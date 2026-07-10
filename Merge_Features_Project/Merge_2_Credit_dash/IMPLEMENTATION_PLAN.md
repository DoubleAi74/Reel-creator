# Credit Dashboard Merge — Phase 2 Implementation Plan

**Status**: **AMENDED v4 (2026-07-10) — reconciled with the built + audited implementation (post-implementation repair programme).** Phase 1+2 are implemented, audited (`../POST_IMPLEMENTATION_AUDIT.md`, PASS with non-blocking issues) and under repair (`../REPAIR_PLAN.md`). v4 aligns this plan's charging model with the **owner-approved clamp-to-zero policy (D-A / repair DV-1)** now implemented in REP-201/REP-201a. Product decisions confirmed (§5). No `[DEFAULT — confirm]` placeholders remain except items deliberately deferred (§6).
**Owner of execution**: the repair-implementation agent (executing `../REPAIR_PLAN.md`); this plan is the architecture-of-record.
**Dates**: drafted 2026-07-08; v2 2026-07-09 (Codex plan-verification); v3 2026-07-09 (A6 false → per-phase billing); **v4 2026-07-10 (clamp-to-zero charging + block-boundary gating, reconciled to built code).**
**Authoring agent**: Phase 2 planning agent (no application/prototype code changed in producing this doc).

> **CRITICAL SEQUENCING**: Phase 1 is accepted and Phase 2 is built; this plan is now the architecture-of-record that the repair programme keeps in sync. Where this plan and `../REPAIR_PLAN.md` describe the same behaviour, they must agree (v4 closes the prior divergence).

### Amendment log
- **v4 CHARGING MODEL — clamp-to-zero (D-A / DV-1), 2026-07-10.** Overrun is no longer a hard-reject; it **clamps to the available balance**:
  - **Clamp settlement (AI debits only):** when a phase's computed cost exceeds the current balance, debit the *remaining* balance (→ 0), **keep/deliver/persist** the work, and record the full computed cost, the clamped debit, and `writeOffMinor` (the written-off remainder) on the `UsageRecord`/ledger metadata. **Never-negative is preserved as a floor, not a rejection.** A fully-written-off phase (balance already 0) writes **no ledger row** (0-amount forbidden) — its write-off is audited on the `UsageRecord` only. **Top-up and all non-AI debits keep the reject semantics unchanged.**
  - **Block-boundary gating:** the balance floor + password + rate-limit gate is enforced at **block boundaries** — **Block A = `transcribe`+`enrich`, Block B = `time`** — i.e. before `transcribe` and before `time`, **but not before `enrich`** (`enrich` is an authorised continuation of Block A). So a "run all" whose Block A zeroes the balance still finishes translation, then `time` is blocked (402).
  - **`full` phase rejected when credits enabled (REP-201a):** because a single `full` job settles after running all phases (it cannot stop Block B mid-job), `POST /api/ai/transcribe` returns `400 full_phase_disabled` when `isCreditsEnabled()`. The live client already uses staged per-phase jobs; `full` is unchanged when credits are off.
  - **`unresolved` narrowed:** insufficient balance no longer produces `accountingStatus:"unresolved"` (clamp always succeeds); `unresolved` now signals only a transient settlement/DB error, remediated by the dry-run `credits:ai-settle-repair` script (REP-202).
  - **Supersedes** the v3 per-phase never-negative-**reject** wording wherever it appears — specifically **D6, §11.2, §11.3, §15, §16** (and the §3 goal). Per-phase billing/rounding (D3/D4/D10) and idempotency keys (`ai_debit:{jobId}:{phase}`) are **unchanged**.
- **v3 A6 correction (ready-to-build change)**: live client verification confirms selected pipeline parts run as **separate phase jobs** (`transcribe`, then `enrich`, then `time`) rather than as one `core` invocation. This plan now treats those live phase jobs as authoritative: **billing units are individual phases**, each debited/rounded independently with key `ai_debit:{jobId}:{phase}`. A lightweight `pipelineRunId` groups the jobs from one Run button press only for audit and final `Generation` persistence. No `core` billing aggregate remains. (§5 D3/D10, §7 A6, §10.1–10.3, §11.1–11.4)
- **D9 confirmed**: a completed generation is **one `Generation` document**; the public card is a **serializer projection** (no separate `Card` model). (§10.2, §11.4, §11.6)
- **D10 confirmed (phase billing + rounding)**: charging/rounding unit is a **billing phase** — `transcribe`, `enrich`, or `time`. Rounding to integer pence happens **once per phase job at phase completion**. A Run button flow that executes multiple phases rounds each completed phase independently because the live client starts them as independent jobs; this preserves charge-completed-work-only and resume-safe exactly-once behavior. Mitigated by **round-half-up to nearest pence** + retained sub-penny remainder. (§5 D3/D4, §10.1, §10.3, §11.1–11.2)
- **D11 confirmed**: SumUp webhook = **trigger-only + mandatory server re-query**; signature verification optional later. (§11.5, §17)
- **D12 confirmed**: ship a **simple per-session/IP rate limit** on generation start now. (§11.3, §17)
- **Factual corrections (verified in live code 2026-07-09)**: OpenAI endpoints are `/v1/responses` and `/v1/audio/transcriptions`; bodies are read via `response.text()` + `tryParseJson(rawText)` (never `.json()`); Responses usage schema is `input_tokens/output_tokens/total_tokens`; audio usage may be `{type:"tokens",…}` or `{type:"duration",seconds}` or absent; no `usage` is captured today. Prototype `WebhookEvent` stores **safe identifiers + status, not the raw body**. `storeUploadedAsset` writes `durationSec:null` and **no** `sourceType`; the YT path (`storeAudioAssetFromPath`) writes a real `durationSec` and no `sourceType`; `sourceType` exists nowhere in runtime. (§4, §10.2, §11.1)
- **New blocking resolutions**: asset provenance stamping (§11.4/§20), honest accounting states (§10.2/§11.2/§16), multi-call idempotency (§10.3/§11.2), replica-set path (§13/§15/§21 Stage 1), R2 two-way failure reconcile (§11.4/§16).

---

## 1. Document Purpose

A complete, self-contained, executable contract for integrating the Credit Dashboard prototype (`Temp_prototype_parts/Credit_dash_prototype_part/`) into the main Reel Creator app: usage-based OpenAI charging, an append-only exactly-once GBP ledger, SumUp top-ups, MongoDB persistence of generations, Cloudflare R2 storage of MP3s, and a public generation-card dashboard. Grounded in direct inspection of both live codebases (§4) and the Phase 2 Information Bank; detailed enough for a fresh implementation agent to execute without repeating the architectural investigation.

---

## 2. Phase Objective

Add a monetization + accounting + persistence + public-dashboard layer on top of the (post-Phase-1) editor:

1. Record the real cost (pence) of every OpenAI call in the lyric pipeline.
2. Debit those costs from a **single shared GBP balance** via an append-only, transactional, exactly-once ledger — per **completed billing phase** (§5 D3).
3. Let users top the balance up through **SumUp Hosted Checkout**, verified via the prototype's dual (webhook + return-page) exactly-once path.
4. Persist completed generations (lyric snapshot + card metadata) in **MongoDB** as a single `Generation` document.
5. Store the associated MP3 (local upload or Phase-1 YouTube) in **Cloudflare R2**.
6. Expose a **public `/dashboard`** of generation cards (title, lyric preview, audio player, open-in-editor link).
7. Gate paid generation behind a **shared password** + rate limit, preserving current editor behavior when the layer is disabled.

---

## 3. Goals and Non-Goals

### Goals
- Reuse the prototype's proven money/ledger/payment/R2 abstractions with minimal change.
- Capture OpenAI cost at the real call sites; charge per **billing phase** on success only.
- Never let the shared balance go negative (a **floor**, via clamp-to-zero — v4/D-A); block further generations once exhausted.
- Persist generations + MP3s durably without disturbing the ephemeral session-asset system used during active editing.
- Keep the app fully functional (feature-flagged off) when Mongo/R2/SumUp are not configured.

### Non-Goals (this phase)
- User accounts / real authentication (deferred; only a shared password is added).
- Per-user balances or per-user ownership (single shared balance confirmed).
- Migrating historical session-only generations (none persist today — none to migrate).
- Gating export/render on balance (export stays free — confirmed).
- Replacing the ephemeral asset system.
- Phase-1 (YouTube) functionality (owned by the sibling merge).
- Finalizing exact OpenAI pence prices (values are your config data; this phase builds the mechanism + a seed table + versioning).

---

## 4. Verified Current-State Architecture (evidence, re-verified 2026-07-09)

### 4.1 Main app (post-Phase-1)
- **No DB / R2 / SumUp / mongoose / zod / aws-sdk** in `lib`,`app`,`components` or `package.json`. All new.
- **OpenAI calls**: all go through `fetchOpenAiWithRetry` (`lib/ai/openai-lyrics.js:3581`), which returns the **raw `Response`** and only drains bodies on retry — it never parses. Each call site parses with **`const rawText = await response.text(); const data = tryParseJson(rawText);`** (sites at `openai-lyrics.js:1632, 1759, 2100, 2230, 2546, 2674, 2857, 3193`). **No `usage` is captured today** (grep: zero `usage`/`input_tokens`/`prompt_tokens` references).
- **Endpoints** (`openai-lyrics.js:18-19`): `TRANSCRIPTION_URL = /v1/audio/transcriptions`, `RESPONSES_URL = /v1/responses`. There is **no** `/v1/chat/completions` usage.
- **Models** (`openai-lyrics.js:23-32`): `gpt-4o-transcribe` (content), `whisper-1` (timing), `gpt-4o` (line-break), `gpt-5.4-mini` (translation/source-repair), `gpt-5.4` (polish, `OPENAI_LYRIC_POLISH_MODEL`), `gpt-4o-mini` (QA audit, `OPENAI_QA_AUDIT_MODEL`); several env-overridable — the price table must cover all defaults **and** env overrides.
- **Orchestration**: `runTranscribeJob` (`lib/ai/transcribe-job.js:46`); signature `{audio,audioAssetId,includeRomanization,jobId,lines,phase,sessionId,sourceLanguage}` (unchanged by Phase 1). Phases `transcribe | enrich | time | full`; `full` runs all three via `runLyricTimingPipeline`. Phase enum `lib/staged-lyrics.js:1` → `["transcribe","enrich","time"]`. The live client Run button resolves presets into this phase list and posts **one job per selected phase**.
- **Jobs**: in-memory global store, poll-based (`lib/ai/transcribe-store.js`); statuses are only **`queued | running | done | error`** (no accounting state). 24h finished-job TTL; `findInFlightTranscribeForSession` dedups by session+asset; POST returns **409 to re-adopt** an in-flight job (`app/api/ai/transcribe/route.js:170`). → idempotency keys must be deterministic per (job, billing phase), not per attempt. A new `pipelineRunId` groups phase jobs from one client Run button press for audit/persistence, not for debit aggregation.
- **Assets** (`lib/files.js`): ephemeral per-session OS-temp files; cookie `reel-creator-session`; 24h TTL sweep; active jobs (incl. YT) exempt sessions; `MAX_AUDIO_BYTES` 25 MB. `storeUploadedAsset` writes metadata with `kind`, **`durationSec:null`** (audio uploads), **no `sourceType`**. Phase-1 `storeAudioAssetFromPath` writes `kind:"audio"`, a **finite positive `durationSec`**, **no `sourceType`**. `sourceType` exists nowhere in runtime. YT ingest returns a normal `{assetId,durationSec,kind,name,sizeBytes}` served by `/api/assets/[assetId]`.
- **App is fully anonymous** — no user model, no login, no password.

### 4.2 Credit prototype (patterns to lift)
- **Money** (`lib/money.js`): integer pence; `formatGbpFromMinor`, `isValidTopUpMinor`, bounds 1–10000p.
- **Ledger** (`lib/ledger/balance-ledger.mjs`): `applyLedgeredBalanceChange` in a Mongo **transaction/session**; replay-safe via **unique `idempotencyKey`**; never-negative via conditional `findOneAndUpdate` (`amountMinor:{$gte:|debit|}`) → null → `INSUFFICIENT_BALANCE`; `balanceAfterMinor` stamped post-update.
- **Balance** (`lib/models/Balance.mjs`): singleton `_id:"shared"`, min 0, integer validator; seeded **500p** by `ensureSharedBalance` (`lib/db/bootstrap.mjs:22`).
- **Ledger types** (`lib/models/CreditLedger.mjs:3`): `["TOP_UP","CARD_CREATE","REFUND_ADJUSTMENT","MANUAL_ADJUSTMENT"]` — **no AI type; enum must be extended.**
- **Fire (reference debit+create pattern)** (`app/api/dashboard/fire/route.js`): doc + ledger debit in ONE txn; R2 write **after** commit; insufficient → 409.
- **Payments** (`lib/payments/`): `createHostedCheckout`/`retrieveCheckout`, pending-order create + 10-min reuse window, dual-path exactly-once verification (`payment-verification.mjs`) via `PaymentOrder{balanceCredited:false}` atomic claim + ledger key `top_up:${order._id}`; always **re-queries** SumUp before crediting. `sumup-env.mjs` test/live split + Zod validation.
- **WebhookEvent** (`app/api/webhooks/sumup/route.js`, `lib/models/WebhookEvent.mjs`): quick-ack; stores **safe identifiers (checkoutId/reference), eventType, processingStatus, safeErrorCode — NOT the raw body**. (Correction from v1.)
- **R2** (`lib/r2/`): `putR2Object`/`deleteR2Object`/`headR2Object`; `R2_ENABLED` + `R2_*` env (optional `R2_PUBLIC_BASE_URL`, derived `endpoint`); status-machine lifecycle (`pending_create/created/create_failed/pending_delete/deleted/skipped`) + reconcile script. Built for small placeholder objects, not multi-MB audio.
- **DB** (`lib/db/mongoose.mjs`): cached global connection; requires `MONGODB_URI`; `dbName` from `MONGODB_DB_NAME` or URI. `bootstrap.mjs`: `ensureSharedBalance`, `initializeDatabaseIndexes`.
- **Deps**: `mongoose@^9`, `@aws-sdk/client-s3@^3`, `zod@^4`.

---

## 5. Confirmed Decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Identity/ownership | **Single shared global GBP balance**; **shared password**; no user accounts. |
| D2 | Password scope | Gates **only starting a paid generation**. Top-ups + viewing (editor + dashboard) are open; dashboard is **world-readable** (read-only). |
| D3 | Charge unit & timing | **Per billing phase, on that phase job's success.** Units: **`transcribe`**, **`enrich`**, **`time`**. This intentionally matches the live client, which posts separate jobs for selected phases. |
| D4 | Partial failure | **Charge only completed phases.** A failed/unrun phase is not debited; its real usage is still recorded (`UsageRecord`) for audit. |
| D5 | Cost method | **Config price table × usage** (Responses `input/output` tokens) **+ per-audio-minute rates** (audio endpoints when usage is duration/absent). Store **raw usage + raw sub-penny cost + computed pence + price-table version.** |
| D6 | Low balance / overrun (**v4 clamp**) | **Clamp-to-zero, keep the work.** Balance gate at **block boundaries** (before `transcribe` = Block A, before `time` = Block B; **not** before `enrich`): balance ≤ `MIN_GENERATION_BALANCE_MINOR` blocks that block (402). A phase whose cost exceeds the balance **clamps the debit to the remaining balance (→ 0), keeps/delivers/persists the work, records `writeOffMinor`**; never negative (floor). `phase:"full"` is **rejected (400) when credits enabled** (REP-201a). **Export stays free.** |
| D7 | Persistence trigger | On the **final selected phase** of a client Run button flow, **auto-persist** one `Generation` + MP3→R2, controlled by a per-generation **"save" toggle (default ON)**. Toggle OFF ⇒ no persistence, no R2 write (any AI debits already applied still stand). |
| D8 | Card content | **Title + lyric preview + audio player + open-in-editor** (requires persisted project/lyric snapshot). |
| **D9** | Generation vs Card | **One `Generation` document.** The public card is a **serializer projection** of it (no separate `Card` model). Deletion + R2 cleanup act on the single doc. |
| **D10** | Rounding | Round **once per billing phase at phase completion**, **half-up to nearest pence**, over that phase's summed sub-penny cost; retain the exact remainder in `UsageRecord.rawCostMicros`. Missing model price ⇒ **fail closed** (block the generation; never charge or run untracked). Multi-phase Run button flows round each completed phase independently because they are separate jobs in live code. |
| **D11** | Webhook auth | **Trigger-only + mandatory server re-query** before any credit (prototype pattern). Optional signature verification later if the deployed mode supports it. |
| **D12** | Abuse control | Ship a **simple per-session + per-IP rate limit** on generation start now, alongside the low-balance hard block. |

### 5.1 Planning-resolved details (now settled, not defaults)
- **AI-charge compensation** beyond D4: none automatic; corrections only via admin `MANUAL_ADJUSTMENT`.
- **Top-up refunds**: port prototype `RefundRecord` + admin refund route (admin-gated, optional).
- **No migration** of historical/session-only generations.
- **Shared-password mechanism**: server-only secret in env `GENERATION_PASSWORD` (compared with a timing-safe equality check); on success the server sets a signed cookie `rc_gen_unlock` (HMAC-`SHA256` via `GENERATION_UNLOCK_SECRET`, `HttpOnly`, `SameSite=Lax`, `Secure` in production, TTL `GENERATION_UNLOCK_TTL_SECONDS` default 12h). **No password hash is stored** — the secret is the env value; the cookie is a signed unlock token, not the password. (Hashing is not required by this plan.)
- **Dashboard route**: public read-only `GET /dashboard`; mutation routes are never public (§17).
- **Feature flag**: whole layer inert unless `CREDITS_ENABLED=true` **and** Mongo configured. With it off, no new read/write path executes.

---

## 6. Deferred Decisions (do NOT resolve here)
- Real user accounts / auth architecture internals.
- Per-user balances / ownership (schema carries an inert nullable `ownerScope` placeholder only; behavior stays shared — do not branch on it).
- Production deployment topology + final security hardening.
- **Exact pence price values** per model (this phase ships the mechanism, a versioned seed table, and the update procedure; you own the numbers).
- SumUp webhook **signature** verification (optional hardening; D11 makes it non-blocking).

---

## 7. Assumptions (Phase-1 reconciliation status)
- A1 (**verified**): upload and YouTube MP3 assets are readable via `getAssetFilePath`/`readAssetMetadata`; R2 promotion can read their bytes.
- A2 (**verified**): `runTranscribeJob` signature, phases, in-memory store, and 409 re-adoption are intact.
- A3 (**verified with fallback**): YT assets carry a real `durationSec`; **upload audio assets have `durationSec:null`** → audio pricing uses the fallback order in §11.1 (metadata → client/project audio duration → server `ffprobe` probe; ffprobe available per Phase-1 D1).
- A4: MongoDB deployment supports multi-document transactions (replica set / Atlas) — path specified in §13/§15.
- A5: MP3s stay ≤ 25 MB, acceptable for a single R2 `PutObject`.
- A6 (**verified false, resolved in v3**): the client does **not** run `transcribe`+`enrich` as one `core` invocation. It loops selected phases and starts separate jobs. Therefore this plan uses per-phase billing and `pipelineRunId` aggregation; do **not** implement a `core` billing aggregate.

---

## 8. Target Architecture After Phase 2

```
Editor (existing flow preserved)
  │
  ├── Balance chrome (GET /api/credits/balance)              [feature-flagged]
  ├── Generation start (POST /api/ai/transcribe)
  │      ├─ password gate (D2)      → 403 if locked
  │      ├─ rate limit (D12)        → 429 if exceeded
  │      ├─ balance gate (D6)       → 402 if too low
  │      ├─ price-precheck (D10)    → 500 if a required model has no price
  │      └─ enqueue → runTranscribeJob
  │             ├─ UsageCollector (per call: model, phase, billingUnit, usage.type, tokens|seconds, rawCostMicros)
  │             ├─ per completed PHASE → creditService.settlePhase()
  │             │        └─ applyLedgeredBalanceChange (txn, key ai_debit:{jobId}:{phase})  + mark UsageRecords charged
  │             ├─ accountingStatus on job (settled | unresolved | none)
  │             └─ on final selected phase + saveToggle → persistGeneration()
  │                     ├─ Generation doc (Mongo) + lyric/project snapshot + sourceType + pipelineRunId/jobIds
  │                     └─ MP3 → R2 (pending_create → created), reconcile-safe both directions
  │
  ├── Top-up (POST /api/credits/checkout) → SumUp Hosted Checkout
  │      └─ dual-path verify (webhook trigger + return poll, both re-query SumUp) → ledger TOP_UP (exactly once)
  │
  └── /dashboard (public read: Generation serializer + R2 audio via proxy/public URL)
```

**Money invariants**: integer pence for balances/ledger; sub-penny retained only in `UsageRecord.rawCostMicros`; balance never < 0; every movement is one idempotent, append-only `CreditLedger` entry inside a transaction; balance is a side-effect of the ledger.

---

## 9. New Files / Modules

Adapted from prototype into the main app's import style (`@/lib/...`). Module format (`.js` vs `.mjs`) is confirmed against `next.config.mjs`/`jsconfig.json` in Stage 0 (Phase-1 note: a new route may use relative imports if the `@/` alias is awkward under Vitest — see Phase-1 deviation record).

**Data / DB**
- `lib/db/mongoose.js` — cached connection; `hasMongoUri()`, `connectToDatabase()`, plus `assertTransactionsSupported()` startup probe (§15).
- `lib/db/bootstrap.js` — `ensureSharedBalance()` (seed `INITIAL_BALANCE_MINOR`, default 500), `initializeDatabaseIndexes()`.
- `lib/models/Balance.js`, `lib/models/CreditLedger.js` (**enum extended**, §10.1), `lib/models/PaymentOrder.js`, `lib/models/WebhookEvent.js`, `lib/models/RefundRecord.js` — ports.
- `lib/models/Generation.js` — **new** single generation-and-card doc (§10.2).
- `lib/models/UsageRecord.js` — **new**, per-call audit truth (§10.3).

**Money / Ledger**
- `lib/money.js` — port.
- `lib/ledger/balance-ledger.js` — port of `applyLedgeredBalanceChange`, `isInsufficientBalanceError`.

**Credit service**
- `lib/credits/credit-service.js` — `getBalance()`, `assertCanStartGeneration()` (D6 + D10 price-precheck), `settlePhase({jobId, pipelineRunId, phase, usageRecords})` (idempotent, rounds per D10), `recordUsageOnly(...)`.
- `lib/credits/billing-phases.js` — `BILLING_PHASES = ["transcribe","enrich","time"]`; `LEDGER_TYPE_OF_PHASE = {transcribe:"AI_TRANSCRIBE", enrich:"AI_ENRICH", time:"AI_TIMING"}`.
- `lib/credits/rate-limit.js` — per-session + per-IP fixed-window limiter (in-memory, config via env) for generation start (D12).
- `lib/credits/flags.js` — `isCreditsEnabled()`, config readouts, `partialConfigFailClosed()`.

**OpenAI cost capture**
- `lib/ai/openai-pricing.js` — versioned price table (`PRICE_TABLE_VERSION`) keyed by model; per-model unit is **micro-pence integers** for exactness: chat models `{inputPerMTokensMicros, outputPerMTokensMicros}`; audio models `{perAudioMinuteMicros}` (and, if an audio endpoint returns token usage, an optional `{inputPerMTokensMicros,…}`). Env override `OPENAI_PRICE_TABLE_JSON`. Exposes `hasPrice(model)`, `computeCallCostMicros({model, usageType, tokens, audioSeconds})` (returns integer micro-pence), and `roundMicrosToPenceHalfUp(sumMicros)`.
- `lib/ai/openai-usage.js` — `createUsageCollector({jobId, pipelineRunId})`: `record({callId, model, phase, billingUnit, usageType, inputTokens, outputTokens, totalTokens, audioSeconds, rawCostMicros})`, `phaseTotalsMicros()`, `markPhaseComplete(phase)`, `finalizedUsageForPhase(phase)`, `serialize()`. Persists a `UsageRecord` per call.

**Payments (ports)**
- `lib/payments/{sumup-client,sumup-env,payment-orders,payment-urls,payment-verification,sumup-refunds}.js` (last optional).

**R2 (ports + audio extension)**
- `lib/r2/{r2-env,r2-client}.js` — ports.
- `lib/r2/audio-r2-lifecycle.js` — **new**: `putGenerationAudioObject`, `deleteGenerationAudioObject`, `reconcileGenerationAudio`; key `generations/{generationId}/audio.mp3`; status machine on `Generation` r2 fields; handles both failure directions (§11.4).

**Persistence orchestration**
- `lib/generations/persist-generation.js` — `persistGeneration({pipelineRunId, jobIds, finalJobId, sessionId, assetId, sourceType, snapshot, title, save})`: writes the final `Generation` in a txn, gathering settled ledger entries by `pipelineRunId`, then promotes MP3 to R2 after commit (fire-pattern).
- `lib/generations/serialize-generation.js` — `serializePublicCard(gen)` (omits internal ids, §11.6) and `serializeEditorPayload(gen)` (open-in-editor).

**API routes (new)**
- `app/api/credits/balance/route.js` (GET), `app/api/credits/unlock/route.js` (POST), `app/api/credits/checkout/route.js` (POST), `app/api/credits/orders/[orderId]/route.js` (GET), `app/api/webhooks/sumup/route.js` (POST), `app/api/dashboard/state/route.js` (GET), `app/api/dashboard/generations/[id]/route.js` (GET), `app/api/media/generations/[id]/route.js` (GET).

**Pages / UI**
- `app/dashboard/page.js` + `components/DashboardView.jsx`; `app/payment/return/page.js` + `components/PaymentReturnClient.jsx`; additive, flagged chrome in `components/editor-shell.js`.

**Scripts (ports)**
- `scripts/db-smoke.mjs`, `scripts/r2-reconcile.mjs` (extended to generations), `scripts/payment-audit.mjs`, `scripts/ledger-repair.mjs`.

---

## 10. Data Models & Contracts

### 10.1 CreditLedger (extend enum)
`CREDIT_LEDGER_TYPES = ["TOP_UP","AI_TRANSCRIBE","AI_ENRICH","AI_TIMING","REFUND_ADJUSTMENT","MANUAL_ADJUSTMENT"]` (dropped the unused `CARD_CREATE`; AI entries map one-to-one to completed billing phases).
- Unique index on `idempotencyKey`; keep `balanceAfterMinor`, `metadata`.
- AI entries: `amountMinor` negative (integer pence); `idempotencyKey = ai_debit:{jobId}:{phase}`; `metadata = { jobId, pipelineRunId, phase, models:[…], usageSummary:{…}, rawCostMicros, priceTableVersion, callIds:[…], settlementMode:"clamp", fullCostMinor, writeOffMinor }`.
- **v4 clamp mode:** the ledger settlement helper takes `mode:"clamp"|"reject"` (default `reject`). AI settlement uses `mode:"clamp"` — it debits `min(cost, balance)`, floors the balance at 0, and stamps `fullCostMinor`/`writeOffMinor`. Top-up and all other debits keep `mode:"reject"` (unchanged never-negative rejection). A fully-written-off phase (debit would be 0) writes **no ledger row** (0-amount forbidden); the write-off is audited on the `UsageRecord`.

### 10.2 Generation (new — single doc = record + public card, D9)
```
_id
title                 (string)
createdAt             (immutable)
pipelineRunId         (string; client Run-button flow id) [index]
jobIds                ([string]; completed phase jobs)
finalJobId            (string; final saved phase job)      [index]
sourceType            ("upload" | "youtube" | "unknown")   // stamped in asset metadata (§11.4)
audioDurationSeconds  (number|null)
snapshot {                                                 // D8 open-in-editor
  lines, translations, timings, project (toProjectJsonValue), sourceLanguage
}
billing {
  phaseCostsMinor { transcribe, enrich, time },             // null when not run
  totalCostMinor (number), priceTableVersion (string),
  ledgerKeys [ "ai_debit:{jobId}:transcribe", ... ]
}
accountingStatus      ("none" | "settled" | "unresolved")  // aggregate of saved phase jobs
saved                 (bool)                               // D7 toggle value
public                (bool; = saved)                      // D2 world-readable
ownerScope            (null)                               // inert placeholder — never branch on it
// R2 audio (Card-style status machine)
r2ObjectKey, r2Status(enum: not_required/pending_create/created/create_failed/pending_delete/delete_failed/deleted/skipped),
r2ErrorCode, r2CreatedAt, r2DeletedAt, r2LastAttemptAt, r2AttemptCount
deletedAt, deleteRequestedAt
```
Indexes: `{createdAt:-1}`, `{deletedAt:1, createdAt:-1}`, `{pipelineRunId:1}`, `{finalJobId:1}`, unique partial on `r2ObjectKey`.
Public serializer (`serializePublicCard`) returns only `{ id, title, lyricPreview, audioUrl, createdAt, durationSeconds }` — **never** `pipelineRunId`, `jobIds`, `finalJobId`, ledger keys, usage, r2 internals, sourceType raw URL, or `snapshot.project`.

### 10.3 UsageRecord (new — audit truth for every call, charged or not)
```
_id, callId (unique), jobId, pipelineRunId, phase, billingUnit ("transcribe"|"enrich"|"time"),
model, endpointKind ("responses"|"audio"),
usageType ("tokens"|"duration"|"none"),
inputTokens, outputTokens, totalTokens,   // Responses / token-audio
audioSeconds,                             // duration-audio or fallback
rawCostMicros (integer micro-pence),
chargedMinor, fullCostMinor, writeOffMinor,   // v4 clamp audit (chargedMinor ≤ fullCostMinor; writeOffMinor = fullCostMinor − chargedMinor)
priceTableVersion, attemptFinal (bool), charged (bool), createdAt
```
- **v4:** `charged:true` with `writeOffMinor>0` marks a clamped/written-off phase. Reconciliation and the `credits:ai-settle-repair` tool (REP-202) must read `writeOffMinor` here — a fully-written-off phase has **no** ledger row, so the ledger alone under-reports true incurred cost.
- `callId` = `${jobId}:${phase}:${sequence}` (stable within a job; retries of the same logical call reuse the same `callId`, last finalized write wins). Unique index on `callId` prevents duplicate rows under retry/re-adoption.
- Indexes `{jobId:1, phase:1}`, `{pipelineRunId:1, phase:1}`. A phase debit is the **immutable aggregate** of that phase job's finalized (`attemptFinal:true`) UsageRecords (§11.2).

### 10.4 API contracts (selected)
- `GET /api/credits/balance` → `{enabled, balanceMinor, currency:"GBP"}` (disabled: `{enabled:false}`).
- `POST /api/ai/transcribe` (extended): body adds `pipelineRunId?:string`, `save?:boolean` (default true), `saveOnCompletion?:boolean` (client sends true only for the final selected phase). New codes (only when enabled): `403 {error:"locked"}`, `429 {error:"rate_limited", retryAfter}`, `402 {error:"insufficient_balance", balanceMinor}`, `500 {error:"pricing_unavailable", model}`. Otherwise unchanged (`{jobId}` / 409 re-adopt). **409 re-adoption of an already-authorized in-flight job does NOT require a fresh unlock** (the original start was authorized); a brand-new job does.
- `POST /api/credits/unlock` `{password}` → `200 {unlocked:true}` + Set-Cookie `rc_gen_unlock`; `401` on mismatch (timing-safe compare).
- `POST /api/credits/checkout` `{amountMinor}` → `{checkoutUrl, orderId}` (server-authoritative bounds).
- `GET /api/credits/orders/[orderId]` → serialized order (poll; re-queries SumUp).
- `POST /api/webhooks/sumup` → `{received:true}` (always 200; trigger-only).
- `GET /api/dashboard/state` → `{cards:[serializePublicCard]}` (+ `balance` optional).
- `GET /api/dashboard/generations/[id]` → `serializeEditorPayload` (open-in-editor).
- `GET /api/media/generations/[id]` → audio stream (or 302 to `R2_PUBLIC_BASE_URL`).

---

## 11. Integration Strategy & Data/State Flows

### 11.1 OpenAI usage capture (corrected to live code)
1. The client creates a `pipelineRunId` for each Run button press and sends it with every selected phase job. `runTranscribeJob` creates `collector = createUsageCollector({jobId, pipelineRunId})` and threads it into the pipeline options (`transcribeAndCleanLyrics`, `enrichLyricLines`, `timeLyricLinesFromAudio`, `runLyricTimingPipeline`).
2. At each call site, **after `const data = tryParseJson(rawText)`**, call `collector.record({ callId, model, phase, billingUnit: phase, …usage… })`. Extract usage by endpoint:
   - **Responses** (`/v1/responses`): `data.usage.input_tokens / output_tokens / total_tokens` → `usageType:"tokens"`.
   - **Audio** (`/v1/audio/transcriptions`): `data.usage` may be `{type:"tokens", input_token_details,…}` → `usageType:"tokens"`; or `{type:"duration", seconds}` → `usageType:"duration"`; or **absent** → `usageType:"none"` and fall back to `audioSeconds`.
   - **`audioSeconds` fallback order**: (a) request/segment duration passed into the call; (b) asset `metadata.durationSec`; (c) client/project audio duration; (d) server `ffprobe` probe of the stored MP3. First finite positive value wins; if none, flag the UsageRecord `usageType:"none", rawCostMicros:0` and log (do not guess).
   - Cost: `rawCostMicros = computeCallCostMicros(...)` using the price table; requires `hasPrice(model)` (pre-checked at start, §11.3).
   - `phase` is the logical phase. Inside direct server-side `full` usage, `runLyricTimingPipeline` tags each call with its sub-phase so each billing phase remains independent. Retries reuse the same `callId` (last finalized write wins).
3. Every recorded call is persisted as a `UsageRecord` (`charged:false` until settlement).

### 11.2 Billing-phase settlement (D3/D4/D10)
- **Phase boundaries**: the live client starts one job per selected phase. A phase completes when that job's AI work succeeds. Direct `phase:"full"` usage, if invoked outside the current client flow, still settles `transcribe`, `enrich`, and `time` independently as each sub-phase succeeds.
- On a phase's successful completion, `runTranscribeJob` calls `creditService.settlePhase({jobId, pipelineRunId, phase, usageRecords: collector.finalizedUsageForPhase(phase)})`:
  1. `sumMicros = Σ rawCostMicros` over finalized UsageRecords for the phase; `fullAmountMinor = roundMicrosToPenceHalfUp(sumMicros)`.
  2. If `fullAmountMinor === 0` → no ledger entry (record phase as settled, cost 0).
  3. Else one transaction with **`mode:"clamp"`** (v4/D-A): `applyLedgeredBalanceChange({ type: LEDGER_TYPE_OF_PHASE[phase], amountMinor: -fullAmountMinor, mode:"clamp", idempotencyKey: "ai_debit:${jobId}:${phase}", metadata })`. The helper debits `min(fullAmountMinor, balance)`, floors the balance at 0, stamps `chargedMinor`/`fullCostMinor`/`writeOffMinor`, and sets `charged:true` on those UsageRecords. If the clamped debit is 0 (balance already 0), **no ledger row is written** but the UsageRecords still record `writeOffMinor = fullAmountMinor`. Returns `{ clamped, balanceExhausted, writeOffMinor }`. Idempotent across polling/re-adoption/resume.
  4. **Replay divergence guard**: if the idempotent key already exists but the newly computed aggregate differs from the stored one, do **not** silently accept — mark the job `accountingStatus:"unresolved"`, log an accounting-conflict, and surface to the `credits:ai-settle-repair` tool / `MANUAL_ADJUSTMENT`. The existing ledger entry is authoritative; no second debit.
- **Overrun is clamped, not rejected (v4):** insufficient balance never fails the AI settlement — it clamps and keeps the work; it does **not** produce `unresolved`. The job surfaces `balanceExhausted:true` + `writeOffMinor` (poll response + client copy), and the next block boundary (§11.3) blocks further work.
- **Partial failure (D4)**: on job/phase error, settle only phases that fully completed; leave the failed phase's UsageRecords `charged:false`. Earlier completed phase jobs are already charged (or clamped); later failed/unrun phase jobs are not.
- **Rounding note (D10, unchanged):** a Run flow that executes all parts rounds `transcribe`, `enrich`, and `time` separately (three jobs). Intentional; keeps billing aligned with exactly what completed.

### 11.3 Generation-start gating (D2/D6/D10/D12)
In `POST /api/ai/transcribe`, before enqueue, **only when `isCreditsEnabled()`** and this is a **new** job (not a 409 re-adopt):
0. **Reject `full` (v4/REP-201a):** `phase:"full"` (or the default resolving to `full`) → `400 {error:"full_phase_disabled"}` (a single `full` job can't stop Block B mid-run). Clients use staged per-phase jobs.
1. **Password**: valid `rc_gen_unlock` cookie or `403 {error:"locked"}`.
2. **Rate limit**: per-session + per-IP fixed window (`GEN_RATE_MAX`, `GEN_RATE_WINDOW_SECONDS`); exceed → `429`.
3. **Price precheck (D10 fail-closed)**: every model the requested phase will use must have `hasPrice(model)`; missing → `500 {error:"pricing_unavailable", model}` (no untracked spend).
4. **Block-boundary balance floor (D6, v4):** applied only at **block-entry phases** — `transcribe` (Block A) and `time` (Block B). `balanceMinor <= MIN_GENERATION_BALANCE_MINOR` → `402`. **`enrich` is gate-exempt** (authorised continuation of Block A; still price-checked). Per-run cost is unknown up front; overrun is handled by **clamp at settlement** (§11.2), not by a start-time estimate.
When disabled, or on a 409 re-adopt of an already-authorized job: skip 0–4 → today's behavior.

### 11.4 Persistence + R2 promotion (D7/D8/D9)
- **Provenance stamping (blocking fix)**: add `sourceType` to asset metadata at write time — `storeUploadedAsset` sets `sourceType:"upload"`; the Phase-1 YT ingest (`storeAudioAssetFromPath` caller) sets `sourceType:"youtube"`. Pre-existing assets read back as `"unknown"`. `persistGeneration` reads it from `readAssetMetadata`.
- The client sends `saveOnCompletion:true` only on the final selected phase in the current Run button flow. Earlier phase jobs send `saveOnCompletion:false`, but their debits still settle immediately.
- On successful job completion, if `save !== false` and `saveOnCompletion === true`:
  1. `persistGeneration` opens a txn: create the `Generation` (snapshot, `pipelineRunId`, all settled `jobIds`/ledger keys for that run, `billing.phaseCostsMinor`, `sourceType`, aggregate `accountingStatus`, `r2Status:"pending_create"`, `r2ObjectKey:generations/{_id}/audio.mp3`).
  2. After commit: `putGenerationAudioObject` streams MP3 bytes (`getAssetFilePath`) to R2, then sets `r2Status:"created"`.
  3. **Two-way failure handling**: Mongo committed but R2 put fails → `r2Status:"create_failed"` + `scripts/r2-reconcile` retries via `headR2Object`/`putR2Object`. R2 put succeeded but the follow-up status update fails → reconcile detects an existing object with `r2Status still pending_create` via `headR2Object` and advances it to `created` (idempotent put). Deletion: `deleteGenerationAudioObject` then hard-delete the doc only after R2 removal (fire-pattern).
- **Toggle OFF**: client sends `save:false` for every phase; skip persistence + R2; ephemeral asset expires normally; AI debits already applied remain.

### 11.5 Top-up (prototype semantics, D11)
Port checkout → SumUp Hosted Checkout → dual-path verification (`refreshPaymentOrderFromSumUp`): the webhook is **trigger-only** and the return page polls; **both always re-query SumUp** and credit exactly once via `top_up:${order._id}` + `balanceCredited:false` claim. `WebhookEvent` stores **safe identifiers + status** (not raw body); optionally add a `sanitizedBody` field if richer audit is wanted. **Not password-gated** (D2). Server-authoritative amounts; never credit from client/webhook body.

### 11.6 Public dashboard (D9)
`/dashboard` (public, read-only) reads non-deleted `Generation` docs (newest first) via `serializePublicCard` (title, lyric preview, `<audio src=/api/media/generations/{id}>`, open-in-editor link). Internal ids (`pipelineRunId`, `jobIds`, `finalJobId`, ledger keys, usage, r2 keys, raw source URLs, project snapshot) are **excluded**. No mutation is reachable from public routes (§17). Respects mobile sheet/transport rules + `app/app_colours.css` tokens.

---

## 12. Affected Existing Files

| File | Change | Reason |
|------|--------|--------|
| `lib/ai/openai-lyrics.js` | Thread `collector`; add `collector.record(...)` after `tryParseJson(rawText)` at each call site; tag sub-phase inside `runLyricTimingPipeline`. No-op when collector absent. | §11.1 |
| `lib/ai/transcribe-job.js` | Create collector; call `settlePhase`/`recordUsageOnly` at phase boundaries; set `accountingStatus`; call `persistGeneration` only when `saveOnCompletion`. | §11.2/11.4 |
| `lib/ai/transcribe-store.js` | Add `accountingStatus`/`accountingError` fields to the job record + poll response. | §11.2/§16 |
| `app/api/ai/transcribe/route.js` | Accept/pass `pipelineRunId`, `save`, and `saveOnCompletion`; password + rate-limit + price-precheck + balance gate (flagged); skip gates on 409 re-adopt. | §11.3 |
| `app/api/ai/transcribe/[jobId]/route.js` | Surface `balanceMinor` / phase `costMinor` / `accountingStatus` in poll response. | UX/§16 |
| `lib/files.js` | Add `sourceType` to metadata writes (`storeUploadedAsset` → `"upload"`; YT ingest path → `"youtube"`). **Additive metadata only; no sweep/TTL change.** | §11.4 provenance |
| `components/editor-shell.js` | Balance chrome, top-up entry, save toggle, unlock prompt, `pipelineRunId` creation, and `saveOnCompletion` only on the final selected phase (additive + flagged). | §11 UI |
| `lib/project.js` | Reuse `toProjectJsonValue`/`importProjectValue` for snapshots (no signature change). | D8 |
| `package.json` | Add `mongoose`,`@aws-sdk/client-s3`,`zod`; dev `mongodb-memory-server`. | new deps |
| `.env.example` / docs | Add new env vars (§14). | config |

**Explicitly NOT to change**: render/remotion pipeline, waveform/preview components, `lib/files.js` sweep/TTL logic (only add a metadata field + read bytes), Phase-1 YT processing behavior beyond additive `sourceType` stamping at the asset-store call, autosave semantics, export gating (stays free).

---

## 13. Dependencies
Add (impl agent): `mongoose@^9`, `@aws-sdk/client-s3@^3`, `zod@^4`; dev-only `mongodb-memory-server` (replica-set mode) for transaction tests. Confirm React 19 / Next 16 compatibility (prototype already uses them). No removal of existing deps.

---

## 14. Environment & Configuration
- **Flags**: `CREDITS_ENABLED`, `ENABLE_TEST_CONTROLS`, `ENABLE_ADMIN_TOOLS`.
- **Mongo**: `MONGODB_URI` (**must be a replica set / Atlas**, §15), `MONGODB_DB_NAME`, `INITIAL_BALANCE_MINOR` (default 500), `MIN_GENERATION_BALANCE_MINOR` (default 1).
- **Pricing**: `OPENAI_PRICE_TABLE_JSON?` (override); in-repo versioned seed `openai-pricing.js` (`PRICE_TABLE_VERSION`, source + date documented in `CREDITS_SETUP.md`).
- **Password / rate limit**: `GENERATION_PASSWORD`, `GENERATION_UNLOCK_SECRET`, `GENERATION_UNLOCK_TTL_SECONDS` (default 43200), `GEN_RATE_MAX` (default 10), `GEN_RATE_WINDOW_SECONDS` (default 60).
- **SumUp**: `SUMUP_MODE`, `SUMUP_API_KEY[_TEST|_LIVE]`, `SUMUP_MERCHANT_CODE[...]`, `SUMUP_CHECKOUT_RETURN_URL`, `SUMUP_WEBHOOK_URL`, `APP_BASE_URL`, `ALLOW_TEMP_LIVE_PAYMENT_URLS`, `SUMUP_API_BASE_URL`, `SUMUP_CURRENCY`.
- **R2**: `R2_ENABLED`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_BASE_URL?`.
All secrets server-side only. **Partial-config policy**: with `CREDITS_ENABLED=true` but Mongo/pricing/password/SumUp/R2 incomplete, **fail closed only on the paid paths** (generation start, top-up, persistence) with clear 5xx/402/403; the disabled path (`CREDITS_ENABLED=false`) skips all new reads/writes entirely.

---

## 15. Lifecycle, Concurrency, Idempotency
- **Balance**: singleton; mutated only inside ledger txns; **never < 0 — a floor via clamp for AI debits (v4), a conditional reject for top-ups/other debits.**
- **AI debit (v4 clamp)**: exactly-once per `ai_debit:{jobId}:{phase}` — safe under 409 re-adoption, polling, resume-after-reload, concurrent duplicate submits; replay-divergence guarded (§11.2). Overrun clamps to the available balance (records `writeOffMinor`), never rejects the AI settlement; a concurrent clamp race throws a retryable `CLAMP_RACE` handled by `withTransaction` (does not reject the AI work). `pipelineRunId` is audit/persistence metadata and is never the debit idempotency key.
- **Top-up credit**: exactly-once via dual-path re-query + `balanceCredited:false` claim + `top_up:{orderId}` key.
- **Generation/R2**: doc in txn; R2 after commit; status machine + reconcile handle both failure directions; never blocks the ledger or user result.
- **Accounting honesty**: job carries `accountingStatus` (`none`/`settled`/`unresolved`) + `accountingError`; a "done" job with `unresolved` accounting is explicit, never silently "complete".
- **Mongo transactions require a replica set**. Path: **dev/CI** = `mongodb-memory-server` in replica-set mode (dev dep) or a local single-node RS via `run-rs`/Docker; **staging/prod** = MongoDB Atlas. `assertTransactionsSupported()` runs a no-op `withTransaction` probe at first credit use and throws a clear, actionable error if the deployment is standalone.

---

## 16. Error, Recovery, Reconciliation
- Pipeline errors: unchanged UX; only completed phases debited/clamped (D4); all usage in `UsageRecord`.
- **Overrun (v4):** insufficient balance is **not** an error — it clamps to zero, keeps the work, records `writeOffMinor`, and blocks the next block. It does **not** set `unresolved`.
- **Accounting-unresolved recovery**: `unresolved` now signals only a **transient** settlement/DB error or a replay divergence (not insufficient balance). The result is preserved; the dry-run `credits:ai-settle-repair` script (REP-202) re-runs `settlePhase` idempotently or applies `MANUAL_ADJUSTMENT`. Because a fully-written-off phase writes no ledger row, reconciliation reads `UsageRecord.writeOffMinor` for true incurred cost. No real cost is silently lost or hidden.
- Ledger-succeeds-but-persistence-fails: debit stands (it reflects real work); Generation persistence is retried; if `save` off, no persistence expected.
- R2 failures: `create_failed`/`delete_failed` + `scripts/r2-reconcile` (HEAD/PUT idempotent) sweeps both directions.
- SumUp: webhook + return converge (both re-query); safe events retained; admin refresh/refund if `ENABLE_ADMIN_TOOLS`.
- Mongo unavailable + enabled: paid paths return clear 5xx (fail-closed); disabled path unaffected.

---

## 17. Security, Abuse, Authorization
- **Password** gates only generation start (D2); env secret via timing-safe compare; signed short-TTL `HttpOnly` cookie (§5.1). No password stored/hashed beyond the env secret.
- **Rate limit** (D12) on generation start (session + IP) bounds password-holder drain/spam; low-balance hard block bounds spend.
- **Payments**: server-authoritative amounts; SumUp always re-queried; **no credit path trusts client or webhook body** (D11).
- **Mutation-route authorization**: every non-GET/mutation route is protected — generation start (password + rate limit + balance), checkout (server-authoritative, bounds, reuse-window), webhook (trigger-only, no body-trust), admin routes (`ENABLE_ADMIN_TOOLS` + Basic auth via ported `proxy.js`). **No mutation is reachable from the public dashboard**; `/dashboard` and its `state`/`generations`/`media` routes are read-only.
- **Secrets** server-only; `/api/media/...` proxy avoids exposing R2 creds; public URL only if `R2_PUBLIC_BASE_URL` set. Serializers strip internal ids (§11.6).
- Webhook idempotent + quick-ack; optional signature verification later (D11).

---

## 18. Desktop & Mobile UI
- Balance chrome + top-up + save toggle + unlock prompt obey mobile sheet/transport/pane rules (`mockup_integration_project/`) + `app/app_colours.css` tokens.
- `/dashboard` grid responsive (single column narrow); audio player fits mobile; open-in-editor navigates to `/`.
- No change to existing transport/sheet behavior when disabled.

---

## 19. Observability
- Structured logs (no secrets): phase debit applied (jobId, pipelineRunId, phase, amount, balanceAfter), accounting-unresolved, top-up credited, R2 promote/reconcile result, unlock failures, rate-limit hits, insufficient-balance blocks, pricing-unavailable blocks.
- `UsageRecord` + `CreditLedger` are the audit spine; optional admin audit view.

---

## 20. Phase-1 Reconciliation (re-confirm before Stage 1)
Reconciliation was performed 2026-07-09 (§4, §7); the implementation agent must re-confirm against the exact accepted Phase-1 commit and record results:
1. Re-confirm A1–A3 (asset read path; job model/signature; audio duration — upload `durationSec:null` fallback).
2. Confirm the **`sourceType` metadata additions** land in both `storeUploadedAsset` and the YT ingest path without altering sweep/TTL.
3. Confirm the transcribe POST route shape for gate placement and 409 re-adopt behavior.
4. Confirm the 8 `fetchOpenAiWithRetry` call sites + `tryParseJson` pattern are intact for collector insertion.
5. Confirm A6 remains as verified in v3: the client still starts separate jobs for selected phases, creates one `pipelineRunId` per Run button flow, and sends `saveOnCompletion:true` only on the final selected phase. Any future client batching change must update the billing plan before coding.
6. Any mismatch → STOP, document, obtain approval (PROJECT_OVERVIEW §6/§10).

---

## 21. Stage-by-Stage Implementation Sequence

App stays green throughout; the layer is inert until Stage 8 flips the flag.

### Stage 0 — Reconciliation & scaffolding
- **Obj**: record §20 re-confirmation; add deps; confirm module format vs `next.config.mjs`/`jsconfig.json`; stand up the replica-set test path (`mongodb-memory-server`).
- **Files**: `package.json`, `PROGRESS.md`.
- **Validate**: `npm i` clean; existing tests/build unchanged; a trivial `withTransaction` probe test passes on the RS test harness; §20 recorded.
- **Done**: deps in, no behavior change, reconciliation approved, transactions runnable in tests.

### Stage 1 — DB, models, money, ledger (no wiring)
- **Files**: `lib/db/*`, `lib/money.js`, `lib/models/{Balance,CreditLedger(+AI_TRANSCRIBE/AI_ENRICH/AI_TIMING enum),PaymentOrder,WebhookEvent,RefundRecord,Generation,UsageRecord}.js`, `lib/ledger/balance-ledger.js`.
- **Actions**: port + extend enum; add single `Generation` (D9) + `UsageRecord` (callId unique); `assertTransactionsSupported`.
- **Validate**: ledger tests — idempotency, never-negative, **concurrent debits**, replay-divergence — green on the RS harness.
- **Done**: ledger + models correct in isolation.

### Stage 2 — Pricing + rounding + usage collector (no charging)
- **Files**: `lib/ai/openai-pricing.js`, `lib/credits/billing-phases.js`, `lib/ai/openai-usage.js`; edits to `lib/ai/openai-lyrics.js`.
- **Actions**: versioned micro-pence price table (all default + env models) + `hasPrice`/`computeCallCostMicros`/`roundMicrosToPenceHalfUp`; collector; insert `record()` after `tryParseJson` at each site; write `UsageRecord`s (no debit).
- **Validate (pricing tests BEFORE wiring is trusted)**: unit tests for Responses `input/output` tokens, audio `duration`, audio `tokens`, absent-usage fallback, **missing-model fail-closed**, **sub-penny accumulation + half-up rounding per phase**; pipeline output unchanged.
- **Done**: usage + cost captured accurately; zero user-visible change.

### Stage 3 — Credit service + phase settlement + accounting states
- **Files**: `lib/credits/{credit-service,flags,rate-limit}.js`; edits to `lib/ai/transcribe-job.js`, `lib/ai/transcribe-store.js`, `app/api/ai/transcribe/route.js`, `components/editor-shell.js`.
- **Actions**: `assertCanStartGeneration` (D6 + price precheck), `settlePhase` (D3/D4/D10), `recordUsageOnly`; add `accountingStatus`/`accountingError`; accept/store `pipelineRunId`; create one `pipelineRunId` per client Run button flow; send `saveOnCompletion:true` only on the final selected phase; wire phase boundaries.
- **Validate**: success settles completed phases only; a failure in `enrich` or `time` does not charge that failed phase; earlier completed phase jobs remain debited; retry/re-adoption no double debit; replay-divergence → `unresolved`, not silent; balance math exact; multi-phase Run button flow rounds each phase independently; final-phase marker is correct for first-one/first-two/all/custom selections.
- **Done**: exactly-once phase charging + honest accounting validated.

### Stage 4 — Generation-start gating
- **Files**: `app/api/ai/transcribe/route.js`, `app/api/credits/unlock/route.js`, `app/api/credits/balance/route.js`.
- **Actions**: password (403) + rate limit (429) + price precheck (500) + balance floor (402); keep `pipelineRunId`/`save`/`saveOnCompletion` passthrough; unlock cookie; 409 re-adopt skips gates.
- **Validate**: each gate fires; direct-API bypass blocked; disabled flag → unchanged flow; unlock + cookie TTL work.
- **Done**: gating correct, flag-inert, bypass-resistant.

### Stage 5 — Persistence + R2 audio (+ provenance)
- **Files**: `lib/r2/{r2-env,r2-client,audio-r2-lifecycle}.js`, `lib/generations/{persist-generation,serialize-generation}.js`, `lib/files.js` (sourceType), `app/api/media/generations/[id]/route.js`; edits to `transcribe-job.js`.
- **Actions**: stamp `sourceType`; persist single `Generation` in txn only from the final selected phase using `pipelineRunId` to collect completed phase debits; promote MP3 after commit; both-direction reconcile; serve audio.
- **Validate**: saved gen → doc + R2 object + playable stream; toggle off → nothing persisted; Mongo-ok/R2-fails and R2-ok/status-fails both reconcile; `sourceType` correct for upload vs YT.
- **Done**: durable generations with playable audio; provenance correct; toggle honored.

### Stage 6 — Top-ups (SumUp)
- **Files**: `lib/payments/*`, `app/api/credits/checkout/route.js`, `app/api/credits/orders/[orderId]/route.js`, `app/api/webhooks/sumup/route.js`, `app/payment/return/*`, `PaymentReturnClient.jsx`.
- **Actions**: port checkout + dual-path re-query verification unchanged (D11).
- **Validate**: sandbox top-up credits exactly once via BOTH webhook and return; webhook/return race; duplicate webhook; wrong amount/currency rejected; no body-trust.
- **Done**: exactly-once top-ups proven in sandbox.

### Stage 7 — Public dashboard + editor chrome
- **Files**: `app/dashboard/page.js`, `components/DashboardView.jsx`, `app/api/dashboard/state/route.js`, `app/api/dashboard/generations/[id]/route.js`; edits to `components/editor-shell.js`.
- **Actions**: responsive card grid via `serializePublicCard`; open-in-editor; balance/top-up/save-toggle/unlock chrome.
- **Validate**: dashboard lists saved gens, audio plays, open-in-editor restores project; **serializer leak test** (no internal ids); mobile sheet/transport parity; desktop parity.
- **Done**: public dashboard + editor integration complete and leak-free.

### Stage 8 — Enablement, scripts, hardening
- **Files**: scripts ports, `.env.example`, `CREDITS_SETUP.md`, docs.
- **Actions**: enable in staging; run reconcile/audit/smoke; observability check.
- **Validate**: full e2e (top-up → generate → phase charges → save → dashboard); **disabled-flag parity** (§22); partial-config fail-closed tests.
- **Done**: acceptance (§22) met.

---

## 22. Validation Gates & Acceptance Criteria
- **Ledger**: never negative; idempotent; concurrent debits serialize; replay-divergence flagged not silent.
- **Charging**: per-phase, completed-only; sub-penny accumulation + half-up rounding correct; no double charge under retry/re-adopt/resume; `accountingStatus` honest; usage audit matches ledger.
- **Pricing**: all live/default/env models priced; missing-model fails closed; price-table version stored per charge and reproducible.
- **Provenance**: `sourceType` correct for upload vs YouTube.
- **Top-ups**: exactly once across webhook + return; server-authoritative; no body-trust.
- **Persistence/R2**: saved gens on dashboard with playable audio + open-in-editor; toggle off persists nothing; both R2 failure directions reconcile.
- **Security**: password gates generation only; rate limit active; mutation routes protected; public serializer leaks nothing; secrets server-only.
- **Mongo**: replica-set transactions run in dev/CI/staging; startup probe errors clearly on standalone.
- **Flags**: `CREDITS_ENABLED=false` preserves current externally observable generation, editor, audio, project, render, and export behavior (only inert wiring present); partial-config fails closed on paid paths only.
- **UI**: mobile + desktop parity for all new UI; no Phase-1 audio-import regression.

## 23. Rollback / Remediation
- Master kill-switch `CREDITS_ENABLED=false` disables charging/gating/dashboard-link instantly (editor fully functional).
- All new code additive; reverting the branch removes the layer cleanly.
- Ledger append-only; corrections via `MANUAL_ADJUSTMENT`, never edits/deletes; accounting-unresolved items resolved by idempotent re-settle or adjustment.

## 24. Documentation Updates Required
- `.env.example` + `CREDITS_SETUP.md` (Mongo/replica-set, R2, SumUp, password/rate-limit, pricing source + version + update procedure).
- README/architecture note for the (flagged) credit layer.
- Ops notes for reconcile/audit scripts (port prototype `OPERATIONS.md`).

## 25. Handoff to Implementation Agent
1. Read PROJECT_OVERVIEW, this plan, `PLAN_VERIFICATION.md`, `PROGRESS.md`, both info banks, and the accepted Phase-1 record.
2. Confirm the remaining open gate is closed (**Phase 1 accepted**, §26) and re-run §20.
3. Work stage-by-stage; keep the app green; keep the flag off until Stage 8; pricing tests before charging is trusted.
4. Update `PROGRESS.md` per micro-deliverable; never mark done without validation.
5. Escalate any material deviation (PROJECT_OVERVIEW §10). v3 has already resolved the A6 billing mismatch; re-verification before Stage 1 should be a short drift check, not another planning loop.

## 26. Open Gates (must close before implementation)
- **G1 — Plan approval**: **closed 2026-07-09** by the user request to change the plan and make it ready to go, with v3 selecting per-phase billing to match live code.
- **G2 — Phase 1 acceptance**: Phase 1 is technically complete/validated but **not accepted in the Phase-1 record**. Before kickoff, an explicit acceptance record must exist under `Merge_Features_Project/Merge_1_YT/` (e.g. an `ACCEPTANCE.md` or a "Phase 1 accepted by user on <date>" line in its `PROGRESS.md`), ideally noting the fresh scoped Phase-1 route/files tests passed on 2026-07-09 and acknowledging that live-provider (RapidAPI) validation is still mocked. Planning agents must not edit Phase-1 files; the user or Phase-1 owner records this.

---

**End of Implementation Plan v3 (Phase 2 — Credit Dashboard). No application or prototype code was modified in producing this document.**
