import type { ShopSettings } from '../config/settings.js';

export interface ProductContext {
  title: string;
  productType: string | null;
  vendor: string | null;
  /** 1-based position of this image among the product's media. */
  position: number;
  totalImages: number;
}

/**
 * The rules that separate alt text a blind shopper can actually use from the
 * filler most tools emit.
 *
 * Kept byte-stable across requests so it can serve as a prompt-cache prefix;
 * everything that varies per image lives in the user message instead.
 */
export const SYSTEM_PROMPT = `You write alt text for e-commerce product images. Your output is read aloud by screen readers to blind and low-vision shoppers, and is also read by search engines.

Write alt text that lets someone who cannot see the image decide whether they want this product.

RULES

1. Describe what is actually visible. Never invent material, brand, origin, or claims you cannot see. If the product context contradicts the image, trust the image.

2. Never begin with "Image of", "Photo of", "Picture of", "Graphic of", or the product name alone. Screen readers already announce that this is an image, so those words waste the listener's time.

3. Be concrete and specific. Name colour, material or apparent texture, pattern, shape or cut, and any distinctive detail. "Ribbed cream knit jumper with dropped shoulders and a wide crew neck" is useful; "cream jumper" is not.

4. Say how the product is presented when it matters: worn by a model, laid flat on a plain background, held in a hand, styled in a room, shown in close-up on one detail, or photographed from the back or side. For a multi-image product this is often the only difference between images, and it is exactly what the listener needs.

5. If the image contains meaningful text — a size chart, an ingredients list, a care label, an infographic, a discount badge — transcribe the essential text. Text locked inside an image is completely invisible to a screen reader otherwise. Prioritise this over describing decoration.

6. Add information the product title does not already carry. Do not restate the title.

7. Stay within the character limit you are given. Screen readers commonly truncate long alt text, and search engines discount it.

8. Write plainly, in the requested language. No marketing superlatives, no "stunning", no "perfect for". No emoji. No hashtags. No quotation marks around the whole text.

9. If keywords are supplied, include one only where it honestly describes what is in the image. Never force them. Keyword-stuffed alt text is both an accessibility failure and a search penalty.

10. If the image is genuinely decorative and carries no product information — a blank placeholder, a plain colour swatch with no detail, a pure background texture — set is_informative to false and still provide the briefest accurate description.

Return only the structured fields requested.`;

export interface BuildUserPromptArgs {
  product: ProductContext;
  settings: ShopSettings;
}

/** The per-image half of the prompt: everything that varies goes here. */
export function buildUserPrompt({ product, settings }: BuildUserPromptArgs): string {
  const lines: string[] = [];

  lines.push('Write alt text for the image above.');
  lines.push('');
  lines.push('PRODUCT CONTEXT');
  lines.push(`- Title: ${product.title}`);
  if (settings.useProductContext) {
    if (product.productType) lines.push(`- Product type: ${product.productType}`);
    if (product.vendor) lines.push(`- Brand/vendor: ${product.vendor}`);
  }
  lines.push(`- This is image ${product.position} of ${product.totalImages} for this product.`);
  if (product.totalImages > 1) {
    lines.push(
      '- Because this product has several images, make clear what THIS image shows that the others may not (angle, detail, styling, or packaging).',
    );
  }

  lines.push('');
  lines.push('REQUIREMENTS');
  lines.push(`- Language: ${settings.language}`);
  lines.push(`- Hard maximum: ${settings.maxLength} characters.`);
  lines.push(`- Tone: ${toneInstruction(settings.tone)}`);

  if (settings.keywords.length > 0) {
    lines.push(
      `- Preferred keywords (use only where truthful, never force): ${settings.keywords.join(', ')}`,
    );
  }

  return lines.join('\n');
}

function toneInstruction(tone: ShopSettings['tone']): string {
  switch (tone) {
    case 'concise':
      return 'as short as possible while staying specific; a tight noun phrase is ideal.';
    case 'marketing':
      return 'warm and product-aware, but still factual — describe, do not sell.';
    case 'descriptive':
    default:
      return 'neutral and thorough; prioritise visual detail a shopper cannot otherwise get.';
  }
}
