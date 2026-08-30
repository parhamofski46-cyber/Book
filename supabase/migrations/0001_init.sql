-- AI Visibility Platform — initial schema
--
-- Design notes:
--   * Multi-tenancy is enforced by RLS at the database layer, never in application code.
--   * Three data tiers: raw responses -> object storage, structured facts -> here,
--     dashboard reads -> metrics_daily only. See docs/ARCHITECTURE.md section 3.
--   * Every measurement carries its sample size and confidence interval. A bare
--     proportion is never surfaced to a customer.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

create table organizations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  slug         text not null unique,
  plan         text not null default 'trial'
                 check (plan in ('trial','audit','growth','scale','enterprise')),
  -- Agency workspaces resell to their own clients; see docs/GTM.md section 2.
  is_agency    boolean not null default false,
  parent_org_id uuid references organizations(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table memberships (
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member' check (role in ('owner','admin','member','viewer')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index on memberships (user_id);

-- ---------------------------------------------------------------------------
-- Tracked entities
-- ---------------------------------------------------------------------------

create table brands (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  name       text not null,
  domain     text,
  category   text,
  locale     text not null default 'en',
  -- 'subject' = the customer's own brand; 'competitor' = tracked for comparison.
  kind       text not null default 'subject' check (kind in ('subject','competitor')),
  -- Entity resolution depends on these. Abbreviations, legal name, parent company,
  -- product names, common misspellings, and transliterations. See ARCHITECTURE 2.3.
  aliases    text[] not null default '{}',
  -- Strings that look like the brand but are not it ("Apple" the fruit).
  negative_context text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index on brands (org_id);

-- Which competitors are compared against which subject brand.
create table brand_competitors (
  subject_brand_id    uuid not null references brands(id) on delete cascade,
  competitor_brand_id uuid not null references brands(id) on delete cascade,
  primary key (subject_brand_id, competitor_brand_id),
  check (subject_brand_id <> competitor_brand_id)
);

-- ---------------------------------------------------------------------------
-- Prompts
-- ---------------------------------------------------------------------------

create table prompt_sets (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  brand_id   uuid not null references brands(id) on delete cascade,
  name       text not null,
  locale     text not null default 'en',
  created_at timestamptz not null default now()
);

create index on prompt_sets (org_id);

create table prompts (
  id            uuid primary key default gen_random_uuid(),
  prompt_set_id uuid not null references prompt_sets(id) on delete cascade,
  text          text not null,
  -- Coverage across intent types is what makes a prompt set representative.
  intent_type   text not null
                  check (intent_type in ('comparison','recommendation','problem',
                                         'alternative','feature','pricing','reputation')),
  -- Relative importance when rolling up into a headline visibility score.
  weight        numeric not null default 1.0 check (weight > 0),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create index on prompts (prompt_set_id) where is_active;

-- ---------------------------------------------------------------------------
-- Model registry
-- ---------------------------------------------------------------------------

create table models (
  id                   uuid primary key default gen_random_uuid(),
  provider             text not null,
  model_id             text not null,
  display_name         text not null,
  supports_web_search  boolean not null default false,
  supports_batch       boolean not null default false,
  -- Cost tracking lives in the database so gross margin per customer is always
  -- queryable. See ARCHITECTURE 2.2 -- cost engineering IS the business model.
  input_cost_per_mtok  numeric,
  output_cost_per_mtok numeric,
  -- Provider rate limits differ; the job engine reads this for concurrency control.
  max_concurrency      int not null default 4,
  is_active            boolean not null default true,
  unique (provider, model_id)
);

-- ---------------------------------------------------------------------------
-- Execution
-- ---------------------------------------------------------------------------

create table runs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  prompt_set_id uuid not null references prompt_sets(id) on delete cascade,
  -- Samples per (prompt, model). Never 1 -- a single sample measures nothing.
  sample_size   int not null default 10 check (sample_size >= 1),
  status        text not null default 'pending'
                  check (status in ('pending','running','completed','failed','cancelled')),
  scheduled_at  timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  -- Denormalised roll-up so margin per run is one lookup, not an aggregate scan.
  total_cost_usd numeric not null default 0,
  created_at    timestamptz not null default now()
);

create index on runs (org_id, scheduled_at desc);
create index on runs (status) where status in ('pending','running');

create table executions (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references runs(id) on delete cascade,
  prompt_id     uuid not null references prompts(id) on delete cascade,
  model_id      uuid not null references models(id),
  sample_index  int  not null,
  status        text not null default 'pending'
                  check (status in ('pending','running','succeeded','failed','skipped')),
  -- Raw text is large and rarely read; it lives in object storage.
  raw_response_uri text,
  -- Recorded so a measurement can be reproduced exactly.
  params        jsonb not null default '{}',
  input_tokens  int,
  output_tokens int,
  cost_usd      numeric,
  latency_ms    int,
  error         text,
  attempts      int not null default 0,
  created_at    timestamptz not null default now(),
  -- Idempotency: a retried job must never pay for the same call twice.
  unique (run_id, prompt_id, model_id, sample_index)
);

create index on executions (run_id, status);

-- ---------------------------------------------------------------------------
-- Extracted facts
-- ---------------------------------------------------------------------------

create table mentions (
  id           uuid primary key default gen_random_uuid(),
  execution_id uuid not null references executions(id) on delete cascade,
  brand_id     uuid not null references brands(id) on delete cascade,
  mentioned    boolean not null,
  -- 1 = named first. Null when mentioned without an ordered list.
  position     int check (position is null or position > 0),
  sentiment    text check (sentiment in ('positive','neutral','negative','mixed')),
  -- What the model actually claimed about the brand -- the raw material for
  -- the corrective-content engine.
  claims       jsonb not null default '[]',
  -- Below threshold, the extraction is escalated to a stronger model (ARCHITECTURE 2.3).
  confidence   numeric check (confidence between 0 and 1),
  extracted_by text,
  created_at   timestamptz not null default now(),
  unique (execution_id, brand_id)
);

create index on mentions (brand_id) where mentioned;

-- Where the model got its answer -- the diagnosis engine (ARCHITECTURE 2.4).
create table citations (
  id           uuid primary key default gen_random_uuid(),
  execution_id uuid not null references executions(id) on delete cascade,
  url          text not null,
  domain       text not null,
  title        text,
  position     int,
  created_at   timestamptz not null default now()
);

create index on citations (execution_id);
create index on citations (domain);

-- ---------------------------------------------------------------------------
-- Pre-aggregated metrics -- the ONLY table the dashboard reads
-- ---------------------------------------------------------------------------

create table metrics_daily (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  brand_id      uuid not null references brands(id) on delete cascade,
  prompt_set_id uuid not null references prompt_sets(id) on delete cascade,
  -- Null = aggregated across all models.
  model_id      uuid references models(id),
  day           date not null,
  sample_n      int  not null,
  mention_count int  not null,
  mention_rate  numeric not null,
  -- Wilson score interval. Reported alongside every rate; a change is only a
  -- change when intervals do not overlap. See ARCHITECTURE 2.1.
  ci_low        numeric not null,
  ci_high       numeric not null,
  avg_position  numeric,
  sentiment_score numeric,
  computed_at   timestamptz not null default now(),
  unique (brand_id, prompt_set_id, model_id, day)
);

create index on metrics_daily (org_id, brand_id, day desc);

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Tenant isolation is a database guarantee, not an application convention.
-- ---------------------------------------------------------------------------

create or replace function current_user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from memberships where user_id = auth.uid();
$$;

alter table organizations    enable row level security;
alter table memberships      enable row level security;
alter table brands           enable row level security;
alter table brand_competitors enable row level security;
alter table prompt_sets      enable row level security;
alter table prompts          enable row level security;
alter table runs             enable row level security;
alter table executions       enable row level security;
alter table mentions         enable row level security;
alter table citations        enable row level security;
alter table metrics_daily    enable row level security;

create policy org_read on organizations
  for select using (id in (select current_user_org_ids()));

create policy membership_read on memberships
  for select using (org_id in (select current_user_org_ids()));

-- Tables carrying org_id directly.
create policy brand_access on brands
  for all using (org_id in (select current_user_org_ids()));
create policy prompt_set_access on prompt_sets
  for all using (org_id in (select current_user_org_ids()));
create policy run_access on runs
  for all using (org_id in (select current_user_org_ids()));
create policy metrics_access on metrics_daily
  for all using (org_id in (select current_user_org_ids()));

-- Tables reached through a parent.
create policy competitor_access on brand_competitors
  for all using (subject_brand_id in (select id from brands));
create policy prompt_access on prompts
  for all using (prompt_set_id in (select id from prompt_sets));
create policy execution_access on executions
  for all using (run_id in (select id from runs));
create policy mention_access on mentions
  for all using (execution_id in (select id from executions));
create policy citation_access on citations
  for all using (execution_id in (select id from executions));

-- The model registry is shared reference data.
alter table models enable row level security;
create policy model_read on models for select using (true);
