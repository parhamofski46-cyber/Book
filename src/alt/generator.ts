import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { AppError, RetryableError } from '../lib/errors.js';
import type { ShopSettings } from '../config/settings.js';
import { SYSTEM_PROMPT, buildUserPrompt, type ProductContext } from './prompt.js';
import { assessQuality, optimiseImageUrl, sanitiseAltText } from './policy.js';

const client = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
  maxRetries: 2,
  timeout: 60_000,
});

const log = logger.child({ component: 'alt-generator' });

/**
 * The shape we ask the model to return.
 *
 * `is_informative` and `confidence` are not decoration: they let the app decline
 * to write anything when the image genuinely carries no product information,
 * which is the correct accessibility outcome and something a "just describe it"
 * prompt can never express.
 */
const AltTextSchema = z.object({
  alt: z.string().describe('The alt text itself, within the character limit given.'),
  primary_subject: z
    .string()
    .describe('Two to four words naming what the image mainly shows, e.g. "ribbed knit jumper".'),
  contains_text: z
    .boolean()
    .describe('True when the image contains readable text that was transcribed into the alt text.'),
  is_informative: z
    .boolean()
    .describe('False only when the image is decorative and carries no product information.'),
  confidence: z.enum(['high', 'medium', 'low']),
});

export type AltTextDraft = z.infer<typeof AltTextSchema>;

export interface GenerateArgs {
  imageUrl: string;
  product: ProductContext;
  settings: ShopSettings;
}

export type GenerateOutcome =
  | {
      ok: true;
      altText: string;
      draft: AltTextDraft;
      model: string;
      inputTokens: number;
      outputTokens: number;
      adjustments: string[];
    }
  | {
      ok: false;
      /** Machine-readable reason, stored on the image row for the merchant to see. */
      reason: 'decorative' | 'low_quality' | 'refused' | 'unreadable_image';
      detail: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
    };

/**
 * Describes one product image.
 *
 * The image is sent by URL so Anthropic fetches it directly from Shopify's CDN
 * — no bytes pass through this process, which keeps memory flat no matter how
 * many workers run. If the URL cannot be fetched remotely we download it once
 * and retry as base64 rather than failing the image.
 */
export async function generateAltText(args: GenerateArgs): Promise<GenerateOutcome> {
  const url = optimiseImageUrl(args.imageUrl);
  const userPrompt = buildUserPrompt({ product: args.product, settings: args.settings });

  let message: Anthropic.Beta.BetaMessage & { parsed_output?: AltTextDraft | null };
  try {
    message = await callModel(url, userPrompt, { asBase64: false });
  } catch (err) {
    if (err instanceof ImageFetchError) {
      log.debug('remote image fetch failed, retrying inline', { url: redactUrl(url) });
      try {
        message = await callModel(url, userPrompt, { asBase64: true });
      } catch (inner) {
        return failure('unreadable_image', toDetail(inner));
      }
    } else {
      throw mapAnthropicError(err);
    }
  }

  const inputTokens = message.usage?.input_tokens ?? 0;
  const outputTokens = message.usage?.output_tokens ?? 0;
  const model = message.model ?? env.ANTHROPIC_MODEL;

  // Safety classifiers can decline a request; the call still returns HTTP 200.
  if (message.stop_reason === 'refusal') {
    log.warn('model declined the image', {
      product: args.product.title,
      category: (message.stop_details as { category?: string } | null)?.category,
    });
    return {
      ok: false,
      reason: 'refused',
      detail: 'The model declined to describe this image.',
      model,
      inputTokens,
      outputTokens,
    };
  }

  const draft = message.parsed_output;
  if (!draft) {
    return failure('low_quality', 'Model returned no parsable output.');
  }

  if (!draft.is_informative) {
    return {
      ok: false,
      reason: 'decorative',
      detail: `Image appears decorative (${draft.primary_subject}); an empty alt attribute is correct here.`,
      model,
      inputTokens,
      outputTokens,
    };
  }

  const { text, adjustments } = sanitiseAltText(draft.alt, args.settings);
  const verdict = assessQuality(text, args.product.title);
  if (!verdict.acceptable) {
    return {
      ok: false,
      reason: 'low_quality',
      detail: verdict.reason ?? 'unspecified',
      model,
      inputTokens,
      outputTokens,
    };
  }

  return { ok: true, altText: text, draft, model, inputTokens, outputTokens, adjustments };

  function failure(
    reason: 'decorative' | 'low_quality' | 'refused' | 'unreadable_image',
    detail: string,
  ): GenerateOutcome {
    return { ok: false, reason, detail, model: env.ANTHROPIC_MODEL, inputTokens: 0, outputTokens: 0 };
  }
}

class ImageFetchError extends Error {}

async function callModel(
  url: string,
  userPrompt: string,
  opts: { asBase64: boolean },
): Promise<Anthropic.Beta.BetaMessage & { parsed_output?: AltTextDraft | null }> {
  const imageBlock: Anthropic.Beta.BetaImageBlockParam = opts.asBase64
    ? { type: 'image', source: await downloadAsBase64(url) }
    : { type: 'image', source: { type: 'url', url } };

  try {
    return await client.beta.messages.parse({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 1024,
      // Alt text is a short, tightly specified task; low effort is both faster
      // and cheaper without measurably hurting description quality.
      output_config: {
        effort: env.ANTHROPIC_EFFORT,
        format: zodOutputFormat(AltTextSchema),
      },
      // A refusal on one product photo must not stall a 20,000-image backfill.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: [imageBlock, { type: 'text', text: userPrompt }] }],
    });
  } catch (err) {
    // The API reports an unreachable image as a 400 naming the URL source.
    if (
      !opts.asBase64 &&
      err instanceof Anthropic.APIError &&
      err.status === 400 &&
      /url|fetch|image/i.test(err.message)
    ) {
      throw new ImageFetchError(err.message);
    }
    throw err;
  }
}

const MAX_INLINE_BYTES = 5 * 1024 * 1024;

async function downloadAsBase64(url: string): Promise<Anthropic.Beta.BetaBase64ImageSource> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    throw new AppError(`Could not download image (${res.status})`, 502, 'image_download_failed');
  }

  const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  const mediaType = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(contentType)
    ? (contentType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp')
    : 'image/jpeg';

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > MAX_INLINE_BYTES) {
    throw new AppError('Image is too large to send inline', 413, 'image_too_large');
  }

  return { type: 'base64', media_type: mediaType, data: buffer.toString('base64') };
}

/** Turns SDK errors into the retryable/permanent distinction the queue needs. */
function mapAnthropicError(err: unknown): Error {
  if (err instanceof Anthropic.RateLimitError) {
    return new RetryableError('Anthropic rate limit reached', 30_000);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new RetryableError('Could not reach the Anthropic API');
  }
  if (err instanceof Anthropic.APIError && err.status >= 500) {
    return new RetryableError(`Anthropic returned ${err.status}`);
  }
  if (err instanceof Anthropic.APIError) {
    return new AppError(`Anthropic error ${err.status}: ${err.message}`, 502, 'anthropic_error');
  }
  return err instanceof Error ? err : new Error(String(err));
}

function toDetail(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
}

/** Shopify CDN URLs carry no secrets, but they are long and noisy in logs. */
function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return '(unparsable url)';
  }
}
