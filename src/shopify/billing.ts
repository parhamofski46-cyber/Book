import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { AppError } from '../lib/errors.js';
import { getPlan, type PlanKey } from '../config/plans.js';
import type { ShopifyAdminClient } from './graphql.js';
import { ACTIVE_SUBSCRIPTIONS, SUBSCRIPTION_CANCEL, SUBSCRIPTION_CREATE } from './queries.js';

export interface ActiveSubscription {
  id: string;
  name: string;
  status: string;
  test: boolean;
  trialDays: number;
  createdAt: string;
  currentPeriodEnd: string | null;
}

interface ActiveSubscriptionsData {
  currentAppInstallation: { activeSubscriptions: ActiveSubscription[] } | null;
}

export async function listActiveSubscriptions(
  client: ShopifyAdminClient,
): Promise<ActiveSubscription[]> {
  const data = await client.request<ActiveSubscriptionsData>(
    ACTIVE_SUBSCRIPTIONS,
    {},
    'ActiveSubscriptions',
  );
  return data.currentAppInstallation?.activeSubscriptions ?? [];
}

/**
 * Starts a recurring charge and returns the URL the merchant must visit to
 * approve it. Shopify collects the money and pays out to the Partner account —
 * we never handle a card.
 *
 * `currencyCode` must be USD for app subscriptions; Shopify converts for the
 * merchant at checkout.
 */
export async function createSubscription(
  client: ShopifyAdminClient,
  planKey: PlanKey,
  host: string,
): Promise<{ confirmationUrl: string; subscriptionGid: string }> {
  const plan = getPlan(planKey);
  if (plan.price <= 0) {
    throw new AppError('The free plan does not require a charge', 400, 'billing_free_plan');
  }

  const returnUrl = new URL(`${env.APP_URL}/billing/confirm`);
  returnUrl.searchParams.set('plan', planKey);
  if (host) returnUrl.searchParams.set('host', host);

  const payload = await client.mutate<{
    appSubscription?: { id: string; status: string };
    confirmationUrl?: string;
    userErrors?: Array<{ field?: string[] | null; message: string }>;
  }>(
    SUBSCRIPTION_CREATE,
    {
      name: `Alt Text Autopilot — ${plan.name}`,
      returnUrl: returnUrl.toString(),
      trialDays: plan.trialDays,
      test: env.BILLING_TEST_MODE,
      amount: plan.price.toFixed(2),
      currencyCode: 'USD',
    },
    (d) => d.appSubscriptionCreate,
    'appSubscriptionCreate',
  );

  if (!payload.confirmationUrl || !payload.appSubscription) {
    throw new AppError('Shopify did not return a confirmation URL', 502, 'billing_no_confirm_url');
  }

  logger.info('subscription created', {
    plan: planKey,
    test: env.BILLING_TEST_MODE,
    status: payload.appSubscription.status,
  });

  return {
    confirmationUrl: payload.confirmationUrl,
    subscriptionGid: payload.appSubscription.id,
  };
}

export async function cancelSubscription(
  client: ShopifyAdminClient,
  subscriptionGid: string,
): Promise<void> {
  await client.mutate(
    SUBSCRIPTION_CANCEL,
    { id: subscriptionGid },
    (d) => d.appSubscriptionCancel,
    'appSubscriptionCancel',
  );
}

/** Maps a Shopify subscription name back to our plan key. */
export function planKeyFromSubscriptionName(name: string): PlanKey | null {
  const match = /—\s*(Free|Starter|Growth|Agency)\s*$/i.exec(name.trim());
  const key = match?.[1]?.toLowerCase();
  return key === 'starter' || key === 'growth' || key === 'agency' ? key : null;
}
