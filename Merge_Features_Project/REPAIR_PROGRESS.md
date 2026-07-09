# Repair Progress — Merge Features Project (Phase 1 + Phase 2)

**Mirrors:** `Merge_Features_Project/REPAIR_PLAN.md` (read that first).
**Source findings:** `Merge_Features_Project/POST_IMPLEMENTATION_AUDIT.md`.
**Branch of record:** `codex/phase-2-credit-dashboard` @ HEAD `d31ebfd`.

**Status legend:** `Not started` / `In progress` / `Implemented, not validated` / `Validated` / `Blocked` / `Deferred` / `Rejected` / `Superseded`.

---

## Programme Status

- **Current status:** Stage 2 in progress — **REP-201 Validated** (incl. REP-201a); next **REP-202**.
- **Definitive inventory:** **26 repairs — 3 High · 6 Medium · 15 Low · 1 Verify (REP-303) · 1 Gate (REP-805)** (see REPAIR_PLAN §3.1). Corrects the earlier prose drift (correct = 6 Medium, 15 Low).
- **Current repair ID:** REP-202 (in progress).
- **Last validated checkpoint:** Post-REP-201a — `npm test` 53 files / **342** tests passed; `npm run lint` exit 0; `npm run build` exit 0. Pre-repair baseline was 331 tests.
- **Next action:** Complete **REP-202** (transient-error `unresolved` dry-run re-settle script).
- **Stage-gate review (2026-07-10):** REP-201 core accepted; REP-201a closed by rejecting `phase:"full"` when credits enabled (staged path only). Note for REP-202/audit: fully written-off clamp phases may have no ledger row — read `UsageRecord.writeOffMinor`.
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
| 2 Financial | REP-202 | High | In progress (D-B recorded) | recorded |
| 2 Financial | REP-203 | Low | Not started | no |
| 2 Financial | REP-204 | Low | Not started | no |
| 2 Financial | REP-205 | Low | Not started | no |
| 2 Financial | REP-206 | Low | Not started | no |
| 3 Payment | REP-301 | High | Not started | no |
| 3 Payment | REP-302 | Low | Not started | no |
| 3 Payment | REP-303 | Verify | Not started | no |
| 4 Security | REP-401 | Medium | Not started | no |
| 4 Security | REP-402 | Medium | Not started | no |
| 4 Security | REP-403 | Medium | Not started (D-C recorded) | recorded |
| 4 Security | REP-404 | Low | Not started | no |
| 4 Security | REP-405 | Low | Not started | no |
| 4 Security | REP-406 | Low | Not started | no |
| 4 Security | REP-407 | Low (pre-existing) | Not started (D-D recorded — fix now) | recorded |
| 5 Mongo/R2/recovery | REP-501 | Low | Not started | no |
| 5 Mongo/R2/recovery | REP-502 | Low | Not started | no |
| 6 Cross-phase lifecycle | REP-601 | Medium | Not started | no |
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
- **Status:** In progress (D-B recorded; depends REP-201 Validated). **Scope narrowed by D-A:** insufficient balance no longer yields `unresolved` (it clamps); tool targets transient settlement/DB-error `unresolved` only.
- [x] D-B recorded (dry-run script; no admin route)
- [ ] Read-only scanner for transient-error `unresolved` jobs/generations
- [ ] Idempotent re-settle under `--apply` (reuses `ai_debit:{jobId}:{phase}`) + `MANUAL_ADJUSTMENT` path
- [ ] npm alias `credits:ai-settle-repair` + docs (`CREDITS_SETUP.md`)
- [ ] Tests: idempotent re-settle; dry-run writes nothing
- **Files changed:** — · **Tests run / results:** — · **Deviations:** —

### REP-203 — Record usage only on `response.ok`
- **Status:** Not started
- [ ] Move `recordOpenAiCallUsage` after `response.ok` at all 8 sites
- [ ] Tests: failed audio call writes no phantom-cost record; success unchanged
- **Files changed:** — · **Tests run / results:** — · **Deviations:** —

### REP-204 — Complete audio-seconds fallback chain
- **Status:** Not started
- [ ] Thread `metadata.durationSec` + optional ffprobe last-resort into `audioSeconds`
- [ ] Tests: each fallback level; upload `durationSec:null` yields nonzero cost
- **Files changed:** — · **Tests run / results:** — · **Deviations:** —

### REP-205 — `ledger-repair` historical `balanceAfterMinor`
- **Status:** Not started
- [ ] Mark repaired rows (`repairedHistoricalEntry`) + document indicative `balanceAfterMinor`
- [ ] Tests: flag present; balance untouched
- **Files changed:** — · **Tests run / results:** — · **Deviations:** —

### REP-206 — Precheck/model-list sync + price-version reproducibility
- **Status:** Not started
- [ ] Single source / cross-check test between `openai-lyrics.js` models and `credit-service` precheck
- [ ] Tests: every called model priced/prechecked; env-override covered
- **Files changed:** — · **Tests run / results:** — · **Deviations:** —

---

## STAGE 3 — Payment & Exactly-Once Fulfilment

### REP-301 — Throttle checkout route
- **Status:** Not started
- [ ] Per-IP/session limiter before non-reused order creation; 429 + retryAfter
- [ ] Tests: distinct-amount burst throttled; single top-up passes; reuse fast path intact
- **Files changed:** — · **Tests run / results:** — · **Deviations:** —

### REP-302 — Webhook quick-ack before verify
- **Status:** Not started (depends REP-303)
- [ ] Persist event + ack fast; run verification after responding (idempotent)
- [ ] Tests: fast ack; credit exactly-once; duplicate/slow safe
- **Files changed:** — · **Tests run / results:** — · **Deviations:** —

### REP-303 — Verify SumUp `redirect_url`/`return_url` semantics
- **Status:** Not started (investigation; needs sandbox creds)
- [ ] Sandbox checkout observes redirect + webhook targets
- [ ] Swap field mapping only if sandbox proves it; document result
- **Files changed:** — · **Tests run / results:** — · **Deviations:** —

---

## STAGE 4 — Security & Authorization

### REP-401 — `Secure` flag on unlock cookie (prod)
- **Status:** Not started
- [ ] Conditional `Secure` in `buildGenerationUnlockSetCookie`; localhost usable
- [ ] Tests: `Secure` present in prod mode, absent on localhost
- **Files changed:** — · **Tests run / results:** — · **Deviations:** —

### REP-402 — Enforce `CREDITS_ENABLED` on payment/persistence/dashboard/media routes
- **Status:** Not started
- [ ] Early flag guard on checkout, orders, webhook, dashboard/state, dashboard/generations, media
- [ ] Tests: each route disabled with flag off; unchanged with flag on
- **Files changed:** — · **Tests run / results:** — · **Deviations:** —

### REP-403 — User-entered title required to publish; drop `sourceType`
- **Status:** Not started (D-C recorded)
- [x] D-C recorded (user-entered title required to publish)
- [ ] Add user title field to the save flow; thread to `persistGeneration`
- [ ] `public:true` only when a non-empty user title is present; else `public:false` (untitled ⇒ non-public)
- [ ] Remove `sourceType` from `serializePublicCard`
- [ ] Existing filename/untitled rows default to `public:false` on read until re-titled
- [ ] Tests: leak test (no `sourceType`); untitled generation not returned by `/api/dashboard/state`; user-titled one is
- **Files changed:** — · **Tests run / results:** — · **Deviations:** —

### REP-404 — Pin resolved IP in media-fetcher (rebinding TOCTOU)
- **Status:** Not started
- [ ] Resolve once, connect to pinned IP with `Host`; preserve per-hop checks + TLS SNI
- [ ] Tests: rebinding attempt blocked; normal https fetch works
- **Files changed:** — · **Tests run / results:** — · **Deviations:** —

### REP-405 — Protect/limit public order re-query
- **Status:** Not started
- [ ] Per-IP limiter; skip SumUp re-query for terminal orders
- [ ] Tests: enumeration throttled; terminal returns without re-query; pending re-queries
- **Files changed:** — · **Tests run / results:** — · **Deviations:** —

### REP-406 — Rate-limit unlock route
- **Status:** Not started
- [ ] Per-IP attempt limiter before password check; 429 on excess
- [ ] Tests: repeated wrong passwords throttled; correct within limit succeeds
- **Files changed:** — · **Tests run / results:** — · **Deviations:** —

### REP-407 — Harden assetId containment (pre-existing) — D-D: fix now
- **Status:** Not started (D-D recorded — fix now)
- [x] D-D recorded (minimal guard, do now)
- [ ] Charset guard at transcribe intake; realpath-containment in `getAssetFilePath`
- [ ] Tests: traversal-shaped id rejected; UUID id works
- **Files changed:** — · **Tests run / results:** — · **Deviations:** —

---

## STAGE 5 — MongoDB, R2 & Recovery Integrity

### REP-501 — Unique partial index on `Generation.finalJobId`
- **Status:** Not started
- [ ] Add unique partial index; handle `E11000` idempotently in `persistGeneration`; rebuild indexes
- [ ] Tests: concurrent persist yields one doc
- **Files changed:** — · **Tests run / results:** — · **Deviations:** —

### REP-502 — Recover R2-create-after-sweep
- **Status:** Not started
- [ ] Touch session immediately before promotion and/or retain source bytes until R2 `created`
- [ ] Tests: promotion succeeds despite TTL race; reconcile recovers
- **Files changed:** — · **Tests run / results:** — · **Deviations:** —

---

## STAGE 6 — Cross-Phase Asset & Lifecycle

### REP-601 — Wire `sweepStaleYoutubeAudioResults`
- **Status:** Not started
- [ ] Best-effort call from POST (and/or status) route after prune; non-blocking
- [ ] Tests: sweeper invoked from route; old orphan deleted; fresh retained
- **Files changed:** — · **Tests run / results:** — · **Deviations:** —

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
