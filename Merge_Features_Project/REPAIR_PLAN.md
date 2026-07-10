# Repair Plan — Merge Features Project (Phase 1 + Phase 2)

**Author role:** Repair-planning agent (planning only — no code changed).
**Date:** 2026-07-09
**Branch of record:** `codex/phase-2-credit-dashboard` @ HEAD `d31ebfd`.
**Source of truth for findings:** `Merge_Features_Project/POST_IMPLEMENTATION_AUDIT.md` (verdict: PASS WITH NON-BLOCKING ISSUES — sandbox E2E may begin; H1/H2/H3 + M-items are pre-live gates).
**Companion tracker:** `Merge_Features_Project/REPAIR_PROGRESS.md`.

This plan converts the **accepted** audit findings into an executable repair programme a fresh coding agent can run without re-deriving the audit. It contains only confirmed defects, accepted findings, approved documentation/operational corrections, and unresolved findings explicitly awaiting a user decision. Rejected/speculative items are excluded.

---

## 1. Goals

- Close every accepted audit defect and gap to make the credit layer safe for **live (real-money)** enablement, in priority order.
- Keep the app green throughout: every repair ships with tests; `CREDITS_ENABLED=false` parity and Phase-1 behaviour must never regress.
- Preserve the existing architecture; all repairs are additive/surgical, none re-architect the merge.
- Keep the layer flag-off until the final release gate.

## 2. Non-Goals

- No re-architecture of the ledger, job model, asset system, or dashboard.
- No new product surface beyond what an accepted finding requires (deletion UI is gated on a user decision, not assumed).
- No change to the confirmed decisions D1–D12 of either phase.
- No enabling of `CREDITS_ENABLED=true` in production as part of this programme (that is the operator's final gate).
- No pricing-value authorship (values remain operator-owned; the plan only requires the reconciliation step).

## 3. Confirmed Repair Scope

Derived one-to-one from accepted audit findings and required repairs (audit §5–§7, §19, §20):

| Audit finding | Severity | Repair ID |
|---|---|---|
| H1 unbilled work delivered/persisted | High | REP-201 |
| H2 no `unresolved` remediation tooling | High | REP-202 |
| L1 phantom cost on failed audio calls | Low | REP-203 |
| L5 partial audio-seconds fallback | Low | REP-204 |
| L7 ledger-repair `balanceAfterMinor` imprecision | Low | REP-205 |
| Audit §11 precheck/model-list drift + price-version reproducibility | Low | REP-206 |
| H3 checkout unauthenticated/unthrottled | High | REP-301 |
| L3 webhook not quick-ack | Low | REP-302 |
| Audit §12/§18 SumUp `redirect_url`/`return_url` semantics | Info→verify | REP-303 |
| M2 unlock cookie missing `Secure` | Medium | REP-401 |
| M4 kill-switch not enforced on all routes | Medium | REP-402 |
| M3 public card title/`sourceType` leak | Medium | REP-403 |
| L2 SSRF DNS-rebinding TOCTOU | Low | REP-404 |
| L4 public order re-query amplification | Low | REP-405 |
| Audit §15 unlock brute-force surface | Low | REP-406 |
| Audit §15 pre-existing assetId containment | Low (pre-existing) | REP-407 |
| L6 `Generation.finalJobId` not unique | Low | REP-501 |
| Audit §10/§14 R2-create-after-sweep unrecoverable | Low | REP-502 |
| M1 stale-result sweeper never wired | Medium | REP-601 |
| Audit §16 standalone test/validation gaps | Medium | REP-701 |
| Audit §17 `GEN_RATE` default mismatch | Low | REP-801 |
| Audit §17 backup/R2-lifecycle/deploy docs | Low | REP-802 |
| Audit §22 sandbox E2E checklist additions | Medium | REP-803 |
| L8/L9 rate-limit map growth + XFF trust | Low | REP-804 |
| Audit §11 / CREDITS_SETUP §3 pricing seed reconciliation | Gate | REP-805 |
| §19 deletion route/UI (plan deviation) | Low | REP-901 |

## 3.1 Definitive Inventory, Counts & Release-Gate Classification
*(Added by planning-owner review, 2026-07-09. Reconciles the earlier prose count drift — the correct figures are 6 Medium and 15 Low.)*

**Total: 26 repair items — 3 High · 6 Medium · 15 Low · 1 Verify (REP-303) · 1 Gate (REP-805).**
- **High (3):** REP-201, REP-202, REP-301.
- **Medium (6):** REP-401, REP-402, REP-403, REP-601, REP-701, REP-803.
- **Low (15):** REP-203, 204, 205, 206, 302, 404, 405, 406, 407, 501, 502, 801, 802, 804, 901.
- **Verify (1):** REP-303. **Gate (1):** REP-805.

Every audit High/Medium/Low finding maps to exactly one repair; **no duplicates, no orphan repairs, no unmapped findings.** L8+L9 are intentionally merged into REP-804 (the only merge). No finding is over-split.

**Release-gate classification (each item exactly once):**

| Class | Repairs |
|---|---|
| Required before **real-money** enablement | REP-201, REP-202, REP-206, REP-301, REP-402, REP-701, REP-803, REP-805 |
| Required before **public production** enablement | REP-401, REP-403, REP-404, REP-405, REP-406, REP-407, REP-501, REP-502, REP-601, REP-802, REP-804 |
| **May be tested during** sandbox E2E | REP-303 |
| **Optional** post-release hardening | REP-203, REP-204, REP-205, REP-302, REP-801, REP-901 |
| Required before **sandbox E2E** | none (audit: sandbox may begin now) |
| **Rejected / no repair** required | none |

## 4. Decisions (RESOLVED 2026-07-09)

All six decisions are resolved by the user/owner; no repair remains blocked on a pending decision.

| # | Decision | Resolution | Affected |
|---|---|---|---|
| D-A | Cost-overrun / settlement policy | **Clamp-to-zero, keep the work.** When a phase's cost exceeds balance, charge the remaining balance (→ 0), keep/deliver/persist the generation, write off the remainder; never-negative preserved as a **floor** (not a rejection). Two billing blocks — **A = `transcribe`+`enrich`, B = `time`**; the balance gate is enforced at **block boundaries** (before `transcribe`, before `time`), **not** before `enrich`, so Block A always finishes and Block B is blocked when balance is 0. **Supersedes the Phase-2 plan's per-phase never-negative-*reject* model (D3/D6/D10) — see Deviation DV-1.** | REP-201, REP-202, REP-701 |
| D-B | `unresolved` remediation form | **Dry-run script** (`credits:ai-settle-repair`); no new public/admin surface now. | REP-202 |
| D-C | Public card title | **User-entered title required to publish.** A card is public only if the user sets a title in the save flow; otherwise it stays untitled/non-public. `sourceType` dropped from the public projection regardless. | REP-403 |
| D-D | Pre-existing `assetId` containment | **Fix now** — minimal charset guard at intake + realpath containment in `getAssetFilePath`. | REP-407 |
| D-E | Deletion route/UI | **Script-only for now** (DB `deletedAt` + `r2-reconcile`); route/UI deferred to a follow-up. | REP-901 |
| D-F | Pricing values | **Operator supplies/reviews every model's pence value + sets the price-table version before enablement;** code stays fail-closed on any unpriced model. | REP-805 |

**Deviation DV-1 (D-A):** REP-201's clamp-to-zero behaviour is an owner-approved product change that intentionally deviates from the Phase-2 IMPLEMENTATION_PLAN's approved per-phase reject/never-negative semantics and per-phase billing/gating. Invariants preserved: ledger stays append-only; balance stays ≥ 0 (floor). Audit honesty preserved: the full computed cost, the clamped debit, and the `writeOffMinor` remainder are recorded on the `UsageRecord`/ledger metadata. **Reconciled 2026-07-10:** the Phase-2 `Merge_2_Credit_dash/IMPLEMENTATION_PLAN.md` has been amended to **v4** (clamp-to-zero + block-boundary gating + `full`-phase reject) so plan and code now agree — DV-1 is closed.

## 5. Stage Ordering

Follows the mandated priority order. Within a stage, items are independent unless a dependency is noted.

- **Stage 1 — Release blockers:** none at code level (audit §4). The only standing blocker is real-service E2E, captured in §8 (Sandbox E2E readiness gate) and §9 (Release-readiness gate). Proceed to Stage 2.
- **Stage 2 — Financial & ledger correctness:** REP-201 → REP-202; REP-203, REP-204, REP-205, REP-206 (parallel).
- **Stage 3 — Payment & exactly-once fulfilment:** REP-301; REP-303 → REP-302 (verify wiring before changing ack timing).
- **Stage 4 — Security & authorization:** REP-401, REP-402, REP-403 (D-C recorded), REP-404, REP-405, REP-406, REP-407 (D-D recorded — fix now). Mostly parallel.
- **Stage 5 — MongoDB, R2 & recovery integrity:** REP-501, REP-502.
- **Stage 6 — Cross-phase asset & lifecycle:** REP-601.
- **Stage 7 — Test & validation gaps:** REP-701 (runs after the code repairs it asserts).
- **Stage 8 — Operational & documentation:** REP-801, REP-802, REP-803, REP-804, REP-805 (parallel; may run alongside code stages).
- **Stage 9 — Non-blocking UI/polish:** REP-901 (D-E recorded — **deferred**, script-only; no code in this programme).

---

## STAGE 1 — Release Blockers

No code-level release blockers were found (audit §4). The single unavoidable gate is **real-service E2E validation**, which is not a code defect and is tracked in §8/§9 and REP-803/REP-805. No repair items in this stage.

---

## STAGE 2 — Financial & Ledger Correctness

### REP-201 — Clamp charging to available balance; gate at billing-block boundaries; keep the work
- **Severity:** High. **Audit ref:** H1 / R1. **Decision:** D-A (clamp-to-zero + block-boundary gating). **See Deviation DV-1.**
- **Evidence:** `lib/credits/credit-service.js:85-111,238-244`; `lib/ai/transcribe-job.js:58-88` (catch → `unresolved`), `:314-335` (persists + completes regardless; persistence gated on the save toggle, not on settlement); `lib/credits/flags.js:7-21`; `lib/ledger/balance-ledger.js:167-194` (current never-negative **reject** semantics).
- **Current behaviour:** start gate checks only a 1p floor; settlement **rejects** on insufficient balance (`INSUFFICIENT_BALANCE`), the reject is caught → job flagged `unresolved`, yet the full result is still delivered and (if the save toggle is on) persisted to the public dashboard — uncharged.
- **Exact target behaviour (D-A):**
  1. **Two billing blocks:** Block A = `transcribe`+`enrich`; Block B = `time`.
  2. **Block-boundary balance gate:** enforce the balance floor **before Block A** (the `transcribe` job start) and **before Block B** (the `time` job start); **do not** gate `enrich` — it is an authorised continuation of Block A. A `time` job started with `balance ≤ floor` returns `402` and does not run.
  3. **Clamp-to-available settlement:** when a phase's computed cost exceeds the current balance, debit exactly the remaining balance (balance → 0), **keep/deliver/persist** the generation, and record the full computed cost, the clamped debit, and `writeOffMinor` (the un-recovered remainder) on the `UsageRecord`/ledger metadata. Never-negative holds as a **floor**, not a rejection.
  4. Once balance is 0, subsequent blocks and future generations are blocked at the start gate.
- **Key consequence:** the "settlement fails → unresolved → delivered free" leak is closed; **insufficient balance no longer produces an `unresolved` state** (clamp always succeeds). `unresolved` now signals only a genuine transient settlement/DB error (narrows REP-202).
- **Affected files/modules:** `lib/ledger/balance-ledger.js` (add a **clamp/floor** settlement mode used *only* by AI settlement — **must not** change the reject semantics used by top-ups/other debits), `lib/credits/credit-service.js` (`settlePhase` clamp + block-boundary gate helper), `lib/ai/transcribe-job.js` (gate placement; persistence unchanged — work is kept), `app/api/ai/transcribe/route.js` (gate only block-entry phase jobs: `transcribe`, `time`), `lib/ai/openai-usage.js` / `lib/models/UsageRecord.js` (record clamped/`writeOffMinor` fields), `lib/ai/transcribe-store.js` + client copy (surface a terminal "balance exhausted / timing skipped" signal).
- **Root cause:** post-delivery charging with reject-on-insufficient and a swallowed failure branch.
- **Ordered steps:** 1) Add a clamped (floor-to-0, write-off-recording) settlement path to the ledger for AI debits; keep top-up/other debits on reject. 2) Implement the block-boundary gate (gate `transcribe` + `time`; exempt `enrich`). 3) `settlePhase` uses clamp; keep persistence (work is kept). 4) Surface a terminal "balance exhausted / Block B skipped" status in the poll response + client copy. 5) Remove the insufficient-balance `unresolved` branch (retain `unresolved` only for transient errors).
- **Risks:** must not weaken never-negative (floor, not negative); must **not** alter top-up/other-debit reject semantics; `CREDITS_ENABLED=false` path unchanged.
- **Required tests:** cost>balance clamps to 0, keeps the generation, records `writeOffMinor`, balance never negative; "run all" that zeroes balance during Block A still finishes `enrich` then blocks `time` (402); top-up debits still reject on insufficient (unchanged); ledger append-only; disabled-flag parity.
- **Rollback/remediation:** `CREDITS_ENABLED=false`; additive/revertible.
- **Completion criteria:** No uncharged-delivery leak; overrun clamps to zero with an audited write-off; block-boundary gating verified; top-up semantics unchanged.
- **Dependencies:** D-A (recorded). **User approval required:** recorded.

#### REP-201a (addendum, decided 2026-07-10) — Reject/decompose `full` when credits enabled
- **Why:** `settleCompletedUsage` settles *after* the whole pipeline, so a single `full` job runs the timing phase's OpenAI calls **before** clamping — Block A exhaustion cannot stop Block B within one job. This re-opens H1 for the `full` entry point (the server's default phase; not used by the current staged run-all UI, but accepted by the API). **Evidence:** `lib/ai/transcribe-job.js:38` (`full → [transcribe,enrich,time]`), `:58-91` (post-pipeline settlement loop, no mid-`full` gate).
- **Decision (2026-07-10):** **Reject `phase:"full"` when `isCreditsEnabled()`** (preferred) — the transcribe route returns a clear 400/409 directing callers to the staged `transcribe→enrich→time` flow the client already uses; acceptable alternative is to internally **decompose** `full` into that staged, block-gated sequence so the timing block is start-gated after Block A. When credits are **disabled**, `full` behaves exactly as today.
- **Files:** `app/api/ai/transcribe/route.js` (guard), optionally `lib/ai/transcribe-job.js` (if decomposing), + tests.
- **Tests:** credits on → a `full` request is rejected/decomposed so timing never runs uncharged after Block A exhaustion; credits off → `full` unchanged; staged flow unaffected.
- **Completion:** no code path runs timing OpenAI work then writes it off after Block A exhausts the balance. **REP-201 is not Validated until REP-201a lands.** (Sub-fix of REP-201 — does not change the 26-item count.)

### REP-202 — Remediation tooling for `accountingStatus:"unresolved"`
- **Severity:** High. **Audit ref:** H2 / R2.
- **Evidence:** `lib/ai/transcribe-job.js:76-87` (marks `unresolved`); `scripts/ledger-repair.mjs` (top-ups only); no `app/api/admin/*`; `ENABLE_ADMIN_TOOLS`/`sumup-refunds.js` unused.
- **Scope narrowed by D-A:** after REP-201, insufficient balance no longer produces `unresolved` (it clamps to zero). `unresolved` now only arises from a **transient settlement/DB error**, so this tool's job is to re-settle those and, where needed, apply a `MANUAL_ADJUSTMENT`. Still required (transient errors happen), but smaller.
- **Form (D-B):** **dry-run script only** — `scripts/ai-settle-repair.mjs`; no admin route/HTTP surface in this programme.
- **Affected behaviour:** transient-error `unresolved` AI work has no supported reconciliation path other than manual MongoDB edits.
- **Affected files/modules:** new `scripts/ai-settle-repair.mjs` (dry-run default); reuses `lib/credits/credit-service.js` `settlePhase`, `lib/ledger/balance-ledger.js` `MANUAL_ADJUSTMENT`. (No `app/api/admin/*` — deferred per D-B.)
- **Root cause:** Recovery path specified in plan §16 was never implemented.
- **Exact target behaviour:** An operator can list `unresolved` jobs/generations and idempotently re-run `settlePhase`, or apply a `MANUAL_ADJUSTMENT`, with a dry-run default and no double debit.
- **Repair strategy:** Dry-run script that scans jobs/generations with `accountingStatus:"unresolved"` (and/or uncharged finalized `UsageRecord`s), recomputes the phase debit, and re-settles idempotently under `--apply`.
- **Ordered steps:** 1) Confirm D-B. 2) Build read-only scanner + summary JSON. 3) Add idempotent re-settle under `--apply` reusing `settlePhase`. 4) Add npm alias `credits:ai-settle-repair`. 5) Document in `CREDITS_SETUP.md`.
- **Risks:** Double-charging if not idempotent — must rely on the existing `ai_debit:{jobId}:{phase}` key.
- **Required tests:** re-settle is idempotent (no second debit); balance moves correctly once; dry-run writes nothing.
- **Rollback/remediation:** ledger is append-only; corrections via `MANUAL_ADJUSTMENT`.
- **Completion criteria:** A documented, tested, dry-run-default tool resolves transient-error `unresolved` accounting.
- **Dependencies:** REP-201 (defines the residual state). **Decision:** D-B recorded (script). **User approval required:** recorded.

### REP-203 — Record OpenAI usage only on successful responses
- **Severity:** Low. **Audit ref:** L1.
- **Evidence:** `lib/ai/openai-lyrics.js:1672-1683` and `:1817-1826` (`recordOpenAiCallUsage` runs before `if (!response.ok) throw`).
- **Affected behaviour:** Failed audio transcription calls write a `UsageRecord` with a full audio-minute `rawCostMicros` (never charged, but pollutes the audit spine).
- **Affected files/modules:** `lib/ai/openai-lyrics.js` (all 8 call sites), `lib/ai/openai-usage.js` (optional guard).
- **Root cause:** Usage capture is placed before the response-ok check.
- **Exact target behaviour:** Usage is recorded only for `response.ok` responses; failed calls record nothing (or an explicit `charged:false, rawCostMicros:0` audit row).
- **Repair strategy:** Move `recordOpenAiCallUsage` after the `response.ok` check at each site, or pass an `ok` flag and no-op on failure.
- **Ordered steps:** 1) Adjust each call site. 2) Verify success path unchanged.
- **Risks:** Missing a legitimate partial-usage case; keep behaviour identical for ok responses.
- **Required tests:** failed audio call writes no phantom-cost `UsageRecord`; successful call unchanged.
- **Rollback/remediation:** revert the site moves.
- **Completion criteria:** No `UsageRecord` with cost for a failed call.
- **Dependencies:** none. **User approval required:** no.

### REP-204 — Complete the audio-seconds fallback chain
- **Severity:** Low. **Audit ref:** L5.
- **Evidence:** `lib/ai/openai-lyrics.js:1124,2032` pass only `audio.duration`; plan §11.1 specifies metadata `durationSec` → server `ffprobe` fallbacks not used at call sites.
- **Affected behaviour:** A generation with `audio.duration=0/absent` records audio calls as `usageType:"none", cost 0` (cost under-capture).
- **Affected files/modules:** `lib/ai/transcribe-job.js` (source metadata already available), `lib/ai/openai-lyrics.js` (thread fallback), reuse `lib/files.js` ffprobe.
- **Root cause:** Only one fallback level implemented.
- **Exact target behaviour:** Fallback order request/segment duration → asset `metadata.durationSec` → project audio duration → server `ffprobe`; first finite-positive value wins.
- **Repair strategy:** Thread `metadata.durationSec` into the pipeline; add an ffprobe fallback only when all else is missing.
- **Ordered steps:** 1) Pass metadata duration from `transcribe-job`. 2) Extend `audioSeconds` resolution. 3) Optional ffprobe last-resort.
- **Risks:** Extra ffprobe latency — keep it last-resort.
- **Required tests:** upload with `durationSec:null` but real ffprobe value → nonzero cost; each fallback level covered.
- **Rollback/remediation:** revert threading.
- **Completion criteria:** No zero-cost audio call when a real duration is obtainable.
- **Dependencies:** none. **User approval required:** no.

### REP-205 — Historical `balanceAfterMinor` accuracy in `ledger-repair`
- **Severity:** Low. **Audit ref:** L7.
- **Evidence:** `scripts/ledger-repair.mjs:78` stamps current balance for a backfilled historical row.
- **Affected behaviour:** Repaired audit rows carry an approximate `balanceAfterMinor` (safe — no balance change — but imprecise/identical across rows).
- **Affected files/modules:** `scripts/ledger-repair.mjs`.
- **Root cause:** Single balance snapshot reused for all repairs.
- **Exact target behaviour:** Either derive a best-effort chronological `balanceAfterMinor`, or explicitly stamp `metadata.repairedHistoricalEntry:true` and document that `balanceAfterMinor` is indicative for repaired rows.
- **Repair strategy:** Minimal — document the limitation and set a clear metadata flag (already partly present); do not attempt full historical reconstruction unless cheap.
- **Ordered steps:** 1) Add/confirm metadata flag. 2) Document in script help + `CREDITS_SETUP.md`.
- **Risks:** none (audit-only).
- **Required tests:** repaired row carries the flag; balance untouched.
- **Rollback/remediation:** revert.
- **Completion criteria:** Repaired rows are unambiguously marked and documented.
- **Dependencies:** none. **User approval required:** no.

### REP-206 — Keep precheck model list in sync with live models; prove price-version reproducibility
- **Severity:** Low. **Audit ref:** Audit §11.
- **Evidence:** `lib/credits/credit-service.js:26-52` hardcodes per-phase model lists that must match `lib/ai/openai-lyrics.js` model constants; drift over-blocks (priced-but-unused) or fails-closed mid-run (used-but-unpriced).
- **Affected behaviour:** Model drift causes spurious `pricing_unavailable` blocks or mid-run fail-closed.
- **Affected files/modules:** `lib/credits/credit-service.js`, `lib/ai/openai-lyrics.js` (export model constants), a guard test.
- **Root cause:** Two independent model lists with no cross-check.
- **Exact target behaviour:** A single source of truth (or a test) guarantees every model `openai-lyrics.js` can call is in the precheck list and priced; price-table version is stored per charge (already in metadata) and reproducible.
- **Repair strategy:** Export the model constants from `openai-lyrics.js` and derive the precheck list, or add a test asserting equality.
- **Ordered steps:** 1) Enumerate live model constants. 2) Add cross-check test / shared constant. 3) Verify precheck covers all + env overrides.
- **Risks:** low.
- **Required tests:** every live model is priced/prechecked; env-override model is covered.
- **Rollback/remediation:** revert.
- **Completion criteria:** No possible priced/called-model mismatch; test enforces it.
- **Dependencies:** none. **User approval required:** no.

---

## STAGE 3 — Payment & Exactly-Once Fulfilment

### REP-301 — Throttle (and consider gating) the checkout route
- **Severity:** High. **Audit ref:** H3 / R3.
- **Evidence:** `app/api/credits/checkout/route.js:59-134` (no rate limit / no auth); reuse window keys on `(amountMinor, currency)` (`lib/payments/payment-orders.js:35-60`), defeatable by iterating amounts.
- **Affected behaviour:** Unauthenticated caller can force up to ~10,000 SumUp hosted-checkout creations + `PaymentOrder` rows per window (external paid-API/quota drain, DB growth).
- **Affected files/modules:** `app/api/credits/checkout/route.js`, reuse `lib/credits/rate-limit.js` (distinct key namespace).
- **Root cause:** Public mutation route with only bounds + amount-keyed reuse.
- **Exact target behaviour:** Per-IP/session fixed-window limit on checkout creation; legitimate single top-ups unaffected. Optionally require the unlock cookie (product choice — top-ups are currently open by D2, so default is rate-limit only).
- **Repair strategy:** Add a `checkout`-namespaced call to the existing limiter before creating a new (non-reused) order.
- **Ordered steps:** 1) Add limiter check keyed by IP+session. 2) Return `429` with `retryAfter`. 3) Keep reuse-window fast path.
- **Risks:** Too-tight limits block real retries — pick conservative defaults + env override.
- **Required tests:** burst of distinct amounts throttled; single top-up passes; reuse still works.
- **Rollback/remediation:** remove the limiter call.
- **Completion criteria:** Checkout creation is bounded per client.
- **Dependencies:** none. **User approval required:** no (confirm thresholds).

### REP-302 — Quick-ack the SumUp webhook before verifying
- **Severity:** Low. **Audit ref:** L3 / R10.
- **Evidence:** `app/api/webhooks/sumup/route.js:106` awaits full re-query + credit before returning 200.
- **Affected behaviour:** A slow SumUp re-query can delay the ack and trigger SumUp webhook retries.
- **Affected files/modules:** `app/api/webhooks/sumup/route.js`.
- **Root cause:** Verification is synchronous with the ack.
- **Exact target behaviour:** Persist the `WebhookEvent`, return `{received:true}` promptly, then run verification (fire-and-forget or deferred) — exactly-once already guaranteed by the return-page poll + idempotency key.
- **Repair strategy:** Ack first; kick verification without blocking the response (still idempotent).
- **Ordered steps:** 1) Store event + ack. 2) Run `refreshPaymentOrderFromSumUp` after responding. 3) Preserve safe-status updates.
- **Risks:** Background verification errors must still be logged; ensure no double-credit (idempotency covers it). Depends on REP-303 confirming SumUp's retry expectations.
- **Required tests:** webhook acks fast; credit still applied exactly once; duplicate/slow paths safe.
- **Rollback/remediation:** revert to synchronous verify.
- **Completion criteria:** Webhook acks without waiting on SumUp re-query; exactly-once preserved.
- **Dependencies:** REP-303 (verify semantics first). **User approval required:** no.

### REP-303 — Verify SumUp `redirect_url`/`return_url` semantics
- **Severity:** Info → verify. **Audit ref:** §12 / §18.
- **Evidence:** `lib/payments/sumup-client.js:96-104` sends `redirect_url`=return page, `return_url`=webhook; which SumUp treats as the webhook trigger is unverified.
- **Affected behaviour:** If mis-wired, the browser could land on the webhook URL and/or the webhook may not fire (crediting still works via the return-page poll re-query).
- **Affected files/modules:** `lib/payments/sumup-client.js`, `lib/payments/payment-urls.js` (only if a swap is needed).
- **Root cause:** Ported prototype wiring not validated against live SumUp.
- **Exact target behaviour:** Confirmed correct field mapping against SumUp's live Hosted Checkout contract; swap if wrong.
- **Repair strategy:** Sandbox verification (part of E2E); adjust field mapping only if the sandbox proves the swap. **Investigation-first**; code change is conditional.
- **Ordered steps:** 1) Sandbox checkout; observe redirect + webhook. 2) If wrong, swap field mapping + retest.
- **Risks:** Changing mapping without a sandbox result could break both paths — only change on evidence.
- **Required tests:** sandbox redirect lands on `/payment/return`; webhook hits `/api/webhooks/sumup`.
- **Rollback/remediation:** revert mapping.
- **Completion criteria:** Field mapping validated in sandbox; documented.
- **Dependencies:** sandbox creds (REP-803 checklist). **User approval required:** no.

---

## STAGE 4 — Security & Authorization

### REP-401 — Add `Secure` to the unlock cookie in production
- **Severity:** Medium. **Audit ref:** M2 / R5.
- **Evidence:** `lib/credits/unlock-cookie.js:87-95` (no `Secure`); plan §5.1 required it.
- **Affected behaviour:** The signed generation-unlock token (authorises paid generation) can be intercepted/replayed over a plain-HTTP hop.
- **Affected files/modules:** `lib/credits/unlock-cookie.js`.
- **Root cause:** `Secure` omitted from the cookie builder.
- **Exact target behaviour:** Cookie includes `Secure` in production (e.g. when `NODE_ENV==="production"` or `APP_BASE_URL` is https), `HttpOnly; SameSite=Lax` retained.
- **Repair strategy:** Append `Secure` conditionally in `buildGenerationUnlockSetCookie`.
- **Ordered steps:** 1) Add conditional `Secure`. 2) Keep dev/localhost usable.
- **Risks:** Setting `Secure` on http-localhost breaks local unlock — gate on env.
- **Required tests:** cookie string includes `Secure` in prod mode, omits on localhost.
- **Rollback/remediation:** revert.
- **Completion criteria:** Production unlock cookie is `Secure`.
- **Dependencies:** none. **User approval required:** no.

### REP-402 — Enforce `CREDITS_ENABLED` on payment/persistence/dashboard/media routes
- **Severity:** Medium. **Audit ref:** M4 / R7.
- **Evidence:** `app/api/credits/checkout/route.js`, `app/api/credits/orders/[orderId]/route.js`, `app/api/webhooks/sumup/route.js`, `app/api/dashboard/state/route.js`, `app/api/dashboard/generations/[id]/route.js`, `app/api/media/generations/[id]/route.js` — none call `isCreditsEnabled()`.
- **Affected behaviour:** With the flag off but backends configured, these routes remain live (webhook could even credit the balance).
- **Affected files/modules:** the six routes above; `lib/credits/flags.js`.
- **Root cause:** Kill-switch only checked on generation-charging/balance/unlock.
- **Exact target behaviour:** With `CREDITS_ENABLED=false`, mutation/payment routes return disabled (e.g. 404/`{enabled:false}`) and perform no reads/writes; the disabled path executes no new logic (plan §14/§23). **Sub-decision (implementer default):** when the flag is off, the public `/dashboard` + `state`/`media` routes go **inert/empty** (return `{cards:[]}` / 404), matching "no new read/write path executes"; adopt this unless the owner wants the public dashboard to remain live independently of the charging flag.
- **Repair strategy:** Add an early `isCreditsEnabled()` guard to each route (dashboard/media return empty/404 to keep the page inert).
- **Ordered steps:** 1) Add guard to each route. 2) Preserve current behaviour when enabled.
- **Risks:** Over-disabling the public dashboard when intentionally left on — decide dashboard behaviour when flag off (recommend inert/empty).
- **Required tests:** each route returns disabled with flag off; unchanged with flag on.
- **Rollback/remediation:** remove guards.
- **Completion criteria:** No new read/write path executes when `CREDITS_ENABLED=false`.
- **Dependencies:** none. **User approval required:** no.

### REP-403 — Sanitise public card title; drop `sourceType` from the public serializer
- **Severity:** Medium. **Audit ref:** M3 / R6.
- **Evidence:** `lib/generations/serialize-generation.js:30-49` (returns `sourceType`); `lib/generations/persist-generation.js:47-63` (`inferTitle` = upload filename / video title).
- **Affected behaviour:** World-readable dashboard exposes users' original upload filenames and provenance (plan §10.2 forbade `sourceType`).
- **Affected files/modules:** `lib/generations/serialize-generation.js`, `lib/generations/persist-generation.js`.
- **Root cause:** Public projection includes `sourceType`; title defaults to the raw filename.
- **Exact target behaviour (D-C — user-entered title required to publish):** a generation is public **only if the user set an explicit title** in the save flow; with no user title it stays untitled and **non-public** (`public:false`). The raw upload filename / YouTube title is **never** used as the public title, and `serializePublicCard` **omits `sourceType`** entirely.
- **Repair strategy:** stop defaulting the public title to `inferTitle` (filename/video title); require a user-supplied title to set `public:true`; drop `sourceType` from the public projection. Keep an internal `title`/provenance field if useful, but never expose it publicly without a user title.
- **Ordered steps:** 1) Add a user title field to the save flow (`editor-shell.js` save/toggle) and thread it to `persistGeneration`. 2) Set `public:true` only when a non-empty user title is present; else `public:false`. 3) Drop `sourceType` from `serializePublicCard`. 4) Update the serializer leak test + a "no user title ⇒ not public" test. 5) Decide back-fill for existing rows (recommend: existing untitled/filename-titled rows default to `public:false` on read until re-titled).
- **Risks:** existing generations with filename titles must not leak — default them non-public. Save-flow UI must make the title requirement clear.
- **Required tests:** leak test asserts no `sourceType`; a generation without a user title is not returned by `/api/dashboard/state`; a user-titled one is.
- **Rollback/remediation:** revert projection + gating.
- **Completion criteria:** No raw filename or `sourceType` on public cards; only user-titled generations are public.
- **Dependencies:** D-C recorded. **User approval required:** recorded.

### REP-404 — Close SSRF DNS-rebinding TOCTOU in the media fetcher
- **Severity:** Low. **Audit ref:** L2 / R9.
- **Evidence:** `lib/youtube-audio/media-fetcher.js:410-446` validates the resolved IP, then `:84` `fetch()` re-resolves by hostname independently.
- **Affected behaviour:** A provider-supplied hostname with low-TTL rebinding could pass validation then connect to a private IP.
- **Affected files/modules:** `lib/youtube-audio/media-fetcher.js`.
- **Root cause:** Validate-then-fetch resolves DNS twice.
- **Exact target behaviour:** Resolve once, connect to the pinned validated IP (with `Host` header), or use a custom lookup/agent that reuses the validated address.
- **Repair strategy:** Pin the resolved address into the fetch (custom `lookup`/agent or connect-by-IP + Host header), keeping all existing per-hop checks.
- **Ordered steps:** 1) Capture the validated address. 2) Pin it for the connection. 3) Preserve redirect re-validation.
- **Risks:** TLS SNI/cert hostname must remain the original host; test https targets.
- **Required tests:** rebinding attempt (validation host public, connect host private) is blocked; normal fetch works.
- **Rollback/remediation:** revert to hostname fetch.
- **Completion criteria:** No connect to an unvalidated IP.
- **Dependencies:** none. **User approval required:** no.

### REP-405 — Protect/limit the public order re-query route
- **Severity:** Low. **Audit ref:** L4.
- **Evidence:** `app/api/credits/orders/[orderId]/route.js:26-46` re-queries SumUp for any guessable `order_<ObjectId>` and returns amount/status.
- **Affected behaviour:** Info disclosure of order status/amount + external-API amplification via enumeration.
- **Affected files/modules:** `app/api/credits/orders/[orderId]/route.js`, reuse `lib/credits/rate-limit.js`.
- **Root cause:** Unbounded public re-query keyed by a semi-guessable reference.
- **Exact target behaviour:** Rate-limit the route per IP; cache/short-circuit re-query for terminal orders (`PAID`/failed/expired) so polling doesn't hammer SumUp.
- **Repair strategy:** Add limiter + skip re-query when the order is already terminal.
- **Ordered steps:** 1) Add limiter. 2) Return stored state without re-query for terminal orders.
- **Risks:** Return page must still converge — keep re-query for pending.
- **Required tests:** enumeration is throttled; terminal order returns without re-query; pending still re-queries.
- **Rollback/remediation:** remove guard.
- **Completion criteria:** Bounded re-query; reduced disclosure.
- **Dependencies:** none. **User approval required:** no.

### REP-406 — Rate-limit the unlock route (brute-force)
- **Severity:** Low. **Audit ref:** §15.
- **Evidence:** `app/api/credits/unlock/route.js:12-47` has no throttle on password attempts.
- **Affected behaviour:** Unthrottled guessing of the shared generation password.
- **Affected files/modules:** `app/api/credits/unlock/route.js`, reuse `lib/credits/rate-limit.js`.
- **Root cause:** No attempt limiter on unlock.
- **Exact target behaviour:** Per-IP attempt limit with backoff; timing-safe compare retained.
- **Repair strategy:** Add limiter keyed to IP before password check.
- **Ordered steps:** 1) Add limiter. 2) Return 429 on excess.
- **Risks:** Legit retries — pick generous limits.
- **Required tests:** repeated wrong passwords get throttled; correct password within limit succeeds.
- **Rollback/remediation:** remove limiter.
- **Completion criteria:** Brute-force is bounded.
- **Dependencies:** none. **User approval required:** no.

### REP-407 — Harden `assetId` containment (pre-existing)
- **Severity:** Low (pre-existing, not introduced by the merge). **Audit ref:** §15.
- **Evidence:** `app/api/ai/transcribe/route.js:185-186` does not charset-validate `audioAssetId` before `readAssetMetadata`; `lib/files.js` `getMetadataPath`/`getAssetFilePath` join raw ids/`storedFileName` without an explicit containment check (mitigated in practice by `findSessionIdForAsset` charset validation and internal filename generation).
- **Affected behaviour:** Theoretical path traversal via a crafted `assetId`/`sessionId` if a matching `<x>.json` exists on disk.
- **Affected files/modules:** `app/api/ai/transcribe/route.js`, `lib/files.js`.
- **Root cause:** Raw ids joined into paths without a shared containment guard.
- **Exact target behaviour:** Reject non-`[A-Za-z0-9_-]` `assetId` at intake; assert `getAssetFilePath` resolves inside the session dir.
- **Repair strategy:** Add the same charset guard used in `findSessionIdForAsset` at the transcribe intake and a realpath-containment check in `getAssetFilePath`.
- **Ordered steps:** 1) Add intake charset guard at the transcribe route. 2) Add realpath-containment assertion in `getAssetFilePath`. 3) Test.
- **Risks:** Must not break legitimate UUID assetIds.
- **Required tests:** traversal-shaped `assetId` rejected; normal assetId works.
- **Rollback/remediation:** revert guards.
- **Completion criteria:** No raw-id path join reachable from a request.
- **Dependencies:** none. **Decision:** D-D recorded — **fix now** (minimal guard). **User approval required:** recorded.

---

## STAGE 5 — MongoDB, R2 & Recovery Integrity

### REP-501 — Unique partial index on `Generation.finalJobId`
- **Severity:** Low. **Audit ref:** L6 / R11.
- **Evidence:** `lib/models/Generation.js:182` indexes `finalJobId` non-unique; `lib/generations/persist-generation.js:278-333` guards duplicates only via an in-transaction `findOne`.
- **Affected behaviour:** Concurrent persists for the same `finalJobId` could each miss the other's uncommitted doc and create two `Generation`s.
- **Affected files/modules:** `lib/models/Generation.js` (schema index only — **note:** this is a schema change; the coding agent, not this planner, may make it).
- **Root cause:** No DB-level uniqueness on the dedup key.
- **Exact target behaviour:** A unique partial index on `finalJobId` prevents duplicates at the DB level; persist handles the duplicate-key error idempotently.
- **Repair strategy:** Add a unique partial index; catch `E11000` in `persistGeneration` and return the existing doc.
- **Ordered steps:** 1) Add unique partial index. 2) Handle duplicate-key in persist. 3) Rebuild indexes via `initializeDatabaseIndexes`.
- **Risks:** Existing duplicate data would block index build — check first.
- **Required tests:** concurrent persist for the same `finalJobId` yields one doc; second returns the existing.
- **Rollback/remediation:** drop the index.
- **Completion criteria:** Duplicate generations are impossible per `finalJobId`.
- **Dependencies:** none. **User approval required:** no (schema-index change — implementer executes).

### REP-502 — Recover R2-create-after-sweep (asset expired before promotion)
- **Severity:** Low. **Audit ref:** §10 / §14.
- **Evidence:** `lib/generations/persist-generation.js:346-353` reads the asset via `getAssetFilePath` after commit; if the session was swept, `putGenerationAudioObject` records `create_failed` with no source to reconcile (`lib/r2/audio-r2-lifecycle.js:168-177`).
- **Affected behaviour:** A saved generation whose source asset expired between commit and R2 promotion becomes permanently `create_failed` (no playable audio).
- **Affected files/modules:** `lib/ai/transcribe-job.js` (keepalive timing), `lib/generations/persist-generation.js`, `lib/r2/audio-r2-lifecycle.js`.
- **Root cause:** Narrow window where the ephemeral asset can be swept before R2 promotion; reconcile needs a source that no longer exists.
- **Exact target behaviour:** Promote to R2 before (or immediately after) the persistence commit while the session is guaranteed warm, or retain the source bytes until R2 `created`, so no saved generation is left without recoverable audio.
- **Repair strategy:** Ensure `touchSession` immediately before promotion, or copy the bytes into a durable temp before commit and promote from there; mark clearly if truly unrecoverable.
- **Ordered steps:** 1) Add a session touch right before promotion. 2) Optionally stage bytes in a retained temp. 3) Reconcile from the retained copy.
- **Risks:** Extra disk churn — bound the retained temp lifetime.
- **Required tests:** promotion succeeds even when the normal TTL would have swept; reconcile recovers from the retained source.
- **Rollback/remediation:** revert to post-commit read.
- **Completion criteria:** No saved generation is permanently audio-less due to a sweep race.
- **Dependencies:** none. **User approval required:** no.

---

## STAGE 6 — Cross-Phase Asset & Lifecycle

### REP-601 — Wire `sweepStaleYoutubeAudioResults` into the runtime
- **Severity:** Medium. **Audit ref:** M1 / R4.
- **Evidence:** `lib/youtube-audio/storage.js:91-129` defined but referenced only by its unit test (repo-wide grep: no runtime caller); plan §8.6 required it be called from POST/status routes.
- **Affected behaviour:** Result `.mp3` files orphaned by a server restart (in-memory jobs lost) accumulate unbounded in `<tmp>/reel-creator-youtube-audio/results`.
- **Affected files/modules:** `app/api/youtube-audio-segments/route.js` (POST) and/or `app/api/youtube-audio-segments/[jobId]/route.js`.
- **Root cause:** The stale-dir sweeper was implemented but never invoked.
- **Exact target behaviour:** Result files older than `JOB_TTL_MS + grace` are swept during normal request handling (e.g. best-effort in POST after `pruneExpiredJobs`), including files with no live job object.
- **Repair strategy:** Call `sweepStaleYoutubeAudioResults()` (best-effort, non-blocking) from the POST route (and/or status route), consistent with existing prune placement.
- **Ordered steps:** 1) Import + call in POST after prune. 2) Ensure failures don't break the request. 3) Keep it bounded/throttled.
- **Risks:** Deleting an in-use result — the grace window + `deleteStoredResult` ownership already protect live jobs.
- **Required tests:** sweeper is invoked from the route; orphan older than cutoff deleted; fresh file retained.
- **Rollback/remediation:** remove the call.
- **Completion criteria:** Orphaned result files are cleaned after restart.
- **Dependencies:** none. **User approval required:** no.

---

## STAGE 7 — Test & Validation Gaps

### REP-701 — Close standalone test/validation gaps
- **Severity:** Medium. **Audit ref:** §16.
- **Evidence:** audit §16 — H1 not asserted as a guarded invariant; M1 absence-of-caller not asserted; no tests for checkout throttle, unlock brute-force, kill-switch route gating, or concurrent `persistGeneration` dedup; mocked-infrastructure caveat undocumented.
- **Affected behaviour:** Regressions in the above could ship undetected.
- **Affected files/modules:** test files paired with each repair (`lib/credits/*`, `lib/ai/*`, `app/api/**/route.test.js`, `lib/youtube-audio/*`, `lib/generations/*`).
- **Root cause:** Coverage gaps at the money-model edges and route protections.
- **Exact target behaviour:** Each repair below lands with the specified tests, and the full suite stays green:
  - REP-201 → clamp-to-zero + block-boundary guarded invariants: cost>balance clamps to 0 (never negative) and records `writeOffMinor`; a "run all" that zeroes balance during Block A finishes `enrich` then blocks `time` (402); top-up debits still reject on insufficient (unchanged).
  - REP-601 → sweeper is invoked from a route.
  - REP-301/REP-406/REP-405 → throttle/brute-force/enumeration tests.
  - REP-402 → kill-switch route-gating tests.
  - REP-501 → concurrent persist dedup.
  - Document the mocked-vs-real infrastructure limitation (mongodb-memory-server, mocked SumUp/R2/OpenAI) in `CREDITS_SETUP.md`/progress.
- **Repair strategy:** Treat as an acceptance checklist over the code repairs; add any missing standalone tests; run the full suite.
- **Ordered steps:** 1) Confirm each repair shipped its tests. 2) Add the mocked-infra caveat doc. 3) Full `npm test`.
- **Risks:** Flaky RS harness — keep deterministic.
- **Required tests:** the union above; `npm test` green.
- **Rollback/remediation:** n/a (tests only).
- **Completion criteria:** All listed invariants asserted; suite green.
- **Dependencies:** REP-201, REP-301, REP-402, REP-405, REP-406, REP-501, REP-601. **User approval required:** no.

---

## STAGE 8 — Operational & Documentation

### REP-801 — Align `GEN_RATE` defaults between `.env.example` and code
- **Severity:** Low. **Audit ref:** §17. **Evidence:** `.env.example:43-44` (20/3600) vs `lib/credits/rate-limit.js:1-2` (10/60). **Target:** one documented default set (env wins at runtime; make example and code consistent or document intentional divergence). **Files:** `.env.example`, `lib/credits/rate-limit.js` (**note:** `.env.example` is an env file the coding agent edits, not this planner). **Tests:** default config matches docs. **User approval:** no.

### REP-802 — Document backup/recovery, R2 lifecycle, deployment order/rollback
- **Severity:** Low. **Audit ref:** §17. **Evidence:** `CREDITS_SETUP.md` lacks Mongo backup/PITR, R2 retention, deployment order. **Target:** add ops sections. **Files:** `CREDITS_SETUP.md`, `README.md`. **Tests:** doc review. **User approval:** no.

### REP-803 — Add the audit §22 sandbox E2E checklist to `CREDITS_SETUP.md`
- **Severity:** Medium. **Audit ref:** §22. **Evidence:** existing §7 baseline lacks race/duplicate/mismatch/H1/kill-switch/orphan cases. **Target:** incorporate the §22 amendments (both-path exactly-once + race, partial-failure charge, H1 low-balance long-audio go/no-go, insufficient-balance/403/429, R2 both-direction reconcile, deletion path, standalone-Mongo fail-closed, pricing coverage, orphan cleanup). **Files:** `CREDITS_SETUP.md`. **Tests:** doc review. **User approval:** no.

### REP-804 — Bound the rate-limit map; document per-process/multi-instance + XFF trust
- **Severity:** Low. **Audit ref:** L8/L9. **Evidence:** `lib/credits/rate-limit.js:4-9` (unbounded map, per-process), `app/api/ai/transcribe/route.js:104-112` (first XFF hop). **Target:** evict expired keys (bounded memory); document that the limiter is per-process (multi-instance ⇒ limit × instances) and that XFF requires a trusted proxy. **Files:** `lib/credits/rate-limit.js`, `CREDITS_SETUP.md`. **Tests:** expired keys evicted; behaviour unchanged for active windows. **User approval:** no.

### REP-805 — Reconcile the OpenAI price seed table before enablement
- **Severity:** Gate. **Audit ref:** §11 / `CREDITS_SETUP.md` §3. **Evidence:** `lib/ai/openai-pricing.js:5` version `openai-seed-2026-07-09-user-review-required`. **Target (D-F recorded):** before enablement the operator reviews every configured/called model against live OpenAI pricing and sets `OPENAI_PRICE_TABLE_JSON` or updates the seed + version; **code stays fail-closed** on any unpriced model (already implemented — this is a hard pre-live gate, not a code change beyond values). **Files:** `lib/ai/openai-pricing.js` and/or env (operator-owned). **Tests:** price-table version stored per charge; all models priced. **Dependencies:** none blocking. **User approval:** recorded (operator owns values).

---

## STAGE 9 — Non-Blocking UI / Polish

### REP-901 — Generation deletion (D-E: script-only — deferred)
- **Severity:** Low. **Audit ref:** §19 (plan deviation). **Decision:** **D-E recorded — keep deletion script-only for now; defer the route/UI.**
- **Evidence:** no DELETE handler; deletion is manual DB `deletedAt` + `r2-reconcile` (already works; R2 lifecycle correctness does not require a route).
- **Scope for this programme:** **no code change.** Document the supported deletion procedure (set `deletedAt`, run `r2-reconcile` to remove the R2 object, then hard-delete) in `CREDITS_SETUP.md` (folds into REP-802). A first-class authorised DELETE route + UI is an explicit **follow-up**, not part of this repair programme.
- **If later productised (follow-up):** authorised DELETE (`app/api/dashboard/generations/[id]`) that sets `deletedAt`/`deleteRequestedAt` → `deleteGenerationAudioObject` → hard-delete only after R2 removal; must be authorised (not public).
- **Dependencies:** D-E recorded (defer). **Status:** Deferred. **User approval:** recorded.

---

## 6. Final Regression Strategy

After each stage and before the release gate:
1. `npm test` — full Vitest suite must stay green (baseline 53 files / 331 tests; count grows with new tests). No previously passing test may regress.
2. `npm run lint` — exit 0.
3. `npm run build` — exit 0; all Phase 1 + Phase 2 routes compile.
4. **Disabled-flag parity:** with `CREDITS_ENABLED=false`, confirm generation/editor/audio/project/render/export/Phase-1 behaviour is byte-for-byte unchanged (no new read/write path executes — REP-402 strengthens this).
5. **Phase-1 non-regression:** YouTube import → asset → waveform/timing/pipeline/preview/export parity with manual upload.
6. **Money invariants:** ledger never negative; idempotent; concurrent debits serialize; replay divergence flagged; exactly-once top-ups; no double charge under retry/re-adopt/resume.
7. Re-run the paired tests for every repair touched in the stage.

## 7. Stage Completion Rule

A stage is complete only when every non-deferred repair in it is **Validated** in `REPAIR_PROGRESS.md` (code + tests + acceptance), the full regression suite (§6) is green, and any required decisions are recorded. Deferred/Blocked items must carry an explicit reason and resume point.

## 8. Sandbox E2E Readiness Gate

Sandbox E2E **may begin now** (audit verdict) and must be **re-run after Stages 2–6** with the REP-803 expanded checklist, using sandbox SumUp + a real/RS Mongo + R2 sandbox + a real OpenAI key:
- Top-up exactly-once across webhook + return + race + duplicate; amount/currency/merchant mismatch rejected.
- Charging: ledger debits == summed `UsageRecord` for completed phases; partial-failure charges completed phases only; retry/re-adopt no double debit.
- **H1 go/no-go (post REP-201, clamp model):** a run whose cost exceeds balance zeroes the balance (never negative), keeps the work, records `writeOffMinor`, and blocks the next block/generation; a "run all" that zeroes balance during Block A (transcribe+translate) still finishes Block A then blocks Block B (timing) with 402.
- 402/403/429 gates fire; disabled-flag route parity (post REP-402).
- Persistence/R2: saved gen on `/dashboard` with playable audio + open-in-editor; toggle-off persists nothing; forced R2 failure repaired by `r2-reconcile` both directions.
- Standalone Mongo → `TRANSACTIONS_UNSUPPORTED` fail-closed.
- Orphan YT result cleanup after restart (post REP-601).
- Pricing coverage: every called/configured model priced; missing fails closed.
- `unresolved` remediation tool resolves a seeded unresolved job (post REP-202).

## 9. Final Release-Readiness Gate (before `CREDITS_ENABLED=true` in production)

All must hold:
1. Stages 2–6 all **Validated**; Stage 7 tests green; §6 regression green.
2. Stage 8 docs updated; **REP-805 pricing reconciled** (D-F recorded).
3. Sandbox E2E (§8) passed, including the H1 go/no-go and the `unresolved` remediation drill.
4. Unresolved decisions D-A…D-F recorded/closed (or the dependent repair explicitly deferred with sign-off).
5. Independent audit sign-off recorded in `REPAIR_PROGRESS.md` → Final Audit Sign-Off.
6. Rollback confirmed: `CREDITS_ENABLED=false` fully disables the layer; ledger append-only.

---

**End of Repair Plan. No application, prototype, test, configuration, schema, dependency, environment, or phase-document file was modified in producing this plan.**
