# Credit Dashboard Setup

Phase 2 is guarded by `CREDITS_ENABLED`. Keep it `false` until the database,
pricing, password, SumUp, R2, and smoke checks below are complete. With the flag
off, the editor remains usable and the paid credit gates stay inert.

## 1. Create `.env.local`

```bash
cp .env.example .env.local
```

Fill secrets only in `.env.local`. Do not put real keys in `.env.example`, docs,
tests, screenshots, or chat.

## 2. MongoDB

Credits require MongoDB transactions, so use MongoDB Atlas or a local replica set.
A standalone `mongod` will fail closed with `TRANSACTIONS_UNSUPPORTED`.

Required:

```bash
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster.example.net/reel_creator
MONGODB_DB_NAME=reel_creator
```

Then run:

```bash
npm run credits:db-smoke
```

The JSON output should include `connected: true` and
`transactionsSupported: true`.

## 3. OpenAI Pricing

`lib/ai/openai-pricing.js` contains a seed table with version
`openai-seed-2026-07-09-user-review-required`. Before enabling charges, compare
every configured model with the official [OpenAI API pricing page](https://platform.openai.com/docs/pricing)
and either update the seed in code or set `OPENAI_PRICE_TABLE_JSON`.

Override format:

```bash
OPENAI_PRICE_TABLE_JSON={"version":"ops-reviewed-YYYY-MM-DD","models":{"gpt-4o":{"inputPerMTokensMicros":250000000,"outputPerMTokensMicros":1000000000}}}
```

Values are micro-pence. One penny is `1000000` micro-pence. Missing configured
models fail closed before generation starts.

## 4. Password Gate And Rate Limit

Required when `CREDITS_ENABLED=true`:

```bash
GENERATION_PASSWORD=shared-password-for-operators
GENERATION_UNLOCK_SECRET=long-random-server-secret
GENERATION_UNLOCK_TTL_SECONDS=43200
GEN_RATE_MAX=20
GEN_RATE_WINDOW_SECONDS=3600
```

Generate a strong unlock secret with:

```bash
openssl rand -hex 32
```

The password is compared server-side and never stored in MongoDB. Successful
unlock creates a signed HttpOnly cookie.

## 5. SumUp

Start in sandbox mode:

```bash
SUMUP_MODE=sandbox
SUMUP_API_KEY_TEST=sk_test_...
SUMUP_MERCHANT_CODE_TEST=...
SUMUP_API_BASE_URL=https://api.sumup.com
SUMUP_CURRENCY=GBP
SUMUP_WEBHOOK_URL=https://your-public-url.example/api/webhooks/sumup
SUMUP_CHECKOUT_RETURN_URL=https://your-public-url.example/payment/return
```

For local webhook testing, point a temporary HTTPS tunnel at `localhost:3000` and
use that tunnel URL for the webhook and return URLs. Do not use live credentials
with temporary or localhost URLs unless `ALLOW_TEMP_LIVE_PAYMENT_URLS=true` is
set intentionally for a controlled test.

Smoke test:

```bash
npm run credits:sumup-smoke
```

This creates a GBP 1.00 hosted checkout. Use sandbox credentials unless you
intend to create a live checkout.

## 6. Cloudflare R2

R2 stores saved generation audio so `/dashboard` cards can play publicly.

```bash
R2_ENABLED=true
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=...
R2_PUBLIC_BASE_URL=
```

Smoke test:

```bash
npm run credits:r2-smoke
```

The script writes, HEADs, and deletes a tiny object. If it fails after writing,
it attempts cleanup and prints a safe error code.

## 7. Enablement Checklist

1. `npm run lint`
2. `npm test`
3. `npm run credits:db-smoke`
4. `npm run credits:r2-smoke`
5. `npm run credits:sumup-smoke`
6. Set `CREDITS_ENABLED=true` and restart the app.
7. Unlock generation in the editor.
8. Create a sandbox top-up, return from checkout, and confirm the balance.
9. Generate with "save to dashboard" on.
10. Open `/dashboard`, play the saved audio, and open it back in the editor.
11. Run `npm run credits:payment-audit` and confirm anomaly counts are zero.

## Operations Scripts

`npm run credits:payment-audit`

Read-only payment and ledger consistency summary. Use after sandbox or staging
payment tests and before live enablement.

`npm run credits:r2-reconcile -- --limit=100`

Retries generation audio R2 state. It can repair a Mongo `pending_create` state
when the object already exists in R2, record safe create failures, delete R2
objects for soft-deleted generations, and hard-delete the Mongo document only
after R2 deletion succeeds or is safely skipped. Add `--dry-run` to inspect
candidates without writing.

`npm run credits:ledger-repair`

Dry-run scan for historical `PAID` and `balanceCredited` SumUp orders missing
their `top_up:{orderId}` ledger entry. It does not change the balance. Pass
`-- --apply` only after reviewing the dry-run output.

Repaired rows are stamped with `metadata.repairedHistoricalEntry: true` and
`metadata.balanceAfterMinorIndicative: true`. The `balanceAfterMinor` value on
those rows is the **current** shared balance at repair time (indicative only),
not a reconstructed historical post-balance.

`npm run credits:ai-settle-repair`

Dry-run remediation for **transient-error** unresolved AI accounting (after
REP-201, insufficient balance clamps and does **not** leave `unresolved`).
Scans:

- `UsageRecord` rows with `attemptFinal: true`, `charged: false`, and
  `rawCostMicros > 0` (settlement/DB failure after work completed)
- `Generation` documents with `accountingStatus: "unresolved"`

Clamp write-offs (`charged: true` + `writeOffMinor`) are **not** candidates —
they already settled with an audited write-off and may have no ledger row when
the debit was fully written off.

Default is dry-run (JSON summary only). Pass `-- --apply` to re-run
`settlePhase` under the existing idempotency key `ai_debit:{jobId}:{phase}`
(no double debit). Optional signed `MANUAL_ADJUSTMENT`:

```bash
npm run credits:ai-settle-repair -- --apply \
  --manual-adjustment-minor=-5 \
  --reason="operator correction" \
  --idempotency-key=manual_adj:ai_repair:example-1
```

Filters: `--job-id=…`, `--phase=transcribe|enrich|time`, `--limit=N`.

## Rollback

Set `CREDITS_ENABLED=false` and restart. This disables generation charging,
password/rate gates, balance reads, and the editor credit chrome. Ledger rows are
append-only; corrections should use new `MANUAL_ADJUSTMENT` entries rather than
editing or deleting historical rows.
