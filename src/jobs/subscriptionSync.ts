import { logger } from '../lib/logger.js';
import * as shopsRepo from '../db/repos/shops.js';
import * as imagesRepo from '../db/repos/images.js';
import { adminClient } from '../shopify/context.js';
import { listActiveSubscriptions, planKeyFromSubscriptionName } from '../shopify/billing.js';
import { enqueue } from '../queue/queue.js';
import { getPlan } from '../config/plans.js';

import type { JobContext } from './types.js';

/**
 * Makes our plan record match Shopify's.
 *
 * Shopify is the source of truth for billing: a merchant can cancel from their
 * own admin, a trial can lapse, a charge can be declined. Reconciling here means
 * we never keep serving a plan nobody is paying for, and never withhold one
 * somebody is.
 */
export async function handleSubscriptionSync(ctx: JobContext): Promise<void> {
  const { shop } = ctx;
  const log = logger.child({ shop: shop.domain, job: 'subscription.sync' });
  const client = adminClient(shop);

  const subscriptions = await listActiveSubscriptions(client);
  const active = subscriptions.find((s) => s.status === 'ACTIVE');

  if (!active) {
    if (shop.plan_key !== 'free') {
      await shopsRepo.updateSubscription(shop.id, {
        planKey: 'free',
        subscriptionGid: null,
        status: null,
        trialEndsAt: null,
      });
      log.info('no active subscription; reverted to free plan', { was: shop.plan_key });
    }
    return;
  }

  const planKey = planKeyFromSubscriptionName(active.name) ?? shop.plan_key;
  const trialEndsAt =
    active.trialDays > 0
      ? new Date(new Date(active.createdAt).getTime() + active.trialDays * 86_400_000)
      : null;

  const changed = planKey !== shop.plan_key || active.id !== shop.subscription_gid;
  await shopsRepo.updateSubscription(shop.id, {
    planKey,
    subscriptionGid: active.id,
    status: active.status,
    trialEndsAt,
  });

  if (!changed) return;
  log.info('subscription synced', { plan: planKey, status: active.status, test: active.test });

  // An upgrade should immediately unblock whatever the old allowance stopped.
  const pending = await imagesRepo.countPending(shop.id);
  if (pending > 0 && getPlan(planKey).monthlyImages > getPlan(shop.plan_key).monthlyImages) {
    await enqueue(
      'catalogue.scan',
      { cursor: null, pagesScanned: 0 },
      { shopId: shop.id, priority: 150, dedupeKey: `scan:${shop.id}` },
    );
    log.info('upgrade detected; resuming queued images', { pending });
  }
}
