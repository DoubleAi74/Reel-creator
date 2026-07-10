# Phase 2 Plan Verification — Credit Dashboard Merge

## 1. Status

**PLAN READY — IMPLEMENTATION MAY BEGIN AFTER RECORDED PHASE 1 ACCEPTANCE**

Verification date: 2026-07-09.

The v2 blocker found by Codex re-verification is resolved in `IMPLEMENTATION_PLAN.md` v3 and `PROGRESS.md` v3. The plan no longer assumes `transcribe + enrich` runs as one `core` invocation. It now matches the live client: selected lyric pipeline parts run as separate phase jobs, and billing settles once per completed phase (`transcribe`, `enrich`, `time`) with idempotency key `ai_debit:{jobId}:{phase}`.

There are no remaining Phase-2 plan-correction blockers. The only remaining gate is external to this plan: Phase 1 must be explicitly accepted and recorded under `Merge_Features_Project/Merge_1_YT/` before Stage 0 implementation begins.

## 2. Preconditions

Initial `git status --short` showed pre-existing Phase 1/app work plus Phase 2 planning files. During this remediation, only Phase-2 planning/verification files were intentionally edited:

- `Merge_Features_Project/Merge_2_Credit_dash/IMPLEMENTATION_PLAN.md`
- `Merge_Features_Project/Merge_2_Credit_dash/PROGRESS.md`
- `Merge_Features_Project/Merge_2_Credit_dash/PLAN_VERIFICATION.md`

No application/prototype implementation code was changed by this remediation.

## 3. Source Areas Inspected

- Phase-2 plan/progress/verification files.
- Phase-1 plan/progress gate wording.
- Live phase orchestration: `components/editor-shell.js`, `components/tabs/audio-tab.js`, `lib/staged-lyrics.js`.
- Live AI job/call seams: `app/api/ai/transcribe/route.js`, `app/api/ai/transcribe/[jobId]/route.js`, `lib/ai/transcribe-job.js`, `lib/ai/transcribe-store.js`, `lib/ai/openai-lyrics.js`.
- Live asset seams: `lib/files.js`, upload route, asset route, and Phase-1 YouTube asset-store flow.
- Prototype ledger/payment/R2 patterns in `Temp_prototype_parts/Credit_dash_prototype_part/`.

## 4. Phase 1 Status

Phase 1 is technically complete and reconciled:

- Phase-1 `PROGRESS.md` marks implementation complete and all stages validated.
- Focused Phase-1 tests passed on 2026-07-09:

```bash
npx vitest run lib/files.test.js app/api/youtube-audio-segments/route.test.js
```

```text
Test Files  2 passed (2)
Tests       11 passed (11)
```

Phase 1 is still not accepted in its own record. That remains the only gate before Phase 2 implementation.

## 5. Remediation Applied

The plan chose the least disruptive A6 fix: keep the live separate-job client flow and make billing phase-based.

Key v3 changes:

- D3/D10 now define billing and rounding per completed phase job, not `core`/`timing` groups.
- Ledger enum becomes `AI_TRANSCRIBE`, `AI_ENRICH`, `AI_TIMING`.
- AI debit key becomes `ai_debit:{jobId}:{phase}`.
- `UsageRecord` stores `pipelineRunId`, `jobId`, `phase`, and `billingUnit`.
- `Generation` stores `pipelineRunId`, `jobIds`, `finalJobId`, phase costs, and ledger keys.
- The client creates one `pipelineRunId` per Run button flow.
- The client sends `saveOnCompletion:true` only on the final selected phase, so no partial `Generation` is saved before the run is complete.
- `pipelineRunId` is audit/persistence metadata only; it is not a debit idempotency key.

## 6. Plan / Progress Match

`IMPLEMENTATION_PLAN.md` and `PROGRESS.md` now match on:

- v3 status and the remaining Phase-1 acceptance gate.
- Per-phase billing, rounding, settlement, ledger types, and idempotency keys.
- `pipelineRunId` aggregation for audit/final persistence.
- Single `Generation` document as public-card source of truth.
- OpenAI usage parsing, source provenance, accounting states, Mongo transaction path, R2 reconciliation, SumUp re-query, password gate, and rate limit.

## 7. Counts

Plan-correction blockers: 0.

External pre-implementation gates: 1.

Non-blocking implementation notes carried forward: 4.

User actions still needed before Stage 0:

1. Record Phase 1 acceptance under `Merge_Features_Project/Merge_1_YT/`.

## 8. Final Recommendation

The Phase-2 plan is ready for a fresh implementation agent after the Phase-1 acceptance record exists. Start Stage 0 by rerunning the short §20 drift check in `IMPLEMENTATION_PLAN.md` v3, then proceed stage-by-stage with `CREDITS_ENABLED` off until enablement.
