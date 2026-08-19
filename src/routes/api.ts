import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '../lib/logger.js';
import { BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from '../lib/errors.js';
import { bearerFrom, verifySessionToken } from '../shopify/sessionToken.js';
import { shopSettingsSchema } from '../config/settings.js';
import { PLANS, PLAN_ORDER, getPlan, type PlanKey } from '../config/plans.js';
import * as shopsRepo from '../db/repos/shops.js';
import * as imagesRepo from '../db/repos/images.js';
import * as usageRepo from '../db/repos/usage.js';
import { adminClient } from '../shopify/context.js';
import { FILE_UPDATE } from '../shopify/queries.js';
import { cancelSubscription, createSubscription } from '../shopify/billing.js';
import { depth, enqueue } from '../queue/queue.js';
import type { Shop } from '../db/repos/shops.js';

type ApiEnv = { Variables: { shop: Shop } };

export const apiRoutes = new Hono<ApiEnv>();
const log = logger.child({ component: 'api' });

/**
 * Every /api route is authenticated by an App Bridge session token.
 *
 * Cookies are unreliable inside the Shopify admin iframe, so the short-lived
 * signed JWT the front end fetches per request is the only trustworthy proof of
 * which store the browser is actually in.
 */
apiRoutes.use('/api/*', async (c, next) => {
  const token = bearerFrom(c.req.header('Authorization'));
  if (!token) throw new UnauthorizedError('Missing session token');

  const session = await verifySessionToken(token);
  const shop = await shopsRepo.findByDomain(session.shopDomain);
  if (!shop || shop.uninstalled_at || !shop.accessToken) {
    throw new UnauthorizedError('Shop is not installed');
  }

  c.set('shop', shop);
  await next();
});

/** Everything the dashboard needs for a first paint, in one request. */
apiRoutes.get('/api/state', async (c) => {
  const shop = c.get('shop');
  const [coverage, quota, queue, usage] = await Promise.all([
    imagesRepo.coverage(shop.id),
    shopsRepo.getQuota(shop),
    depth(shop.id),
    usageRepo.history(shop.id, 6),
  ]);

  return c.json({
    shop: {
      domain: shop.domain,
      name: shop.shop_name,
      locale: shop.primary_locale,
      installedAt: shop.installed_at,
    },
    plan: {
      key: shop.plan_key,
      name: getPlan(shop.plan_key).name,
      status: shop.subscription_status,
      trialEndsAt: shop.trial_ends_at,
    },
    plans: PLAN_ORDER.map((k) => PLANS[k]),
    quota,
    coverage,
    backfill: {
      state: shop.backfill_state,
      completedAt: shop.backfill_completed_at,
    },
    queue,
    usage,
    settings: shop.settings,
  });
});

apiRoutes.put('/api/settings', async (c) => {
  const shop = c.get('shop');
  const parsed = shopSettingsSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new BadRequestError('Invalid settings', { issues: parsed.error.issues });
  }

  await shopsRepo.updateSettings(shop.id, parsed.data);
  log.info('settings updated', { shop: shop.domain });
  return c.json({ ok: true, settings: parsed.data });
});

apiRoutes.get('/api/history', async (c) => {
  const shop = c.get('shop');
  const offset = Number.parseInt(c.req.query('offset') ?? '0', 10) || 0;
  const rows = await imagesRepo.recent(shop.id, 25, offset);

  return c.json({
    items: rows.map((r) => ({
      id: r.id,
      productTitle: r.product_title,
      productHandle: r.product_handle,
      imageUrl: r.image_url,
      altBefore: r.alt_before,
      altAfter: r.alt_after,
      status: r.status,
      skipReason: r.skip_reason,
      error: r.error_message,
      updatedAt: r.updated_at,
    })),
    nextOffset: rows.length === 25 ? offset + 25 : null,
  });
});

/**
 * Puts one image back the way it was.
 *
 * Every automated change a merchant cannot undo is a change they will resent.
 * This is cheap to build and it is the difference between a tool they trust
 * with 20,000 images and one they uninstall after three.
 */
apiRoutes.post('/api/images/:id/revert', async (c) => {
  const shop = c.get('shop');
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) throw new BadRequestError('Invalid image id');

  const image = await imagesRepo.findById(shop.id, id);
  if (!image) throw new NotFoundError('Image not found');
  if (image.status !== 'applied') {
    throw new BadRequestError('Only applied changes can be reverted');
  }

  const restore = image.alt_before?.trim() ? image.alt_before : null;
  await adminClient(shop).mutate(
    FILE_UPDATE,
    { files: [{ id: image.media_gid, alt: restore }] },
    (d) => d.fileUpdate,
    'fileUpdate',
  );

  await imagesRepo.markReverted(shop.id, id);
  log.info('alt text reverted', { shop: shop.domain, imageId: id });
  return c.json({ ok: true, restoredTo: restore });
});

/** Re-sweeps the catalogue, e.g. after changing tone or keywords. */
apiRoutes.post('/api/rescan', async (c) => {
  const shop = c.get('shop');
  await shopsRepo.setBackfillState(shop.id, 'running');
  const id = await enqueue(
    'catalogue.scan',
    { cursor: null, pagesScanned: 0 },
    { shopId: shop.id, priority: 150, dedupeKey: `scan:${shop.id}` },
  );
  return c.json({ ok: true, queued: id !== null, alreadyRunning: id === null });
});

const subscribeSchema = z.object({
  plan: z.enum(['starter', 'growth', 'agency']),
  host: z.string().max(400).optional(),
});

apiRoutes.post('/api/billing/subscribe', async (c) => {
  const shop = c.get('shop');
  const parsed = subscribeSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new BadRequestError('Unknown plan');

  const { confirmationUrl, subscriptionGid } = await createSubscription(
    adminClient(shop),
    parsed.data.plan as PlanKey,
    parsed.data.host ?? '',
  );

  log.info('billing confirmation issued', { shop: shop.domain, plan: parsed.data.plan });
  // The merchant must approve the charge on Shopify's own page, at top level.
  return c.json({ confirmationUrl, subscriptionGid });
});

apiRoutes.post('/api/billing/cancel', async (c) => {
  const shop = c.get('shop');
  if (!shop.subscription_gid) throw new BadRequestError('No active subscription');

  await cancelSubscription(adminClient(shop), shop.subscription_gid);
  await shopsRepo.updateSubscription(shop.id, {
    planKey: 'free',
    subscriptionGid: null,
    status: 'CANCELLED',
    trialEndsAt: null,
  });

  log.info('subscription cancelled', { shop: shop.domain });
  return c.json({ ok: true });
});

/** Guards a route behind a paid plan. Currently unused but kept for feature gates. */
export function requirePaidPlan(shop: Shop): void {
  if (getPlan(shop.plan_key).price <= 0) {
    throw new ForbiddenError('This feature requires a paid plan');
  }
}
