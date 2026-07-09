# Credit Dashboard Merge — Phase 2 Progress Tracker

**Mirrors**: `IMPLEMENTATION_PLAN.md` v3 (2026-07-09). Read that + `PLAN_VERIFICATION.md` first.
**Phase status**: IMPLEMENTATION STARTED (v3) — Stage 6 Validated.
**Current stage**: Stage 7 — Public dashboard + editor chrome (next).
**Last verified checkpoint**: Stage 6 validated on 2026-07-09: SumUp env/client/order/verification libraries, checkout/order/webhook routes, and return polling page landed; webhook and return paths re-query SumUp and credit exactly once.
**Next action**: Stage 7 — build public dashboard/read APIs and flagged editor chrome for balance/top-up/save/unlock/dashboard entry.
**Blockers**: None.

Status legend: `Not started` / `In progress` / `Implemented, not validated` / `Validated` / `Blocked` / `Deferred` / `Superseded`.

---

## Open Gates (must close before any Stage 0 code)
- [x] **G1 — Plan approved/corrected** by user request. — Status: Closed 2026-07-09; v3 is the implementation-ready plan.
- [x] **G2 — Phase 1 accepted** and recorded under `Merge_Features_Project/Merge_1_YT/`. — Status: Closed 2026-07-09; `Merge_1_YT/PROGRESS.md` records user acceptance and accepted-complete status. RapidAPI live validation remains mocked/outside scope.
- [x] **G3 — Codex re-verification of v2**. — Status: Closed; found A6 false, remediated in v3.

## Decision Records
- D1 Shared balance + shared password; no accounts. **Confirmed 2026-07-08.**
- D2 Password gates generation start only; dashboard/top-ups open; dashboard read-only public. **Confirmed 2026-07-08.**
- D3 Charge per **billing phase** on success — `transcribe`, `enrich`, `time`. This matches the live separate-job client flow. **Confirmed 2026-07-09 in v3 (supersedes v2 core/timing grouping).**
- D4 Charge completed phases only; failed/unrun phase records usage for audit, not debited. **Confirmed.**
- D5 Price-table × usage (Responses input/output tokens) + audio-minute; store raw usage + rawCostMicros + pence + priceTableVersion. **Confirmed.**
- D6 Hard-block generation at/below balance floor; export free. **Confirmed.**
- D7 Auto-persist one Generation + MP3→R2 on the final selected phase of a Run button flow, per-generation save toggle default ON. **Confirmed.**
- D8 Card = title + lyric preview + audio + open-in-editor. **Confirmed.**
- D9 **Single `Generation` doc**; public card = serializer projection (no separate Card). **Confirmed 2026-07-09.**
- D10 **Round once per billing phase at completion, half-up to nearest pence**, remainder kept in `rawCostMicros`; missing model price ⇒ fail closed. Multi-phase Run button flows round each completed phase independently. **Confirmed 2026-07-09 in v3.**
- D11 SumUp webhook trigger-only + mandatory re-query; signature optional later. **Confirmed 2026-07-09.**
- D12 Simple per-session/IP rate limit on generation start now. **Confirmed 2026-07-09.**

## Deviation Records
- DEV-1 (superseded by v3): v2's `core`/`timing` grouped rounding was rejected after re-verification proved A6 false. v3 intentionally settles and rounds `transcribe`, `enrich`, and `time` independently.
- DEV-2 (v3 pipeline aggregation): `pipelineRunId` groups the jobs from one Run button press for audit and final `Generation` persistence only. It is **not** a debit idempotency key; debits remain `ai_debit:{jobId}:{phase}`.

## Unresolved / To Confirm
- Exact pence price values per model (esp. `gpt-5.4`, `gpt-5.4-mini`, `gpt-4o-transcribe`, `whisper-1`) — you own values; mechanism + versioning built.
- Optional: SumUp webhook signature verification (deferred, D11).

---

## Verification-finding disposition (from `PLAN_VERIFICATION.md`)
Original B1-B7 from the first verification → resolved in v2/v3. Re-verification B1 (`core` group mismatch) → resolved in v3 by per-phase billing + `pipelineRunId` persistence aggregation. Re-verification B2 (approval/acceptance gates) → G1/G2 closed before implementation. Non-blocking notes → applied or carried forward: sourceType seam accepted as Phase-2 scope, focused Phase-1 tests now passed, exact price values remain config-owned, stale info-bank wording superseded by v3.

---

## Stage Checklists (micro-deliverables)

### Stage 0 — Reconciliation & scaffolding — `Validated`
- [x] Re-confirm §20 (A1–A3, A6 remains false/v3 phase flow, sourceType land points, route shape, call sites) vs accepted Phase-1 commit; record findings + resume point. — Validate: written findings.
- [x] Confirm module format vs `next.config.mjs`/`jsconfig.json`. — Validate: sample import builds.
- [x] Add deps `mongoose`,`@aws-sdk/client-s3`,`zod` + dev `mongodb-memory-server`. — Files: `package.json` — Validate: `npm i` clean; existing tests pass.
- [x] Stand up replica-set test harness; `withTransaction` probe test. — Validate: probe passes.

Stage 0 reconciliation findings (2026-07-09):
- Precondition baseline recorded before edits: `git status --short`, `git diff --name-only`, and `git diff --stat`. Existing Phase 1/app changes were preserved.
- Dedicated branch created: `codex/phase-2-credit-dashboard`.
- A1 confirmed: upload and YouTube MP3 assets are readable through `readAssetMetadata`/`getAssetFilePath`; `/api/assets/[assetId]` serves those bytes.
- A2 confirmed: `runTranscribeJob` signature is unchanged (`audio`, `audioAssetId`, `includeRomanization`, `jobId`, `lines`, `phase`, `sessionId`, `sourceLanguage`); phases remain `full|transcribe|enrich|time`; 409 re-adoption still happens before new job creation.
- A3 confirmed: YouTube ingestion uses `storeAudioAssetFromPath` with finite `durationSec`; manual upload metadata still has `durationSec:null`, so the v3 fallback order remains required.
- `sourceType` land points confirmed: `storeUploadedAsset` and the YouTube status-route call to `storeAudioAssetFromPath` are the additive metadata seam for Stage 5; no `sourceType` exists yet, as expected.
- Transcribe POST route shape confirmed for future gates: parse/validate request, resolve session, touch/sweep, 409 re-adopt, then `createTranscribeJob`/`enqueueTranscribeJob`.
- OpenAI collector insertion confirmed: eight `fetchOpenAiWithRetry` call sites still parse with `response.text()` + `tryParseJson(rawText)`; no usage capture exists yet.
- A6 confirmed as v3 expects: client still loops `selectedLyricPipelinePhases` and starts one job per selected phase; no `pipelineRunId` or `saveOnCompletion` exists yet.
- No material mismatch found; Stage 0 may continue.

Stage 0 validation/results (2026-07-09):
- Branch: `codex/phase-2-credit-dashboard`.
- `npm install mongoose@^9 @aws-sdk/client-s3@^3 zod@^4` and `npm install -D mongodb-memory-server`: passed. Corrected initial placement so `mongodb-memory-server` is dev-only. `npm audit` reports 7 existing dependency advisories; no audit fix was run.
- Installed versions: `mongoose@9.7.4`, `@aws-sdk/client-s3@3.1083.0`, `zod@4.3.6`, `mongodb-memory-server@11.2.0`.
- Module-format smoke: `node --input-type=module` imported `mongoose`, `S3Client`, `z`, and `MongoMemoryReplSet`: passed.
- Scoped Phase-1 sanity: `npx vitest run lib/files.test.js app/api/youtube-audio-segments/route.test.js`: passed (`Test Files 2 passed`, `Tests 11 passed`).
- Replica-set transaction probe: `MongoMemoryReplSet.create` + `mongoose.connect` + `session.withTransaction` insert/count: passed (`transactionProbe:"passed"`, `count:1`).
- Repo-wide baseline: `npm test` failed with unchanged documented out-of-scope shape (`Test Files 3 failed | 40 passed (43)`, `Tests 4 failed | 300 passed (304)`, `Errors 1 error`) in the known prototype/Word Board/jsdom areas.
- Whitespace: `git diff --check -- package.json package-lock.json Merge_Features_Project/Merge_2_Credit_dash/PROGRESS.md`: passed.
- Files changed by Stage 0: `package.json`, `package-lock.json`, `Merge_Features_Project/Merge_2_Credit_dash/PROGRESS.md`.

### Stage 1 — DB / models / money / ledger — `Validated`
- [x] Port `lib/db/mongoose.js` (+`assertTransactionsSupported`), `lib/db/bootstrap.js`. — Validate: connects to RS test Mongo.
- [x] Port `lib/money.js` (+tests). — Validate: money tests green.
- [x] Port Balance/PaymentOrder/WebhookEvent/RefundRecord. — Validate: schemas load.
- [x] Extend `CreditLedger` enum → add `AI_TRANSCRIBE`,`AI_ENRICH`,`AI_TIMING` (drop unused `CARD_CREATE`). — Validate: enum test.
- [x] Add single `Generation` model (§10.2) + `UsageRecord` (§10.3, unique `callId`). — Validate: indexes build.
- [x] Port `lib/ledger/balance-ledger.js` (+tests). — Validate: idempotency / never-negative / **concurrent debits** / **replay-divergence** tests green on RS harness.

Stage 1 implementation notes (2026-07-09):
- Added `lib/db/mongoose.js` with cached connection, `hasMongoUri`, `getConfiguredDatabaseName`, `connectToDatabase`, `assertTransactionsSupported`, and test-only disconnect support. The transaction probe performs an insert/delete inside `withTransaction` and throws `TRANSACTIONS_UNSUPPORTED` with a replica-set/Atlas remediation message on standalone deployments.
- Added `lib/db/bootstrap.js` with `initializeDatabaseIndexes`, `ensureSharedBalance`, and `INITIAL_BALANCE_MINOR` parsing (default `500` pence).
- Added `lib/money.js` using integer pence and micro-pence helpers, including half-up micro-pence rounding for later Stage 2 billing.
- Added Mongoose models: `Balance`, `CreditLedger`, `PaymentOrder`, `WebhookEvent`, `RefundRecord`, single-doc `Generation`, and `UsageRecord`. `CreditLedger` uses the v3 enum (`TOP_UP`, `AI_TRANSCRIBE`, `AI_ENRICH`, `AI_TIMING`, `REFUND_ADJUSTMENT`, `MANUAL_ADJUSTMENT`) and no `CARD_CREATE`; `UsageRecord.callId` and ledger idempotency keys are unique.
- Added `lib/ledger/balance-ledger.js` requiring a session/transaction, stamping `balanceAfterMinor`, preserving never-negative debits with conditional balance updates, exact replay idempotency, and replay-divergence detection.
- Kept Stage 1 unwired: no route/client/transcribe runtime behavior changes; `CREDITS_ENABLED` remains unused/off.

Stage 1 validation/results (2026-07-09):
- Scoped Stage 1 tests: `npx vitest run --root lib --reporter verbose money.test.js ledger/balance-ledger.test.js` passed (`Test Files 2 passed`, `Tests 17 passed`).
- Replica-set coverage in `lib/ledger/balance-ledger.test.js`: transaction support probe, shared-balance seed, unique index creation, input validation, idempotent exact replay, replay-divergence rejection, never-negative rollback, concurrent debit overdraw prevention, and `Generation`/`UsageRecord` contract checks.
- Direct module import smoke: `node --input-type=module` imported all Stage 1 DB/model/money/ledger modules: passed (Node emitted the expected typeless-package ESM warning only).
- Whitespace: `git diff --check -- lib/db lib/models lib/ledger lib/money.js lib/money.test.js`: passed.

### Stage 2 — Pricing + rounding + usage collector — `Validated`
- [x] `lib/ai/openai-pricing.js` (versioned micro-pence table, all default+env models) + `hasPrice`/`computeCallCostMicros`/`roundMicrosToPenceHalfUp`. — Validate: unit tests incl. **missing-model fail-closed** + **sub-penny accumulation + half-up**.
- [x] `lib/credits/billing-phases.js` (phase→ledger type). — Validate: mapping test.
- [x] `lib/ai/openai-usage.js` collector (callId, phase totals, finalized-for-phase). — Validate: aggregation + retry-same-callId tests.
- [x] Thread collector into `openai-lyrics.js`; `record()` after `tryParseJson(rawText)` at all 8 sites; tag sub-phase/billing unit in `runLyricTimingPipeline`; parse Responses `input/output` + audio `tokens`/`duration`/absent. — Files: `lib/ai/openai-lyrics.js` — Validate: correct capture per endpoint; **pipeline output unchanged**; UsageRecords written (no debit).

Stage 2 implementation notes (2026-07-09):
- Added `lib/ai/openai-pricing.js` with version `openai-seed-2026-07-09-user-review-required`, integer micro-pence math, default model coverage for the current lyric pipeline, `OPENAI_PRICE_TABLE_JSON` overrides, missing-model/unit fail-closed errors, audio duration pricing, token pricing, and half-up pence rounding export. Exact pence values remain user-owned before enablement.
- Added `lib/credits/billing-phases.js` mapping `transcribe→AI_TRANSCRIBE`, `enrich→AI_ENRICH`, and `time→AI_TIMING`.
- Added `lib/ai/openai-usage.js` with `createUsageCollector({jobId,pipelineRunId})`, stable per-phase call IDs, idempotent `UsageRecord` upsert by `callId`, phase totals, `markPhaseComplete`, and `finalizedUsageForPhase`. Collector records remain `charged:false`; Stage 2 performs no debits.
- Threaded optional `usageCollector` through `openai-lyrics.js` only. With no collector (current runtime), behavior remains unchanged. When a collector is supplied, all eight OpenAI call sites record after `tryParseJson(rawText)` and are tagged by v3 billing phase: content transcription / line breaks / source repair as `transcribe`, translation / polish / word meanings as `enrich`, timing transcription / quality audit as `time`.

Stage 2 validation/results (2026-07-09):
- Stage 2 suite: `npx vitest run lib/ai/openai-pricing.test.js lib/ai/openai-usage.test.js lib/credits/billing-phases.test.js lib/ai/openai-lyrics.test.js` passed (`Test Files 4 passed`, `Tests 27 passed`).
- Pricing coverage: Responses input/output tokens, audio duration, audio token usage, absent audio usage with fallback, missing model fail-closed, missing unit fail-closed, override version/merge, malformed override rejection, sub-penny accumulation, and half-up phase rounding.
- Collector coverage: extraction for Responses/audio usage shapes, retry-same-callId idempotent upsert, phase totals, `markPhaseComplete`, finalized records, and Mongo `UsageRecord` persistence with `charged:false`.
- Pipeline capture coverage: mock collector test exercises all eight OpenAI call sites, verifies phase/endpoint/usage tags and positive raw costs, and confirms pipeline output remains unchanged.
- Lint: `npx eslint lib/ai/openai-pricing.js lib/ai/openai-pricing.test.js lib/ai/openai-usage.js lib/ai/openai-usage.test.js lib/credits/billing-phases.js lib/credits/billing-phases.test.js lib/ai/openai-lyrics.js lib/ai/openai-lyrics.test.js`: passed.
- Direct module import smoke: `node --input-type=module` imported `openai-pricing`, `openai-usage`, and `billing-phases`: passed (Node emitted the expected typeless-package ESM warning only).
- Whitespace: `git diff --check -- lib/ai/openai-pricing.js lib/ai/openai-pricing.test.js lib/ai/openai-usage.js lib/ai/openai-usage.test.js lib/credits/billing-phases.js lib/credits/billing-phases.test.js lib/ai/openai-lyrics.js lib/ai/openai-lyrics.test.js Merge_Features_Project/Merge_2_Credit_dash/PROGRESS.md`: passed.

### Stage 3 — Credit service + phase settlement + accounting — `Validated`
- [x] `lib/credits/{flags,rate-limit,credit-service}.js` (`assertCanStartGeneration` incl. price precheck; `settlePhase` D3/D4/D10; `recordUsageOnly`). — Validate: unit.
- [x] Add `accountingStatus`/`accountingError` to `transcribe-store.js` + poll response. — Validate: statuses surface.
- [x] Wire phase boundaries in `transcribe-job.js`; add `pipelineRunId` pass-through and final-phase `saveOnCompletion` handling in route/client. — Files: `lib/ai/transcribe-job.js`, `app/api/ai/transcribe/route.js`, `components/editor-shell.js` — Validate: completed-phases-only; failed `enrich`/`time` does not charge failed phase; earlier completed phases remain debited; retry/re-adopt no double debit; divergence→`unresolved`; multi-phase Run rounds each phase independently; final-phase marker correct.

Stage 3 implementation notes (2026-07-09):
- Added `lib/credits/flags.js`, `lib/credits/rate-limit.js`, and `lib/credits/credit-service.js`. Credit service is dormant when `CREDITS_ENABLED` is false; when enabled it prechecks configured model prices and minimum balance, settles completed phases with `applyLedgeredBalanceChange`, marks `UsageRecord`s charged only after settlement, records failed-phase usage as uncharged audit data, and converts replay divergence to `ACCOUNTING_CONFLICT`.
- Added `accountingStatus`/`accountingError` to transcribe jobs and poll responses. Jobs default to `none`, become `settled` after successful enabled settlement, and become `unresolved` if settlement fails after AI work completed.
- `runTranscribeJob` now creates a `UsageCollector` only when credits are enabled, passes it into the OpenAI pipeline, finalizes/settles the completed billing phase, and keeps completed AI output available even when accounting becomes unresolved.
- `app/api/ai/transcribe/route.js` now accepts/passes `pipelineRunId`, `save` (default true), and `saveOnCompletion`; missing `pipelineRunId` falls back to a server UUID for backward compatibility.
- The client Run button flow now creates one `pipelineRunId` per selected-phase run and sends `saveOnCompletion:true` only for the final selected phase. Only those two small hunks were staged from `components/editor-shell.js`; pre-existing Phase 1 YouTube editor changes remain unstaged.

Stage 3 validation/results (2026-07-09):
- Stage 3 suite: `npx vitest run lib/credits/credit-service.test.js lib/credits/rate-limit.test.js lib/ai/transcribe-store.test.js lib/ai/transcribe-job.test.js app/api/ai/transcribe/route.test.js` passed (`Test Files 5 passed`, `Tests 19 passed`).
- Combined Stage 2/3 regression: `npx vitest run lib/ai/openai-pricing.test.js lib/ai/openai-usage.test.js lib/credits/billing-phases.test.js lib/ai/openai-lyrics.test.js lib/credits/credit-service.test.js lib/credits/rate-limit.test.js lib/ai/transcribe-store.test.js lib/ai/transcribe-job.test.js app/api/ai/transcribe/route.test.js` passed (`Test Files 9 passed`, `Tests 46 passed`).
- Credit-service coverage: disabled no-op shapes, price precheck, low-balance precheck, exactly-once phase settlement, retry/re-adopt idempotency, replay-divergence conflict, zero-cost phase settlement without a ledger entry, and failed-phase uncharged usage audit.
- Route/store coverage: accounting status surfaces in poll responses; `pipelineRunId`, `save`, and `saveOnCompletion` pass through create/enqueue/run; final-phase marker is covered at the route boundary and by staged client code review.
- Lint: touched Stage 3 files passed `npx eslint`.
- Direct module import smoke: Stage 3 modules imported with the repo's `scripts/extensionless-loader.mjs`; passed (Node emitted expected experimental-loader/typeless-package warnings only).
- Whitespace: `git diff --check -- lib/credits lib/ai/transcribe-store.js lib/ai/transcribe-store.test.js lib/ai/transcribe-job.js lib/ai/transcribe-job.test.js app/api/ai/transcribe components/editor-shell.js Merge_Features_Project/Merge_2_Credit_dash/PROGRESS.md`: passed.

### Stage 4 — Generation-start gating — `Validated`
- [x] `app/api/credits/unlock/route.js` + signed cookie (name/TTL/timing-safe per §5.1). — Validate: correct/incorrect password; cookie TTL.
- [x] `app/api/credits/balance/route.js`. — Validate: enabled/disabled shapes.
- [x] Gate `app/api/ai/transcribe/route.js`: 403 locked / 429 rate / 500 pricing-unavailable / 402 low; `pipelineRunId`/`save`/`saveOnCompletion` passthrough; 409 re-adopt skips gates. — Validate: each gate; direct-API bypass blocked; disabled flag unchanged.

Stage 4 implementation notes (2026-07-09):
- Added signed unlock-cookie helpers in `lib/credits/unlock-cookie.js`: `rc_gen_unlock`, HMAC-SHA256 signature, `GENERATION_UNLOCK_TTL_SECONDS` default 12h, timing-safe password compare, and `HttpOnly; SameSite=Lax` cookie construction.
- Added `POST /api/credits/unlock`: disabled shape `{enabled:false}`, 401 for wrong password, 500 fail-closed if password/secret config is incomplete, and `Set-Cookie` on success.
- Added `GET /api/credits/balance`: returns `getBalance()` shape and maps service errors to a safe 500.
- Added flagged generation-start gates in `POST /api/ai/transcribe`: with credits disabled the route skips all new gates; with credits enabled, brand-new jobs require unlock cookie, pass the simple session/IP rate limit, and pass price/balance precheck. Existing 409 in-flight adoption returns before gates as required.

Stage 4 validation/results (2026-07-09):
- Stage 4 suite: `npx vitest run lib/credits/unlock-cookie.test.js app/api/credits/unlock/route.test.js app/api/credits/balance/route.test.js app/api/ai/transcribe/route.test.js` passed (`Test Files 4 passed`, `Tests 11 passed`).
- Combined Stage 2/3/4 regression: `npx vitest run lib/credits/unlock-cookie.test.js app/api/credits/unlock/route.test.js app/api/credits/balance/route.test.js app/api/ai/transcribe/route.test.js lib/credits/credit-service.test.js lib/credits/rate-limit.test.js lib/ai/transcribe-store.test.js lib/ai/transcribe-job.test.js lib/ai/openai-pricing.test.js lib/ai/openai-usage.test.js lib/credits/billing-phases.test.js lib/ai/openai-lyrics.test.js` passed (`Test Files 12 passed`, `Tests 56 passed`).
- Gate coverage: disabled parity, 409 re-adoption skipping gates, 403 locked, 429 rate-limited, 500 pricing-unavailable, 402 insufficient balance, and no job creation on gate failures.
- Lint: touched Stage 4 files passed `npx eslint`.
- Direct library import smoke: `node --input-type=module` imported Stage 4 credit library modules: passed (Node emitted expected typeless-package warning only). Next route execution is covered by Vitest because raw Node cannot resolve `next/server` like the Next runtime.
- Whitespace: `git diff --check -- lib/credits app/api/credits app/api/ai/transcribe Merge_Features_Project/Merge_2_Credit_dash/PROGRESS.md`: passed.

### Stage 5 — Persistence + R2 audio (+ provenance) — `Validated`
- [x] Add `sourceType` to `lib/files.js` metadata (`upload` + YT ingest `youtube`; additive only). — Validate: metadata correct, sweep/TTL unchanged.
- [x] Port `lib/r2/{r2-env,r2-client}.js`. — Validate: r2 smoke (sandbox bucket).
- [x] `lib/r2/audio-r2-lifecycle.js` (put/delete/reconcile, both failure directions). — Validate: object round-trip + reconcile both ways.
- [x] `lib/generations/{persist-generation,serialize-generation}.js`. — Validate: txn create + post-commit R2; toggle off persists nothing.
- [x] `app/api/media/generations/[id]/route.js`. — Validate: playable stream / 302.
- [x] Wire completion call in `transcribe-job.js` honoring `save` + `saveOnCompletion`; `persistGeneration` collects settled phase debits by `pipelineRunId`. — Validate: end-to-end saved gen; sourceType correct upload vs YT; no partial Generation is saved before final selected phase.

Stage 5 implementation notes (2026-07-09):
- Added asset provenance normalization in `lib/files.js`: new upload writes store `sourceType:"upload"`, trusted server-side audio path ingestion defaults to `sourceType:"youtube"`, and legacy metadata reads back as `sourceType:"unknown"`. The staged Phase 5 file keeps this additive metadata/helper seam; the separate Phase 1 active-YouTube-session sweep remains an unstaged pre-existing change.
- Ported R2 environment/client wrappers to `lib/r2/r2-env.js` and `lib/r2/r2-client.js`, including disabled/config errors, safe error-code mapping, put/head/delete/get wrappers, optional public base URL, and media-proxy object reads.
- Added `lib/r2/audio-r2-lifecycle.js` for generation MP3 create/delete/reconcile. R2 PUT failures mark `create_failed`; a successful PUT followed by a Mongo status-update failure is repairable by `reconcileGenerationAudio` via `headR2Object`; delete failures mark `delete_failed`.
- Added generation persistence and serialization in `lib/generations/`: `persistGeneration` creates the `Generation` in a Mongo transaction, gathers settled ledger/usage by `pipelineRunId`, updates ledger `generationId`, stores phase costs/ledger keys, then promotes the MP3 to R2 after commit. `save:false` skips all persistence/R2 work.
- Added `GET /api/media/generations/[id]` to serve saved public generated audio: redirects to `R2_PUBLIC_BASE_URL` when configured, otherwise proxies the R2 object body.
- Wired `runTranscribeJob` to persist only when credits are enabled, `save !== false`, and `saveOnCompletion === true`; earlier phase jobs can settle usage but cannot save a partial `Generation`.

Stage 5 validation/results (2026-07-09):
- Stage 5 suite: `npx vitest run lib/files-source-type.test.js lib/r2/r2-client.test.js lib/r2/audio-r2-lifecycle.test.js lib/generations/persist-generation.test.js lib/ai/transcribe-job.test.js 'app/api/media/generations/[id]/route.test.js'` passed (`Test Files 7 passed`, `Tests 39 passed`).
- Combined Phase 2 regression through Stage 5: `npx vitest run lib/money.test.js lib/ledger/balance-ledger.test.js lib/ai/openai-pricing.test.js lib/ai/openai-usage.test.js lib/credits/billing-phases.test.js lib/ai/openai-lyrics.test.js lib/credits/credit-service.test.js lib/credits/rate-limit.test.js lib/ai/transcribe-store.test.js lib/ai/transcribe-job.test.js app/api/ai/transcribe/route.test.js lib/credits/unlock-cookie.test.js app/api/credits/unlock/route.test.js app/api/credits/balance/route.test.js lib/files-source-type.test.js lib/r2/r2-client.test.js lib/r2/audio-r2-lifecycle.test.js lib/generations/persist-generation.test.js 'app/api/media/generations/[id]/route.test.js'` passed (`Test Files 22 passed`, `Tests 117 passed`).
- Existing file-storage regression: `npx vitest run lib/files.test.js lib/files-source-type.test.js` passed (`Test Files 2 passed`, `Tests 12 passed`).
- Lint: touched Stage 5 files passed `npx eslint`.
- Direct library import smoke: `node --loader ./scripts/extensionless-loader.mjs --input-type=module` imported Stage 5 libraries and `transcribe-job`: passed (expected experimental-loader/typeless-package warnings only).
- Whitespace: Stage 5 file trailing-whitespace scan passed.

### Stage 6 — Top-ups (SumUp) — `Validated`
- [x] Port `lib/payments/*`. — Validate: sumup-env/client tests.
- [x] `app/api/credits/checkout/route.js` + `orders/[orderId]/route.js`. — Validate: checkout + reuse window; server-authoritative amount.
- [x] `app/api/webhooks/sumup/route.js` (trigger-only + re-query; safe event storage). — Validate: quick-ack; no body-trust.
- [x] `app/payment/return/*` + poll. — Validate: **exactly-once via BOTH webhook and return**; race; duplicate webhook; wrong amount/currency rejected.

Stage 6 implementation notes (2026-07-09):
- Ported SumUp environment validation, hosted-checkout client, payment URL helpers, order helpers, verification, and refund wrapper under `lib/payments/`.
- Added `POST /api/credits/checkout`: validates bounded integer-pence top-up amounts, reuses recent pending hosted checkouts, creates SumUp hosted checkouts with server-owned order amount/reference/currency, and rejects unsafe hosted checkout URLs.
- Added `GET /api/credits/orders/[orderId]`: return-page polling path that finds the stored order and calls `refreshPaymentOrderFromSumUp`, which always re-queries SumUp before crediting.
- Added `POST /api/webhooks/sumup`: trigger-only webhook path that stores safe identifiers/status, never raw body, and calls the same re-query verification path. Duplicate webhooks converge through `top_up:{order._id}` and `balanceCredited:false`.
- Added `/payment/return` and `PaymentReturnClient` for post-checkout polling. The client only displays order state returned by the server; it does not determine crediting.

Stage 6 validation/results (2026-07-09):
- Stage 6 suite: `npx vitest run lib/payments/sumup-env.test.js lib/payments/sumup-client.test.js lib/payments/payment-urls.test.js lib/payments/payment-verification.test.js app/api/credits/checkout/route.test.js 'app/api/credits/orders/[orderId]/route.test.js' app/api/webhooks/sumup/route.test.js` passed (`Test Files 11 passed`, `Tests 38 passed`).
- Combined Phase 2 regression through Stage 6: `npx vitest run lib/money.test.js lib/ledger/balance-ledger.test.js lib/ai/openai-pricing.test.js lib/ai/openai-usage.test.js lib/credits/billing-phases.test.js lib/ai/openai-lyrics.test.js lib/credits/credit-service.test.js lib/credits/rate-limit.test.js lib/ai/transcribe-store.test.js lib/ai/transcribe-job.test.js app/api/ai/transcribe/route.test.js lib/credits/unlock-cookie.test.js app/api/credits/unlock/route.test.js app/api/credits/balance/route.test.js lib/files-source-type.test.js lib/r2/r2-client.test.js lib/r2/audio-r2-lifecycle.test.js lib/generations/persist-generation.test.js 'app/api/media/generations/[id]/route.test.js' lib/payments/sumup-env.test.js lib/payments/sumup-client.test.js lib/payments/payment-urls.test.js lib/payments/payment-verification.test.js app/api/credits/checkout/route.test.js 'app/api/credits/orders/[orderId]/route.test.js' app/api/webhooks/sumup/route.test.js` passed (`Test Files 33 passed`, `Tests 155 passed`).
- Exactly-once coverage: concurrent refreshes simulating webhook+return, duplicate webhooks, and order-route polling all credit at most one ledger entry; amount mismatch, currency/status mismatch, and missing checkout ids do not credit.
- Lint: touched Stage 6 files passed `npx eslint`.
- Direct library import smoke: `node --loader ./scripts/extensionless-loader.mjs --input-type=module` imported all payment libraries: passed (expected experimental-loader/typeless-package warnings only).
- Whitespace: Stage 6 file trailing-whitespace scan passed.

### Stage 7 — Public dashboard + editor chrome — `Not started`
- [ ] `app/dashboard/page.js` + `components/DashboardView.jsx` (responsive; `serializePublicCard`). — Validate: mobile sheet/transport + tokens.
- [ ] `app/api/dashboard/state/route.js` + `generations/[id]/route.js`. — Validate: lists saved gens; **leak test** (no internal ids); open-in-editor payload.
- [ ] Editor chrome in `components/editor-shell.js` (balance, top-up, save toggle, unlock, dashboard link) — additive + flagged. — Validate: disabled flag hides all.

### Stage 8 — Enablement, scripts, hardening — `Not started`
- [ ] Port scripts (reconcile→generations, audit, smoke, ledger-repair). — Validate: run clean.
- [ ] `.env.example` + `CREDITS_SETUP.md` (+ pricing source/version/update procedure) + README note. — Validate: fresh setup works from docs.
- [ ] Staging end-to-end (top-up→generate→phase charges→save→dashboard). — Validate: acceptance §22.
- [ ] Disabled-flag parity + partial-config fail-closed tests. — Validate: current behavior preserved; paid paths fail closed on partial config.

---

## Financial / concurrency / payment test gates (must be credible before enablement)
- [ ] Money math + micro-pence + half-up rounding + sub-penny accumulation.
- [ ] Missing-model fail-closed; price-table version stored per charge.
- [ ] Per-endpoint usage parsing (Responses input/output; audio tokens/duration/absent + fallback).
- [ ] Phase settlement: completed-only; partial-failure; retry/re-adopt/resume no double debit; replay-divergence→unresolved.
- [ ] Ledger never-negative + concurrent debits + concurrent top-ups.
- [ ] Replica-set transaction viability (dev/CI/staging) + standalone startup-probe error.
- [ ] Top-up exactly-once across webhook+return race, duplicate webhook, amount/currency mismatch; no body-trust.
- [ ] R2 create/delete failure + both-direction reconcile.
- [ ] sourceType detection (upload vs YouTube).
- [ ] Dashboard serializer leak test.
- [ ] Password gating + rate limit + direct-route bypass attempts.
- [ ] `CREDITS_ENABLED=false` behavior parity + partial-config fail-closed.

## Final Acceptance Checklist (Plan §22)
- [ ] Ledger never negative; idempotent; concurrency-correct; divergence flagged.
- [ ] Per-phase, completed-only charging; rounding correct; no double charge; accounting honest; audit matches.
- [ ] All models priced; missing fails closed; version reproducible.
- [ ] sourceType correct.
- [ ] Exactly-once top-ups (webhook + return; no body-trust).
- [ ] Saved gens on dashboard w/ playable audio + open-in-editor; toggle-off persists nothing; R2 both-direction reconcile.
- [ ] Password gates generation only; rate limit active; mutation routes protected; serializer leaks nothing.
- [ ] Replica-set transactions run; standalone errors clearly.
- [ ] `CREDITS_ENABLED=false` preserves current externally observable behavior; partial-config fails closed on paid paths only.
- [ ] Mobile + desktop parity; no Phase-1 regression; docs complete.

---

## Fresh-Agent Resume Section
- **State**: Plan v3 + this tracker aligned; nothing implemented. One gate open: G2 Phase-1 acceptance.
- **Start by**: reading `IMPLEMENTATION_PLAN.md` v3 + `PLAN_VERIFICATION.md`, confirming G2 closed, then re-running §20 against the accepted Phase-1 commit before Stage 0.
- **Golden rules**: keep app green every stage; `CREDITS_ENABLED` off until Stage 8; pricing/rounding tests before charging is trusted; ledger append-only; every money move idempotent + in a txn on a replica set; escalate material deviations before coding them.
- **Files you may write**: application code per the approved plan + this `PROGRESS.md`. Do not edit `INFORMATION_BANK.md`, `PROJECT_OVERVIEW.md`, `PLAN_VERIFICATION.md`, or the Phase-1 folder.
