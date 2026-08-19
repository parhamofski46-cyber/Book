import { query, type Queryable } from '../pool.js';
import { encrypt, decrypt } from '../../lib/crypto.js';
import { parseSettings, type ShopSettings } from '../../config/settings.js';
import { getPlan, type PlanKey } from '../../config/plans.js';

export interface ShopRow {
  id: number;
  domain: string;
  access_token: string | null;
  scopes: string;
  shop_name: string | null;
  contact_email: string | null;
  country_code: string | null;
  currency: string | null;
  primary_locale: string;
  plan_display_name: string | null;
  plan_key: PlanKey;
  subscription_gid: string | null;
  subscription_status: string | null;
  trial_ends_at: Date | null;
  settings: unknown;
  quota_used: number;
  quota_period_start: Date;
  backfill_state: 'pending' | 'running' | 'done' | 'failed';
  backfill_completed_at: Date | null;
  installed_at: Date;
  uninstalled_at: Date | null;
}

/** A shop with its token decrypted and settings validated — what callers actually want. */
export interface Shop extends Omit<ShopRow, 'access_token' | 'settings'> {
  accessToken: string | null;
  settings: ShopSettings;
}

function hydrate(row: ShopRow): Shop {
  const { access_token, settings, ...rest } = row;
  return {
    ...rest,
    accessToken: access_token ? decrypt(access_token) : null,
    settings: parseSettings(settings),
  };
}

const COLUMNS = `
  id, domain, access_token, scopes, shop_name, contact_email, country_code, currency,
  primary_locale, plan_display_name, plan_key, subscription_gid, subscription_status,
  trial_ends_at, settings, quota_used, quota_period_start, backfill_state,
  backfill_completed_at, installed_at, uninstalled_at
`;

export async function findByDomain(domain: string, client?: Queryable): Promise<Shop | null> {
  const { rows } = await query<ShopRow>(
    `SELECT ${COLUMNS} FROM shops WHERE domain = $1`,
    [domain],
    client,
  );
  return rows[0] ? hydrate(rows[0]) : null;
}

export async function findById(id: number, client?: Queryable): Promise<Shop | null> {
  const { rows } = await query<ShopRow>(`SELECT ${COLUMNS} FROM shops WHERE id = $1`, [id], client);
  return rows[0] ? hydrate(rows[0]) : null;
}

/**
 * Called at the end of OAuth. Re-installing a store must revive the existing
 * row (keeping its history and settings), not create a duplicate.
 */
export async function upsertOnInstall(
  domain: string,
  accessToken: string,
  scopes: string,
): Promise<Shop> {
  const { rows } = await query<ShopRow>(
    `INSERT INTO shops (domain, access_token, scopes, installed_at, uninstalled_at)
     VALUES ($1, $2, $3, now(), NULL)
     ON CONFLICT (domain) DO UPDATE SET
       access_token   = EXCLUDED.access_token,
       scopes         = EXCLUDED.scopes,
       installed_at   = now(),
       uninstalled_at = NULL
     RETURNING ${COLUMNS}`,
    [domain, encrypt(accessToken), scopes],
  );
  return hydrate(rows[0]!);
}

/**
 * Uninstall. The token is destroyed immediately (it is dead anyway, and holding
 * a dead credential is pure liability); history is kept so a re-install resumes.
 */
export async function markUninstalled(domain: string): Promise<void> {
  await query(
    `UPDATE shops
        SET uninstalled_at = now(),
            access_token = NULL,
            subscription_gid = NULL,
            subscription_status = NULL,
            plan_key = 'free'
      WHERE domain = $1`,
    [domain],
  );
  await query(
    `UPDATE jobs SET status = 'failed', last_error = 'shop uninstalled'
      WHERE status IN ('queued', 'running')
        AND shop_id = (SELECT id FROM shops WHERE domain = $1)`,
    [domain],
  );
}

export async function updateStorefrontMetadata(
  id: number,
  meta: {
    shopName: string | null;
    contactEmail: string | null;
    countryCode: string | null;
    currency: string | null;
    primaryLocale: string | null;
    planDisplayName: string | null;
  },
): Promise<void> {
  await query(
    `UPDATE shops SET
       shop_name         = $2,
       contact_email     = $3,
       country_code      = $4,
       currency          = $5,
       primary_locale    = COALESCE($6, primary_locale),
       plan_display_name = $7
     WHERE id = $1`,
    [
      id,
      meta.shopName,
      meta.contactEmail,
      meta.countryCode,
      meta.currency,
      meta.primaryLocale,
      meta.planDisplayName,
    ],
  );
}

export async function updateSettings(id: number, settings: ShopSettings): Promise<void> {
  await query(`UPDATE shops SET settings = $2::jsonb WHERE id = $1`, [id, JSON.stringify(settings)]);
}

export async function updateSubscription(
  id: number,
  data: {
    planKey: PlanKey;
    subscriptionGid: string | null;
    status: string | null;
    trialEndsAt: Date | null;
  },
): Promise<void> {
  await query(
    `UPDATE shops
        SET plan_key = $2, subscription_gid = $3, subscription_status = $4, trial_ends_at = $5
      WHERE id = $1`,
    [id, data.planKey, data.subscriptionGid, data.status, data.trialEndsAt],
  );
}

export async function setBackfillState(
  id: number,
  state: ShopRow['backfill_state'],
): Promise<void> {
  await query(
    `UPDATE shops
        SET backfill_state = $2,
            backfill_completed_at = CASE WHEN $2 = 'done' THEN now() ELSE backfill_completed_at END
      WHERE id = $1`,
    [id, state],
  );
}

export interface QuotaStatus {
  used: number;
  limit: number;
  remaining: number;
  periodStart: Date;
}

export async function getQuota(shop: Shop): Promise<QuotaStatus> {
  const limit = getPlan(shop.plan_key).monthlyImages;
  // A stale period means the month rolled over and nothing has consumed quota yet.
  const currentPeriod = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const stale = shop.quota_period_start < currentPeriod;
  const used = stale ? 0 : shop.quota_used;
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    periodStart: stale ? currentPeriod : shop.quota_period_start,
  };
}

/**
 * Atomically reserves `count` units of this month's allowance.
 *
 * Returns false when the reservation would exceed the plan limit. The monthly
 * rollover happens inside the same statement, so a worker running at 00:00 on
 * the 1st cannot race another worker into double-counting.
 */
export async function tryConsumeQuota(
  shopId: number,
  count: number,
  limit: number,
  client?: Queryable,
): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE shops
        SET quota_used = CASE
              WHEN quota_period_start < date_trunc('month', now())::date THEN $2
              ELSE quota_used + $2 END,
            quota_period_start = date_trunc('month', now())::date
      WHERE id = $1
        AND (CASE
              WHEN quota_period_start < date_trunc('month', now())::date THEN 0
              ELSE quota_used END) + $2 <= $3`,
    [shopId, count, limit],
    client,
  );
  return (rowCount ?? 0) > 0;
}

/** Gives quota back when a reserved unit was never actually spent. */
export async function releaseQuota(shopId: number, count: number): Promise<void> {
  await query(`UPDATE shops SET quota_used = GREATEST(0, quota_used - $2) WHERE id = $1`, [
    shopId,
    count,
  ]);
}

export async function listActive(): Promise<Shop[]> {
  const { rows } = await query<ShopRow>(
    `SELECT ${COLUMNS} FROM shops WHERE uninstalled_at IS NULL AND access_token IS NOT NULL`,
  );
  return rows.map(hydrate);
}

/** GDPR shop/redact: erase everything we hold about a store. */
export async function purge(domain: string): Promise<void> {
  await query(`DELETE FROM shops WHERE domain = $1`, [domain]);
}
