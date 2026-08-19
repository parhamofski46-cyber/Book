import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from '../src/config/settings.js';
import {
  assessQuality,
  optimiseImageUrl,
  sanitiseAltText,
  truncateAtWord,
} from '../src/alt/policy.js';

const settings = { ...DEFAULT_SETTINGS };

describe('sanitiseAltText', () => {
  it('strips openers that waste a screen reader listener\'s time', () => {
    // "Image of" is redundant: the screen reader already announced the image.
    for (const opener of ['Image of ', 'A photo of ', 'Picture showing ', 'Illustration depicting ']) {
      const { text } = sanitiseAltText(`${opener}a ribbed cream knit jumper`, settings);
      expect(text.toLowerCase()).not.toMatch(/^(an? )?(image|photo|picture|illustration)/);
      expect(text.toLowerCase()).toContain('ribbed cream knit jumper');
    }
  });

  it('keeps a leading word that only looks like an opener', () => {
    const { text } = sanitiseAltText('Imagery print scarf in navy', settings);
    expect(text).toBe('Imagery print scarf in navy');
  });

  it('collapses whitespace and removes wrapping quotes', () => {
    const { text } = sanitiseAltText('  "Navy   wool\n scarf"  ', settings);
    expect(text).toBe('Navy wool scarf');
  });

  it('enforces the length limit at a word boundary', () => {
    const long = 'Ribbed cream knit jumper with dropped shoulders, a wide crew neck and tonal stitching throughout the body';
    const { text, adjustments } = sanitiseAltText(long, { ...settings, maxLength: 50 });
    expect(text.length).toBeLessThanOrEqual(50);
    expect(text).not.toMatch(/\s$/);
    expect(text.endsWith('-')).toBe(false);
    expect(adjustments).toContain('truncated to length limit');
  });

  it('prefixes the brand only when asked and not already present', () => {
    const withBrand = { ...settings, includeBrandName: true, brandName: 'Aurelia' };
    expect(sanitiseAltText('Navy wool scarf', withBrand).text).toBe('Aurelia — Navy wool scarf');
    expect(sanitiseAltText('Aurelia navy wool scarf', withBrand).text).toBe('Aurelia navy wool scarf');
    expect(sanitiseAltText('Navy wool scarf', settings).text).toBe('Navy wool scarf');
  });
});

describe('truncateAtWord', () => {
  it('never cuts mid-word when a boundary is available', () => {
    expect(truncateAtWord('one two three four', 12)).toBe('one two');
  });
  it('leaves short text alone', () => {
    expect(truncateAtWord('short', 40)).toBe('short');
  });
  it('falls back to a hard cut when there is no usable boundary', () => {
    expect(truncateAtWord('a'.repeat(50), 10)).toHaveLength(10);
  });
});

describe('assessQuality', () => {
  const title = 'Cream Ribbed Knit Jumper';

  it('accepts a genuinely descriptive draft', () => {
    expect(assessQuality('Ribbed cream jumper with a wide crew neck, worn by a model', title).acceptable).toBe(true);
  });

  it('rejects text that only repeats the product title', () => {
    // The listener would hear the same words twice and learn nothing.
    expect(assessQuality('Cream Ribbed Knit Jumper', title)).toMatchObject({
      acceptable: false,
      reason: 'duplicates_product_title',
    });
  });

  it('rejects placeholders and stubs', () => {
    expect(assessQuality('Product', title).acceptable).toBe(false);
    expect(assessQuality('n/a', title).acceptable).toBe(false);
    expect(assessQuality('Jumper', title).acceptable).toBe(false);
  });

  it('rejects keyword stuffing', () => {
    expect(assessQuality('jumper jumper jumper jumper knit jumper jumper', title)).toMatchObject({
      acceptable: false,
      reason: 'repetitive',
    });
  });
});

describe('optimiseImageUrl', () => {
  it('asks the Shopify CDN for a smaller rendition', () => {
    const url = optimiseImageUrl('https://cdn.shopify.com/s/files/1/0/x/product.jpg?v=17');
    expect(url).toContain('width=800');
    expect(url).toContain('v=17');
  });

  it('replaces an existing width rather than appending a second one', () => {
    const url = optimiseImageUrl('https://cdn.shopify.com/s/files/1/0/x/p.jpg?width=4000', 800);
    expect(url.match(/width=/g)).toHaveLength(1);
    expect(url).toContain('width=800');
  });

  it('leaves non-Shopify and malformed URLs untouched', () => {
    expect(optimiseImageUrl('https://example.com/a.jpg')).toBe('https://example.com/a.jpg');
    expect(optimiseImageUrl('not a url')).toBe('not a url');
  });
});

describe('parseSettings', () => {
  it('fills defaults for a brand new shop', () => {
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(null).maxLength).toBe(125);
  });

  it('falls back to defaults rather than throwing on corrupt stored JSON', () => {
    // A settings blob written by an older version must never break the app.
    expect(parseSettings({ maxLength: 'not a number' })).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('garbage')).toEqual(DEFAULT_SETTINGS);
  });

  it('preserves valid stored values', () => {
    const stored = parseSettings({ tone: 'concise', language: 'de', maxLength: 90 });
    expect(stored.tone).toBe('concise');
    expect(stored.language).toBe('de');
    expect(stored.maxLength).toBe(90);
  });

  it('does not overwrite merchant alt text by default', () => {
    expect(DEFAULT_SETTINGS.overwriteExisting).toBe(false);
  });
});
