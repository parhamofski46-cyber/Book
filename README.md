# Alt Text Autopilot

A Shopify app that writes accessible, search-friendly alt text for every product
image — and keeps doing it, forever, without the merchant opening the app again.

Install it once. It sweeps the existing catalogue, then describes every new
product image as it is uploaded. Nothing to click, nothing to remember.

---

## Why this exists

Most Shopify stores have thousands of product images with an empty `alt`
attribute. That is three losses at once:

- **A blind shopper cannot shop.** A screen reader reaching an undescribed image
  says nothing useful. If it is the only view of the product, the sale is gone.
- **Google cannot see the image.** No alt text means no Google Images traffic and
  a weaker signal for the page itself.
- **Nobody is going to fix it by hand.** Writing 2,000 descriptions is weeks of
  work, so it never happens.

The existing apps in this category mostly paste the product title into every
image. That is worse than useless: the screen reader announces the same words
the listener has already heard, and search engines discount it.

This app looks at the actual image.

---

## What it does

1. **Finds** every product image in the catalogue and records the ones with no
   alt text.
2. **Describes** each one with a vision model that reads the real photograph —
   colour, material, cut, how the product is presented, and any text locked
   inside the image (size charts, care labels, infographics), which is otherwise
   completely invisible to a screen reader.
3. **Writes** the result back to Shopify.
4. **Keeps watching.** A `products/create` or `products/update` webhook queues the
   product; alt text appears within a minute or two of upload.
5. **Reports.** A coverage dashboard, a full change log, and one-click undo on
   every change.

Images that already carry alt text are left alone unless the merchant explicitly
opts in. Genuinely decorative images are deliberately left empty, which is the
correct accessibility outcome rather than a failure.

---

## Architecture

```
Shopify Admin (iframe)
  └─ GET /                     embedded dashboard, App Bridge session tokens
       └─ /api/*               JSON API, JWT-verified per request

Shopify webhooks ──► /webhooks/*   HMAC-verified against the raw body
                          │
                          ▼
                  jobs table (Postgres)
                          │  FOR UPDATE SKIP LOCKED
                          ▼
                     Worker loop
                          ├─ shop.install       metadata, webhooks, first sweep
                          ├─ catalogue.scan     one page per run, self-requeuing
                          ├─ product.process    describe + write back
                          └─ subscription.sync  reconcile billing with Shopify
                                   │
                                   ▼
                        Claude vision (image by URL)
```

**The queue is just Postgres.** `FOR UPDATE SKIP LOCKED` lets several workers
share one table with no broker, so the whole app runs on a free-tier database
with no Redis and no additional bill.

**Image bytes never enter this process.** Images are passed to the model by URL,
so memory stays flat no matter how many workers run. A base64 download is the
fallback for the rare CDN that refuses a remote fetch.

### Layout

| Path | Contents |
|---|---|
| `src/config/` | Environment validation, pricing plans, per-shop settings schema |
| `src/lib/` | Logger, error taxonomy, token encryption, concurrency helper |
| `src/db/` | Pool, migration runner, repositories |
| `src/shopify/` | HMAC, session tokens, GraphQL client, OAuth, webhooks, billing |
| `src/alt/` | The prompt, the generator, and the quality policy |
| `src/queue/` | Job queue and worker loop |
| `src/jobs/` | The four job handlers |
| `src/routes/` | HTTP surface |
| `public/` | Dashboard CSS and JS, served fingerprinted and immutable |
| `migrations/` | Plain SQL, applied in order under an advisory lock |

---

## Security

Everything below is enforced in code and covered by tests.

| Concern | Handling |
|---|---|
| Access tokens at rest | AES-256-GCM envelope encryption, versioned for rotation |
| Shop domain input | Strict `*.myshopify.com` allowlist — this is what stops the install endpoint becoming an open redirect |
| OAuth CSRF | Single-use nonce bound to the shop, expiring in 15 minutes |
| Redirect signatures | Timing-safe HMAC on every signed Shopify redirect |
| Webhook authenticity | HMAC over the **raw** body, before any JSON parsing |
| Webhook replay | Every webhook id is claimed once; duplicates are dropped |
| API authentication | App Bridge session tokens, verified for signature, audience, expiry, and `dest`/`iss` agreement |
| Clickjacking | `frame-ancestors` naming only the merchant's own admin |
| Log hygiene | Tokens, secrets and signatures are redacted by the logger itself |
| Uninstall | The access token is destroyed immediately, not merely marked stale |
| `shop/redact` | Every row for the store is deleted for real |

This app reads product images and writes alt text. It never requests, receives,
or stores customer, order, or address data — which is why the two customer GDPR
webhooks have nothing to report.

---

## Running it

### Prerequisites

- Node.js 20.11+
- A Postgres database (Supabase's free tier is plenty)
- A Shopify Partner account and a development store
- An Anthropic API key

### Local development

```bash
npm install
cp .env.example .env          # then fill it in
npm run migrate
npm run dev
```

Generate the encryption key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Shopify must reach the app over HTTPS, so expose it with a tunnel and set
`APP_URL` to the tunnel's URL:

```bash
npx shopify app dev            # or: cloudflared tunnel --url http://localhost:8080
```

### Tests

```bash
npm test          # unit tests
npm run typecheck
npm run build
```

### Production

```bash
docker build -t alt-text-autopilot .
docker run -p 8080:8080 --env-file .env alt-text-autopilot
```

Migrations run automatically at boot under an advisory lock, so a rolling deploy
of several instances is safe.

By default the worker runs inside the web process, which is the right shape for
one small box. Once volume justifies it, set `RUN_WORKER_IN_WEB=false` and run
`npm run worker` separately; both read the same queue and coordinate through
Postgres.

---

## Configuration

Every variable is validated at boot. A missing or malformed value stops the
process rather than letting it run in a half-configured state — an app that
starts without its API secret will accept webhooks it cannot verify, which is
worse than not starting.

See `.env.example` for the full annotated list.

The two that most affect behaviour:

- `ANTHROPIC_MODEL` — defaults to `claude-opus-5`.
- `ANTHROPIC_EFFORT` — defaults to `low`. Alt text is a short, tightly specified
  task, so low effort is faster and cheaper without measurably worse
  descriptions. Raise it if you change the prompt substantially.

---

## Cost

Per image, the app sends one 800px rendition (Shopify's CDN resizes it — a 4000px
original and an 800px one produce the same description, and the large one costs
several times as many image tokens) plus a short prompt, and receives about 60
tokens back.

At the time of writing that lands well under a cent per image on `claude-opus-5`,
against a $9.99 plan covering 500 images. Check current per-token pricing before
setting your own margins, and remember the cost is front-loaded: a store's
catalogue is described once, after which only new uploads cost anything.

Infrastructure is a free-tier database, a small container, and a domain.

---

## Shopify App Store submission

The pieces reviewers check are already in place: the three mandatory compliance
webhooks, embedded App Bridge with session-token authentication, per-merchant
`frame-ancestors`, the Billing API rather than an external payment page, and
GDPR-honest data handling.

Before submitting:

1. Copy `shopify.app.toml.example` to `shopify.app.toml` and fill in `client_id`.
2. Set `BILLING_TEST_MODE=false`.
3. Confirm `SHOPIFY_API_VERSION` names a version Shopify still supports.
4. Deploy config with `npx shopify app deploy`.

---

## Licence

See `LICENSE`.
