import { query, type Queryable } from '../pool.js';

export type ImageStatus = 'pending' | 'applied' | 'skipped' | 'failed' | 'reverted';

export interface ImageRow {
  id: number;
  shop_id: number;
  media_gid: string;
  product_gid: string;
  product_title: string | null;
  product_handle: string | null;
  image_url: string | null;
  alt_before: string | null;
  alt_after: string | null;
  status: ImageStatus;
  skip_reason: string | null;
  error_message: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface DiscoveredImage {
  mediaGid: string;
  productGid: string;
  productTitle: string | null;
  productHandle: string | null;
  imageUrl: string | null;
  altBefore: string | null;
}

/**
 * Records images we found on a product. Re-running this for a product already
 * seen is a no-op for rows we have finished with — we never re-bill a merchant
 * for an image we already described.
 */
export async function recordDiscovered(
  shopId: number,
  images: readonly DiscoveredImage[],
  client?: Queryable,
): Promise<void> {
  if (images.length === 0) return;

  const values: unknown[] = [];
  const tuples = images.map((img, i) => {
    const b = i * 6;
    values.push(shopId, img.mediaGid, img.productGid, img.productTitle, img.productHandle, img.imageUrl);
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`;
  });

  await query(
    `INSERT INTO images (shop_id, media_gid, product_gid, product_title, product_handle, image_url)
     VALUES ${tuples.join(', ')}
     ON CONFLICT (shop_id, media_gid) DO UPDATE SET
       product_title  = EXCLUDED.product_title,
       product_handle = EXCLUDED.product_handle,
       image_url      = EXCLUDED.image_url`,
    values,
    client,
  );
}

export async function markApplied(
  shopId: number,
  mediaGid: string,
  data: {
    altBefore: string | null;
    altAfter: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  },
): Promise<void> {
  await query(
    `UPDATE images
        SET status = 'applied', alt_before = $3, alt_after = $4,
            model = $5, input_tokens = $6, output_tokens = $7,
            skip_reason = NULL, error_message = NULL
      WHERE shop_id = $1 AND media_gid = $2`,
    [shopId, mediaGid, data.altBefore, data.altAfter, data.model, data.inputTokens, data.outputTokens],
  );
}

export async function markSkipped(
  shopId: number,
  mediaGid: string,
  reason: string,
  altBefore: string | null,
): Promise<void> {
  await query(
    `UPDATE images
        SET status = 'skipped', skip_reason = $3, alt_before = $4, error_message = NULL
      WHERE shop_id = $1 AND media_gid = $2`,
    [shopId, mediaGid, reason, altBefore],
  );
}

export async function markFailed(shopId: number, mediaGid: string, message: string): Promise<void> {
  await query(
    `UPDATE images SET status = 'failed', error_message = $3 WHERE shop_id = $1 AND media_gid = $2`,
    [shopId, mediaGid, message.slice(0, 500)],
  );
}

export async function markReverted(shopId: number, imageId: number): Promise<ImageRow | null> {
  const { rows } = await query<ImageRow>(
    `UPDATE images SET status = 'reverted' WHERE shop_id = $1 AND id = $2 RETURNING *`,
    [shopId, imageId],
  );
  return rows[0] ?? null;
}

export async function findByMediaGid(shopId: number, mediaGid: string): Promise<ImageRow | null> {
  const { rows } = await query<ImageRow>(
    `SELECT * FROM images WHERE shop_id = $1 AND media_gid = $2`,
    [shopId, mediaGid],
  );
  return rows[0] ?? null;
}

export async function findById(shopId: number, id: number): Promise<ImageRow | null> {
  const { rows } = await query<ImageRow>(`SELECT * FROM images WHERE shop_id = $1 AND id = $2`, [
    shopId,
    id,
  ]);
  return rows[0] ?? null;
}

export interface CoverageStats {
  total: number;
  applied: number;
  pending: number;
  skipped: number;
  failed: number;
  reverted: number;
  /** Percentage of discovered images that now carry alt text (applied + skipped-because-present). */
  coveragePercent: number;
}

export async function coverage(shopId: number): Promise<CoverageStats> {
  const { rows } = await query<{ status: ImageStatus; skip_reason: string | null; n: string }>(
    `SELECT status, skip_reason, COUNT(*)::text AS n
       FROM images WHERE shop_id = $1
      GROUP BY status, skip_reason`,
    [shopId],
  );

  const stats: CoverageStats = {
    total: 0,
    applied: 0,
    pending: 0,
    skipped: 0,
    failed: 0,
    reverted: 0,
    coveragePercent: 0,
  };

  let described = 0;
  for (const row of rows) {
    const n = Number.parseInt(row.n, 10);
    stats.total += n;
    stats[row.status] += n;
    // An image skipped because it already had alt text still counts as covered.
    if (row.status === 'applied' || (row.status === 'skipped' && row.skip_reason === 'already_has_alt')) {
      described += n;
    }
  }

  stats.coveragePercent = stats.total === 0 ? 0 : Math.round((described / stats.total) * 100);
  return stats;
}

export async function recent(shopId: number, limit = 25, offset = 0): Promise<ImageRow[]> {
  const { rows } = await query<ImageRow>(
    `SELECT * FROM images
      WHERE shop_id = $1 AND status <> 'pending'
      ORDER BY updated_at DESC
      LIMIT $2 OFFSET $3`,
    [shopId, Math.min(limit, 100), Math.max(0, offset)],
  );
  return rows;
}

/** Media ids still awaiting generation, oldest first. */
export async function pendingMediaGids(shopId: number, limit: number): Promise<string[]> {
  const { rows } = await query<{ media_gid: string }>(
    `SELECT media_gid FROM images
      WHERE shop_id = $1 AND status = 'pending'
      ORDER BY id ASC LIMIT $2`,
    [shopId, limit],
  );
  return rows.map((r) => r.media_gid);
}

export async function countPending(shopId: number): Promise<number> {
  const { rows } = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM images WHERE shop_id = $1 AND status = 'pending'`,
    [shopId],
  );
  return Number.parseInt(rows[0]?.n ?? '0', 10);
}
