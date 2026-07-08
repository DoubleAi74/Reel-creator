# Credit Dashboard Merge — Phase 2 Progress Tracker

**Mirrors**: `IMPLEMENTATION_PLAN.md` (same folder). Read that first.
**Phase status**: PLANNING COMPLETE — awaiting user approval of the plan. **Implementation NOT started** (and must not start until Phase 1 is complete & accepted).
**Current stage**: Pre-Stage-0 (approval + Phase-1 reconciliation pending).
**Last verified checkpoint**: Live-code inspection of main app (AI/asset/job) + Credit prototype (money/ledger/payments/R2/dashboard) completed 2026-07-08; all 8 foundational decisions confirmed by user; plan drafted.
**Next action**: User approves plan → fresh implementation agent runs §20 reconciliation against post-Phase-1 code → Stage 0.
**Blockers**: (1) Phase 1 not yet implemented/accepted. (2) Lower-tier `[DEFAULT — confirm]` items may need user sign-off. (3) Pricing pence values are user-owned data.

Status legend: `Not started` / `In progress` / `Implemented, not validated` / `Validated` / `Blocked` / `Deferred` / `Superseded`.

---

## Decision Records
- DR1 (Identity): Shared global GBP balance + shared password; no accounts. **Confirmed 2026-07-08.**
- DR2 (Password scope): Gates generation start ONLY; top-ups + viewing + dashboard open; dashboard world-readable. **Confirmed.**
- DR3 (Charge timing): Per phase, on phase success. **Confirmed.**
- DR4 (Partial failure): Charge completed phases only; record uncharged usage for audit. **Confirmed.**
- DR5 (Cost method): Config price table × tokens + per-audio-minute; store raw usage + computed pence. **Confirmed.**
- DR6 (Low balance): Hard-block generation start; never negative; export free. **Confirmed.**
- DR7 (Persistence trigger): Auto-persist Generation+Card+MP3→R2 on completion, gated by per-generation save toggle (default ON). **Confirmed.**
- DR8 (Card content): Title + lyric preview + audio player + open-in-editor. **Confirmed.**
- DR9 (defaults, `[confirm]`): manual-only AI compensation; no historical migration; hashed env password + signed cookie; `/dashboard` public; replica-set required; `CREDITS_ENABLED` master flag. **Planning default — awaiting objection.**

## Unresolved / To Confirm
- Exact pence prices per model (esp. `gpt-5.4`, `gpt-5.4-mini`, `gpt-4o-transcribe`, `whisper-1`).
- Whether SumUp webhook signature verification is available/required.
- Optional rate-limiting on generation start.
- Whether Generation doc doubles as the dashboard Card or a separate Card doc is kept.

## Deviation Records
- (none yet)

---

## Stage Checklists (micro-deliverables)

### Stage 0 — Reconciliation & scaffolding — `Not started`
- [ ] Run §20 reconciliation vs post-Phase-1 code; record A1–A4 findings. — files: `PROGRESS.md` — validate: written findings + approval.
- [ ] Confirm module format (`.js`/`.mjs`) vs main `next.config.mjs`/jsconfig. — validate: sample import builds.
- [ ] Add deps `mongoose`,`@aws-sdk/client-s3`,`zod`. — files: `package.json` — validate: `npm i` clean, existing tests pass.

### Stage 1 — DB / models / money / ledger — `Not started`
- [ ] Port `lib/db/mongoose.js`, `lib/db/bootstrap.js`. — validate: connects to test Mongo.
- [ ] Port `lib/money.js` (+ tests). — validate: money tests green.
- [ ] Port models Balance/PaymentOrder/WebhookEvent/RefundRecord. — validate: schemas load.
- [ ] Extend `CreditLedger` enum with `AI_TRANSCRIBE/AI_ENRICH/AI_TIME`. — validate: enum test.
- [ ] Add `Generation` model (§10.2) + `UsageRecord` model (§10.3). — validate: indexes build.
- [ ] Port `lib/ledger/balance-ledger.js` (+ tests). — validate: idempotency / never-negative / concurrent-debit tests green.

### Stage 2 — Pricing + usage collector — `Not started`
- [ ] `lib/ai/openai-pricing.js` seed table + `computeCallCostMinor`. — validate: unit tests per model kind.
- [ ] `lib/ai/openai-usage.js` collector. — validate: aggregation tests.
- [ ] Thread collector into `openai-lyrics.js` pipeline fns + record after each parse + tag `full` sub-phases. — files: `lib/ai/openai-lyrics.js` — validate: capture correct; **pipeline output unchanged**; write `UsageRecord`s (no debit).

### Stage 3 — Credit service + per-phase debit — `Not started`
- [ ] `lib/credits/flags.js` (`isCreditsEnabled`) + `lib/credits/credit-service.js`. — validate: unit.
- [ ] Wire `debitPhase`/`recordUsageOnly` at phase boundaries in `transcribe-job.js`. — files: `lib/ai/transcribe-job.js` — validate: success debits completed phases; failure debits none of failed phase; retry/re-adopt no double-charge; balance exact.

### Stage 4 — Generation-start gating — `Not started`
- [ ] `app/api/credits/unlock/route.js` + signed cookie. — validate: correct/incorrect password.
- [ ] `app/api/credits/balance/route.js`. — validate: enabled/disabled shapes.
- [ ] Gate `app/api/ai/transcribe/route.js` (403 locked / 402 low) + `save` passthrough. — validate: gates fire; disabled flag = unchanged flow.

### Stage 5 — Persistence + R2 audio — `Not started`
- [ ] Port `lib/r2/r2-env.js`, `r2-client.js`. — validate: r2 smoke (sandbox bucket).
- [ ] `lib/r2/audio-r2-lifecycle.js` (put/delete generation audio). — validate: object round-trip.
- [ ] `lib/generations/persist-generation.js` (txn create + post-commit R2). — validate: saved gen → doc+object.
- [ ] `app/api/media/generations/[id]/route.js` serve. — validate: playable stream / 302.
- [ ] Wire completion call in `transcribe-job.js` honoring `save` toggle. — validate: toggle off persists nothing.

### Stage 6 — Top-ups (SumUp) — `Not started`
- [ ] Port `lib/payments/*`. — validate: sumup-env / client tests.
- [ ] `app/api/credits/checkout/route.js` + `orders/[orderId]/route.js`. — validate: checkout creates order + reuse window.
- [ ] `app/api/webhooks/sumup/route.js` + raw `WebhookEvent`. — validate: quick-ack.
- [ ] `app/payment/return/*` + client poll. — validate: **exactly-once via BOTH webhook and return**; wrong amount rejected.

### Stage 7 — Public dashboard + editor chrome — `Not started`
- [ ] `app/dashboard/page.js` + `components/DashboardView.jsx` (responsive). — validate: mobile sheet/transport rules + tokens.
- [ ] `app/api/dashboard/state/route.js` + `generations/[id]/route.js`. — validate: lists saved gens; open-in-editor payload.
- [ ] Editor chrome in `components/editor-shell.js` (balance, top-up, save toggle, unlock, dashboard link) — additive + flagged. — validate: disabled flag hides all.

### Stage 8 — Enablement, scripts, hardening — `Not started`
- [ ] Port scripts (reconcile→generations, audit, smoke, ledger-repair). — validate: run clean.
- [ ] `.env.example` + `CREDITS_SETUP.md` + README note. — validate: fresh setup works from docs.
- [ ] Staging end-to-end (top-up→generate→charge→save→dashboard). — validate: acceptance §22.
- [ ] Disabled-flag regression = current behavior. — validate: parity.

---

## Final Acceptance Checklist (from Plan §22)
- [ ] Ledger never negative; idempotent; concurrency-correct.
- [ ] Per-phase, completed-only charging; no double charge; usage audit matches ledger.
- [ ] Exactly-once top-ups (webhook + return).
- [ ] Saved generations on dashboard w/ playable audio + open-in-editor; toggle-off persists nothing.
- [ ] Password gates generation only; low balance hard-blocks; export free.
- [ ] `CREDITS_ENABLED=false` ⇒ byte-identical current behavior.
- [ ] Mobile + desktop parity; no secret leaks; misconfig fails fast.
- [ ] Docs + scripts complete.

---

## Fresh-Agent Resume Section
- **Where we are**: Plan + this tracker written; nothing implemented. Phase 1 must be done/accepted first.
- **Start by**: reading `IMPLEMENTATION_PLAN.md` fully, then executing §20 reconciliation (Stage 0) against the ACTUAL post-Phase-1 code. Do not assume pre-Phase-1 shapes hold.
- **Golden rules**: keep app green every stage; keep `CREDITS_ENABLED` off until Stage 8; ledger append-only; every money move idempotent + in a txn; escalate material deviations before coding them.
- **Files you may write**: application code per the approved plan + this `PROGRESS.md`. Do not edit `INFORMATION_BANK.md`, `PROJECT_OVERVIEW.md`, or the Phase-1 folder.
