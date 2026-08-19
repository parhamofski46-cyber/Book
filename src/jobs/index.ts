import type { JobType } from '../queue/queue.js';
import type { JobHandler } from './types.js';
import { handleShopInstall } from './shopInstall.js';
import { handleCatalogueScan } from './catalogueScan.js';
import { handleProductProcess } from './productProcess.js';
import { handleSubscriptionSync } from './subscriptionSync.js';

export const HANDLERS: Readonly<Record<JobType, JobHandler>> = {
  'shop.install': handleShopInstall,
  'catalogue.scan': handleCatalogueScan,
  'product.process': handleProductProcess,
  'subscription.sync': handleSubscriptionSync,
};

export type { JobContext, JobHandler } from './types.js';
