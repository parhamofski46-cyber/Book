import { z } from 'zod';

/**
 * Every environment variable the app reads, validated once at boot.
 *
 * Fail-fast is deliberate: a Shopify app that starts with a missing API secret
 * will happily accept webhooks it cannot verify, which is worse than not
 * starting at all.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),

  /** Public HTTPS origin of this app, no trailing slash. e.g. https://app.example.com */
  APP_URL: z
    .string()
    .url()
    .transform((v) => v.replace(/\/+$/, '')),

  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z
    .enum(['require', 'disable'])
    .default('require')
    .describe('Supabase/Neon need "require"; a local docker Postgres needs "disable".'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(50).default(8),

  SHOPIFY_API_KEY: z.string().min(1),
  SHOPIFY_API_SECRET: z.string().min(1),
  SHOPIFY_SCOPES: z.string().default('read_products,write_products'),
  SHOPIFY_API_VERSION: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Expected a Shopify API version like 2026-07')
    .default('2026-07'),
  /** The app handle from Partners; used to build admin deep links. */
  SHOPIFY_APP_HANDLE: z.string().default('alt-text-autopilot'),

  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),
  /** low | medium | high | xhigh | max — alt text is a short, well-specified task. */
  ANTHROPIC_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('low'),

  /**
   * 32 bytes, hex- or base64-encoded. Encrypts Shopify access tokens at rest.
   * Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   */
  ENCRYPTION_KEY: z.string().min(32),

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  /** Runs the job worker inside the web process. Convenient for a single free-tier box. */
  RUN_WORKER_IN_WEB: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /** Creates Shopify charges as test charges — never bills a real merchant. */
  BILLING_TEST_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // Console, not the logger: the logger itself depends on this module.
    console.error(`Invalid environment configuration:\n${detail}\n`);
    process.exit(1);
  }
  return parsed.data;
}

export const env: Env = load();

export const isProduction = env.NODE_ENV === 'production';

/** Scopes as an array, trimmed and de-duplicated, for exact comparison against Shopify's echo. */
export const requiredScopes: readonly string[] = [
  ...new Set(
    env.SHOPIFY_SCOPES.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ),
].sort();
