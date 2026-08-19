import { Hono, type Context } from 'hono';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { isValidShopDomain, normaliseShopDomain, verifyQueryHmac } from '../shopify/hmac.js';
import { iframeBreakoutHtml } from '../shopify/oauth.js';
import { getAsset, renderDashboard, renderInstallPrompt } from '../ui/dashboard.js';
import * as shopsRepo from '../db/repos/shops.js';
import { enqueue } from '../queue/queue.js';
import { needsReauth } from './auth.js';

export const appRoutes = new Hono();
const log = logger.child({ component: 'app' });

/** Fingerprinted, immutable front-end assets. */
appRoutes.get('/static/:name', (c) => {
  const asset = getAsset(c.req.param('name'));
  if (!asset) return c.text('Not found', 404);

  if (c.req.header('If-None-Match') === asset.etag) return c.body(null, 304);

  c.header('Content-Type', asset.contentType);
  c.header('ETag', asset.etag);
  c.header('Cache-Control', 'public, max-age=31536000, immutable');
  return c.body(asset.body);
});

/**
 * The embedded app entry point.
 *
 * Shopify loads this inside an iframe in the merchant's admin. Three things
 * have to be right or the page is either blank or insecure: the request has to
 * be verified, the frame-ancestors policy has to name the shop, and a store
 * that is not installed (or whose grant is stale) has to be sent to OAuth on
 * the top window rather than inside our frame.
 */
appRoutes.get('/', async (c) => {
  const url = new URL(c.req.url);
  const shopParam = normaliseShopDomain(url.searchParams.get('shop') ?? '');

  if (!isValidShopDomain(shopParam)) {
    // Opened directly in a browser rather than from the admin.
    setFrameAncestors(c, null);
    return c.html(renderInstallPrompt());
  }

  // Shopify signs the embedded load. An unsigned request is either a probe or a
  // misconfiguration; either way it does not get a session.
  if (url.searchParams.has('hmac') && !verifyQueryHmac(url.searchParams)) {
    log.warn('embedded load failed hmac verification', { shop: shopParam });
    setFrameAncestors(c, shopParam);
    return c.text('Request signature verification failed', 401);
  }

  const shop = await shopsRepo.findByDomain(shopParam);
  if (!shop || shop.uninstalled_at || needsReauth(shop)) {
    const target = new URL(`${env.APP_URL}/auth`);
    target.searchParams.set('shop', shopParam);
    setFrameAncestors(c, shopParam);
    return c.html(iframeBreakoutHtml(target.toString()));
  }

  setFrameAncestors(c, shopParam);
  return c.html(renderDashboard());
});

/**
 * Where Shopify sends the merchant after they approve or decline a charge.
 *
 * We do not trust the query string about what was approved — a sync job asks
 * Shopify directly, which is the only account of billing that matters.
 */
appRoutes.get('/billing/confirm', async (c) => {
  const shopParam = normaliseShopDomain(c.req.query('shop') ?? '');
  const host = c.req.query('host') ?? '';

  if (isValidShopDomain(shopParam)) {
    const shop = await shopsRepo.findByDomain(shopParam);
    if (shop && !shop.uninstalled_at) {
      await enqueue('subscription.sync', {}, { shopId: shop.id, priority: 10 });
    }
  }

  const target = new URL(`https://${shopParam}/admin/apps/${env.SHOPIFY_API_KEY}`);
  if (host) target.searchParams.set('host', host);
  return c.html(iframeBreakoutHtml(target.toString()));
});

/**
 * Declares who may frame this page.
 *
 * Shopify requires embedded apps to allow exactly the merchant's own admin, and
 * nobody else. A wildcard here would let any site frame the app and clickjack a
 * logged-in merchant.
 */
function setFrameAncestors(c: Context, shop: string | null): void {
  const ancestors = shop
    ? `frame-ancestors https://${shop} https://admin.shopify.com`
    : "frame-ancestors 'none'";
  c.header('Content-Security-Policy', ancestors);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
}
