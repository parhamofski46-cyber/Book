import type { ShopSettings } from '../config/settings.js';

/** Openers that waste a screen-reader listener's time. Stripped defensively. */
const DEAD_OPENERS =
  /^(an?\s+)?(image|photo|photograph|picture|graphic|illustration|screenshot|close[- ]?up shot)\s+(of|showing|depicting|featuring)\s+/i;

const WRAPPING_QUOTES = /^["'“‘«]+|["'”’»]+$/g;

export interface SanitiseResult {
  text: string;
  /** Non-fatal notes about what had to be corrected — useful for tuning the prompt. */
  adjustments: string[];
}

/**
 * Last line of defence between the model and the merchant's storefront.
 *
 * Everything here is deterministic: even a perfect model occasionally returns a
 * trailing newline or drifts one character over the limit, and a storefront is
 * not the place to find out.
 */
export function sanitiseAltText(raw: string, settings: ShopSettings): SanitiseResult {
  const adjustments: string[] = [];
  let text = raw;

  text = text.replace(/\s+/g, ' ').trim();

  const unquoted = text.replace(WRAPPING_QUOTES, '').trim();
  if (unquoted !== text) {
    adjustments.push('removed wrapping quotes');
    text = unquoted;
  }

  const withoutOpener = text.replace(DEAD_OPENERS, '').trim();
  if (withoutOpener !== text && withoutOpener.length >= 10) {
    adjustments.push('removed redundant opener');
    text = withoutOpener;
    // Re-capitalise after removing a leading phrase.
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }

  if (settings.includeBrandName && settings.brandName.trim()) {
    const brand = settings.brandName.trim();
    if (!text.toLowerCase().includes(brand.toLowerCase())) {
      text = `${brand} — ${text}`;
      adjustments.push('prefixed brand name');
    }
  }

  if (text.length > settings.maxLength) {
    text = truncateAtWord(text, settings.maxLength);
    adjustments.push('truncated to length limit');
  }

  return { text, adjustments };
}

/** Cuts at the last word boundary that fits, so we never end mid-word. */
export function truncateAtWord(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const slice = text.slice(0, limit);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > limit * 0.6 ? slice.slice(0, lastSpace) : slice;
  return cut.replace(/[\s,;:.\-–—]+$/, '');
}

export interface QualityVerdict {
  acceptable: boolean;
  reason?: string;
}

/**
 * Rejects output that would be worse than leaving alt empty.
 *
 * An empty alt attribute is a valid, honest signal ("this image adds nothing").
 * Alt text that merely repeats the product title is actively harmful: the
 * screen reader announces the same words twice and the listener learns nothing.
 */
export function assessQuality(text: string, productTitle: string): QualityVerdict {
  const trimmed = text.trim();

  if (trimmed.length < 10) {
    return { acceptable: false, reason: 'too_short' };
  }
  if (/^(product|item|image|photo|untitled|n\/?a|none)$/i.test(trimmed)) {
    return { acceptable: false, reason: 'placeholder_text' };
  }

  const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9؀-ۿ\s]/gi, '').trim();
  if (normalise(trimmed) === normalise(productTitle)) {
    return { acceptable: false, reason: 'duplicates_product_title' };
  }

  // A run of the same token repeated is the classic keyword-stuffing signature.
  const words = normalise(trimmed).split(/\s+/).filter((w) => w.length > 3);
  if (words.length >= 6) {
    const counts = new Map<string, number>();
    for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
    const worst = Math.max(...counts.values());
    if (worst / words.length > 0.4) {
      return { acceptable: false, reason: 'repetitive' };
    }
  }

  return { acceptable: true };
}

/**
 * Asks Shopify's CDN for a smaller rendition.
 *
 * A 4000px product shot and an 800px one produce the same description, but the
 * large one costs several times as many image tokens. This one line is a
 * meaningful share of the app's gross margin.
 */
export function optimiseImageUrl(url: string, width = 800): string {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)shopify(cdn)?\.com$/.test(parsed.hostname) && !parsed.hostname.includes('cdn.shopify')) {
      return url;
    }
    parsed.searchParams.set('width', String(width));
    return parsed.toString();
  } catch {
    return url;
  }
}
