import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');

export interface Asset {
  body: string;
  contentType: string;
  etag: string;
}

const assets = new Map<string, Asset>();

/**
 * Loads the front-end assets once at boot and fingerprints them.
 *
 * Serving from memory keeps the request path free of disk I/O, and the content
 * hash in the URL means the browser can cache both files forever while a deploy
 * still takes effect immediately.
 */
export async function loadAssets(): Promise<void> {
  const files: Array<[string, string]> = [
    ['app.css', 'text/css; charset=utf-8'],
    ['app.js', 'text/javascript; charset=utf-8'],
  ];

  for (const [name, contentType] of files) {
    const body = await readFile(join(publicDir, name), 'utf8');
    const etag = createHash('sha256').update(body).digest('hex').slice(0, 12);
    assets.set(name, { body, contentType, etag });
  }
}

export function getAsset(name: string): Asset | undefined {
  return assets.get(name);
}

function assetUrl(name: string): string {
  const asset = assets.get(name);
  return `/static/${name}?v=${asset?.etag ?? 'dev'}`;
}

/**
 * The embedded admin page.
 *
 * Everything dynamic is fetched by the client with a session token, so this
 * document is identical for every merchant and safe to cache.
 */
export function renderDashboard(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Alt Text Autopilot</title>
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" data-api-key="${escapeAttr(env.SHOPIFY_API_KEY)}"></script>
  <link rel="stylesheet" href="${assetUrl('app.css')}">
</head>
<body>
  <main id="root" aria-busy="true">
    <div class="loading" role="status">
      <span class="spinner" aria-hidden="true"></span>
      Loading your catalogue…
    </div>
  </main>
  <script type="module" src="${assetUrl('app.js')}"></script>
</body>
</html>`;
}

/** Minimal page shown when the app is opened outside the Shopify admin. */
export function renderInstallPrompt(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Alt Text Autopilot</title>
  <link rel="stylesheet" href="${assetUrl('app.css')}">
</head>
<body>
  <main>
    <header class="app"><h1>Alt Text Autopilot</h1></header>
    <section class="card">
      <h2>Open this app from your Shopify admin</h2>
      <p class="muted small" style="margin-top:8px">
        Alt Text Autopilot runs inside the Shopify admin. Install it from the Shopify App Store,
        then find it under Apps.
      </p>
    </section>
  </main>
</body>
</html>`;
}

function escapeAttr(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}
