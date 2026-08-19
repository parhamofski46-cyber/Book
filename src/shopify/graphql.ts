import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { AppError, RetryableError, UnauthorizedError } from '../lib/errors.js';

export interface ThrottleStatus {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number;
}

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
    extensions?: { code?: string; documentation?: string; [k: string]: unknown };
  }>;
  extensions?: {
    cost?: {
      requestedQueryCost: number;
      actualQueryCost: number;
      throttleStatus: ThrottleStatus;
    };
  };
}

export interface UserError {
  field?: string[] | null;
  message: string;
  code?: string | null;
}

/** Raised when a mutation returns `userErrors` — a semantic failure, not a transport one. */
export class ShopifyUserError extends AppError {
  constructor(
    readonly mutation: string,
    readonly userErrors: readonly UserError[],
  ) {
    super(
      `${mutation}: ${userErrors.map((e) => e.message).join('; ')}`,
      422,
      'shopify_user_error',
      { mutation, userErrors },
    );
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Below this fraction of the cost bucket we slow down voluntarily rather than get throttled. */
const BUCKET_SAFETY_FLOOR = 0.25;

export interface AdminClientOptions {
  shopDomain: string;
  accessToken: string;
  /** Transport-level retries handled inside the client before giving up. */
  maxRetries?: number;
}

export class ShopifyAdminClient {
  private readonly endpoint: string;
  private readonly maxRetries: number;
  private readonly log;

  constructor(private readonly opts: AdminClientOptions) {
    this.endpoint = `https://${opts.shopDomain}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`;
    this.maxRetries = opts.maxRetries ?? 3;
    this.log = logger.child({ shop: opts.shopDomain, component: 'shopify-graphql' });
  }

  async request<T>(
    document: string,
    variables: Record<string, unknown> = {},
    operationName?: string,
  ): Promise<T> {
    let attempt = 0;

    for (;;) {
      attempt += 1;
      const started = Date.now();

      let res: Response;
      try {
        res = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': this.opts.accessToken,
            Accept: 'application/json',
            'User-Agent': 'AltTextAutopilot/1.0',
          },
          body: JSON.stringify({ query: document, variables }),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (err) {
        // Network fault or timeout.
        if (attempt <= this.maxRetries) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw new RetryableError(`Shopify request failed: ${(err as Error).message}`);
      }

      if (res.status === 401 || res.status === 403) {
        // The merchant uninstalled or revoked the app; the token is dead.
        throw new UnauthorizedError('Shopify rejected the access token', { status: res.status });
      }

      if (res.status === 429) {
        const retryAfter = Number.parseFloat(res.headers.get('Retry-After') ?? '2');
        const waitMs = Math.min(60_000, Math.max(1_000, retryAfter * 1000));
        if (attempt <= this.maxRetries) {
          this.log.debug('http 429, backing off', { waitMs, attempt });
          await sleep(waitMs);
          continue;
        }
        throw new RetryableError('Shopify rate limit exceeded', waitMs);
      }

      if (res.status >= 500) {
        if (attempt <= this.maxRetries) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw new RetryableError(`Shopify returned ${res.status}`);
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new AppError(
          `Shopify returned ${res.status}: ${body.slice(0, 300)}`,
          502,
          'shopify_http_error',
        );
      }

      const json = (await res.json()) as GraphQLResponse<T>;

      const throttled = json.errors?.some(
        (e) => e.extensions?.code === 'THROTTLED' || /throttl/i.test(e.message),
      );
      if (throttled) {
        const waitMs = this.throttleWaitMs(json);
        if (attempt <= this.maxRetries) {
          this.log.debug('graphql throttled, backing off', { waitMs, attempt });
          await sleep(waitMs);
          continue;
        }
        throw new RetryableError('Shopify GraphQL throttled', waitMs);
      }

      if (json.errors?.length) {
        const message = json.errors.map((e) => e.message).join('; ');
        // ACCESS_DENIED means our granted scopes do not cover this call — a
        // configuration problem, never worth retrying.
        const denied = json.errors.some((e) => e.extensions?.code === 'ACCESS_DENIED');
        throw new AppError(
          `Shopify GraphQL error: ${message}`,
          denied ? 403 : 502,
          denied ? 'shopify_access_denied' : 'shopify_graphql_error',
          { operationName },
        );
      }

      if (!json.data) {
        throw new AppError('Shopify returned no data', 502, 'shopify_empty_response');
      }

      await this.respectBucket(json);

      this.log.debug('graphql ok', {
        operationName,
        ms: Date.now() - started,
        cost: json.extensions?.cost?.actualQueryCost,
        available: json.extensions?.cost?.throttleStatus.currentlyAvailable,
      });

      return json.data;
    }
  }

  /**
   * Runs a mutation and raises if Shopify reported `userErrors`.
   * `pick` selects the mutation payload from the response root.
   */
  async mutate<T extends { userErrors?: UserError[] }>(
    document: string,
    variables: Record<string, unknown>,
    pick: (data: Record<string, T>) => T | undefined,
    mutationName: string,
  ): Promise<T> {
    const data = await this.request<Record<string, T>>(document, variables, mutationName);
    const payload = pick(data);
    if (!payload) {
      throw new AppError(`${mutationName} returned no payload`, 502, 'shopify_empty_payload');
    }
    if (payload.userErrors?.length) {
      throw new ShopifyUserError(mutationName, payload.userErrors);
    }
    return payload;
  }

  private throttleWaitMs(json: GraphQLResponse<unknown>): number {
    const cost = json.extensions?.cost;
    if (!cost) return 2_000;
    const { currentlyAvailable, restoreRate } = cost.throttleStatus;
    const deficit = Math.max(0, cost.requestedQueryCost - currentlyAvailable);
    const seconds = restoreRate > 0 ? deficit / restoreRate : 2;
    return Math.min(30_000, Math.max(1_000, Math.ceil(seconds * 1000)));
  }

  /**
   * Voluntary slow-down. Waiting 300ms here is far cheaper than being throttled
   * and losing a whole request round-trip, and it keeps headroom for the
   * merchant's own admin traffic, which shares the same bucket.
   */
  private async respectBucket(json: GraphQLResponse<unknown>): Promise<void> {
    const status = json.extensions?.cost?.throttleStatus;
    if (!status || status.maximumAvailable <= 0) return;
    const ratio = status.currentlyAvailable / status.maximumAvailable;
    if (ratio >= BUCKET_SAFETY_FLOOR) return;

    const target = status.maximumAvailable * BUCKET_SAFETY_FLOOR;
    const deficit = target - status.currentlyAvailable;
    const waitMs = status.restoreRate > 0 ? (deficit / status.restoreRate) * 1000 : 500;
    await sleep(Math.min(5_000, Math.max(200, Math.ceil(waitMs))));
  }
}

function backoffMs(attempt: number): number {
  // 500ms, 1s, 2s, 4s … with jitter to avoid a thundering herd across workers.
  const base = Math.min(8_000, 250 * 2 ** attempt);
  return base + Math.floor(Math.random() * 250);
}

export function clientFor(shopDomain: string, accessToken: string): ShopifyAdminClient {
  return new ShopifyAdminClient({ shopDomain, accessToken });
}
