import { describe, expect, it } from 'vitest';
import { buildAuthorizeUrl, scopesSatisfied } from '../src/shopify/oauth.js';
import { planKeyFromSubscriptionName } from '../src/shopify/billing.js';
import { callbackUrlFor, WEBHOOK_TOPICS } from '../src/shopify/webhooks.js';
import { getPlan, PLANS, PLAN_ORDER } from '../src/config/plans.js';
import { mapLimit } from '../src/lib/concurrency.js';

describe('buildAuthorizeUrl', () => {
  it('points at the shop\'s own consent screen with our redirect', () => {
    const url = new URL(buildAuthorizeUrl('demo.myshopify.com', 'nonce-123'));
    expect(url.origin).toBe('https://demo.myshopify.com');
    expect(url.pathname).toBe('/admin/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('test_api_key');
    expect(url.searchParams.get('state')).toBe('nonce-123');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/auth/callback');
    expect(url.searchParams.get('scope')).toContain('write_products');
  });

  it('refuses a shop domain it cannot trust', () => {
    expect(() => buildAuthorizeUrl('evil.com', 's')).toThrow();
  });
});

describe('scopesSatisfied', () => {
  it('is true when every required scope was granted', () => {
    expect(scopesSatisfied('read_products,write_products,write_files')).toBe(true);
    expect(scopesSatisfied('write_files,read_products,write_products,read_orders')).toBe(true);
  });

  it('is false when a scope is missing, so the merchant is re-prompted', () => {
    // This is what makes a deploy that widens SHOPIFY_SCOPES actually take effect.
    expect(scopesSatisfied('read_products,write_products')).toBe(false);
    expect(scopesSatisfied('')).toBe(false);
  });
});

describe('planKeyFromSubscriptionName', () => {
  it('recovers the plan from the subscription Shopify stores', () => {
    expect(planKeyFromSubscriptionName('Alt Text Autopilot — Growth')).toBe('growth');
    expect(planKeyFromSubscriptionName('Alt Text Autopilot — Starter')).toBe('starter');
    expect(planKeyFromSubscriptionName('Alt Text Autopilot — Agency')).toBe('agency');
  });

  it('returns null for anything it does not recognise', () => {
    expect(planKeyFromSubscriptionName('Some Other App — Pro')).toBeNull();
    expect(planKeyFromSubscriptionName('')).toBeNull();
  });
});

describe('plans', () => {
  it('offers a free tier so merchants see real output before paying', () => {
    expect(PLANS.free.price).toBe(0);
    expect(PLANS.free.monthlyImages).toBeGreaterThan(0);
  });

  it('increases the allowance with every paid step', () => {
    const limits = PLAN_ORDER.map((k) => PLANS[k].monthlyImages);
    for (let i = 1; i < limits.length; i++) {
      expect(limits[i]!).toBeGreaterThan(limits[i - 1]!);
    }
  });

  it('falls back to free for unknown or missing keys', () => {
    expect(getPlan(undefined).key).toBe('free');
    expect(getPlan('enterprise').key).toBe('free');
  });
});

describe('webhook callbacks', () => {
  it('maps every topic to a distinct route under our app URL', () => {
    const urls = WEBHOOK_TOPICS.map(callbackUrlFor);
    expect(new Set(urls).size).toBe(WEBHOOK_TOPICS.length);
    for (const url of urls) expect(url.startsWith('https://app.example.com/webhooks/')).toBe(true);
    expect(callbackUrlFor('PRODUCTS_UPDATE')).toBe('https://app.example.com/webhooks/products-update');
  });
});

describe('mapLimit', () => {
  it('preserves input order', async () => {
    const out = await mapLimit([5, 1, 3], 2, async (n) => {
      await new Promise((r) => setTimeout(r, n));
      return n * 2;
    });
    expect(out).toEqual([10, 2, 6]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('handles an empty list', async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });
});
