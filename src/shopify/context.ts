import { clientFor, type ShopifyAdminClient } from './graphql.js';
import { SHOP_INFO, type ShopInfoData } from './queries.js';
import type { Shop } from '../db/repos/shops.js';
import { AppError } from '../lib/errors.js';

/** Builds an authenticated Admin API client for an installed shop. */
export function adminClient(shop: Shop): ShopifyAdminClient {
  if (!shop.accessToken) {
    throw new AppError(`Shop ${shop.domain} has no access token`, 401, 'shop_not_authenticated');
  }
  return clientFor(shop.domain, shop.accessToken);
}

export interface StorefrontInfo {
  shopName: string | null;
  contactEmail: string | null;
  countryCode: string | null;
  currency: string | null;
  primaryLocale: string | null;
  planDisplayName: string | null;
  isDevelopmentStore: boolean;
}

export async function fetchStorefrontInfo(client: ShopifyAdminClient): Promise<StorefrontInfo> {
  const data = await client.request<ShopInfoData>(SHOP_INFO, {}, 'ShopInfo');
  const primary = data.shopLocales.find((l) => l.primary)?.locale ?? null;
  return {
    shopName: data.shop.name,
    contactEmail: data.shop.email,
    countryCode: data.shop.billingAddress?.countryCodeV2 ?? null,
    currency: data.shop.currencyCode,
    primaryLocale: primary,
    planDisplayName: data.shop.plan.displayName,
    isDevelopmentStore: data.shop.plan.partnerDevelopment,
  };
}
