import { query } from '../pool.js';
import { randomToken } from '../../lib/crypto.js';

/**
 * Shopify redelivers webhooks on any non-2xx and occasionally on success.
 * Returns true only the first time a given webhook id is seen.
 */
export async function claimWebhook(
  webhookId: string,
  topic: string,
  shopDomain: string,
): Promise<boolean> {
  const { rowCount } = await query(
    `INSERT INTO webhook_events (webhook_id, topic, shop_domain)
     VALUES ($1, $2, $3) ON CONFLICT (webhook_id) DO NOTHING`,
    [webhookId, topic, shopDomain],
  );
  return (rowCount ?? 0) > 0;
}

/** Creates a single-use OAuth nonce and returns it. */
export async function createOAuthState(shopDomain: string): Promise<string> {
  const state = randomToken(32);
  await query(`INSERT INTO oauth_states (state, shop_domain) VALUES ($1, $2)`, [state, shopDomain]);
  return state;
}

/**
 * Consumes a nonce. Returns the shop it was issued for, or null when the state
 * is unknown, already used, or older than 15 minutes.
 */
export async function consumeOAuthState(state: string): Promise<string | null> {
  const { rows } = await query<{ shop_domain: string }>(
    `DELETE FROM oauth_states
      WHERE state = $1 AND created_at > now() - INTERVAL '15 minutes'
      RETURNING shop_domain`,
    [state],
  );
  return rows[0]?.shop_domain ?? null;
}
