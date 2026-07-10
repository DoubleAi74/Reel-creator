# Merge Features Project — Project Overview

**Purpose**  
This document is the single source of truth for the overall process, boundaries, responsibilities, and handoff rules of the `Merge_Features_Project` programme. It is designed to be handed to every fresh planning agent and implementation agent so they can operate correctly without re-deriving the programme structure.

It must be read first by every new agent before they touch any phase-specific documents or code.

**Date**: 2026-07-08

---

## 1. Project Objective

The objective of `Merge_Features_Project` is to carefully integrate two working prototype features into the main Reel Creator Next.js application while preserving the existing application's behavior, quality, and architecture unless explicitly changed in an approved plan.

The intended final result is:

- A main application in which users can acquire audio either by direct MP3 upload **or** by pasting a YouTube URL and selecting a precise segment (Phase 1).
- After Phase 1 is complete, the addition of credit accounting, usage-based charging for OpenAI calls in the lyric pipeline, SumUp-powered balance top-ups, persistent generation records (lyric data + MP3 assets), MongoDB storage, R2 object storage for assets, and a public dashboard of "generation cards" (Phase 2).

Key principles:
- Preserve the existing main application as the stable base.
- Introduce prototype capabilities through deliberate, staged integration rather than wholesale replacement.
- Use information banks for factual discovery, separate planning agents for strategy, and separate implementation agents for execution.
- Separate planning (parallel) from implementation (sequential) to reduce context loss and architectural mistakes.
- Keep decisions explicit, documented, and approved before code changes.

---

## 2. Phase Definitions and Order

### Phase 1 — YouTube Audio Merge

**Information bank**: `Merge_Features_Project/Merge_1_YT/INFORMATION_BANK.md`

**High-level purpose**  
Integrate the working YouTube-to-MP3 segment prototype so that users can obtain audio clips from YouTube URLs. The resulting audio must become a first-class source in the main application's existing audio and asset lifecycle (upload-style assetId, waveform, timing, lyric pipeline, preview, export).

The phase focuses on audio acquisition and ingestion. It explicitly excludes cost tracking, credits, MongoDB, R2 for user assets, and the public dashboard.

**Why it comes first**  
Audio is a foundational input. Phase 2 will instrument and persist generation flows that depend on audio assets. Performing the audio integration first ensures Phase 2 works against the final post-merge audio and asset model rather than assumptions.

### Phase 2 — Credit Dashboard Merge

**Information bank**: `Merge_Features_Project/Merge_2_Credit_dash/INFORMATION_BANK.md`

**High-level purpose**  
Integrate the credit ledger, balance management, OpenAI usage recording and deduction, SumUp top-up flows, MongoDB for lyric/generation data and card metadata, R2 storage for MP3s (evolving the bucket currently used only for placeholder objects), and a public dashboard page that presents generation cards.

This phase adds the monetization, accounting, persistence, and dashboard layers on top of the editor.

**Why it must follow Phase 1**  
Phase 2 must instrument the final generation and asset flows (including any changes introduced by Phase 1). Its implementation agent is required to reconcile against the live codebase after Phase 1 has been completed and accepted.

---

## 3. Full Document Lifecycle

Each merge follows a strict three-document lifecycle. The three documents for a phase are the only authoritative deliverables for that phase.

1. **INFORMATION_BANK.md** (already completed and verified for both phases)
   - Factual architecture discovery and codebase context.
   - Current-state flows, data shapes, integration seams, risks, considerations, and dependencies.
   - Explicitly **not** an approved implementation strategy.
   - Recommendations inside are suggestions for the planning stage, not decisions.

2. **IMPLEMENTATION_PLAN.md** (to be created by the planning agent)
   - The approved, detailed, executable implementation strategy.
   - Stages, architectural decisions, affected files, new modules, data contracts, validation approach, migration/compatibility concerns, error and recovery behavior, and rollback considerations.
   - Must be grounded in the live code + the phase's information bank.

3. **PROGRESS.md** (initially created by the planning agent, maintained by the implementation agent)
   - Execution checklist and live record.
   - Broken into micro-deliverables aligned with the plan.
   - Records status, files changed, tests/results, deviations, blockers, and exact resume points.

**Filenames**  
Use exactly:
- `INFORMATION_BANK.md`
- `IMPLEMENTATION_PLAN.md`
- `PROGRESS.md`

These names were explicitly specified for this programme. (Note: the repository contains a similar but separate pattern under `mockup_integration_project/` using slightly different names; that precedent is informative for process style only and does not override the filenames required here.)

---

## 4. Authority Hierarchy

When in doubt, follow this order (highest first):

1. The user's latest explicit instructions and approved decisions.
2. The phase's approved `IMPLEMENTATION_PLAN.md`.
3. `PROJECT_OVERVIEW.md` (programme-wide process and boundaries).
4. The phase's `INFORMATION_BANK.md` (verified current-state context).
5. Live source code (exact implementation reality).
6. Older plans, progress files, prototypes, guides, archived documentation, and `Temp_prototype_parts/` (supporting context only).

Important rules:
- The information bank is **not** an approved implementation plan. Recommendations inside are not automatically decisions.
- The approved implementation plan must remain consistent with live code.
- Where older documentation conflicts with live code, live code wins unless the user explicitly approves a change.
- Agents must **never** silently resolve material conflicts between documents, the plan, or live code. Escalate.

---

## 5. Responsibilities of Each Agent Type

### Information-Bank Agent (already completed)
- Inspected both codebases and relevant documents.
- Produced verified factual context in the information banks.
- Did **not** make architectural decisions or write application code.

### Planning Agent (one per phase)
Must:
- Read `PROJECT_OVERVIEW.md` + the assigned phase's `INFORMATION_BANK.md` in full.
- Inspect the live code needed to validate the bank and to ground the plan.
- Identify decisions that require user approval and ask focused clarification questions before finalising material product or architectural choices.
- Produce a detailed, executable `IMPLEMENTATION_PLAN.md`.
- Produce the initial `PROGRESS.md` (micro-deliverables, validation gates, etc.).
- Make **no** application-code or prototype-code changes.
- Write only inside the assigned phase folder (except when reading shared project files).

### Implementation Agent (one per phase, different agent from the planning agent)
Must:
- Read `PROJECT_OVERVIEW.md`, the phase's `INFORMATION_BANK.md`, the approved `IMPLEMENTATION_PLAN.md`, and the current `PROGRESS.md` in full.
- Inspect the live code before making any edits.
- Treat the approved plan as the implementation contract.
- Execute one micro-deliverable at a time.
- Keep `PROGRESS.md` accurate and up-to-date as work proceeds.
- Validate each stage (including tests and acceptance criteria) before advancing.
- Report deviations, blockers, new discoveries, and required plan amendments immediately.
- Never redesign the approved architecture without explicit user approval.
- For Phase 2 only: reconcile the plan and bank against the actual post-Phase-1 live codebase before starting implementation.

### Review or Verification Agent (if used)
- May be asked to inspect completed planning or implementation work.
- Must not silently rewrite approved decisions or expand scope.
- Reports findings back to the user.

---

## 6. Parallel and Sequential Work Rules

- Phase 1 and Phase 2 **planning** may occur in parallel.
- Each planning agent must write **only** inside its assigned merge sub-folder (except when reading shared files such as this overview).
- Planning agents must **not** edit `PROJECT_OVERVIEW.md`, the other phase's documents, or any application/prototype code.
- Phase 1 **implementation** occurs first and must complete successfully before Phase 2 implementation begins.
- Phase 2 implementation begins only after Phase 1 has been completed, verified, and accepted by the user.
- Before starting Phase 2 implementation, its implementation agent **must**:
  - Re-read the Phase 2 information bank and plan.
  - Inspect the actual live codebase resulting from the completed Phase 1 merge.
  - Document any mismatches between pre-Phase-1 assumptions and the post-Phase-1 reality.
  - Update the Phase 2 plan only with explicit user approval.

If Phase 1 changes an integration seam that the Phase 2 plan relied upon, the Phase 2 agent must stop, document the mismatch, and obtain approval before proceeding.

---

## 7. Scope Boundaries

### Currently Fixed (do not change without user approval)
- Phase order: YouTube audio merge (Phase 1) before Credit Dashboard merge (Phase 2).
- Planning agents may work in parallel; implementation agents work sequentially.
- Each phase uses a fresh planning agent and a (different) fresh implementation agent.
- Existing main application behavior must be preserved unless the approved plan explicitly changes it.
- Information banks are factual context, not final architecture.
- No implementation code changes until the corresponding plan is reviewed and approved by the user.

### Currently Intended but Not Yet Finalised
- The application remains broadly public initially.
- A shared password may be introduced to protect generation actions.

### Explicitly Deferred to the Relevant Planning Stage
- Introduction of user accounts or authentication architecture.
- Authorization and ownership rules (who owns balances, generations, cards).
- Exact public vs. private dashboard behavior and visibility rules.
- Design and enforcement points for any shared-password mechanism.
- Credit ownership and balance scope (per-user, shared, hybrid).
- Migration and persistence policy details.
- Deployment architecture.
- Final production security controls.
- Any other product or architectural decision not explicitly approved in a plan.

**Do not resolve these matters in this overview or in any plan without explicit user direction.**

---

## 8. Planning-Document Quality Standard

Each `IMPLEMENTATION_PLAN.md` must be detailed enough that a fresh implementation agent can execute it without repeating the main architectural investigation.

Plans must include (where relevant):
- Goals and non-goals.
- Confirmed decisions vs. unresolved decisions.
- Current-state summary (grounded in the information bank + live code).
- Target architecture after the phase.
- Exact integration seams and data handoff points.
- Affected files and modules (existing and new).
- Data models, API contracts, and state/lifecycle changes.
- Environment variables, dependencies, and configuration.
- Error, recovery, idempotency, and concurrency behavior.
- Responsive / UI implications.
- Compatibility, migration, and rollback concerns.
- Testing and validation strategy.
- Stage-by-stage implementation sequence with clear deliverables.
- Acceptance criteria per stage.
- Documentation updates required.
- All factual claims and proposed file changes must be traceable to live code or clearly identified source documents.

---

## 9. Progress-Document Quality Standard

Each `PROGRESS.md` must:
- Mirror the implementation plan's stages.
- Break every stage into small, verifiable micro-deliverables.
- Use explicit status (checkboxes or clear markers) for each micro-deliverable.
- Record validation requirements and actual results for each meaningful step.
- Record files changed.
- Record tests run and their results.
- Record every deviation from the plan, with approval reference.
- Record unresolved blockers.
- Provide a clear resume point so a different fresh agent can continue.
- Never mark work "complete" merely because code was written — completion requires validation against acceptance criteria.
- Distinguish: implemented, validated, blocked, deferred, superseded.

---

## 10. Change-Control Rules

When an agent discovers something that conflicts with the approved plan:

1. Stop before making the conflicting architectural change.
2. Document the discovery and which plan assumptions are affected.
3. Present the smallest safe options.
4. Request explicit user approval for any material decision (architecture, behavior, scope, security, data contracts, or user experience).
5. Update the plan and progress documents **only after** approval.
6. Preserve a clear record of the deviation and its resolution.

Minor implementation details that do not alter architecture, observable behavior, scope, security, data contracts, or user experience may be resolved by the implementation agent and simply recorded in `PROGRESS.md`.

---

## 11. Validation Gates

Programme-level gates (all must be passed):

- **Information-bank gate**: Bank completed and verified (already passed for both phases).
- **Planning gate**: `IMPLEMENTATION_PLAN.md` + initial `PROGRESS.md` completed by planning agent.
- **Approval gate**: User reviews and explicitly approves the plan.
- **Implementation-readiness gate**: Implementation agent confirms all required reading and validates the live-code baseline (including post-Phase-1 state for Phase 2).
- **Stage gates**: Each key implementation stage is validated (code + tests + acceptance criteria) before the next stage begins.
- **Phase-completion gate**: All acceptance criteria met, tests passing, documentation updated, `PROGRESS.md` complete and accurate.
- **Phase-transition gate**: Phase 1 fully accepted before any Phase 2 implementation work begins.
- **Final verification gate**: End-to-end review of the integrated system.

---

## 12. Required Reading Matrix

| Agent Type                        | Mandatory Documents (must read in full before starting work) |
|-----------------------------------|-------------------------------------------------------------|
| Phase 1 Planning Agent            | `PROJECT_OVERVIEW.md`, `Merge_1_YT/INFORMATION_BANK.md`, relevant live code, and documents referenced inside the bank |
| Phase 2 Planning Agent            | `PROJECT_OVERVIEW.md`, `Merge_2_Credit_dash/INFORMATION_BANK.md`, relevant live code, and documents referenced inside the bank |
| Phase 1 Implementation Agent      | `PROJECT_OVERVIEW.md`, `Merge_1_YT/INFORMATION_BANK.md`, approved `Merge_1_YT/IMPLEMENTATION_PLAN.md`, `Merge_1_YT/PROGRESS.md`, current live code |
| Phase 2 Implementation Agent      | `PROJECT_OVERVIEW.md`, both information banks (where relevant), approved `Merge_2_Credit_dash/IMPLEMENTATION_PLAN.md`, `Merge_2_Credit_dash/PROGRESS.md`, completed Phase 1 progress/completion record, **post-Phase-1 live codebase** |

---

## 13. Folder and Document Map

Expected structure (create files only as specified by the workflow):

```
Merge_Features_Project/
├── PROJECT_OVERVIEW.md
├── Merge_1_YT/
│   ├── INFORMATION_BANK.md          (complete)
│   ├── IMPLEMENTATION_PLAN.md       (planning agent)
│   └── PROGRESS.md                  (planning agent → implementation agent)
└── Merge_2_Credit_dash/
    ├── INFORMATION_BANK.md          (complete)
    ├── IMPLEMENTATION_PLAN.md       (planning agent)
    └── PROGRESS.md                  (planning agent → implementation agent)
```

Planning agents write only inside their own sub-folder (except when reading shared files). Implementation agents update only the progress file and application code as directed by the approved plan.

---

## 14. Handoff Expectations

### Planning-Agent Handoff (to user + implementation agent)
Must deliver:
- `IMPLEMENTATION_PLAN.md` (complete, approved-ready).
- Initial `PROGRESS.md`.
- Summary of major decisions encoded in the plan.
- List of unresolved questions and assumptions.
- Key risks and recommended mitigations.
- Explicit confirmation that no application or prototype code was changed.

### Implementation-Agent Handoff (at phase completion)
Must deliver:
- Completed and accurate `PROGRESS.md`.
- Record of all work completed and validated.
- Tests run and results.
- Complete list of files changed.
- Any deviations from the plan and the approvals obtained.
- Outstanding risks or follow-up work.
- Clear statement of the exact current state of the system for that phase.

---

## Final Notes for All Agents

- Always start by reading this document.
- Never assume "the information bank already decided it."
- When in doubt about authority or process, re-read this document and escalate to the user.
- The goal is controlled, high-quality integration using fresh agents to avoid context loss.

This overview, together with the two verified information banks, forms the complete foundation for the remaining planning and implementation work.