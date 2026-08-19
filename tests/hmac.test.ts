import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { isValidShopDomain, verifyQueryHmac, verifyWebhookHmac } from '../src/shopify/hmac.js';

const SECRET = 'test_api_secret_value';

describe('isValidShopDomain', () => {
  it('accepts a real myshopify domain', () => {
    expect(isValidShopDomain('example-store.myshopify.com')).toBe(true);
    expect(isValidShopDomain('store123.myshopify.com')).toBe(true);
  });

  it('rejects lookalikes and injection attempts', () => {
    // Each of these, if accepted, would let an attacker point the app's
    // credentials or its OAuth redirect at a host they control.
    const hostile = [
      'evil.com',
      'example.myshopify.com.evil.com',
      'evil.com/example.myshopify.com',
      'example.myshopify.com/../admin',
      'example.myshopify.com:8080',
      'https://example.myshopify.com',
      '.myshopify.com',
      '-store.myshopify.com',
      'example.myshopify.com\n',
      '',
    ];
    for (const shop of hostile) {
      expect(isValidShopDomain(shop), shop).toBe(false);
    }
  });

  it('rejects non-strings', () => {
    expect(isValidShopDomain(null)).toBe(false);
    expect(isValidShopDomain(undefined)).toBe(false);
    expect(isValidShopDomain(42)).toBe(false);
  });
});

describe('verifyQueryHmac', () => {
  function sign(params: URLSearchParams): URLSearchParams {
    const keys = [...params.keys()].filter((k) => k !== 'hmac' && k !== 'signature').sort();
    const message = keys.map((k) => `${k}=${params.getAll(k).join(',')}`).join('&');
    params.set('hmac', createHmac('sha256', SECRET).update(message).digest('hex'));
    return params;
  }

  it('accepts a correctly signed query', () => {
    const params = sign(new URLSearchParams({ shop: 'a.myshopify.com', host: 'xyz', timestamp: '1' }));
    expect(verifyQueryHmac(params)).toBe(true);
  });

  it('rejects a tampered parameter', () => {
    const params = sign(new URLSearchParams({ shop: 'a.myshopify.com', host: 'xyz' }));
    params.set('shop', 'b.myshopify.com');
    expect(verifyQueryHmac(params)).toBe(false);
  });

  it('rejects an added parameter', () => {
    const params = sign(new URLSearchParams({ shop: 'a.myshopify.com' }));
    params.set('injected', '1');
    expect(verifyQueryHmac(params)).toBe(false);
  });

  it('rejects a missing signature', () => {
    expect(verifyQueryHmac(new URLSearchParams({ shop: 'a.myshopify.com' }))).toBe(false);
  });

  it('is order independent, because Shopify sorts keys before signing', () => {
    const a = sign(new URLSearchParams({ shop: 'a.myshopify.com', host: 'x', code: 'c' }));
    const reordered = new URLSearchParams();
    reordered.set('code', a.get('code')!);
    reordered.set('shop', a.get('shop')!);
    reordered.set('host', a.get('host')!);
    reordered.set('hmac', a.get('hmac')!);
    expect(verifyQueryHmac(reordered)).toBe(true);
  });
});

describe('verifyWebhookHmac', () => {
  const body = JSON.stringify({ id: 1, title: 'Product' });
  const signature = createHmac('sha256', SECRET).update(body).digest('base64');

  it('accepts an authentic body', () => {
    expect(verifyWebhookHmac(body, signature)).toBe(true);
    expect(verifyWebhookHmac(Buffer.from(body), signature)).toBe(true);
  });

  it('rejects a modified body', () => {
    expect(verifyWebhookHmac(body + ' ', signature)).toBe(false);
  });

  it('rejects a missing or malformed signature', () => {
    expect(verifyWebhookHmac(body, undefined)).toBe(false);
    expect(verifyWebhookHmac(body, '')).toBe(false);
    expect(verifyWebhookHmac(body, 'short')).toBe(false);
  });
});
