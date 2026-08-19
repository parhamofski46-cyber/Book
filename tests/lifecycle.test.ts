import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, query } from '../src/db/pool.js';
import * as images from '../src/db/repos/images.js';
import * as shops from '../src/db/repos/shops.js';
import * as queue from '../src/queue/queue.js';

/**
 * Integration tests against a real Postgres.
 *
 * Skipped automatically when no database is reachable, so `npm test` still runs
 * everywhere; CI provides one.
 */
let reachable = false;
try {
  await query('SELECT 1');
  reachable = true;
} catch {
  reachable = false;
}

const suite = reachable ? describe : describe.skip;

suite('image lifecycle', () => {
  let shopId: number;

  beforeAll(async () => {
    await query('TRUNCATE shops, jobs, images, monthly_usage RESTART IDENTITY CASCADE');
    const shop = await shops.upsertOnInstall('lifecycle.myshopify.com', 'example-token', 'read_products');
    shopId = shop.id;
  });


  const discover = (gid: string, alt: string | null = null) =>
    images.recordDiscovered(shopId, [
      {
        mediaGid: gid,
        productGid: 'gid://shopify/Product/1',
        productTitle: 'Cream Ribbed Knit Jumper',
        productHandle: 'jumper',
        imageUrl: 'https://cdn.shopify.com/x.jpg',
        altBefore: alt,
      },
    ]);

  it('records a discovered image as pending', async () => {
    await discover('gid://shopify/MediaImage/1');
    expect((await images.findByMediaGid(shopId, 'gid://shopify/MediaImage/1'))?.status).toBe('pending');
  });

  it('re-discovering an image does not reset work already done', async () => {
    await images.markApplied(shopId, 'gid://shopify/MediaImage/1', {
      altBefore: null,
      altAfter: 'Ribbed cream jumper with a wide crew neck, worn by a model',
      model: 'claude-opus-5',
      inputTokens: 900,
      outputTokens: 40,
    });
    await discover('gid://shopify/MediaImage/1', 'Ribbed cream jumper with a wide crew neck, worn by a model');

    const row = await images.findByMediaGid(shopId, 'gid://shopify/MediaImage/1');
    expect(row?.status).toBe('applied');
    expect(row?.alt_after).toContain('crew neck');
  });

  it('will not demote an applied image to skipped when the product is re-processed', async () => {
    // Without this guard the merchant's Undo button vanishes and the
    // "written by the app" count silently walks backwards.
    await images.markSkipped(shopId, 'gid://shopify/MediaImage/1', 'already_has_alt', 'anything');
    expect((await images.findByMediaGid(shopId, 'gid://shopify/MediaImage/1'))?.status).toBe('applied');
  });

  it('keeps a reverted image reverted', async () => {
    await images.markReverted(shopId, (await images.findByMediaGid(shopId, 'gid://shopify/MediaImage/1'))!.id);
    await images.markSkipped(shopId, 'gid://shopify/MediaImage/1', 'already_has_alt', null);

    const row = await images.findByMediaGid(shopId, 'gid://shopify/MediaImage/1');
    expect(row?.status).toBe('reverted');

    // And the processor can see that decision before choosing candidates.
    const statuses = await images.statusFor(shopId, ['gid://shopify/MediaImage/1']);
    expect(statuses.get('gid://shopify/MediaImage/1')).toBe('reverted');
  });

  it('counts an image that already had alt text as covered', async () => {
    await discover('gid://shopify/MediaImage/2', 'Merchant wrote this');
    await images.markSkipped(shopId, 'gid://shopify/MediaImage/2', 'already_has_alt', 'Merchant wrote this');
    await discover('gid://shopify/MediaImage/3');

    const stats = await images.coverage(shopId);
    expect(stats.total).toBe(3);
    expect(stats.pending).toBe(1);
    // One reverted + one skipped-as-already-described out of three.
    expect(stats.coveragePercent).toBe(33);
  });
});

suite('quota', () => {
  it('never grants more than the plan allows under concurrency', async () => {
    const shop = await shops.upsertOnInstall('quota.myshopify.com', 'example-token', 'read_products');
    const granted = (
      await Promise.all(Array.from({ length: 40 }, () => shops.tryConsumeQuota(shop.id, 1, 25)))
    ).filter(Boolean).length;
    expect(granted).toBe(25);
  });
});

suite('queue', () => {
  it('collapses duplicate work and frees the key once done', async () => {
    const shop = await shops.upsertOnInstall('queue.myshopify.com', 'example-token', 'read_products');
    const first = await queue.enqueue('product.process', {}, { shopId: shop.id, dedupeKey: 'k' });
    const second = await queue.enqueue('product.process', {}, { shopId: shop.id, dedupeKey: 'k' });
    expect(first).not.toBeNull();
    expect(second).toBeNull();

    const claimed = await queue.claim('test-worker', 1);
    await queue.complete(claimed[0]!.id);
    expect(await queue.enqueue('product.process', {}, { shopId: shop.id, dedupeKey: 'k' })).not.toBeNull();
  });
});

// One teardown for the whole file: closing the pool inside a suite would pull
// it out from under the suites that follow.
afterAll(async () => {
  if (reachable) await pool.end();
});
