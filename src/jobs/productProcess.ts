import { logger } from '../lib/logger.js';
import { mapLimit } from '../lib/concurrency.js';
import { isRetryable } from '../lib/errors.js';
import { getPlan } from '../config/plans.js';
import * as imagesRepo from '../db/repos/images.js';
import * as shopsRepo from '../db/repos/shops.js';
import * as usageRepo from '../db/repos/usage.js';
import { adminClient } from '../shopify/context.js';
import { ShopifyUserError, type ShopifyAdminClient } from '../shopify/graphql.js';
import { FILE_UPDATE, PRODUCT_MEDIA, type ProductMediaData, type ProductNode } from '../shopify/queries.js';
import { collectImages } from './catalogueScan.js';
import { generateAltText } from '../alt/generator.js';
import type { JobContext } from './types.js';

const MEDIA_PAGE_SIZE = 50;
/** Model calls per product. Products rarely have many images, and Shopify's
 *  bucket is the real constraint — three in flight keeps latency low without
 *  crowding out other shops. */
const GENERATION_CONCURRENCY = 3;

export interface ProductPayload {
  productGid: string;
}

interface Applied {
  mediaGid: string;
  altBefore: string | null;
  altText: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Describes every image on one product.
 *
 * This is the unit of work for both the initial backfill and the live webhook
 * path, which means a merchant uploading a product gets exactly the same
 * treatment as their existing catalogue — that consistency is the product.
 */
export async function handleProductProcess(ctx: JobContext): Promise<void> {
  const { shop } = ctx;
  const { productGid } = ctx.job.payload as unknown as ProductPayload;
  const log = logger.child({ shop: shop.domain, job: 'product.process', productGid });
  const client = adminClient(shop);

  const product = await fetchProductWithAllMedia(client, productGid);
  if (!product) {
    log.info('product no longer exists; nothing to do');
    return;
  }

  const images = collectImages(product);
  if (images.length === 0) return;
  await imagesRepo.recordDiscovered(shop.id, images);

  // Two things are off limits here.
  //
  // Images that already carry alt text are left alone unless the merchant
  // explicitly opted into overwriting — silently replacing a human's words is
  // the fastest way to lose their trust. And an image the merchant undid stays
  // undone: re-describing it tomorrow would override an explicit decision.
  const stored = await imagesRepo.statusFor(
    shop.id,
    images.map((i) => i.mediaGid),
  );

  const candidates = images.filter((img) => {
    if (stored.get(img.mediaGid) === 'reverted') return false;
    return shop.settings.overwriteExisting || !img.altBefore || img.altBefore.trim() === '';
  });

  const candidateGids = new Set(candidates.map((c) => c.mediaGid));
  for (const img of images) {
    if (!candidateGids.has(img.mediaGid)) {
      await imagesRepo.markSkipped(shop.id, img.mediaGid, 'already_has_alt', img.altBefore);
    }
  }
  if (candidates.length === 0) return;

  const limit = getPlan(shop.plan_key).monthlyImages;
  let quotaBlocked = false;
  let inputTokens = 0;
  let outputTokens = 0;
  const applied: Applied[] = [];

  await mapLimit(candidates, GENERATION_CONCURRENCY, async (image, index) => {
    if (quotaBlocked || !image.imageUrl) {
      if (!image.imageUrl) {
        await imagesRepo.markSkipped(shop.id, image.mediaGid, 'no_image_url', image.altBefore);
      }
      return;
    }

    // Reserve before spending. The reservation is atomic, so parallel workers
    // across every product of this shop share one honest counter.
    if (!(await shopsRepo.tryConsumeQuota(shop.id, 1, limit))) {
      quotaBlocked = true;
      log.info('monthly allowance reached; remaining images stay queued', { plan: shop.plan_key });
      return;
    }

    let outcome;
    try {
      outcome = await generateAltText({
        imageUrl: image.imageUrl,
        product: {
          title: product.title,
          productType: product.productType,
          vendor: product.vendor,
          position: index + 1,
          totalImages: candidates.length,
        },
        settings: shop.settings,
      });
    } catch (err) {
      await shopsRepo.releaseQuota(shop.id, 1);
      if (isRetryable(err)) throw err; // let the queue back off and retry the product
      await imagesRepo.markFailed(shop.id, image.mediaGid, (err as Error).message);
      log.warn('generation failed', { mediaGid: image.mediaGid, err });
      return;
    }

    inputTokens += outcome.inputTokens;
    outputTokens += outcome.outputTokens;

    if (!outcome.ok) {
      // A decorative image genuinely consumed a model call, so it keeps its
      // reservation. Everything else is our problem, not the merchant's.
      if (outcome.reason !== 'decorative') {
        await shopsRepo.releaseQuota(shop.id, 1);
      }
      await imagesRepo.markSkipped(shop.id, image.mediaGid, outcome.reason, image.altBefore);
      log.debug('image not described', { mediaGid: image.mediaGid, reason: outcome.reason });
      return;
    }

    applied.push({
      mediaGid: image.mediaGid,
      altBefore: image.altBefore,
      altText: outcome.altText,
      model: outcome.model,
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
    });
  });

  if (applied.length > 0) {
    await writeBackAltText(client, shop.id, applied, log);
  }

  if (inputTokens > 0 || outputTokens > 0) {
    await usageRepo.recordUsage(shop.id, applied.length, inputTokens, outputTokens);
  }

  log.info('product processed', {
    images: images.length,
    described: applied.length,
    quotaBlocked,
  });
}

/**
 * Writes the new alt text back to Shopify.
 *
 * The batch mutation is tried first because it is one request for the whole
 * product. If Shopify rejects the batch — one unpublished or deleted media is
 * enough — we fall back to per-file writes so a single bad image cannot discard
 * the work done on its siblings.
 */
async function writeBackAltText(
  client: ShopifyAdminClient,
  shopId: number,
  applied: readonly Applied[],
  log: ReturnType<typeof logger.child>,
): Promise<void> {
  const files = applied.map((a) => ({ id: a.mediaGid, alt: a.altText }));

  try {
    await client.mutate(FILE_UPDATE, { files }, (d) => d.fileUpdate, 'fileUpdate');
    for (const a of applied) {
      await imagesRepo.markApplied(shopId, a.mediaGid, {
        altBefore: a.altBefore,
        altAfter: a.altText,
        model: a.model,
        inputTokens: a.inputTokens,
        outputTokens: a.outputTokens,
      });
    }
    return;
  } catch (err) {
    if (!(err instanceof ShopifyUserError)) throw err;
    log.warn('batch alt write rejected; retrying one at a time', {
      count: files.length,
      userErrors: err.userErrors,
    });
  }

  for (const a of applied) {
    try {
      await client.mutate(
        FILE_UPDATE,
        { files: [{ id: a.mediaGid, alt: a.altText }] },
        (d) => d.fileUpdate,
        'fileUpdate',
      );
      await imagesRepo.markApplied(shopId, a.mediaGid, {
        altBefore: a.altBefore,
        altAfter: a.altText,
        model: a.model,
        inputTokens: a.inputTokens,
        outputTokens: a.outputTokens,
      });
    } catch (err) {
      await imagesRepo.markFailed(shopId, a.mediaGid, (err as Error).message);
    }
  }
}

/** Follows the media cursor so products with more than one page are complete. */
async function fetchProductWithAllMedia(
  client: ShopifyAdminClient,
  productGid: string,
): Promise<ProductNode | null> {
  const first = await client.request<ProductMediaData>(
    PRODUCT_MEDIA,
    { id: productGid, first: MEDIA_PAGE_SIZE, after: null },
    'ProductMedia',
  );
  const product = first.product;
  if (!product) return null;

  let pageInfo = product.media.pageInfo;
  let guard = 0;
  while (pageInfo.hasNextPage && pageInfo.endCursor && guard < 20) {
    guard += 1;
    const next = await client.request<ProductMediaData>(
      PRODUCT_MEDIA,
      { id: productGid, first: MEDIA_PAGE_SIZE, after: pageInfo.endCursor },
      'ProductMedia',
    );
    if (!next.product) break;
    product.media.nodes.push(...next.product.media.nodes);
    pageInfo = next.product.media.pageInfo;
  }

  return product;
}
