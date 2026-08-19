import { logger } from '../lib/logger.js';
import * as shopsRepo from '../db/repos/shops.js';
import { adminClient, fetchStorefrontInfo } from '../shopify/context.js';
import { ensureWebhooks } from '../shopify/webhooks.js';
import { enqueue } from '../queue/queue.js';
import type { JobContext } from './types.js';

/**
 * Runs once per install, after OAuth completes.
 *
 * Deliberately does the slow work off the request path: the merchant lands on a
 * working dashboard in milliseconds while this fills in shop metadata,
 * subscribes webhooks and kicks off the catalogue sweep.
 */
export async function handleShopInstall(ctx: JobContext): Promise<void> {
  const shop = ctx.shop;
  const log = logger.child({ shop: shop.domain, job: 'shop.install' });
  const client = adminClient(shop);

  const info = await fetchStorefrontInfo(client);
  await shopsRepo.updateStorefrontMetadata(shop.id, info);
  log.info('storefront metadata stored', {
    plan: info.planDisplayName,
    locale: info.primaryLocale,
    dev: info.isDevelopmentStore,
  });

  // The shop's own language is a far better default than English.
  if (info.primaryLocale && shop.settings.language === 'en' && !info.primaryLocale.startsWith('en')) {
    await shopsRepo.updateSettings(shop.id, {
      ...shop.settings,
      language: info.primaryLocale,
    });
    log.info('generation language defaulted to shop locale', { locale: info.primaryLocale });
  }

  await ensureWebhooks(client, shop.domain);

  await enqueue(
    'catalogue.scan',
    { cursor: null, pagesScanned: 0 },
    { shopId: shop.id, priority: 200, dedupeKey: `scan:${shop.id}` },
  );
  await shopsRepo.setBackfillState(shop.id, 'running');
  log.info('catalogue sweep queued');
}
