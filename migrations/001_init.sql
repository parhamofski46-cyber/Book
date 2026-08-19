-- Alt Text Autopilot — initial schema.
-- Designed to run on any Postgres 14+ (Supabase free tier, Neon, plain Docker).


-- ---------------------------------------------------------------------------
-- shops: one row per installed store. The access token is stored encrypted.
-- ---------------------------------------------------------------------------
CREATE TABLE shops (
    id                    BIGSERIAL PRIMARY KEY,
    domain                TEXT        NOT NULL UNIQUE,
    access_token          TEXT,                 -- AES-256-GCM envelope, NULL once uninstalled
    scopes                TEXT        NOT NULL DEFAULT '',

    -- Storefront metadata, refreshed on install and on demand.
    shop_name             TEXT,
    contact_email         TEXT,
    country_code          TEXT,
    currency              TEXT,
    primary_locale        TEXT        NOT NULL DEFAULT 'en',
    plan_display_name     TEXT,                 -- merchant's own Shopify plan (e.g. "Basic")

    -- Billing.
    plan_key              TEXT        NOT NULL DEFAULT 'free',
    subscription_gid      TEXT,
    subscription_status   TEXT,
    trial_ends_at         TIMESTAMPTZ,

    -- Per-merchant behaviour. See src/config/settings.ts for the shape.
    settings              JSONB       NOT NULL DEFAULT '{}'::JSONB,

    -- Rolling monthly usage window.
    quota_used            INTEGER     NOT NULL DEFAULT 0,
    quota_period_start    DATE        NOT NULL DEFAULT date_trunc('month', now())::DATE,

    backfill_state        TEXT        NOT NULL DEFAULT 'pending',  -- pending|running|done|failed
    backfill_completed_at TIMESTAMPTZ,

    installed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    uninstalled_at        TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT shops_plan_key_valid
        CHECK (plan_key IN ('free', 'starter', 'growth', 'agency')),
    CONSTRAINT shops_backfill_state_valid
        CHECK (backfill_state IN ('pending', 'running', 'done', 'failed'))
);

CREATE INDEX shops_active_idx ON shops (id) WHERE uninstalled_at IS NULL;

-- ---------------------------------------------------------------------------
-- images: the audit trail. Every image we look at gets exactly one row, so the
-- merchant can always answer "what did this app change, and when?".
-- ---------------------------------------------------------------------------
CREATE TABLE images (
    id              BIGSERIAL PRIMARY KEY,
    shop_id         BIGINT      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    media_gid       TEXT        NOT NULL,       -- gid://shopify/MediaImage/123
    product_gid     TEXT        NOT NULL,
    product_title   TEXT,
    product_handle  TEXT,
    image_url       TEXT,

    alt_before      TEXT,
    alt_after       TEXT,

    status          TEXT        NOT NULL DEFAULT 'pending',
    -- pending  : discovered, queued for generation
    -- applied  : alt text generated and written back to Shopify
    -- skipped  : already had alt text and overwrite is off
    -- failed   : generation or write-back failed permanently
    -- reverted : merchant undid our change
    skip_reason     TEXT,
    error_message   TEXT,

    model           TEXT,
    input_tokens    INTEGER,
    output_tokens   INTEGER,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT images_status_valid
        CHECK (status IN ('pending', 'applied', 'skipped', 'failed', 'reverted')),
    CONSTRAINT images_unique_media UNIQUE (shop_id, media_gid)
);

CREATE INDEX images_shop_status_idx  ON images (shop_id, status);
CREATE INDEX images_shop_created_idx ON images (shop_id, created_at DESC);
CREATE INDEX images_product_idx      ON images (shop_id, product_gid);

-- ---------------------------------------------------------------------------
-- jobs: a Postgres-backed work queue. Claimed with FOR UPDATE SKIP LOCKED so
-- several workers can share one table without a broker.
-- ---------------------------------------------------------------------------
CREATE TABLE jobs (
    id            BIGSERIAL PRIMARY KEY,
    shop_id       BIGINT      REFERENCES shops(id) ON DELETE CASCADE,
    type          TEXT        NOT NULL,
    payload       JSONB       NOT NULL DEFAULT '{}'::JSONB,

    status        TEXT        NOT NULL DEFAULT 'queued',  -- queued|running|done|failed
    priority      SMALLINT    NOT NULL DEFAULT 100,       -- lower runs first
    run_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts      INTEGER     NOT NULL DEFAULT 0,
    max_attempts  INTEGER     NOT NULL DEFAULT 5,

    locked_at     TIMESTAMPTZ,
    locked_by     TEXT,

    last_error    TEXT,
    /* Collapses duplicate work: a product edited five times in a minute
       should be processed once. NULL means "never deduplicate". */
    dedupe_key    TEXT,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT jobs_status_valid CHECK (status IN ('queued', 'running', 'done', 'failed'))
);

-- The claim query's covering index: only pending work is indexed.
CREATE INDEX jobs_claimable_idx
    ON jobs (priority, run_at, id)
    WHERE status = 'queued';

CREATE UNIQUE INDEX jobs_dedupe_idx
    ON jobs (dedupe_key)
    WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running');

CREATE INDEX jobs_stalled_idx ON jobs (locked_at) WHERE status = 'running';
CREATE INDEX jobs_shop_idx    ON jobs (shop_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- webhook_events: Shopify retries webhooks; this makes handlers idempotent.
-- ---------------------------------------------------------------------------
CREATE TABLE webhook_events (
    webhook_id   TEXT        PRIMARY KEY,
    topic        TEXT        NOT NULL,
    shop_domain  TEXT        NOT NULL,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX webhook_events_received_idx ON webhook_events (received_at);

-- ---------------------------------------------------------------------------
-- oauth_states: single-use nonces for the OAuth handshake (CSRF defence).
-- ---------------------------------------------------------------------------
CREATE TABLE oauth_states (
    state       TEXT        PRIMARY KEY,
    shop_domain TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX oauth_states_created_idx ON oauth_states (created_at);

-- ---------------------------------------------------------------------------
-- monthly_usage: retained history for the merchant-facing report and for our
-- own cost accounting (tokens are money).
-- ---------------------------------------------------------------------------
CREATE TABLE monthly_usage (
    shop_id          BIGINT  NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    period           DATE    NOT NULL,
    images_processed INTEGER NOT NULL DEFAULT 0,
    input_tokens     BIGINT  NOT NULL DEFAULT 0,
    output_tokens    BIGINT  NOT NULL DEFAULT 0,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (shop_id, period)
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER shops_touch  BEFORE UPDATE ON shops  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER images_touch BEFORE UPDATE ON images FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER jobs_touch   BEFORE UPDATE ON jobs   FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
