# Repair Progress — Merge Features Project (Phase 1 + Phase 2)

**Mirrors:** `Merge_Features_Project/REPAIR_PLAN.md` (read that first).
**Source findings:** `Merge_Features_Project/POST_IMPLEMENTATION_AUDIT.md`.
**Branch of record:** `codex/phase-2-credit-dashboard` @ HEAD `d31ebfd`.

**Status legend:** `Not started` / `In progress` / `Implemented, not validated` / `Validated` / `Blocked` / `Deferred` / `Rejected` / `Superseded`.

---

## Programme Status

- **Current status:** Stages 2–6 code repairs complete through **REP-601**. Stopped before Stage 7/sandbox E2E. **REP-303 Blocked** (sandbox). **REP-805** not forced (D-F).
- **Definitive inventory:** **26 repairs — 3 High · 6 Medium · 15 Low · 1 Verify (REP-303) · 1 Gate (REP-805)** (see REPAIR_PLAN §3.1). Corrects the earlier prose drift (correct = 6 Medium, 15 Low).
- **Current repair ID:** — (Stage 6 complete; next Stage 7/8 or sandbox).
- **Last validated checkpoint:** Post-Stage-6 — `npm test` **55** files / **351** tests; lint 0; build 0. Baseline 331/53.
- **Next action:** Stage 7 REP-701 / Stage 8 ops docs when ready; real-service E2E + REP-303 sandbox + REP-805 operator pricing remain open.
- **Stage-gate review (2026-07-10):** REP-201 (+201a) closed. REP-202 dry-run tool lands; clamp write-offs excluded via `charged:true` (read `UsageRecord.writeOffMinor` for audit of full write-offs with no ledger row).
- **Blockers:** none on decisions — D-A…D-F all recorded. Standing gate: real-service E2E (not a code defect). **DV-1:** REP-201 supersedes the Phase-2 plan's per-phase reject model; the Phase-2 IMPLEMENTATION_PLAN should be amended by its owner so plan and code agree.
- **Keep flag off:** `CREDITS_ENABLED=false` throughout until the Final Release-Readiness Gate.
- **Working branch:** `repair/phase-1-2-programme` off `codex/phase-2-credit-dashboard` @ `d31ebfd`.

## Decision Log

| ID | Decision | Status | Resolution / owner | Date |
|----|----------|--------|--------------------|------|
| D-A | REP-201 overrun policy | **Closed** | **Clamp-to-zero, keep the work; never-negative preserved as a floor. Two billing blocks (A=transcribe+enrich, B=time); balance gate at block boundaries (before transcribe, before time), not before enrich. Records `writeOffMinor`. Supersedes plan D3/D6/D10 → DV-1.** / user | 2026-07-09 |
| D-B | REP-202 form | **Closed** | Dry-run script `credits:ai-settle-repair`; no admin route now. / user | 2026-07-09 |
| D-C | REP-403 public title | **Closed** | User-entered title required to publish; untitled ⇒ non-public; `sourceType` dropped. / user | 2026-07-09 |
| D-D | REP-407 scope | **Closed** | Fix now (minimal charset guard + realpath containment). / user | 2026-07-09 |
| D-E | REP-901 deletion | **Closed** | Script-only for now; route/UI deferred to follow-up. / user | 2026-07-09 |
| D-F | REP-805 pricing | **Closed** | Operator supplies/reviews all model prices + version before enablement; code stays fail-closed. / operator | 2026-07-09 |

## Repair Item Index (mirrors plan)

| Stage | ID | Severity | Status | User approval |
|---|---|---|---|---|
| 1 Release blockers | — | — | N/A (none) | — |
| 2 Financial | REP-201 | High | **Validated** (incl. REP-201a; DV-1) | recorded |
| 2 Financial | REP-202 | High | **Validated** (D-B) | recorded |
| 2 Financial | REP-203 | Low | **Validated** | no |
| 2 Financial | REP-204 | Low | **Validated** | no |
| 2 Financial | REP-205 | Low | **Validated** | no |
| 2 Financial | REP-206 | Low | **Validated** | no |
| 3 Payment | REP-301 | High | **Validated**| no |
| 3 Payment | REP-302 | Low | **Validated**| no |
| 3 Payment | REP-303 | Verify | **Blocked** (sandbox)| no |
| 4 Security | REP-401 | Medium | **Validated**| no |
| 4 Security | REP-402 | Medium | **Validated**| no |
| 4 Security | REP-403 | Medium | **Validated** (D-C)| recorded |
| 4 Security | REP-404 | Low | **Validated**| no |
| 4 Security | REP-405 | Low | **Validated**| no |
| 4 Security | REP-406 | Low | **Validated**| no |
| 4 Security | REP-407 | Low (pre-existing) | **Validated** (D-D)| recorded |
| 5 Mongo/R2/recovery | REP-501 | Low | **Validated**| no |
| 5 Mongo/R2/recovery | REP-502 | Low | **Validated**| no |
| 6 Cross-phase lifecycle | REP-601 | Medium | **Validated**| no |
| 7 Test/validation | REP-701 | Medium | Not started | no |
| 8 Ops/docs | REP-801 | Low | Not started | no |
| 8 Ops/docs | REP-802 | Low | Not started | no |
| 8 Ops/docs | REP-803 | Medium | Not started | no |
| 8 Ops/docs | REP-804 | Low | Not started | no |
| 8 Ops/docs | REP-805 | Gate | Not started (D-F recorded) | recorded |
| 9 UI/polish | REP-901 | Low | Deferred (D-E — script-only; doc via REP-802) | recorded |

---

## STAGE 1 — Release Blockers
No code repairs. The real-service E2E gate is tracked in the Sandbox E2E Checklist and Final Audit Sign-Off below.

---

## STAGE 2 — Financial & Ledger Correctness

### REP-201 — Clamp charging to available balance; block-boundary gating; keep the work
- **Status:** **Validated** (2026-07-09 core + 2026-07-10 REP-201a)
- [x] D-A recorded in Decision Log (clamp-to-zero + block-boundary gating)
- [x] Clamp/floor settlement mode in `lib/ledger/balance-ledger.js` for **AI debits only** (`mode: "clamp"`); top-up/other debits keep default reject; records `writeOffMinor` + `fullCostMinor` on ledger metadata
- [x] Block-boundary balance gate: gate `transcribe` + `time` + `full` job starts; **exempt** `enrich` (`isBlockBoundaryPhase` / `assertCanStartGeneration` in `credit-service.js`; route still calls gate for all phases — enrich returns `gateExempt`)
- [x] `settlePhase` uses clamp; persistence kept (work is delivered/saved) — `transcribe-job` marks `settled` with write-off, not `unresolved`
- [x] Insufficient-balance no longer produces `unresolved` (clamp always succeeds); `unresolved` retained only for transient settlement/DB errors in catch
- [x] Terminal "balance exhausted / Block B skipped" status: poll fields `balanceExhausted` + `writeOffMinor`; client 402 copy for time skip + post-complete balance-exhausted notice
- [x] `writeOffMinor` / `chargedMinor` / `fullCostMinor` on `UsageRecord`; ledger metadata `settlementMode:"clamp"`, `fullCostMinor`, `writeOffMinor`
- [x] Tests: clamp to 0 + write-off + never negative; Block A zeros then enrich settles (write-off) then time start rejects; reject mode still insufficient for non-clamp debits; disabled-flag parity preserved; persistence kept after clamp
- [x] **REP-201a:** reject `phase:"full"` when `isCreditsEnabled()` in `app/api/ai/transcribe/route.js` (400 `full_phase_disabled`); credits-off `full` unchanged. Tests: credits-on explicit/default `full` rejected (no job); credits-off `full` allowed; staged flow unaffected.
- **Deviation:** DV-1 — supersedes plan D3/D6/D10 (owner-approved); recommend Phase-2 plan be amended by its owner.
- **Files changed:**
  - `lib/ledger/balance-ledger.js` — `mode: "clamp"|"reject"` (default reject); clamp replay matching; full write-off with no ledger row when debit=0
  - `lib/credits/credit-service.js` — `isBlockBoundaryPhase`; enrich gate-exempt; `settlePhase` clamp + write-off fields on UsageRecord
  - `lib/models/UsageRecord.js` — optional `chargedMinor`, `fullCostMinor`, `writeOffMinor`
  - `lib/ai/transcribe-job.js` — clamp settlement surfaces balanceExhausted/writeOff; unresolved = transient only
  - `lib/ai/transcribe-store.js` — job/poll `balanceExhausted`, `writeOffMinor`
  - `components/editor-shell.js` — 402 exhausted copy; poll balance-exhausted notice
  - `app/api/ai/transcribe/route.js` — REP-201a reject `full` when credits enabled
  - tests: `balance-ledger.test.js`, `credit-service.test.js`, `transcribe-job.test.js`, `transcribe-store.test.js`, `app/api/ai/transcribe/route.test.js`
- **Tests run / results:** Post-REP-201a `npm test` → 53 files / **342** passed (was 331 baseline / 340 post-core); `npm run lint` exit 0; `npm run build` exit 0.
- **Deviations / notes:** Zero-debit full write-off creates no ledger row (amountMinor cannot be 0); audit via UsageRecord `writeOffMinor` + settlement return. Concurrent clamp race throws `CLAMP_RACE` for transaction retry (does not reject AI work). Top-up path still uses default reject mode (credits are positive).

### REP-202 — Remediation tooling for transient-error `unresolved` (dry-run script)
- **Status:** **Validated** (2026-07-10; D-B). **Scope narrowed by D-A:** insufficient balance no longer yields `unresolved` (it clamps); tool targets transient settlement/DB-error `unresolved` only.
- [x] D-B recorded (dry-run script; no admin route)
- [x] Read-only scanner for uncharged finalized `UsageRecord`s + `Generation.accountingStatus:"unresolved"` (skips clamp write-offs with `charged:true`)
- [x] Idempotent re-settle under `--apply` (reuses `ai_debit:{jobId}:{phase}` via `settlePhase`) + `MANUAL_ADJUSTMENT` path (`--manual-adjustment-minor` + `--reason`)
- [x] npm alias `credits:ai-settle-repair` + docs (`CREDITS_SETUP.md`)
- [x] Tests: scan dry-run writes nothing; re-settle once + second apply no double debit; MANUAL_ADJUSTMENT dry-run + idempotent apply
- **Files changed:**
  - `lib/credits/ai-settle-repair.js` — scan / re-settle / manual adjustment
  - `scripts/ai-settle-repair.mjs` — CLI (dry-run default)
  - `lib/credits/ai-settle-repair.test.js`
  - `package.json` — `credits:ai-settle-repair`
  - `CREDITS_SETUP.md` — operator docs
- **Tests run / results:** `npm test` → **54** files / **347** passed; lint 0; build 0.
- **Deviations:** Core logic in `lib/credits/ai-settle-repair.js` (script is thin CLI) for testability — still exposes `scripts/ai-settle-repair.mjs` + npm alias as specified. Re-settle temporarily forces `CREDITS_ENABLED=true` only for the `settlePhase` call (does not change deployment flag).

### REP-203 — Record usage only on `response.ok`
- **Status:** **Validated** (2026-07-10)
- [x] `recordOpenAiCallUsage` no-ops when `responseOk:false` at all 8 call sites
- [x] Tests: failed path writes no record; success unchanged
- **Files changed:** `lib/ai/openai-usage.js`, `lib/ai/openai-lyrics.js` (8 sites), tests · **Tests:** §6 green (part of Stage 2 lows batch)

### REP-204 — Complete audio-seconds fallback chain
- **Status:** **Validated** (2026-07-10)
- [x] `resolveBillingAudioSeconds` chain + thread `assetDurationSec`/`audioFilePath` from transcribe-job; ffprobe last-resort via `probeMediaDurationSec`
- [x] Tests: fallback order unit tests
- **Files changed:** `lib/ai/openai-lyrics.js`, `lib/ai/transcribe-job.js`, `lib/files.js`, tests

### REP-205 — `ledger-repair` historical `balanceAfterMinor`
- **Status:** **Validated** (2026-07-10)
- [x] `repairedHistoricalEntry` + `balanceAfterMinorIndicative`; help + CREDITS_SETUP docs
- [x] Tests: flag present; balance not mutated by repair helper
- **Files changed:** `lib/credits/ledger-repair.js`, `scripts/ledger-repair.mjs`, `CREDITS_SETUP.md`, tests

### REP-206 — Precheck/model-list sync + price-version reproducibility
- **Status:** **Validated** (2026-07-10)
- [x] `getLiveOpenAiModelsByBillingPhase` is single source for `getConfiguredOpenAiModelsByPhase`
- [x] Tests: live==precheck; every model priced; env override covered
- **Files changed:** `lib/ai/openai-lyrics.js`, `lib/credits/credit-service.js`, tests

---

## STAGE 3 — Payment & Exactly-Once Fulfilment

### REP-301 — Throttle checkout route
- **Status:** **Validated** (2026-07-10)
- [x] Per-IP/session limiter before non-reused order creation; 429 + retryAfter
- [x] Tests: distinct-amount burst throttled; single top-up passes; reuse fast path intact
- **Files changed:** see Stage 3–6 commit · **Tests run / results:** 55 files / 351 tests; lint 0; build 0 · **Deviations:** see programme notes

### REP-302 — Webhook quick-ack before verify
- **Status:** **Validated** (2026-07-10; implemented without waiting on REP-303 per owner)
- [x] Persist event + ack fast; run verification after responding (idempotent)
- [x] Tests: fast ack; credit exactly-once; duplicate/slow safe
- **Files changed:** see Stage 3–6 commit · **Tests run / results:** 55 files / 351 tests; lint 0; build 0 · **Deviations:** see programme notes

### REP-303 — Verify SumUp `redirect_url`/`return_url` semantics
- **Status:** **Blocked** (sandbox creds / E2E — parked)
- [ ] Sandbox checkout observes redirect + webhook targets
- [ ] Swap field mapping only if sandbox proves it; document result
- **Files changed:** none · **Parked:** requires SumUp sandbox observation (REP-803). No field mapping change without evidence. · **Deviations:** none

---

## STAGE 4 — Security & Authorization

### REP-401 — `Secure` flag on unlock cookie (prod)
- **Status:** **Validated** (2026-07-10)
- [x] Conditional `Secure` in `buildGenerationUnlockSetCookie`; localhost usable
- [x] Tests: `Secure` present in prod mode, absent on localhost
- **Files changed:** see Stage 3–6 commit · **Tests run / results:** 55 files / 351 tests; lint 0; build 0 · **Deviations:** see programme notes

### REP-402 — Enforce `CREDITS_ENABLED` on payment/persistence/dashboard/media routes
- **Status:** **Validated** (2026-07-10)
- [x] Early flag guard on checkout, orders, webhook, dashboard/state, dashboard/generations, media
- [x] Tests: each route disabled with flag off; unchanged with flag on
- **Files changed:** see Stage 3–6 commit · **Tests run / results:** 55 files / 351 tests; lint 0; build 0 · **Deviations:** see programme notes

### REP-403 — User-entered title required to publish; drop `sourceType`
- **Status:** **Validated** (2026-07-10; D-C)
- [x] D-C recorded (user-entered title required to publish)
- [x] Add user title field to the save flow; thread to `persistGeneration`
- [x] `public:true` only when a non-empty user title is present; else `public:false` (untitled ⇒ non-public)
- [x] Remove `sourceType` from `serializePublicCard`
- [x] Existing filename/untitled rows default to `public:false` on read until re-titled
- [x] Tests: leak test (no `sourceType`); untitled generation not returned by `/api/dashboard/state`; user-titled one is
- **Files changed:** see Stage 3–6 commit · **Tests run / results:** 55 files / 351 tests; lint 0; build 0 · **Deviations:** see programme notes

### REP-404 — Pin resolved IP in media-fetcher (rebinding TOCTOU)
- **Status:** **Validated** (2026-07-10)
- [x] Resolve once, connect to pinned IP with `Host`; preserve per-hop checks + TLS SNI
- [x] Tests: rebinding attempt blocked; normal https fetch works
- **Files changed:** see Stage 3–6 commit · **Tests run / results:** 55 files / 351 tests; lint 0; build 0 · **Deviations:** see programme notes

### REP-405 — Protect/limit public order re-query
- **Status:** **Validated** (2026-07-10)
- [x] Per-IP limiter; skip SumUp re-query for terminal orders
- [x] Tests: enumeration throttled; terminal returns without re-query; pending re-queries
- **Files changed:** see Stage 3–6 commit · **Tests run / results:** 55 files / 351 tests; lint 0; build 0 · **Deviations:** see programme notes

### REP-406 — Rate-limit unlock route
- **Status:** **Validated** (2026-07-10)
- [x] Per-IP attempt limiter before password check; 429 on excess
- [x] Tests: repeated wrong passwords throttled; correct within limit succeeds
- **Files changed:** see Stage 3–6 commit · **Tests run / results:** 55 files / 351 tests; lint 0; build 0 · **Deviations:** see programme notes

### REP-407 — Harden assetId containment (pre-existing) — D-D: fix now
- **Status:** **Validated** (2026-07-10; D-D)
- [x] D-D recorded (minimal guard, do now)
- [x] Charset guard at transcribe intake; realpath-containment in `getAssetFilePath`
- [x] Tests: traversal-shaped id rejected; UUID id works
- **Files changed:** see Stage 3–6 commit · **Tests run / results:** 55 files / 351 tests; lint 0; build 0 · **Deviations:** see programme notes

---

## STAGE 5 — MongoDB, R2 & Recovery Integrity

### REP-501 — Unique partial index on `Generation.finalJobId`
- **Status:** **Validated** (2026-07-10)
- [x] Add unique partial index; handle `E11000` idempotently in `persistGeneration`; rebuild indexes
- [x] Tests: concurrent persist yields one doc
- **Files changed:** see Stage 3–6 commit · **Tests run / results:** 55 files / 351 tests; lint 0; build 0 · **Deviations:** see programme notes

### REP-502 — Recover R2-create-after-sweep
- **Status:** **Validated** (2026-07-10)
- [x] Touch session immediately before promotion and/or retain source bytes until R2 `created`
- [x] Tests: promotion succeeds despite TTL race; reconcile recovers
- **Files changed:** see Stage 3–6 commit · **Tests run / results:** 55 files / 351 tests; lint 0; build 0 · **Deviations:** see programme notes

---

## STAGE 6 — Cross-Phase Asset & Lifecycle

### REP-601 — Wire `sweepStaleYoutubeAudioResults`
- **Status:** **Validated** (2026-07-10)
- [x] Best-effort call from POST (and/or status) route after prune; non-blocking
- [x] Tests: sweeper invoked from route; old orphan deleted; fresh retained
- **Files changed:** see Stage 3–6 commit · **Tests run / results:** 55 files / 351 tests; lint 0; build 0 · **Deviations:** see programme notes

---

## STAGE 7 — Test & Validation Gaps

### REP-701 — Close standalone test/validation gaps
- **Status:** Not started (depends REP-201, 301, 402, 405, 406, 501, 601)
- [ ] H1 guarded-invariant test (REP-201)
- [ ] Sweeper-invoked test (REP-601)
- [ ] Checkout throttle / unlock brute-force / order enumeration tests (REP-301/406/405)
- [ ] Kill-switch route-gating tests (REP-402)
- [ ] Concurrent `persistGeneration` dedup test (REP-501)
- [ ] Mocked-infra caveat documented
- [ ] Full `npm test` green
- **Files changed:** — · **Tests run / results:** — · **Deviations:** —

---

## STAGE 8 — Operational & Documentation

### REP-801 — Align `GEN_RATE` defaults
- **Status:** Not started
- [ ] Reconcile `.env.example` (20/3600) vs code (10/60); document intended defaults
- **Files changed:** — · **Tests run / results:** — · **Deviations:** —

### REP-802 — Backup/R2-lifecycle/deploy docs
- **Status:** Not started
- [ ] Add Mongo backup/PITR, R2 retention, deployment order/rollback to `CREDITS_SETUP.md`/`README.md`
- **Files changed:** — · **Tests run / results:** — · **Deviations:** —

### REP-803 — Sandbox E2E checklist additions
- **Status:** Not started
- [ ] Incorporate audit §22 amendments into `CREDITS_SETUP.md`
- **Files changed:** — · **Tests run / results:** — · **Deviations:** —

### REP-804 — Bound rate-limit map; document per-process + XFF trust
- **Status:** Not started
- [ ] Evict expired keys; document per-process/multi-instance limit + XFF proxy trust
- [ ] Tests: expired keys evicted; active windows unchanged
- **Files changed:** — · **Tests run / results:** — · **Deviations:** —

### REP-805 — Reconcile OpenAI price seed table
- **Status:** Not started (Blocked: D-F)
- [ ] D-F recorded; operator confirms every model's pence values + version
- [ ] Tests: all models priced; version stored per charge
- **Files changed:** — · **Tests run / results:** — · **Deviations:** —

---

## STAGE 9 — Non-Blocking UI / Polish

### REP-901 — Generation deletion (D-E: script-only) — Deferred
- **Status:** Deferred (D-E — script-only for now; route/UI is a follow-up, not in this programme)
- [x] D-E recorded (script-only)
- [ ] Document the supported deletion procedure (DB `deletedAt` → `r2-reconcile`) in `CREDITS_SETUP.md` (folds into REP-802) — no code change
- **Files changed:** — · **Tests run / results:** — · **Deviations:** —

---

## Resume Instructions (for a fresh coding agent)
1. Read `REPAIR_PLAN.md` in full, then this tracker.
2. Confirm the branch is `codex/phase-2-credit-dashboard`; capture a fresh `npm test`/`lint`/`build` baseline.
3. Decisions D-A…D-F are all recorded (Decision Log). Note DV-1: REP-201 clamp-to-zero supersedes plan D3/D6/D10 — implement per this repair doc; the Phase-2 plan should be amended by its owner.
4. Work stage-by-stage in plan order (Stage 2 → 9); within a stage, independent items may run in parallel (see plan §5 / final response).
5. For each repair: implement → add the required tests → run the §6 regression → mark the checklist items → set status → record files changed / tests run / results / deviations.
6. Keep `CREDITS_ENABLED=false`. Never mark a repair `Validated` without passing tests + acceptance.
7. After Stages 2–6, run the Sandbox E2E Checklist below; then the Final Regression Checklist; then request the Final Audit Sign-Off.

---

## Final Regression Checklist (run per stage + before release)
- [ ] `npm test` green (≥ 331 baseline + new tests; no regressions)
- [ ] `npm run lint` exit 0
- [ ] `npm run build` exit 0 (all Phase 1 + Phase 2 routes)
- [ ] `CREDITS_ENABLED=false` parity: generation/editor/audio/project/render/export/Phase-1 unchanged
- [ ] Phase-1 non-regression: YouTube import parity with manual upload
- [ ] Money invariants: never-negative, idempotent, concurrent-serialize, replay-flagged, exactly-once top-ups, no double charge
- [ ] Paired tests for every repair in the stage re-run

## Sandbox E2E Checklist (real sandbox services; run after Stages 2–6)
- [ ] Top-up exactly-once via webhook + return + race + duplicate; amount/currency/merchant mismatch rejected
- [ ] Charging: ledger debits == summed `UsageRecord` for completed phases; partial-failure completed-only; retry/re-adopt no double debit
- [ ] H1 go/no-go (clamp model, post REP-201): cost>balance zeroes the balance (never negative), keeps the work, records `writeOffMinor`, blocks the next block/generation; a "run all" that zeroes balance during Block A finishes translation then blocks timing (402)
- [ ] Gates: 402 insufficient / 403 locked / 429 rate-limited fire; unlock cookie TTL works
- [ ] Kill-switch: flag-off route parity (post REP-402)
- [ ] Persistence/R2: saved gen on `/dashboard`, playable audio, open-in-editor; toggle-off persists nothing; forced R2 failure repaired both directions
- [ ] Standalone Mongo → `TRANSACTIONS_UNSUPPORTED` fail-closed
- [ ] Orphan YT result cleanup after restart (post REP-601)
- [ ] Pricing: every configured/called model priced; missing fails closed (REP-805 reconciled)
- [ ] `unresolved` remediation tool resolves a seeded unresolved job (post REP-202)
- [ ] SumUp redirect/webhook wiring verified in sandbox (REP-303)

## Final Audit Sign-Off
- [ ] Stages 2–6 all `Validated`; Stage 7 tests green; §6 regression green
- [ ] Stage 8 docs complete; REP-805 pricing reconciled (D-F closed)
- [ ] Sandbox E2E checklist passed (incl. H1 go/no-go + `unresolved` drill)
- [ ] Decisions D-A…D-F recorded/closed (or dependent repair explicitly Deferred with sign-off)
- [ ] Rollback confirmed (`CREDITS_ENABLED=false` fully disables the layer)
- [ ] **Independent auditor sign-off:** _name / date / verdict_ → ____________________

---

**No application, prototype, test, configuration, schema, dependency, environment, or phase-document file was modified in producing this tracker. Only `REPAIR_PLAN.md` and `REPAIR_PROGRESS.md` were written.**
