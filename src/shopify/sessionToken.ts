import { jwtVerify, type JWTPayload } from 'jose';
import { env } from '../config/env.js';
import { UnauthorizedError } from '../lib/errors.js';
import { isValidShopDomain, normaliseShopDomain } from './hmac.js';

const secret = new TextEncoder().encode(env.SHOPIFY_API_SECRET);

export interface SessionTokenClaims extends JWTPayload {
  /** Storefront the request came from, e.g. https://example.myshopify.com */
  dest: string;
  /** Our API key — proves the token was minted for this app. */
  aud: string;
  /** Shopify staff user id, present on online tokens. */
  sub?: string;
  sid?: string;
}

export interface VerifiedSession {
  shopDomain: string;
  userId: string | undefined;
  expiresAt: Date;
}

/**
 * Verifies an App Bridge session token.
 *
 * These are short-lived (about a minute) HS256 JWTs signed with the app secret.
 * They are how an embedded admin page proves which store the browser is inside
 * — cookies are unreliable in the Shopify admin iframe, so this is the only
 * trustworthy identity signal for API calls from the front end.
 */
export async function verifySessionToken(token: string): Promise<VerifiedSession> {
  let payload: SessionTokenClaims;
  try {
    const result = await jwtVerify<SessionTokenClaims>(token, secret, {
      algorithms: ['HS256'],
      audience: env.SHOPIFY_API_KEY,
      clockTolerance: 10,
    });
    payload = result.payload;
  } catch (err) {
    throw new UnauthorizedError('Invalid session token', { reason: (err as Error).message });
  }

  if (!payload.dest || !payload.iss) {
    throw new UnauthorizedError('Session token is missing dest or iss');
  }

  // `iss` is the admin URL and `dest` the storefront URL for the same shop.
  // A mismatch means the token was minted for a different store.
  let destHost: string;
  let issHost: string;
  try {
    destHost = new URL(payload.dest).host;
    issHost = new URL(payload.iss).host;
  } catch {
    throw new UnauthorizedError('Session token has malformed dest/iss');
  }
  if (destHost !== issHost) {
    throw new UnauthorizedError('Session token dest does not match iss');
  }

  const shopDomain = normaliseShopDomain(destHost);
  if (!isValidShopDomain(shopDomain)) {
    throw new UnauthorizedError('Session token names a non-Shopify host', { host: destHost });
  }

  return {
    shopDomain,
    userId: payload.sub,
    expiresAt: new Date((payload.exp ?? 0) * 1000),
  };
}

/** Pulls a bearer token out of an Authorization header. */
export function bearerFrom(header: string | undefined | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? null;
}
