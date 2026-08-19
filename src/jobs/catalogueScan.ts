import { logger } from '../lib/logger.js';
import * as imagesRepo from '../db/repos/images.js';
import * as shopsRepo from '../db/repos/shops.js';
import { adminClient } from '../shopify/context.js';
import { PRODUCTS_PAGE, type ProductsPageData, type ProductNode } from '../shopify/queries.js';
import { clearDedupeKey, enqueue } from '../queue/queue.js';
import type { JobContext } from './types.js';

/** Chosen so the calculated query cost stays well inside Shopify's 2,000-point bucket. */
const PRODUCTS_PER_PAGE = 20;
const MEDIA_PER_PRODUCT = 50;

export interface CataloguePayload {
  cursor: string | null;
  pagesScanned: number;
}

/**
 * Walks the whole catalogue one page at a time, recording every product image
 * and queueing the products that need work.
 *
 * Each invocation handles a single page and then re-queues itself. Short jobs
 * mean a deploy or a crash costs one page, not an entire sweep, and a merchant
 * who edits a product mid-backfill is not stuck behind it.
 */
export async function handleCatalogueScan(ctx: JobContext): Promise<void> {
  const { shop, job } = ctx;
  const payload = job.payload as unknown as CataloguePayload;
  const log = logger.child({ shop: shop.domain, job: 'catalogue.scan' });
  const client = adminClient(shop);

  const data = await client.request<ProductsPageData>(
    PRODUCTS_PAGE,
    { first: PRODUCTS_PER_PAGE, after: payload.cursor, mediaFirst: MEDIA_PER_PRODUCT },
    'ProductsPage',
  );

  const products = data.products.nodes;
  let discovered = 0;
  let queued = 0;

  for (const product of products) {
    const images = collectImages(product);
    if (images.length === 0) continue;

    await imagesRepo.recordDiscovered(shop.id, images);
    discovered += images.length;

    // Only bother the worker for products that actually have something to do.
    const needsWork =
      shop.settings.overwriteExisting ||
      images.some((i) => !i.altBefore || i.altBefore.trim() === '') ||
      product.media.pageInfo.hasNextPage;

    if (needsWork) {
      await enqueue(
        'product.process',
        { productGid: product.id },
        {
          shopId: shop.id,
          priority: 200, // backfill yields to live webhook traffic
          dedupeKey: `product:${shop.id}:${product.id}`,
        },
      );
      queued += 1;
    } else {
      for (const image of images) {
        await imagesRepo.markSkipped(shop.id, image.mediaGid, 'already_has_alt', image.altBefore);
      }
    }
  }

  const pagesScanned = (payload.pagesScanned ?? 0) + 1;
  log.info('catalogue page scanned', {
    page: pagesScanned,
    products: products.length,
    discovered,
    queued,
  });

  if (data.products.pageInfo.hasNextPage && data.products.pageInfo.endCursor) {
    // Free the key before queueing the successor: this job still holds it.
    await clearDedupeKey(job.id);
    await enqueue(
      'catalogue.scan',
      { cursor: data.products.pageInfo.endCursor, pagesScanned },
      { shopId: shop.id, priority: 200, dedupeKey: `scan:${shop.id}` },
    );
  } else {
    await shopsRepo.setBackfillState(shop.id, 'done');
    log.info('catalogue sweep complete', { pages: pagesScanned });
  }
}

/** Media connections mix types; non-image nodes arrive as empty objects. */
export function collectImages(product: ProductNode): imagesRepo.DiscoveredImage[] {
  return product.media.nodes
    .filter((n): n is Required<Pick<typeof n, 'id'>> & typeof n => typeof n.id === 'string')
    .map((node) => ({
      mediaGid: node.id!,
      productGid: product.id,
      productTitle: product.title,
      productHandle: product.handle,
      imageUrl: node.image?.url ?? null,
      altBefore: node.alt ?? null,
    }));
}
