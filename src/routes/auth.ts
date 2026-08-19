import { Hono } from 'hono';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { BadRequestError } from '../lib/errors.js';
import { isValidShopDomain, normaliseShopDomain, verifyQueryHmac } from '../shopify/hmac.js';
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  iframeBreakoutHtml,
  scopesSatisfied,
} from '../shopify/oauth.js';
import * as shopsRepo from '../db/repos/shops.js';
import * as eventsRepo from '../db/repos/events.js';
import { enqueue } from '../queue/queue.js';

export const authRoutes = new Hono();
const log = logger.child({ component: 'auth' });

/**
 * Start of the install. Reached from the app listing, from a re-install, and
 * whenever the embedded app finds its granted scopes are out of date.
 */
authRoutes.get('/auth', async (c) => {
  const shop = normaliseShopDomain(c.req.query('shop') ?? '');
  if (!isValidShopDomain(shop)) {
    throw new BadRequestError('Missing or invalid shop parameter');
  }

  const state = await eventsRepo.createOAuthState(shop);
  const authorizeUrl = buildAuthorizeUrl(shop, state);
  log.info('starting oauth', { shop });

  // Shopify's consent screen refuses to render in our iframe, so the redirect
  // has to happen on the top window.
  return c.html(iframeBreakoutHtml(authorizeUrl));
});

/** Shopify sends the merchant back here after they approve the scopes. */
authRoutes.get('/auth/callback', async (c) => {
  const url = new URL(c.req.url);
  const params = url.searchParams;

  if (!verifyQueryHmac(params)) {
    log.warn('oauth callback failed hmac verification');
    throw new BadRequestError('Request signature verification failed');
  }

  const shop = normaliseShopDomain(params.get('shop') ?? '');
  const code = params.get('code');
  const state = params.get('state');
  const host = params.get('host') ?? '';

  if (!isValidShopDomain(shop) || !code || !state) {
    throw new BadRequestError('Malformed OAuth callback');
  }

  // Single-use nonce, bound to the shop it was issued for. This is what stops
  // an attacker from replaying a callback against a different store.
  const issuedFor = await eventsRepo.consumeOAuthState(state);
  if (issuedFor !== shop) {
    log.warn('oauth state mismatch', { shop, issuedFor });
    throw new BadRequestError('Invalid or expired OAuth state');
  }

  const { accessToken, scope } = await exchangeCodeForToken(shop, code);
  const stored = await shopsRepo.upsertOnInstall(shop, accessToken, scope);
  log.info('install complete', { shop, scopes: scope });

  // Setup runs in the background; the merchant sees the dashboard immediately.
  await enqueue('shop.install', {}, { shopId: stored.id, priority: 10, dedupeKey: `install:${stored.id}` });
  await enqueue('subscription.sync', {}, { shopId: stored.id, priority: 20 });

  const target = new URL(`https://${shop}/admin/apps/${env.SHOPIFY_API_KEY}`);
  if (host) target.searchParams.set('host', host);
  return c.html(iframeBreakoutHtml(target.toString()));
});

/**
 * True when the stored grant no longer covers what the app needs — for example
 * after a release that added a scope. The embedded entry point uses this to
 * send the merchant back through consent.
 */
export function needsReauth(shop: { scopes: string; accessToken: string | null }): boolean {
  return !shop.accessToken || !scopesSatisfied(shop.scopes);
}
