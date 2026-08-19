import type { Job } from '../queue/queue.js';
import type { Shop } from '../db/repos/shops.js';

export interface JobContext {
  job: Job;
  /** Always an installed shop with a live access token. */
  shop: Shop;
}

export type JobHandler = (ctx: JobContext) => Promise<void>;
