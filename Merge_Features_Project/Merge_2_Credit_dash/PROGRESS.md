# Credit Dashboard Merge — Phase 2 Progress Tracker

**Mirrors**: `IMPLEMENTATION_PLAN.md` v3 (2026-07-09). Read that + `PLAN_VERIFICATION.md` first.
**Phase status**: IMPLEMENTATION STARTED (v3) — Stage 0 Validated.
**Current stage**: Stage 1 — DB / models / money / ledger (next).
**Last verified checkpoint**: Stage 0 validated on 2026-07-09: Phase 1 acceptance recorded, v3 plan-ready status confirmed, §20 drift check found no material mismatch, deps installed, module imports passed, scoped tests passed, repo-wide `npm test` baseline unchanged, and Mongo replica-set transaction probe passed.
**Next action**: Stage 1 — port DB/model/money/ledger modules behind no runtime wiring, then validate ledger/model tests on the replica-set harness.
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
Original B1-B7 from the first verification → resolved in v2/v3. Re-verification B1 (`core` group mismatch) → resolved in v3 by per-phase billing + `pipelineRunId` persistence aggregation. Re-verification B2 (approval/acceptance gates) → G1 closed; G2 remains external. Non-blocking notes → applied or carried forward: sourceType seam accepted as Phase-2 scope, focused Phase-1 tests now passed, exact price values remain config-owned, stale info-bank wording superseded by v3.

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

### Stage 1 — DB / models / money / ledger — `Not started`
- [ ] Port `lib/db/mongoose.js` (+`assertTransactionsSupported`), `lib/db/bootstrap.js`. — Validate: connects to RS test Mongo.
- [ ] Port `lib/money.js` (+tests). — Validate: money tests green.
- [ ] Port Balance/PaymentOrder/WebhookEvent/RefundRecord. — Validate: schemas load.
- [ ] Extend `CreditLedger` enum → add `AI_TRANSCRIBE`,`AI_ENRICH`,`AI_TIMING` (drop unused `CARD_CREATE`). — Validate: enum test.
- [ ] Add single `Generation` model (§10.2) + `UsageRecord` (§10.3, unique `callId`). — Validate: indexes build.
- [ ] Port `lib/ledger/balance-ledger.js` (+tests). — Validate: idempotency / never-negative / **concurrent debits** / **replay-divergence** tests green on RS harness.

### Stage 2 — Pricing + rounding + usage collector — `Not started`
- [ ] `lib/ai/openai-pricing.js` (versioned micro-pence table, all default+env models) + `hasPrice`/`computeCallCostMicros`/`roundMicrosToPenceHalfUp`. — Validate: unit tests incl. **missing-model fail-closed** + **sub-penny accumulation + half-up**.
- [ ] `lib/credits/billing-phases.js` (phase→ledger type). — Validate: mapping test.
- [ ] `lib/ai/openai-usage.js` collector (callId, phase totals, finalized-for-phase). — Validate: aggregation + retry-same-callId tests.
- [ ] Thread collector into `openai-lyrics.js`; `record()` after `tryParseJson(rawText)` at all 8 sites; tag sub-phase/billing unit in `runLyricTimingPipeline`; parse Responses `input/output` + audio `tokens`/`duration`/absent. — Files: `lib/ai/openai-lyrics.js` — Validate: correct capture per endpoint; **pipeline output unchanged**; UsageRecords written (no debit).

### Stage 3 — Credit service + phase settlement + accounting — `Not started`
- [ ] `lib/credits/{flags,rate-limit,credit-service}.js` (`assertCanStartGeneration` incl. price precheck; `settlePhase` D3/D4/D10; `recordUsageOnly`). — Validate: unit.
- [ ] Add `accountingStatus`/`accountingError` to `transcribe-store.js` + poll response. — Validate: statuses surface.
- [ ] Wire phase boundaries in `transcribe-job.js`; add `pipelineRunId` pass-through and final-phase `saveOnCompletion` handling in route/client. — Files: `lib/ai/transcribe-job.js`, `app/api/ai/transcribe/route.js`, `components/editor-shell.js` — Validate: completed-phases-only; failed `enrich`/`time` does not charge failed phase; earlier completed phases remain debited; retry/re-adopt no double debit; divergence→`unresolved`; multi-phase Run rounds each phase independently; final-phase marker correct.

### Stage 4 — Generation-start gating — `Not started`
- [ ] `app/api/credits/unlock/route.js` + signed cookie (name/TTL/timing-safe per §5.1). — Validate: correct/incorrect password; cookie TTL.
- [ ] `app/api/credits/balance/route.js`. — Validate: enabled/disabled shapes.
- [ ] Gate `app/api/ai/transcribe/route.js`: 403 locked / 429 rate / 500 pricing-unavailable / 402 low; `pipelineRunId`/`save`/`saveOnCompletion` passthrough; 409 re-adopt skips gates. — Validate: each gate; direct-API bypass blocked; disabled flag unchanged.

### Stage 5 — Persistence + R2 audio (+ provenance) — `Not started`
- [ ] Add `sourceType` to `lib/files.js` metadata (`upload` + YT ingest `youtube`; additive only). — Validate: metadata correct, sweep/TTL unchanged.
- [ ] Port `lib/r2/{r2-env,r2-client}.js`. — Validate: r2 smoke (sandbox bucket).
- [ ] `lib/r2/audio-r2-lifecycle.js` (put/delete/reconcile, both failure directions). — Validate: object round-trip + reconcile both ways.
- [ ] `lib/generations/{persist-generation,serialize-generation}.js`. — Validate: txn create + post-commit R2; toggle off persists nothing.
- [ ] `app/api/media/generations/[id]/route.js`. — Validate: playable stream / 302.
- [ ] Wire completion call in `transcribe-job.js` honoring `save` + `saveOnCompletion`; `persistGeneration` collects settled phase debits by `pipelineRunId`. — Validate: end-to-end saved gen; sourceType correct upload vs YT; no partial Generation is saved before final selected phase.

### Stage 6 — Top-ups (SumUp) — `Not started`
- [ ] Port `lib/payments/*`. — Validate: sumup-env/client tests.
- [ ] `app/api/credits/checkout/route.js` + `orders/[orderId]/route.js`. — Validate: checkout + reuse window; server-authoritative amount.
- [ ] `app/api/webhooks/sumup/route.js` (trigger-only + re-query; safe event storage). — Validate: quick-ack; no body-trust.
- [ ] `app/payment/return/*` + poll. — Validate: **exactly-once via BOTH webhook and return**; race; duplicate webhook; wrong amount/currency rejected.

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
