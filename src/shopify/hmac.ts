import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * A myshopify domain, and nothing else.
 *
 * This check is the single most important input validation in a Shopify app:
 * every OAuth redirect and every API call is built from this value. Accepting an
 * attacker-supplied host here turns the install endpoint into an open redirect
 * and leaks credentials to whatever host they name.
 */
const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]{0,59}\.myshopify\.com$/;

export function isValidShopDomain(shop: unknown): shop is string {
  return typeof shop === 'string' && shop.length <= 80 && SHOP_DOMAIN.test(shop.toLowerCase());
}

export function normaliseShopDomain(shop: string): string {
  return shop.trim().toLowerCase();
}

function equals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verifies the `hmac` parameter Shopify appends to redirects (OAuth callback,
 * embedded app load).
 *
 * Shopify's algorithm: drop `hmac` and `signature`, sort the remaining pairs by
 * key, join as `key=value` with `&`, then HMAC-SHA256 with the app secret.
 */
export function verifyQueryHmac(params: URLSearchParams): boolean {
  const provided = params.get('hmac');
  if (!provided) return false;

  const pairs: string[] = [];
  const keys = [...new Set([...params.keys()])].filter((k) => k !== 'hmac' && k !== 'signature');
  keys.sort();
  for (const key of keys) {
    // Repeated keys are joined with commas, matching Shopify's serialisation.
    pairs.push(`${key}=${params.getAll(key).join(',')}`);
  }

  const digest = createHmac('sha256', env.SHOPIFY_API_SECRET).update(pairs.join('&')).digest('hex');
  return equals(digest, provided);
}

/**
 * Verifies a webhook against the raw request body.
 *
 * The body must be the exact bytes Shopify sent — parsing to JSON and
 * re-serialising changes whitespace and key order, and the signature will
 * never match again.
 */
export function verifyWebhookHmac(rawBody: Buffer | string, headerValue: string | undefined): boolean {
  if (!headerValue) return false;
  const digest = createHmac('sha256', env.SHOPIFY_API_SECRET).update(rawBody).digest('base64');
  return equals(digest, headerValue);
}
