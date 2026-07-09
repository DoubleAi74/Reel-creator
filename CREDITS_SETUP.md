# Credit Dashboard Setup

Phase 2 is guarded by `CREDITS_ENABLED`. Keep it `false` until the database,
pricing, password, SumUp, R2, and smoke checks below are complete. With the flag
off, the editor remains usable and the paid credit gates stay inert.

## Mocked infrastructure caveat (local tests)

`npm test` uses **in-process mocks and emulators**, not production services:

| Dependency | In Vitest | Required for real enablement |
|---|---|---|
| MongoDB | `mongodb-memory-server` replica set | Atlas / real replica set (`credits:db-smoke`) |
| SumUp | mocked `fetch` / stubbed client | Sandbox then live keys |
| Cloudflare R2 | mocked client / lifecycle | Sandbox bucket + `credits:r2-smoke` |
| OpenAI | mocked HTTP / no paid calls | Real key; pricing reviewed (REP-805) |
| RapidAPI (YT) | mocked provider responses | Real RapidAPI key |

Green local tests **do not** replace sandbox E2E (see checklist below). Always keep
`CREDITS_ENABLED=false` until Mongo transactions, SumUp sandbox, R2, and pricing
are verified with real (non-prod) services.

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
# Defaults match code + .env.example (REP-801): 20 requests / 3600 seconds
GEN_RATE_MAX=20
GEN_RATE_WINDOW_SECONDS=3600
# Optional tighter limits (env wins over code defaults)
CHECKOUT_RATE_MAX=20
CHECKOUT_RATE_WINDOW_SECONDS=600
UNLOCK_RATE_MAX=20
UNLOCK_RATE_WINDOW_SECONDS=300
ORDER_RATE_MAX=60
ORDER_RATE_WINDOW_SECONDS=60
```

Generate a strong unlock secret with:

```bash
openssl rand -hex 32
```

The password is compared server-side and never stored in MongoDB. Successful
unlock creates a signed HttpOnly cookie (`Secure` in production / https
`APP_BASE_URL`).

### Rate-limit operational notes (REP-804)

- Limiters are **in-memory and per Node process**. Behind N app instances the
  effective ceiling is roughly `limit × N` unless you put a shared edge limiter
  in front.
- Expired keys are periodically **evicted** so the map cannot grow without bound.
- Client IP is taken from the **first** `X-Forwarded-For` hop (then `X-Real-Ip`).
  Only trust these headers when a reverse proxy you control strips/forges them;
  otherwise clients can spoof IPs and bypass per-IP limits.

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

## 7. Enablement Checklist (local smoke)

1. `npm run lint`
2. `npm test`
3. `npm run credits:db-smoke`
4. `npm run credits:r2-smoke`
5. `npm run credits:sumup-smoke`
6. Set `CREDITS_ENABLED=true` and restart the app (**sandbox only** until §8 passes).
7. Unlock generation in the editor.
8. Create a sandbox top-up, return from checkout, and confirm the balance.
9. Generate with "save to dashboard" on (set a **user title** in project meta so the card is public).
10. Open `/dashboard`, play the saved audio, and open it back in the editor.
11. Run `npm run credits:payment-audit` and confirm anomaly counts are zero.

## 8. Sandbox E2E Checklist (REP-803 / audit §22)

Run with SumUp **sandbox**, Mongo **replica set**, R2 sandbox, and a real (non-prod)
OpenAI key. Keep production `CREDITS_ENABLED=false` until this list is green and
**REP-805** pricing is operator-reviewed.

- [ ] **Top-up exactly-once:** webhook alone, return-page alone, **both** (incl. race),
      duplicate webhook → single credit; amount/currency/merchant mismatch rejected.
- [ ] **Charging:** ledger debits == summed finalized `UsageRecord` for completed phases;
      partial failure charges only completed phases; retry/re-adopt no double debit.
- [ ] **H1 clamp go/no-go (post REP-201):** cost > balance → balance floors at 0, work kept,
      `writeOffMinor` recorded; "run all" that zeroes balance in Block A finishes enrich,
      then **time** is blocked (402). `phase: full` rejected when credits enabled (REP-201a).
- [ ] **Gates:** 402 insufficient, 403 locked, 429 rate-limited on gen/checkout/unlock/orders.
- [ ] **Kill-switch:** `CREDITS_ENABLED=false` with backends configured → checkout/webhook/
      dashboard/media inert (404/empty); editor generation path ungated as before.
- [ ] **Persistence/R2:** titled save → public card + playable audio + open-in-editor;
      save toggle off → nothing public; forced R2 put failure repaired by `r2-reconcile`
      both directions.
- [ ] **Deletion (script-only):** set `deletedAt` → `credits:r2-reconcile` removes R2 →
      hard-delete Mongo only after R2 gone (see §10).
- [ ] **Standalone Mongo:** non-RS URI → `TRANSACTIONS_UNSUPPORTED` fail-closed.
- [ ] **Pricing:** every model in precheck + live pipeline is priced; missing fails closed.
- [ ] **Orphan YT cleanup:** result files cleaned after restart (sweeper on YT POST).
- [ ] **Unresolved remediation:** seed transient `unresolved` / uncharged finalized usage →
      `credits:ai-settle-repair` dry-run then `--apply` settles once (no double debit).
- [ ] **REP-303 (open):** observe SumUp sandbox `redirect_url` vs `return_url` targets;
      swap mapping only if evidence shows mis-wire (parked until sandbox run).

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

## 9. Backup, R2 lifecycle, deployment order (REP-802)

### MongoDB backup / PITR

- Prefer **Atlas** continuous backup / PITR (or equivalent) on the credits database.
- Snapshot before any index rebuild, price-table change, or live enablement.
- Restore drills: restore to a **non-prod** URI and run `credits:db-smoke` +
  `credits:payment-audit` (read-only).
- Never point production app servers at a restored copy without renaming DBs.

### R2 retention / lifecycle

- Saved generation audio lives under generation object keys; soft-delete sets
  `deletedAt` / `deleteRequestedAt` then `credits:r2-reconcile` deletes the object.
- Keep bucket versioning **off** unless you have a retention plan for billable
  storage; if versioning is on, document purge of non-current versions.
- Reconcile regularly in sandbox/staging:

```bash
npm run credits:r2-reconcile -- --limit=100
npm run credits:r2-reconcile -- --dry-run
```

### Deployment order

1. Deploy app code with **`CREDITS_ENABLED=false`** (default).
2. Ensure Mongo replica set / Atlas URI + indexes (`credits:db-smoke`).
3. Configure R2 + smoke; SumUp **sandbox** + smoke.
4. Operator completes **REP-805** price review (seed or `OPENAI_PRICE_TABLE_JSON`).
5. Run sandbox E2E (§8).
6. Only then set `CREDITS_ENABLED=true` in the target environment and restart.
7. Watch `credits:payment-audit` and balance/ledger for the first real top-ups.

### Rollback

Set `CREDITS_ENABLED=false` and restart. This disables generation charging,
password/rate gates, balance reads, payment/dashboard mutation paths (REP-402),
and the editor credit chrome. Ledger rows are append-only; corrections should use
new `MANUAL_ADJUSTMENT` entries (or `credits:ai-settle-repair`) rather than
editing or deleting historical rows.

## 10. Generation deletion procedure (script-only — D-E / REP-901)

There is **no** public DELETE route in this programme. Supported operator path:

1. Soft-delete in Mongo: set `deletedAt` (and optionally `deleteRequestedAt`) on
   the `Generation` document.
2. Run `npm run credits:r2-reconcile` so the R2 object is removed (or confirmed
   missing).
3. Only after R2 is gone (or safely skipped), hard-delete the Mongo document if
   required for retention policy.

Do not hard-delete Mongo while `r2Status` still expects a live object unless you
accept orphaned R2 storage until reconcile.
