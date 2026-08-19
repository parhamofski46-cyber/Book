import { query } from '../pool.js';

/** Rolls token spend into the current month's bucket. Used for reporting and cost control. */
export async function recordUsage(
  shopId: number,
  images: number,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  await query(
    `INSERT INTO monthly_usage (shop_id, period, images_processed, input_tokens, output_tokens)
     VALUES ($1, date_trunc('month', now())::date, $2, $3, $4)
     ON CONFLICT (shop_id, period) DO UPDATE SET
       images_processed = monthly_usage.images_processed + EXCLUDED.images_processed,
       input_tokens     = monthly_usage.input_tokens     + EXCLUDED.input_tokens,
       output_tokens    = monthly_usage.output_tokens    + EXCLUDED.output_tokens,
       updated_at       = now()`,
    [shopId, images, inputTokens, outputTokens],
  );
}

export interface UsagePeriod {
  period: Date;
  images_processed: number;
  input_tokens: number;
  output_tokens: number;
}

export async function history(shopId: number, months = 12): Promise<UsagePeriod[]> {
  const { rows } = await query<UsagePeriod>(
    `SELECT period, images_processed, input_tokens, output_tokens
       FROM monthly_usage WHERE shop_id = $1
      ORDER BY period DESC LIMIT $2`,
    [shopId, months],
  );
  return rows;
}
