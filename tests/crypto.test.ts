import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, hmacSha256Base64, randomToken, safeEqual } from '../src/lib/crypto.js';

describe('token encryption', () => {
  it('round trips a Shopify access token', () => {
    const token = 'example-token-value-not-a-real-format';
    expect(decrypt(encrypt(token))).toBe(token);
  });

  it('never puts the plaintext in the envelope', () => {
    const token = 'example-secret-value';
    expect(encrypt(token)).not.toContain(token);
  });

  it('produces a different envelope every time', () => {
    // A fresh nonce per encryption; identical tokens must not look identical
    // in the database.
    expect(encrypt('same')).not.toBe(encrypt('same'));
  });

  it('refuses a tampered ciphertext rather than returning garbage', () => {
    const envelope = encrypt('example-token');
    const parts = envelope.split('.');
    const flipped = Buffer.from(parts[3]!, 'base64');
    flipped[0] ^= 0xff;
    parts[3] = flipped.toString('base64');
    expect(() => decrypt(parts.join('.'))).toThrow();
  });

  it('refuses an unrecognised envelope', () => {
    expect(() => decrypt('not-an-envelope')).toThrow(/Malformed/);
    expect(() => decrypt('v9.a.b.c')).toThrow(/Malformed/);
  });

  it('handles unicode', () => {
    const value = 'توکن دسترسی ✓';
    expect(decrypt(encrypt(value))).toBe(value);
  });
});

describe('safeEqual', () => {
  it('compares equal strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
  });
  it('rejects different strings without throwing on length mismatch', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('abc', '')).toBe(false);
  });
});

describe('hmacSha256Base64', () => {
  it('matches a known value', () => {
    // Reference value computed independently:
    //   echo -n hello | openssl dgst -sha256 -hmac key -binary | base64
    expect(hmacSha256Base64('hello', 'key')).toBe('kwezuRXvtRcf8U2MtV+8x5jGwO8UVtZt7RpqpyOli3s=');
  });
});

describe('randomToken', () => {
  it('is url safe and unique', () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(randomToken());
  });
});
