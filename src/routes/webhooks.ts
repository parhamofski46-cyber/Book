import { Hono, type Context } from 'hono';
import { logger } from '../lib/logger.js';
import { verifyWebhookHmac, isValidShopDomain, normaliseShopDomain } from '../shopify/hmac.js';
import * as shopsRepo from '../db/repos/shops.js';
import * as eventsRepo from '../db/repos/events.js';
import { enqueue } from '../queue/queue.js';

export const webhookRoutes = new Hono();
const log = logger.child({ component: 'webhooks' });

interface VerifiedWebhook {
  topic: string;
  shopDomain: string;
  webhookId: string;
  body: Record<string, unknown>;
}

/**
 * Verifies a webhook and returns its parsed body, or null when it must be
 * ignored (bad signature, replay).
 *
 * The signature is computed over the exact bytes Shopify sent. Parsing to JSON
 * and re-serialising reorders keys and changes whitespace, and the signature
 * would never match again — so the raw buffer is read first, always.
 */
async function verify(c: Context): Promise<VerifiedWebhook | null> {
  const raw = Buffer.from(await c.req.arrayBuffer());
  const signature = c.req.header('X-Shopify-Hmac-Sha256');

  if (!verifyWebhookHmac(raw, signature)) {
    log.warn('webhook rejected: bad signature', { topic: c.req.header('X-Shopify-Topic') });
    return null;
  }

  const topic = c.req.header('X-Shopify-Topic') ?? 'unknown';
  const shopDomain = normaliseShopDomain(c.req.header('X-Shopify-Shop-Domain') ?? '');
  const webhookId = c.req.header('X-Shopify-Webhook-Id') ?? '';

  if (!isValidShopDomain(shopDomain)) {
    log.warn('webhook rejected: bad shop domain', { topic });
    return null;
  }

  // Shopify retries on any non-2xx and occasionally duplicates on success.
  if (webhookId && !(await eventsRepo.claimWebhook(webhookId, topic, shopDomain))) {
    log.debug('duplicate webhook ignored', { topic, webhookId });
    return null;
  }

  let body: Record<string, unknown> = {};
  try {
    body = raw.length > 0 ? (JSON.parse(raw.toString('utf8')) as Record<string, unknown>) : {};
  } catch {
    log.warn('webhook body was not valid JSON', { topic });
  }

  return { topic, shopDomain, webhookId, body };
}

/**
 * Product created or updated.
 *
 * This single handler is what makes the app an autopilot rather than a one-off
 * bulk tool: a merchant uploading a product at 3am gets alt text without ever
 * opening the app.
 */
for (const path of ['/webhooks/products-create', '/webhooks/products-update']) {
  webhookRoutes.post(path, async (c) => {
    const event = await verify(c);
    if (!event) return c.body(null, 200); // never make Shopify retry a rejected event

    const shop = await shopsRepo.findByDomain(event.shopDomain);
    if (!shop || shop.uninstalled_at || !shop.settings.autoProcessNewProducts) {
      return c.body(null, 200);
    }

    const productId = event.body['admin_graphql_api_id'] ?? event.body['id'];
    if (!productId) return c.body(null, 200);

    const productGid =
      typeof productId === 'string' ? productId : `gid://shopify/Product/${String(productId)}`;

    await enqueue(
      'product.process',
      { productGid },
      {
        shopId: shop.id,
        // Live merchant activity outranks the bulk backfill.
        priority: 50,
        // A product saved five times in a minute is described once.
        dedupeKey: `product:${shop.id}:${productGid}`,
        // Give the merchant a moment to finish editing before we look.
        runAt: new Date(Date.now() + 20_000),
      },
    );
    return c.body(null, 200);
  });
}

webhookRoutes.post('/webhooks/app-uninstalled', async (c) => {
  const event = await verify(c);
  if (!event) return c.body(null, 200);

  await shopsRepo.markUninstalled(event.shopDomain);
  log.info('app uninstalled; token destroyed', { shop: event.shopDomain });
  return c.body(null, 200);
});

webhookRoutes.post('/webhooks/app-subscriptions-update', async (c) => {
  const event = await verify(c);
  if (!event) return c.body(null, 200);

  const shop = await shopsRepo.findByDomain(event.shopDomain);
  if (shop && !shop.uninstalled_at) {
    await enqueue('subscription.sync', {}, { shopId: shop.id, priority: 20 });
  }
  return c.body(null, 200);
});

// ---------------------------------------------------------------------------
// Mandatory compliance webhooks.
//
// Shopify sends these to every app and rejects app submissions that do not
// answer them. They are configured in the Partner Dashboard, not via the API.
// ---------------------------------------------------------------------------

/**
 * A shopper asked what personal data this app holds about them.
 *
 * The honest answer is none: this app reads product images and writes alt text.
 * It never touches customers, orders, or addresses. Responding 200 with nothing
 * to report is the correct and complete answer.
 */
webhookRoutes.post('/webhooks/customers-data-request', async (c) => {
  const event = await verify(c);
  if (event) {
    log.info('customer data request received; app stores no customer data', {
      shop: event.shopDomain,
    });
  }
  return c.body(null, 200);
});

/** A shopper asked to be erased. Again: we hold no customer data. */
webhookRoutes.post('/webhooks/customers-redact', async (c) => {
  const event = await verify(c);
  if (event) {
    log.info('customer redaction request received; no customer data held', {
      shop: event.shopDomain,
    });
  }
  return c.body(null, 200);
});

/**
 * Sent 48 hours after uninstall. Everything we hold about the store — settings,
 * image history, usage — is deleted for real, not soft-deleted.
 */
webhookRoutes.post('/webhooks/shop-redact', async (c) => {
  const event = await verify(c);
  if (!event) return c.body(null, 200);

  await shopsRepo.purge(event.shopDomain);
  log.info('shop data purged on request', { shop: event.shopDomain });
  return c.body(null, 200);
});
