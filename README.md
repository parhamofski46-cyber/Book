# ChanSub — subscription management for private Telegram channels

A bot that runs paid access to private Telegram channels end to end: it takes
the payment, hands out a single-use invite, tracks the expiry date, sends the
renewal reminder, and removes the member when the grace window runs out. The
channel owner does nothing after setup.

## The design decision that matters most

**Subscriber money never passes through this platform.**

Each channel owner plugs in their own payment credentials. A subscriber pays
the owner directly; this bot records that it happened and grants access. The
platform's only revenue is a monthly software fee owners pay separately.

This keeps the operator out of the money-transmission business — no licence to
hold other people's funds, no liability when a subscriber disputes a charge,
and tax exposure limited to actual software revenue rather than gross flow.

```
subscriber ──pays──▶ owner's own gateway ──▶ owner
     │
     └──▶ bot records payment, issues invite, tracks expiry

owner ──monthly software fee──▶ platform operator
```

## What makes it different

| | Typical competitor | Here |
|---|---|---|
| Payment providers | one, fixed | four, per owner: Stars, ZarinPal, PayPal, card transfer |
| Languages | English only | English, Persian, Arabic, Turkish, Russian |
| Lapsed members | removed immediately | configurable grace window with escalating reminders |
| Manual payments | screenshot review | unique-amount reconciliation against a bank statement |
| Growth | none | referral attribution built into the checkout deep link |

### Grace periods instead of instant removal

A member whose renewal is a day late keeps access for a per-channel grace
window. Reminders escalate: a heads-up three days before expiry, a warning at
lapse, removal only after the window closes. Owners recover late renewals that
a hard cutoff would have lost, and nobody is ejected over a bank delay.

### Unique-amount reconciliation

Screenshots prove nothing — they take thirty seconds to fake. Instead every
invoice adds a small random suffix to its amount (`5,000,000` → `5,003,741`),
unique among all invoices currently awaiting payment. The exact figure appears
once in the recipient's bank statement and identifies the payer, so confirming
is a two-second match rather than an act of faith.

### Referral loop

Every plan link is a deep link (`?start=plan_42`). Every owner also gets
`?start=ref_<code>`. When a referred owner pays their first invoice, the
referrer is credited a free month — once, enforced in the service layer.

## Architecture

```
app/
├── config.py            settings from environment
├── db/models.py         schema; see the module docstring for the money rules
├── i18n/                JSON catalogues, one per language
├── payments/
│   ├── base.py          provider interface + registry
│   ├── stars.py         Telegram Stars (self-verifying)
│   ├── zarinpal.py      Iranian rial gateway (server-side verify)
│   ├── paypal.py        PayPal.me link, reviewed by hand
│   └── manual_card.py   card transfer, unique-amount reconciliation
├── services/            business logic, no Telegram types
│   ├── subscriptions.py purchase, activation, renewal, expiry sweeps
│   ├── membership.py    invites and removals
│   └── billing.py       platform invoices and referral credit
├── bot/                 aiogram handlers, keyboards, middlewares
└── scheduler/jobs.py    hourly sweep: remind → lapse → remove
```

Handlers hold no business logic; services take no Telegram types. Adding a
payment provider means one file in `payments/` and one enum value — nothing in
the subscription logic changes.

## Correctness guarantees

Both are covered by tests:

- **No double grants.** `(provider, provider_ref)` is unique in the database. A
  replayed webhook or a double-tapped button loses the insert race and is
  treated as a no-op.
- **Renewal extends, never resets.** Renewing four days early keeps those four
  days. Resetting would silently charge people for time they had already
  bought.

## Setup

```bash
pip install -e ".[dev]"
cp .env.example .env      # fill in BOT_TOKEN and ADMIN_IDS
python -m app.bot.main
```

`ADMIN_IDS` is the operator's own Telegram user id — those accounts get
`/admin` and `/invoices`. Everyone else sees only owner and subscriber flows.

### Commands

| Command | Who | What |
|---|---|---|
| `/setup` | owner | connect a channel (forward a post from it) |
| `/addplan` | owner | create a plan, returns the shareable link |
| `/channels` | owner | per-channel stats: active, expiring, revenue, renewal rate |
| `/provider` | owner | choose how to collect payments |
| `/claims` | owner | confirm or reject payments buyers say they made |
| `/billing` | owner | plan status and the current invoice |
| `/referral` | owner | referral link and count |
| `/language` | anyone | switch language |
| `/admin` | operator | platform totals and manual-volume warning |
| `/invoices` | operator | confirm or reject pending transfers |

## Deployment notes

**Telegram API access.** `api.telegram.org` is filtered inside Iran. Set
`TELEGRAM_PROXY` when the bot runs on an Iranian host, or run it abroad and
confirm the payment gateway accepts foreign origins. Verify this before
committing to a host — it is the most common way this deployment fails.

**Manual billing volume.** `/admin` warns once confirmed transfers approach
80 in 30 days. Past roughly 100 deposits a month, Iranian rules treat a
personal account as a business account. The migration path is to add a gateway
provider for platform billing, not to keep reviewing transfers by hand.

**Telegram Stars payouts.** Stars can be collected long before they can be
withdrawn — Fragment applies a hold plus identity verification, and coverage is
not universal. Complete one real end-to-end withdrawal before treating Stars as
revenue. Collecting money you cannot withdraw is worse than not collecting it.

## Testing

```bash
python -m pytest tests/ -q
python -m ruff check app tests
```

47 tests. Alongside the unit tests, `tests/test_end_to_end.py` drives the real
services, real SQL and the real hourly sweep with only the Telegram transport
replaced by a recorder — so purchase, admission, reminder, grace, removal and
re-subscription are exercised as shipped code.

That end-to-end pass found three bugs that the unit tests did not:

1. **Expiry sweeps crashed on SQLite.** `DateTime(timezone=True)` returns
   *naive* datetimes on SQLite and aware ones on PostgreSQL, so every
   `expires_at - now()` raised `TypeError` — reminders and removals would have
   failed on every run. Fixed with a `UtcDateTime` type that normalises at the
   column boundary, so this cannot recur on any column.
2. **Manually-settled payments had no confirmation path.** PayPal and card
   buyers could tap "I have paid" and nothing in the product could ever let
   them in. `services/subscriber_payments.py` plus `/claims` closes it, with
   authorisation resolved from the channel rather than the caller's claim.
3. **Switching payment provider stranded existing plans.** An owner moving to
   Stars with rial-priced plans crashed the buyer's checkout; moving to PayPal
   with Stars-priced plans quoted "150 ⭐" as a PayPal amount. `CURRENCY_FOR` is
   now the single source of truth, checked when a plan is created, when a
   provider is switched, and again at checkout.

Translation tests assert every catalogue carries the same keys *and* the same
placeholders — a placeholder present in one language and missing in another
renders wrong for real users.

## Status

Working: schema, payment abstraction with four providers, subscription
lifecycle, invites and removal, hourly sweeps, five languages, owner flows,
manual payment confirmation, operator panel, referral credit.

Not verified: anything requiring a live Telegram connection. The bot has never
held a real token, joined a real channel, or taken a real payment. Every
Telegram call is exercised against a recorder, which proves the arguments and
the ordering but not Telegram's acceptance of them. Run it against a test bot
and a throwaway channel before trusting it with money.

Not built yet: Alembic migrations (tables are created directly at startup — fine
for development, replace before production), a ZarinPal callback HTTP endpoint
(the client is written and tested; it needs a web server to receive the
return), and per-channel grace-window editing from the bot (the column and
logic exist, the UI does not).
