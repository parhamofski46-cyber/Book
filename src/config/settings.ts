import { z } from 'zod';

/**
 * Per-merchant generation preferences. Stored as JSONB on `shops.settings`, so
 * the schema must stay backward compatible: add optional fields, never rename.
 */
export const shopSettingsSchema = z.object({
  /** How the description reads. */
  tone: z.enum(['descriptive', 'concise', 'marketing']).default('descriptive'),

  /** Prefix descriptions with the store's brand name, e.g. "Aurelia — ...". */
  includeBrandName: z.boolean().default(false),
  brandName: z.string().max(60).default(''),

  /**
   * Keywords the merchant wants present when they honestly describe the image.
   * The generator is instructed to weave these in only where truthful — keyword
   * stuffing in alt text is both an accessibility failure and an SEO penalty.
   */
  keywords: z.array(z.string().min(1).max(40)).max(10).default([]),

  /** BCP-47 language tag for the generated text. Defaults to the shop locale. */
  language: z.string().min(2).max(12).default('en'),

  /**
   * Screen readers commonly truncate around 125 characters, and Google's image
   * guidance favours short, specific text. 125 is the accessibility consensus.
   */
  maxLength: z.number().int().min(40).max(250).default(125),

  /** Replace alt text that already exists. Off by default — never destroy merchant work silently. */
  overwriteExisting: z.boolean().default(false),

  /** React to product create/update webhooks. This is what makes the app "autopilot". */
  autoProcessNewProducts: z.boolean().default(true),

  /** Mention the product type ("running shoe") when the image alone is ambiguous. */
  useProductContext: z.boolean().default(true),
});

export type ShopSettings = z.infer<typeof shopSettingsSchema>;

export const DEFAULT_SETTINGS: ShopSettings = shopSettingsSchema.parse({});

/** Tolerant parse: unknown or corrupt stored settings fall back to defaults per-field. */
export function parseSettings(raw: unknown): ShopSettings {
  const result = shopSettingsSchema.safeParse(raw ?? {});
  return result.success ? result.data : DEFAULT_SETTINGS;
}
