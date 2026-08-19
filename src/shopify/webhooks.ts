import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import type { ShopifyAdminClient } from './graphql.js';
import { WEBHOOK_CREATE, WEBHOOK_LIST } from './queries.js';

/**
 * Topics the app subscribes to.
 *
 * PRODUCTS_CREATE/UPDATE are what make this "autopilot" — a merchant uploading
 * a product at 3am gets alt text without touching the app. APP_UNINSTALLED lets
 * us destroy the access token promptly. APP_SUBSCRIPTIONS_UPDATE keeps our idea
 * of the plan in sync when a merchant cancels from Shopify's own billing page.
 *
 * The three GDPR/compliance topics (customers/data_request, customers/redact,
 * shop/redact) are configured in the Partner Dashboard, not here — Shopify
 * sends them regardless of subscription, and we serve them at /webhooks/*.
 */
export const WEBHOOK_TOPICS = [
  'PRODUCTS_CREATE',
  'PRODUCTS_UPDATE',
  'APP_UNINSTALLED',
  'APP_SUBSCRIPTIONS_UPDATE',
] as const;

export type WebhookTopic = (typeof WEBHOOK_TOPICS)[number];

/** Maps a GraphQL enum topic to the path we expose for it. */
export function callbackUrlFor(topic: WebhookTopic): string {
  const path = topic.toLowerCase().replace(/_/g, '-');
  return `${env.APP_URL}/webhooks/${path}`;
}

interface WebhookListData {
  webhookSubscriptions: {
    nodes: Array<{
      id: string;
      topic: string;
      endpoint: { callbackUrl?: string } | null;
    }>;
  };
}

/**
 * Idempotently ensures every topic is subscribed with the current callback URL.
 * Safe to run on every install and on every deploy.
 */
export async function ensureWebhooks(client: ShopifyAdminClient, shopDomain: string): Promise<void> {
  const log = logger.child({ shop: shopDomain, component: 'webhooks' });

  const existing = await client.request<WebhookListData>(WEBHOOK_LIST, { first: 100 }, 'WebhookList');
  const registered = new Map(
    existing.webhookSubscriptions.nodes.map((n) => [n.topic, n.endpoint?.callbackUrl ?? '']),
  );

  for (const topic of WEBHOOK_TOPICS) {
    const wanted = callbackUrlFor(topic);
    if (registered.get(topic) === wanted) continue;

    try {
      await client.mutate(
        WEBHOOK_CREATE,
        { topic, callbackUrl: wanted },
        (d) => d.webhookSubscriptionCreate,
        'webhookSubscriptionCreate',
      );
      log.info('webhook registered', { topic, callbackUrl: wanted });
    } catch (err) {
      // A stale subscription on a previous URL makes the create fail with
      // "already taken"; that is not fatal, and the next deploy retries.
      log.warn('webhook registration failed', { topic, err });
    }
  }
}
