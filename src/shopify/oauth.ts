import { env, requiredScopes } from '../config/env.js';
import { BadRequestError, AppError } from '../lib/errors.js';
import { isValidShopDomain } from './hmac.js';

export const INSTALL_CALLBACK_PATH = '/auth/callback';

export interface TokenExchangeResult {
  accessToken: string;
  scope: string;
}

/** Builds the URL we send the merchant to in order to grant scopes. */
export function buildAuthorizeUrl(shopDomain: string, state: string): string {
  if (!isValidShopDomain(shopDomain)) {
    throw new BadRequestError('Invalid shop domain');
  }
  const url = new URL(`https://${shopDomain}/admin/oauth/authorize`);
  url.searchParams.set('client_id', env.SHOPIFY_API_KEY);
  url.searchParams.set('scope', requiredScopes.join(','));
  url.searchParams.set('redirect_uri', `${env.APP_URL}${INSTALL_CALLBACK_PATH}`);
  url.searchParams.set('state', state);
  return url.toString();
}

/** Exchanges the one-time OAuth code for a permanent offline access token. */
export async function exchangeCodeForToken(
  shopDomain: string,
  code: string,
): Promise<TokenExchangeResult> {
  const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: env.SHOPIFY_API_KEY,
      client_secret: env.SHOPIFY_API_SECRET,
      code,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AppError(
      `Token exchange failed (${res.status}): ${body.slice(0, 200)}`,
      502,
      'oauth_exchange_failed',
    );
  }

  const json = (await res.json()) as { access_token?: string; scope?: string };
  if (!json.access_token) {
    throw new AppError('Token exchange returned no access_token', 502, 'oauth_no_token');
  }
  return { accessToken: json.access_token, scope: json.scope ?? '' };
}

/**
 * True when the granted scopes cover everything we need.
 *
 * Shopify does not re-prompt automatically when an app adds a scope, so this is
 * how an existing install gets nudged back through the consent screen after a
 * deploy that widened `SHOPIFY_SCOPES`.
 */
export function scopesSatisfied(granted: string): boolean {
  const have = new Set(
    granted
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return requiredScopes.every((s) => have.has(s));
}

/**
 * The embedded-app entry point must break out of the Shopify iframe before
 * starting OAuth — Shopify's authorize page sets `X-Frame-Options` and will not
 * render inside our frame. Returning HTML that redirects the top window is the
 * documented escape hatch.
 */
export function iframeBreakoutHtml(target: string): string {
  const safe = JSON.stringify(target);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Redirecting…</title></head>
<body>
<script>
  var target = ${safe};
  if (window.top === window.self) { window.location.href = target; }
  else { window.top.location.href = target; }
</script>
<noscript><a href="${escapeHtml(target)}">Continue installing</a></noscript>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}
