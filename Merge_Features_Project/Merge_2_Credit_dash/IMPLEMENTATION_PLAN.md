# Credit Dashboard Merge — Phase 2 Implementation Plan

**Status**: DRAFT — awaiting final user approval. Foundational product decisions confirmed (see §5). Lower-tier defaults marked `[DEFAULT — confirm]`.
**Owner of execution**: A future, fresh Phase 2 *implementation* agent.
**Date drafted**: 2026-07-08
**Authoring agent**: Phase 2 planning agent (no application/prototype code changed).

> **CRITICAL SEQUENCING**: This plan is written against the **pre-Phase-1** live codebase. Phase 2 implementation **may not begin until Phase 1 (YouTube audio) is complete and accepted**. Before executing, the implementation agent **must** perform the reconciliation pass in §20 against the actual post-Phase-1 code. Any Phase-1 change to audio asset shape, job routes, or lifecycle seams requires an approved amendment before continuing.

---

## 1. Document Purpose

A complete, self-contained, executable contract for integrating the Credit Dashboard prototype (`Temp_prototype_parts/Credit_dash_prototype_part/`) into the main Reel Creator app: usage-based OpenAI charging, an append-only exactly-once GBP ledger, SumUp top-ups, MongoDB persistence of generations, Cloudflare R2 storage of MP3s, and a public generation-card dashboard. It is grounded in direct inspection of both live codebases (see §4) and the Phase 2 Information Bank.

It is detailed enough for a fresh implementation agent to execute without repeating the architectural investigation.

---

## 2. Phase Objective

Add a monetization + accounting + persistence + public-dashboard layer on top of the (post-Phase-1) editor:

1. Record the real cost (pence) of every OpenAI call in the lyric pipeline.
2. Debit those costs from a **single shared GBP balance** via an append-only, transactional, exactly-once ledger.
3. Let users top the balance up through **SumUp Hosted Checkout**, verified via the prototype's dual (webhook + return-page) exactly-once path.
4. Persist completed generations (lyric snapshot + card metadata) in **MongoDB**.
5. Store the associated MP3 (local upload or Phase-1 YouTube) in **Cloudflare R2**.
6. Expose a **public `/dashboard`** of generation cards (title, lyric preview, audio player, open-in-editor link).
7. Gate paid generation behind a **shared password**, while preserving 100% of current editor behavior when credits/features are disabled.

---

## 3. Goals and Non-Goals

### Goals
- Reuse the prototype's proven money/ledger/payment/R2 abstractions with minimal change.
- Instrument OpenAI cost capture at the real call sites; charge per-phase on success only.
- Never let the shared balance go negative; hard-block generation when it is too low.
- Persist generations + MP3s durably without disturbing the ephemeral session-asset system used during active editing.
- Keep the app fully functional (feature-flagged off) when Mongo/R2/SumUp are not configured.

### Non-Goals (this phase)
- User accounts / real authentication (deferred; only a shared password is added).
- Per-user balances or per-user ownership (single shared balance is confirmed).
- Migrating historical session-only generations (none persist today — none to migrate).
- Gating export/render on balance (export stays free — confirmed).
- Replacing the ephemeral asset system.
- Phase-1 (YouTube) functionality (owned by the sibling merge).
- Finalizing exact OpenAI pence prices (values are your config data; this phase builds the mechanism and a seed table).

---

## 4. Verified Current-State Architecture (evidence)

### 4.1 Main app (pre-Phase-1)
- **No DB / R2 / SumUp / mongoose / zod / aws-sdk** anywhere in `lib`,`app`,`components` (grep clean; absent from `package.json`). All are new.
- **OpenAI calls**: all go through `fetchOpenAiWithRetry` — `lib/ai/openai-lyrics.js:3581`. It returns the **raw `fetch` `Response`** and only drains bodies on retry; it **never parses JSON**, so `usage` is **not** available there. Usage is parsed at each call site (~6 sites: `:1621` content transcription, `:1748` whisper timing, `:2082` line-break, `:2196` source-repair, `:2502`/`:2631` translation/word-meanings, `:2814` polish, `:3154` QA audit).
- **Models** (`openai-lyrics.js:23-32`): `gpt-4o-transcribe` (content), `whisper-1` (timing), `gpt-4o` (line-break), `gpt-5.4-mini` (translation/source-repair), `gpt-5.4` (polish), `gpt-4o-mini` (QA audit). Several are env-overridable.
- **Orchestration**: `runTranscribeJob` — `lib/ai/transcribe-job.js:46`. Phases `transcribe | enrich | time | full`. `full` runs all three internally via `runLyricTimingPipeline`.
- **Phases enum**: `lib/staged-lyrics.js:1` → `["transcribe","enrich","time"]`.
- **Jobs**: in-memory global store, poll-based — `lib/ai/transcribe-store.js`. 24h finished-job TTL; `findInFlightTranscribeForSession` (`:136`) dedups by session+asset; the POST route returns **409 to re-adopt** an in-flight job (`app/api/ai/transcribe/route.js:170`). Jobs survive reloads via re-adoption → **idempotency keys must be deterministic per (job,phase), not per attempt**.
- **Assets**: ephemeral per-session OS-temp files — `lib/files.js`. Cookie `reel-creator-session`; 24h TTL sweep; active jobs exempt sessions; `MAX_AUDIO_BYTES` 25 MB. Seams: `storeUploadedAsset:292`, `getAssetFilePath:286`, `readAssetMetadata:242`.
- **App is fully anonymous** — no user model, no login, no password.

### 4.2 Credit prototype (patterns to lift)
- **Money** — `lib/money.js`: integer pence everywhere; `formatGbpFromMinor`, `isValidTopUpMinor`, bounds 1–10000p.
- **Ledger** — `lib/ledger/balance-ledger.mjs`: `applyLedgeredBalanceChange` in a Mongo **transaction/session**; replay-safe via **unique `idempotencyKey`** (early `findOne` returns `applied:false`); never-negative via conditional `findOneAndUpdate` filter (`amountMinor:{$gte:|debit|}`) → null → `INSUFFICIENT_BALANCE`. `balanceAfterMinor` stamped post-update.
- **Balance** — `lib/models/Balance.mjs`: singleton `_id:"shared"`, min 0, integer validator. Seeded to **500p** by `ensureSharedBalance` — `lib/db/bootstrap.mjs:22`.
- **Ledger types** — `lib/models/CreditLedger.mjs:3`: `["TOP_UP","CARD_CREATE","REFUND_ADJUSTMENT","MANUAL_ADJUSTMENT"]`. **No AI type — enum must be extended.**
- **Fire (reference debit+create pattern)** — `app/api/dashboard/fire/route.js`: card + ledger debit in ONE txn; R2 write **after** commit; insufficient → 409.
- **Payments** — `lib/payments/`: `createHostedCheckout`/`retrieveCheckout` (`sumup-client.mjs`), pending-order create + 10-min reuse window (`payment-orders.mjs`), dual-path exactly-once verification (`payment-verification.mjs`) via `PaymentOrder{balanceCredited:false}` atomic claim + ledger key `top_up:${orderId}`; webhook stores raw `WebhookEvent` and quick-acks (`app/api/webhooks/sumup/route.js`); env test/live split with strong Zod validation (`sumup-env.mjs`).
- **R2** — `lib/r2/`: `putR2Object`/`deleteR2Object`/`headR2Object` (`r2-client.mjs`), enable flag + creds via `R2_ENABLED` + `R2_*` (`r2-env.mjs`, exposes optional `R2_PUBLIC_BASE_URL` and derived `endpoint`), status-machine lifecycle (`card-r2-lifecycle.mjs`) with `pending_create/created/create_failed/pending_delete/deleted/skipped`, reconcile script. **Built for small placeholder objects, not multi-MB audio.**
- **DB** — `lib/db/mongoose.mjs`: cached global connection; requires `MONGODB_URI`; `dbName` from `MONGODB_DB_NAME` or URI. `bootstrap.mjs`: `ensureSharedBalance`, `initializeDatabaseIndexes`.
- **Dashboard** — `components/DashboardClient.jsx` (useReducer), `app/api/dashboard/state|fire|cards|balance`, admin behind Basic-auth `proxy.js` gated by `ENABLE_ADMIN_TOOLS`.
- **Deps**: `mongoose@^9`, `@aws-sdk/client-s3@^3`, `zod@^4`.

---

## 5. Confirmed Decisions (user-approved 2026-07-08)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Identity/ownership | **Single shared global GBP balance**; **shared password**; no user accounts. |
| D2 | What the password gates | **Only starting a paid generation.** Top-ups and viewing (editor + dashboard) are open. Dashboard is **world-readable**. |
| D3 | Charge timing | **Per phase, on that phase's success** (`transcribe`/`enrich`/`time`). |
| D4 | Partial failure | **Charge only completed phases.** Failed/unrun phases are not debited (their real usage is still recorded for audit). |
| D5 | Cost method | **Config price table × token usage** (chat/Responses) **+ per-audio-minute rates** (whisper-1, gpt-4o-transcribe). Store **both raw usage and computed pence.** |
| D6 | Low balance | **Hard-block** starting a generation when balance is at/below threshold; never negative; prompt to top up. **Export stays free.** |
| D7 | Persistence trigger | On generation completion, **auto-persist** Generation + Card + MP3→R2, controlled by a per-generation **"save" toggle (default ON)**. Toggle OFF ⇒ no card, no R2 write (AI debits already applied still stand). |
| D8 | Card content | **Title + lyric preview + audio player + open-in-editor** (requires persisted project/lyric snapshot). |

### 5.1 Lower-tier defaults (planning agent resolved — `[DEFAULT — confirm]`)
- **AI-charge compensation** beyond D4: **none automatic**; corrections only via admin `MANUAL_ADJUSTMENT`.
- **Top-up refunds**: port prototype `RefundRecord` + admin refund route unchanged (admin-gated, optional).
- **No migration** of historical/session-only generations.
- **Shared password storage**: hashed secret in env (`GENERATION_PASSWORD_HASH`), compared server-side; client holds a short-lived signed cookie after one successful unlock.
- **Dashboard route**: public `GET /dashboard`.
- **Mongo transactions** require an Atlas/replica-set connection (operational prerequisite).
- **Feature flags**: entire credit layer is **inert unless `CREDITS_ENABLED=true`** (+ Mongo configured). With it off, the editor behaves exactly as today (no charging, no password, no dashboard link).

---

## 6. Deferred Decisions (do NOT resolve here)
- Real user accounts / auth architecture internals.
- Per-user balances / ownership (schemas carry an inert nullable `ownerScope` placeholder only — see §8; behavior stays shared).
- Production deployment topology and final security hardening.
- Exact pence price values for each model (this phase ships a seed table + mechanism; you own the numbers).

---

## 7. Assumptions (incl. Phase-1 reconciliation)
- A1: After Phase 1, an MP3 asset (upload **or** YouTube-derived) is still readable server-side via a `sessionId`+`assetId` through `lib/files.js`-style helpers (`getAssetFilePath`/`readAssetMetadata`). **Reconcile in §20.**
- A2: The transcribe job model (`runTranscribeJob`, phases, in-memory store, 409 re-adoption) is unchanged or superset-compatible after Phase 1. **Reconcile in §20.**
- A3: A completed MP3 has a probable duration in seconds available (from asset metadata, waveform, or ffprobe introduced in Phase 1) for per-minute audio pricing. If not, the implementer adds a lightweight probe. **Reconcile in §20.**
- A4: MongoDB deployment supports multi-document transactions (replica set / Atlas).
- A5: MP3s stay ≤ current 25 MB cap, acceptable for R2 PutObject in one request.

---

## 8. Target Architecture After Phase 2

```
Editor (unchanged core)
  │
  ├── Balance chrome (read /api/credits/balance)         [feature-flagged]
  ├── Generation start (POST /api/ai/transcribe)
  │      ├─ password gate (D2)  ─ 403 if locked
  │      ├─ balance gate (D6)   ─ 402 if too low
  │      └─ enqueue job → runTranscribeJob
  │             ├─ UsageCollector (per call: model, phase, tokens|audioSec)
  │             ├─ per successful phase → creditService.debitPhase()
  │             │        └─ applyLedgeredBalanceChange (txn, key ai_debit:{jobId}:{phase})
  │             └─ on complete + saveToggle → persistGeneration()
  │                     ├─ Generation doc (Mongo)  + lyric/project snapshot
  │                     ├─ Card doc (Mongo)         (dashboard entry)
  │                     └─ MP3 → R2 (pending_create → created), reconcile-safe
  │
  ├── Top-up (POST /api/credits/checkout) → SumUp Hosted Checkout
  │      └─ dual-path verify (webhook + return poll) → ledger TOP_UP (exactly once)
  │
  └── /dashboard  (public read: Mongo cards + R2 audio via proxy/public URL)
```

**Money invariants**: integer pence only; balance never < 0; every movement is one idempotent, append-only `CreditLedger` entry inside a transaction; balance is a side-effect of the ledger.

---

## 9. New Files / Modules

Ported/adapted from prototype into main app (converted to the main app's import style; `@/lib/...` alias, ESM). Prefer `.js` (main app uses `.js` + `"type"` default) — keep `.mjs` internals only if a module relies on top-level ESM the app config can't resolve; verify against main `next.config.mjs`/jsconfig during Stage 0.

**Data / DB**
- `lib/db/mongoose.js` — cached connection (port of `mongoose.mjs`); `hasMongoUri()`, `connectToDatabase()`.
- `lib/db/bootstrap.js` — `ensureSharedBalance()` (seed configurable via `INITIAL_BALANCE_MINOR`, default 500), `initializeDatabaseIndexes()`.
- `lib/models/Balance.js`, `lib/models/CreditLedger.js` (**enum extended**, §10.1), `lib/models/PaymentOrder.js`, `lib/models/WebhookEvent.js`, `lib/models/RefundRecord.js` — ports.
- `lib/models/Generation.js` — **new** (§10.2).
- `lib/models/UsageRecord.js` — **new**, per-call audit truth (§10.3).

**Money / Ledger**
- `lib/money.js` — port (extend with any AI helpers if needed).
- `lib/ledger/balance-ledger.js` — port of `applyLedgeredBalanceChange`, `isInsufficientBalanceError`.

**Credit service (new orchestration seam)**
- `lib/credits/credit-service.js` — `getBalance()`, `assertCanStartGeneration()` (D6 threshold), `debitPhase({jobId, phase, amountMinor, usageRecords})` (idempotent), `recordUsageOnly(...)` (failed/unrun phases). Wraps ledger + UsageRecord in one txn.
- `lib/credits/flags.js` — `isCreditsEnabled()`, config readouts.

**OpenAI cost capture (new)**
- `lib/ai/openai-pricing.js` — seed price table keyed by model: `{ inputPerMTokens, outputPerMTokens }` for chat; `{ perAudioMinute }` for `whisper-1`/`gpt-4o-transcribe`. Env override hook. Exposes `computeCallCostMinor({model, usage, audioSeconds})`.
- `lib/ai/openai-usage.js` — `createUsageCollector({jobId})`: `record({model, phase, usage, audioSeconds})`, `phaseTotals()`, `markPhaseComplete(phase)`, `serialize()`.

**Payments (ports)**
- `lib/payments/sumup-client.js`, `sumup-env.js`, `payment-orders.js`, `payment-urls.js`, `payment-verification.js`, `sumup-refunds.js` (last optional).

**R2 (ports + audio extension)**
- `lib/r2/r2-env.js`, `r2-client.js` — ports.
- `lib/r2/audio-r2-lifecycle.js` — **new**, generation-audio analogue of `card-r2-lifecycle.mjs` (`putGenerationAudioObject`, `deleteGenerationAudioObject`, key `generations/{generationId}/audio.mp3`, status machine reusing Card-style fields on Generation).

**Persistence orchestration (new)**
- `lib/generations/persist-generation.js` — `persistGeneration({jobId, sessionId, assetId, project/lyrics snapshot, title, save})`: writes Generation + Card in a txn, then promotes MP3 to R2 after commit (fire-pattern ordering).

**API routes (new, main app under `app/api`)**
- `app/api/credits/balance/route.js` — `GET` balance (public read).
- `app/api/credits/checkout/route.js` — `POST` create/reuse SumUp checkout (port of prototype checkout route).
- `app/api/credits/orders/[orderId]/route.js` — `GET` order status (return-page poll).
- `app/api/webhooks/sumup/route.js` — `POST` webhook (port).
- `app/api/credits/unlock/route.js` — `POST` verify shared password → set signed cookie (D2).
- `app/api/dashboard/state/route.js` — `GET` public cards + (optional) balance.
- `app/api/dashboard/generations/[id]/route.js` — `GET` single generation (open-in-editor payload).
- `app/api/media/generations/[id]/route.js` — `GET` proxy-serve MP3 from R2 (or redirect to `R2_PUBLIC_BASE_URL`).

**Pages / UI (new)**
- `app/dashboard/page.js` + `components/DashboardView.jsx` (responsive card grid, respects mobile sheet/transport rules & `app/app_colours.css` tokens).
- `app/payment/return/page.js` + `components/PaymentReturnClient.jsx` — ports (route base under main app).
- Editor chrome additions in `components/editor-shell.js` (balance display, top-up entry, save toggle, password unlock prompt) — **additive, feature-flagged.**

**Scripts (ports, optional but recommended)**
- `scripts/db-smoke.mjs`, `scripts/r2-reconcile.mjs` (extended to generations), `scripts/payment-audit.mjs`, `scripts/ledger-repair.mjs`.

---

## 10. Data Models & Contracts

### 10.1 CreditLedger (extend enum)
`CREDIT_LEDGER_TYPES = ["TOP_UP","AI_TRANSCRIBE","AI_ENRICH","AI_TIME","CARD_CREATE","REFUND_ADJUSTMENT","MANUAL_ADJUSTMENT"]`
- Keep unique index on `idempotencyKey`; keep `balanceAfterMinor`, `metadata`.
- AI entries: `amountMinor` negative; `metadata` = `{ jobId, phase, models:[...], usage:{...}, computedFrom:"price_table@v1" }`; `idempotencyKey = ai_debit:{jobId}:{phase}`.
- `CARD_CREATE` retained only if a fire-like feature is kept; otherwise unused (harmless).

### 10.2 Generation (new)
```
_id
title            (string; derived from lyrics/first line or user)
createdAt        (immutable)
jobId            (string; source transcribe job)
sourceType       ("upload" | "youtube")   // youtube requires Phase-1
audioDurationSeconds (number|null)
lyricSnapshot    (Mixed: serialized project lines/translations for open-in-editor, D8)
projectSnapshot  (Mixed|null: toProjectJsonValue(project) if available)
totalCostMinor   (number; sum of debited phase costs)
saved            (bool; D7 toggle value at completion)
public           (bool; = saved for now, D2 world-readable)
ownerScope       (null)  // inert placeholder; DO NOT branch behavior on it
// R2 audio (mirror Card's r2 fields)
r2ObjectKey, r2Status(enum like Card), r2ErrorCode, r2CreatedAt, r2DeletedAt,
r2LastAttemptAt, r2AttemptCount
deletedAt, deleteRequestedAt
```
Indexes: `{createdAt:-1}`, `{deletedAt:1, createdAt:-1}`, `{jobId:1}`, unique partial on `r2ObjectKey`.

### 10.3 UsageRecord (new — audit truth, all calls incl. uncharged)
```
_id, jobId, phase, model, endpointKind ("chat"|"audio"),
promptTokens, completionTokens, totalTokens, audioSeconds,
computedCostMinor, priceTableVersion, charged (bool), createdAt
```
Index: `{jobId:1, phase:1}`. Used to reconcile "usage incurred" vs "amount debited" (matters under D4 partial-failure).

### 10.4 API contracts (selected)
- `GET /api/credits/balance` → `{ enabled, balanceMinor, currency:"GBP" }` (when disabled: `{enabled:false}`).
- `POST /api/ai/transcribe` (extended): body adds `save?:boolean` (default true). New failure codes: `403 {error:"locked"}` (password), `402 {error:"insufficient_balance", balanceMinor}` (D6). Otherwise unchanged (`{jobId}` / 409 re-adopt).
- `POST /api/credits/unlock` `{password}` → `200 {unlocked:true}` + Set-Cookie; `401` otherwise.
- `POST /api/credits/checkout` `{amountMinor}` → `{checkoutUrl, orderId}` (ports prototype validation/reuse).
- `GET /api/credits/orders/[orderId]` → serialized order (poll).
- `POST /api/webhooks/sumup` → `{received:true}` (always 200).
- `GET /api/dashboard/state` → `{ cards:[serializedGenerationCard], balance? }`.
- `GET /api/media/generations/[id]` → audio stream (or 302 to public URL).

---

## 11. Integration Strategy & Data/State Flows

### 11.1 OpenAI usage capture
1. `runTranscribeJob` creates `collector = createUsageCollector({jobId})` and threads it into the pipeline options (`transcribeAndCleanLyrics`, `enrichLyricLines`, `timeLyricLinesFromAudio`, `runLyricTimingPipeline`).
2. At each of the ~6 `fetchOpenAiWithRetry` call sites, **after** the response body is parsed to JSON, call `collector.record({ model, phase, usage: data.usage, audioSeconds })`.
   - Chat/Responses: `usage.prompt_tokens/completion_tokens/total_tokens`.
   - Audio (`whisper-1`, `gpt-4o-transcribe`): if no `usage`, pass `audioSeconds` (probed duration or offset window) → per-minute price.
   - `phase` is the logical phase; inside `full`, the pipeline tags each call with its sub-phase (`transcribe`/`enrich`/`time`) so per-phase settlement is possible. Retries reuse the same record slot (last write wins) — the collector keys by `(phase, callIndex)`.
3. Every recorded call is persisted as a `UsageRecord` (charged flag set later).

### 11.2 Per-phase debit (D3/D4)
- On a phase's successful completion boundary, `runTranscribeJob` calls `creditService.debitPhase({jobId, phase, amountMinor: collector.phaseTotals()[phase], usageRecords})`.
  - Staged jobs (`transcribe`/`enrich`/`time`): the whole job is one phase → settle on success.
  - `full`: settle each sub-phase at its internal completion boundary; if boundary instrumentation is impractical, **fallback**: settle all *completed* phases at job completion by iterating `collector.phaseTotals()` for phases marked complete.
- `debitPhase` runs one transaction: `applyLedgeredBalanceChange({type:`AI_${PHASE}`, amountMinor:-cost, idempotencyKey:`ai_debit:${jobId}:${phase}`, reason, metadata})` + flip matching `UsageRecord.charged=true`. Idempotent across polling/re-adoption/resume.
- **Failure**: on job/phase error, settle only *fully completed* phases; leave the failed phase's UsageRecords `charged:false` (recorded, not debited) per D4.
- **Zero-cost phases** (e.g. `enrich` with no billable call) produce no ledger entry.

### 11.3 Generation-start gating (D2/D6)
In `app/api/ai/transcribe/route.js` POST, **before** enqueue (only when `isCreditsEnabled()`):
1. Password: require valid unlock cookie; else `403 {error:"locked"}`.
2. Balance: `creditService.assertCanStartGeneration()` → if `balanceMinor <= MIN_GENERATION_BALANCE_MINOR` return `402`. (Exact per-job cost is unknowable up front; this is a floor check. Never-negative is still enforced atomically at debit time.)
When credits disabled: skip both → today's behavior exactly.

### 11.4 Persistence + R2 promotion (D7/D8)
On successful job completion, if `save !== false`:
1. `persistGeneration` opens a txn: create `Generation` (with `lyricSnapshot`/`projectSnapshot`, `totalCostMinor` from ledger, `r2Status:"pending_create"`, `r2ObjectKey:generations/{id}/audio.mp3`) + a dashboard `Card`/or treat Generation itself as the card doc.
2. After commit: `putGenerationAudioObject` streams the MP3 bytes (read via `getAssetFilePath`) to R2, then marks `r2Status:"created"` (fire-pattern ordering; failure → `create_failed`, reconcile script fixes later).
3. Toggle OFF: skip all of the above; the ephemeral asset is untouched and expires normally; AI debits already applied remain.

### 11.5 Top-up (unchanged prototype semantics)
Port checkout → SumUp Hosted Checkout → dual-path verification (`refreshPaymentOrderFromSumUp`) crediting exactly once via `top_up:${orderId}` + `balanceCredited:false` claim. Webhook stores raw `WebhookEvent`. **Not password-gated** (D2).

### 11.6 Public dashboard
`/dashboard` (public) reads non-deleted `Generation` docs (newest first), renders cards (title, lyric preview, `<audio>` from `/api/media/generations/[id]`, "Open in editor" → loads `projectSnapshot`). Respects mobile sheet/transport rules + design tokens.

---

## 12. Affected Existing Files (precise, with reason)

| File | Change | Reason |
|------|--------|--------|
| `lib/ai/openai-lyrics.js` | Thread a `collector` param into pipeline fns; add `collector.record(...)` after JSON parse at each `fetchOpenAiWithRetry` site; tag sub-phases inside `runLyricTimingPipeline`. **No behavior change when collector absent** (record is a no-op). | §11.1 usage capture |
| `lib/ai/transcribe-job.js` | Create collector; call `creditService.debitPhase`/`recordUsageOnly` at phase boundaries; call `persistGeneration` on completion when `save`. | §11.2/11.4 |
| `app/api/ai/transcribe/route.js` | Add password + balance gate (flagged); pass `save` through to job. | §11.3 |
| `app/api/ai/transcribe/[jobId]/route.js` | Optionally surface `balanceMinor` / `costMinor` in poll response. | UX |
| `components/editor-shell.js` | Balance chrome, top-up entry, save toggle, unlock prompt (all additive + flagged). | §11 UI |
| `lib/project.js` | Reuse `toProjectJsonValue`/`importProjectValue` for snapshots (no signature change). | D8 snapshots |
| `package.json` | Add `mongoose`,`@aws-sdk/client-s3`,`zod` (impl agent only). | new deps |
| `.env.example` / docs | Add new env vars (§14). | config |

**Explicitly NOT to change**: render/remotion pipeline, waveform/preview components, `lib/files.js` core sweep/TTL logic (only *read* assets for promotion — no lifecycle change), Phase-1 YT modules, autosave semantics, export gating (stays free).

---

## 13. Dependencies
Add (impl agent): `mongoose@^9`, `@aws-sdk/client-s3@^3`, `zod@^4`. Confirm React 19 / Next 16 compatibility (prototype already uses Next 16 + React 19). No removal of existing deps.

---

## 14. Environment & Configuration
- **Flags**: `CREDITS_ENABLED`, `ENABLE_TEST_CONTROLS`, `ENABLE_ADMIN_TOOLS`.
- **Mongo**: `MONGODB_URI`, `MONGODB_DB_NAME` (default derived), `INITIAL_BALANCE_MINOR` (default 500), `MIN_GENERATION_BALANCE_MINOR` (default 1).
- **SumUp**: `SUMUP_MODE`, `SUMUP_API_KEY[_TEST|_LIVE]`, `SUMUP_MERCHANT_CODE[...]`, `SUMUP_CHECKOUT_RETURN_URL`, `SUMUP_WEBHOOK_URL`, `APP_BASE_URL`, `ALLOW_TEMP_LIVE_PAYMENT_URLS`, `SUMUP_API_BASE_URL`, `SUMUP_CURRENCY`.
- **R2**: `R2_ENABLED`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_BASE_URL?`.
- **Password**: `GENERATION_PASSWORD_HASH`, `GENERATION_UNLOCK_SECRET` (cookie signing).
- **Pricing**: `OPENAI_PRICE_TABLE_JSON?` (override) + in-repo seed `openai-pricing.js`.
All secrets server-side only; never sent to client. SumUp/R2 Zod validation reused so misconfig fails fast at first use, not silently.

---

## 15. Lifecycle, Concurrency, Idempotency
- **Balance**: singleton; only mutated inside ledger txns; never < 0 (conditional update).
- **AI debit**: exactly-once via `ai_debit:{jobId}:{phase}` unique key — safe under 409 re-adoption, client polling, resume-after-reload, and concurrent duplicate submits.
- **Top-up credit**: exactly-once via dual-path claim (`balanceCredited:false`) + `top_up:{orderId}` key.
- **Generation/R2**: doc created in txn; R2 write after commit; status machine + reconcile script handle partial R2 failures (never blocks the ledger or user result).
- **Transactions require replica set** (A4). Provide a clear startup error if `MONGODB_URI` points at a standalone.

---

## 16. Error, Recovery, Reconciliation
- OpenAI/pipeline errors: unchanged UX; only *completed* phases debited (D4); all usage in `UsageRecord` for audit.
- Insufficient balance mid-run cannot occur for an already-started job (floor-checked at start; debits are post-hoc and atomic — if a debit would go negative it throws and is recorded as an uncharged/flagged UsageRecord + logged for admin `MANUAL_ADJUSTMENT`). This edge is logged, not user-facing.
- R2 create/delete failures: status `create_failed`/`delete_failed` + `scripts/r2-reconcile` sweeps.
- SumUp: webhook + return poll both converge; raw events retained; admin refund/refresh routes (if `ENABLE_ADMIN_TOOLS`).
- Mongo unavailable + `CREDITS_ENABLED=true`: generation start returns a clear 503 (fail-closed on paid path); with credits disabled, editor unaffected.

---

## 17. Security, Abuse, Authorization
- Shared password gates only generation start (D2); stored hashed; constant-time compare; signed short-TTL cookie.
- Server-authoritative amounts for top-ups; SumUp re-fetch verification (never trust client/webhook body for crediting).
- R2/Mongo/SumUp secrets server-only; `/api/media/...` proxy avoids exposing bucket creds; public URL only if `R2_PUBLIC_BASE_URL` set.
- Shared balance is drainable by anyone with the password — accepted under D1; mitigate with `MIN_GENERATION_BALANCE_MINOR` + observability + optional rate limiting `[DEFAULT — confirm]`.
- Webhook endpoint idempotent + quick-ack; consider SumUp signature verification if available `[DEFAULT — confirm]`.

---

## 18. Desktop & Mobile UI
- Balance chrome + top-up + save toggle + unlock prompt must obey the in-progress mobile sheet/transport/pane exclusivity rules (`mockup_integration_project/`) and tokens in `app/app_colours.css`.
- `/dashboard` card grid: responsive (single column on narrow), audio player fits mobile, "Open in editor" navigates back to `/`.
- No change to existing transport/sheet behavior when credits disabled.

---

## 19. Observability
- Structured logs (no secrets) for: debit applied (jobId, phase, amount, balanceAfter), top-up credited, R2 promote result, password-unlock failures, insufficient-balance blocks.
- `UsageRecord` + `CreditLedger` are the audit spine; optional admin audit view.

---

## 20. Phase-1 Reconciliation (MANDATORY before implementation)
The implementation agent must, against the **post-Phase-1** code:
1. Confirm A1–A3 (asset read path, job model, audio duration availability). Record findings.
2. Verify `sourceType` detection for YouTube-derived assets and that R2 promotion can read their bytes.
3. Verify the transcribe POST route shape/args didn't change; re-place the password/balance gate accordingly.
4. Confirm no Phase-1 change to `openai-lyrics.js` call sites invalidates the collector insertion points.
5. Document any mismatch, STOP, and obtain approval before amending this plan (per PROJECT_OVERVIEW §6/§10).

---

## 21. Stage-by-Stage Implementation Sequence

Each stage: objective → prerequisites → files → actions → expected behavior → risks → validation → completion criteria. Stages are ordered so the app stays green throughout; the credit layer is inert until Stage 8 flips the flag.

### Stage 0 — Reconciliation & scaffolding
- **Obj**: Confirm §20; add deps; establish module-format decision (`.js` vs `.mjs`) against main `next.config.mjs`/jsconfig.
- **Files**: `package.json`, reconciliation notes in `PROGRESS.md`.
- **Validate**: `npm i` clean; app builds/tests unchanged; §20 findings recorded.
- **Done**: deps installed, no behavior change, reconciliation approved.

### Stage 1 — DB, models, money, ledger (no wiring)
- **Files**: `lib/db/*`, `lib/money.js`, `lib/models/{Balance,CreditLedger(+enum),PaymentOrder,WebhookEvent,RefundRecord,Generation,UsageRecord}.js`, `lib/ledger/balance-ledger.js`.
- **Actions**: port + extend enum + add Generation/UsageRecord; port ledger tests.
- **Validate**: ledger unit tests (idempotency, never-negative, concurrent debit) green against a test Mongo (replica set / memory-server).
- **Done**: ledger correctness proven in isolation.

### Stage 2 — OpenAI pricing + usage collector (no charging)
- **Files**: `lib/ai/openai-pricing.js`, `lib/ai/openai-usage.js`; edits to `lib/ai/openai-lyrics.js` (thread collector, record after parse, tag sub-phases).
- **Actions**: implement price table + `computeCallCostMinor`; insert `record()` calls; write `UsageRecord`s (no debit yet).
- **Validate**: run a real/mocked pipeline → correct per-phase token/audio capture + computed pence; pipeline output byte-identical to before (no behavior change).
- **Done**: usage captured accurately, zero user-visible change.

### Stage 3 — Credit service + per-phase debit
- **Files**: `lib/credits/credit-service.js`, `lib/credits/flags.js`; edits to `lib/ai/transcribe-job.js`.
- **Actions**: implement `assertCanStartGeneration`, `debitPhase` (D3/D4), `recordUsageOnly`; wire phase boundaries.
- **Validate**: simulate success (debits only completed phases), mid-phase failure (no debit for failed phase, usage recorded), retry/re-adoption (no double debit). Balance math exact.
- **Done**: exactly-once per-phase charging validated.

### Stage 4 — Generation start gating
- **Files**: `app/api/ai/transcribe/route.js`, `app/api/credits/unlock/route.js`, `app/api/credits/balance/route.js`.
- **Actions**: password gate (403), balance floor (402), `save` passthrough; unlock cookie.
- **Validate**: locked→403; low balance→402; with credits disabled→unchanged flow; unlock works.
- **Done**: gating correct and flag-inert.

### Stage 5 — Generation persistence + R2 audio
- **Files**: `lib/r2/{r2-env,r2-client,audio-r2-lifecycle}.js`, `lib/generations/persist-generation.js`; edits to `transcribe-job.js` (call on completion when `save`); `app/api/media/generations/[id]/route.js`.
- **Actions**: persist Generation+snapshot in txn; promote MP3 to R2 after commit; serve audio.
- **Validate**: saved generation → Mongo doc + R2 object + playable stream; toggle off → nothing persisted; R2 failure → `create_failed` + reconcile fixes.
- **Done**: durable generations with playable audio; toggle honored.

### Stage 6 — Top-ups (SumUp)
- **Files**: `lib/payments/*`, `app/api/credits/checkout/route.js`, `app/api/credits/orders/[orderId]/route.js`, `app/api/webhooks/sumup/route.js`, `app/payment/return/*`, `PaymentReturnClient.jsx`.
- **Actions**: port checkout + dual-path verification unchanged.
- **Validate**: sandbox top-up credits exactly once via BOTH webhook and return poll; double-submit reuse window; wrong amount rejected.
- **Done**: exactly-once top-ups proven in sandbox.

### Stage 7 — Public dashboard + editor chrome
- **Files**: `app/dashboard/page.js`, `components/DashboardView.jsx`, `app/api/dashboard/state/route.js`, `app/api/dashboard/generations/[id]/route.js`; edits to `components/editor-shell.js` (balance, top-up, save toggle, unlock, dashboard link).
- **Actions**: responsive card grid; open-in-editor; balance chrome.
- **Validate**: dashboard lists saved generations, audio plays, open-in-editor restores project; mobile layout obeys sheet/transport rules; desktop parity.
- **Done**: public dashboard + editor integration complete.

### Stage 8 — Enablement, scripts, hardening
- **Files**: scripts ports, `.env.example`, docs.
- **Actions**: flip `CREDITS_ENABLED` in a staging config; run reconcile/audit/smoke scripts; observability check.
- **Validate**: full end-to-end (top-up → generate → charge → save → dashboard) in staging; disabled-flag regression = today's behavior.
- **Done**: acceptance criteria (§22) all met.

---

## 22. Validation Gates & Acceptance Criteria
- Ledger: never negative; idempotent; concurrent debits serialize correctly (tests).
- Charging: per-phase, completed-only; no double charge under retry/re-adopt/resume; usage audit matches.
- Top-ups: exactly once across webhook + return; server-authoritative amounts.
- Persistence: saved generations appear on dashboard with playable audio + working open-in-editor; toggle off persists nothing.
- Gating: password blocks generation only; low balance hard-blocks; export free; **credits-disabled = byte-identical current behavior**.
- Mobile + desktop parity for all new UI.
- No secret leaks; R2/Mongo/SumUp misconfig fails fast.

## 23. Rollback / Remediation
- Master kill-switch: `CREDITS_ENABLED=false` disables all charging/gating/dashboard-link instantly (editor fully functional).
- All new code is additive; reverting the branch removes the layer cleanly.
- Ledger is append-only; corrections via `MANUAL_ADJUSTMENT`, never edits/deletes.

## 24. Documentation Updates Required
- `.env.example` + a `CREDITS_SETUP.md` (Mongo/R2/SumUp/password/pricing).
- Update main README/architecture notes to mention the (flagged) credit layer.
- Operations notes for reconcile/audit scripts (port prototype `OPERATIONS.md`).

## 25. Handoff to Implementation Agent
1. Read PROJECT_OVERVIEW, this plan, `PROGRESS.md`, both info banks, and the completed Phase-1 record.
2. Execute §20 reconciliation FIRST; get approval for any amendment.
3. Work stage-by-stage; keep the app green; keep the flag off until Stage 8.
4. Update `PROGRESS.md` per micro-deliverable; never mark done without validation.
5. Escalate any material deviation (PROJECT_OVERVIEW §10).

---

**End of Implementation Plan (Phase 2 — Credit Dashboard). No application or prototype code was modified in producing this document.**
