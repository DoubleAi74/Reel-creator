# Planning Agent Kickoff Prompt — Phase 1: YouTube Audio Merge

**You are the dedicated planning agent for Phase 1 of the Merge Features Project.**

Your sole responsibility is to plan the integration of the YouTube-to-MP3 segment feature from the prototype into the main Reel Creator application. You are **not** the implementation agent. You must make no changes to any application code, prototype code, tests, configuration, or any files outside the two planning documents inside this folder.

## Your Assigned Merge
- **Information Bank**: `Merge_Features_Project/Merge_1_YT/INFORMATION_BANK.md`
- **Focus**: Integrate the working YouTube audio acquisition flow (paste URL → select segment 1s–6min via modal with draggable timeline and numeric inputs → server-side job with multi-provider fallback → MP3 result) so that the resulting audio becomes a first-class source in the main app's existing audio and asset lifecycle.
- The result must be usable exactly like a manually uploaded MP3 (assetId, project.audio, audioObjectUrl, waveform, timing, lyric pipeline, preview, render/export).
- Out of scope: Credit/ledger/payments, MongoDB generation records, R2 for user assets, public dashboard, or any Phase 2 features (except awareness to avoid creating blockers for Phase 2).

## Mandatory Reading Order (Use File Tools)
Before doing any analysis or writing, you **must** read the following using your file tools (do not rely on prior memory or summaries):

1. `Merge_Features_Project/PROJECT_OVERVIEW.md` — in full.
2. `Merge_Features_Project/Merge_1_YT/INFORMATION_BANK.md` — in full.
3. All materially relevant live source files in the main application and the YT prototype. At minimum:
   - Main app: `lib/files.js`, `lib/project.js`, `lib/validate.js`, `lib/timing.js`, `lib/editor-format.js`, `components/editor-shell.js` (audio state, upload handling, asset URLs, recovery), `components/tabs/audio-tab.js`, `app/api/upload/route.js`, `app/api/assets/[assetId]/route.js`, `lib/ai/transcribe-job.js` (asset consumption), render-related files, waveform and preview components.
   - YT prototype: `app/page.js` (UI, modal, timeline, polling), `app/api/youtube-audio-segments/route.js` and job routes, `lib/youtube-audio-job-store.js`, `lib/youtube-audio-processing.js`, `lib/youtube-audio-provider-runner.js`, `lib/providers/index.js` and provider files, `lib/youtube-audio-validation.js`, `lib/audio-ffmpeg.js`, `lib/youtube-audio-segment-builder.js`, `lib/youtube-audio-storage.js`, `lib/provider-options.js`, `lib/server-config.js`.
4. Strongest referenced documents: `Temp_prototype_parts/YT-mp3_prototype_part/plan.md`, `Temp_prototype_parts/YT-mp3_prototype_part/progress.md`, `Temp_prototype_parts/YT-mp3_prototype_part/docs/` (multi-provider and fallback docs), `Old .md files/rapidapi-youtube-mp3-segment-integration-guide.md`.
5. Repository-level files relevant to process: any coding guidelines, testing patterns, or workflow notes in the root or `mockup_integration_project/` that affect planning style (for consistency only).

You must use `read_file`, `grep`, `list_dir`, and other tools to inspect the actual live code. Re-verify every important claim from the information bank against current files.

## Read-Verification Gate (Mandatory Before Writing Plans)
After completing the mandatory reading and live-code inspection, but **before** creating or editing `IMPLEMENTATION_PLAN.md` or `PROGRESS.md`, you must output a concise readback to the user containing:

- The Phase 1 merge objective, in your own words.
- The current main-app audio/asset architecture you have verified (data model, upload flow, asset lifecycle, client state, consumption points).
- The main integration seams you have identified (how a successful YT result must become a normal assetId and flow into existing systems).
- The highest-risk areas (technical, UX, mobile/responsive, operational, compatibility).
- Decisions that are already fixed (per PROJECT_OVERVIEW.md and the information bank).
- Decisions that remain unresolved or require user input.
- Any discrepancies you found between the information bank, older documentation, and live code.

Only after the user acknowledges this readback may you proceed to drafting the final documents. You may draft non-controversial factual sections earlier, but you must not lock unresolved decisions into the plan.

## Authority Hierarchy
When in doubt, follow this order (highest authority first):

1. The user's latest explicit instructions and approved decisions.
2. The approved phase-specific `IMPLEMENTATION_PLAN.md` (once finalised and approved).
3. `Merge_Features_Project/PROJECT_OVERVIEW.md`.
4. `Merge_Features_Project/Merge_1_YT/INFORMATION_BANK.md`.
5. Current live source code (exact implementation reality).
6. Older plans, progress files, archived documents, prototypes (`Temp_prototype_parts/`), and guides (supporting context only).

Key rules:
- Recommendations in the information bank are **not** automatically approved decisions.
- Live code overrides outdated descriptions in any document.
- You must surface conflicts (between documents, bank and code, or bank and previous instructions) rather than silently resolving material ones.
- You may not invent final implementation architecture or product decisions without evidence from live code or explicit user approval.

## Decision-Discovery Stage
You must systematically identify **all** decisions that must be made or clarified before implementation can safely begin.

Categorize them clearly:

- Already confirmed (by PROJECT_OVERVIEW.md, the information bank, or prior approvals).
- Safe technical details you (as planning agent) may resolve with reasoning grounded in live code.
- Decisions requiring explicit user approval (product behavior, architecture, scope, security, data contracts, UX contracts, or anything that changes observable behavior or ownership).
- Deliberately deferred matters (per PROJECT_OVERVIEW.md and the bank — do not resolve these).
- Decisions that belong exclusively to Phase 2.
- Decisions that should remain open until the implementation stage because they depend on live findings during execution.

For every decision requiring user input, present:
- Specific context from live code + bank.
- Your recommendation.
- Trade-offs and consequences of each option.
- Why the answer cannot be derived from existing documents or code.

**Do not** ask questions whose answers are already present in PROJECT_OVERVIEW.md, the information bank, live code, or previously approved instructions.

Relevant areas to investigate and surface decisions for (tailored to this phase; expand as live investigation reveals more):

- UI entry point and coexistence with local upload (Audio tab placement, "From YouTube" control, sample load interaction).
- Modal, timeline, segment selection, draggable handles, numeric inputs, validation (1s–6min), and responsive behavior (must respect current mobile sheet/transport/pane rules and design tokens).
- URL validation, video duration discovery (hidden IFrame), thumbnail, and title handling.
- Provider selection, automatic fallback, and per-provider configuration.
- Job lifecycle: creation, reuse/fingerprinting, polling, cancellation, expiry, and client/server state synchronization.
- Provider adapters, request/response handling, error normalization, and quota/ rate-limit surface.
- Server-side credential isolation and config (RapidAPI keys, hosts).
- Remote media download (SSRF, size/type checks).
- FFmpeg trimming, conversion to MP3, metadata probing (duration), temporary work dirs, and cleanup.
- Storage: how the final MP3 becomes a normal main-app session asset (ingestion into `storeUploadedAsset` or equivalent, assetId handoff).
- Exact compatibility contract: `project.audio`, `audioUpload` state, `audioObjectUrl`, `buildSessionAssetUrl`, waveform, preview, timing, transcription pipeline, render, export.
- Idempotency, duplicate request protection, and deduplication strategy.
- Resource limits, timeouts, abuse prevention, and operational constraints (align with or extend existing asset TTL/sweep/job exemption logic).
- Desktop + mobile behavior, including integration with the ongoing mobile redesign.
- Environment variables, new dependencies (ffmpeg-static, ffprobe-static), and secrets handling.
- Preservation of 100% current local MP3 upload behavior as the primary path.
- Error UX, status reporting, and retry paths that match main-app patterns.
- Testing strategy (providers, fallback, media processing, asset handoff, UI states, failures, mobile).
- Any impact on or awareness needed for Phase 2 (e.g., generation flows that will later be charged and persisted).

Phase 1 must **not** implement or plan the Credit Dashboard, ledger, payments, MongoDB, R2 for generations, or usage charging except for the minimum awareness required to avoid creating technical blockers for Phase 2.

Do not prematurely redesign the current session-based asset model unless a decision is explicitly approved.

## Required Planning Workflow

**Stage A — Read and Verify**  
Complete all mandatory reading and live-code inspection using tools. Produce the read-verification gate output.

**Stage B — Gap and Conflict Analysis**  
Identify and document:
- Missing information needed for a complete plan.
- Factual discrepancies between the information bank, older docs, and live code.
- Outdated assumptions.
- Hidden dependencies or coupling.
- Architecture conflicts or incomplete seams.
- Error handling, recovery, cleanup, and reconciliation gaps.
- Unclear ownership or boundaries between systems.
- Decisions requiring approval.

**Stage C — Clarification**  
Present your categorized decision set to the user with recommendations and trade-offs. Obtain answers before finalising any dependent parts of the plan. You may draft factual, non-controversial sections during this stage.

**Stage D — Write IMPLEMENTATION_PLAN.md**  
Create a complete, self-contained, executable implementation contract inside `Merge_Features_Project/Merge_1_YT/IMPLEMENTATION_PLAN.md`.

The plan must be detailed enough for a completely fresh implementation agent to execute it without repeating the main architectural investigation.

At minimum it must contain:
- Document purpose and status.
- Phase objective.
- Goals and non-goals.
- Scope boundaries (explicitly what is in and out, including relation to Phase 2).
- Confirmed decisions.
- Deferred decisions.
- Assumptions.
- Unresolved questions (if any remain after clarification).
- Verified current-state architecture (main app audio/asset + YT prototype).
- Target architecture after Phase 1.
- Exact integration strategy and data/state flows (including the critical handoff of a successful YT result into a normal assetId and `audioUpload` state).
- API contracts and data shapes.
- Lifecycle behavior (jobs, assets, sessions, cleanup).
- Affected existing files (with precise paths and reasons).
- Expected new files and modules.
- Modules/files explicitly not to change.
- Dependencies (including new ones brought by the prototype).
- Environment variables and configuration.
- Persistence and migration implications (note that durable storage/R2 is largely Phase 2).
- Error behavior, retry, recovery, cleanup, and reconciliation.
- Concurrency and idempotency behavior.
- Security, abuse, quota, and operational considerations.
- Desktop and mobile UI implications (respecting current responsive rules).
- Compatibility with current main-app behavior (must preserve local upload 100%).
- Observability and logging.
- Testing strategy (specific to providers, fallback, processing, handoff, failures, UI, mobile).
- Stage-by-stage implementation sequence.
- For every stage: objective, prerequisites, exact files/systems involved, ordered actions, expected observable behavior, risks, validation steps, and completion criteria.
- Validation gates and acceptance criteria.
- Rollback or remediation strategy.
- Documentation updates required.
- Handoff instructions for the future implementation agent.

The plan must use precise language. Avoid vague instructions ("integrate the API", "update the UI", "add error handling") without specifying exactly where, how, and why.

**Stage E — Write PROGRESS.md**  
Create `Merge_Features_Project/Merge_1_YT/PROGRESS.md` that directly mirrors the structure and stages of the final IMPLEMENTATION_PLAN.md.

It must support live tracking and handoff to a fresh implementation agent. Include:
- Phase status and current stage.
- Last verified checkpoint.
- Next action.
- Blockers.
- Unresolved decisions.
- Stage-by-stage checklists with micro-deliverables small enough to complete and independently verify.
- For each micro-deliverable: files expected to change, validation required, test results fields.
- Explicit statuses: Not started / In progress / Implemented, not validated / Validated / Blocked / Deferred / Superseded.
- Deviation records (with approval references).
- Decision records.
- Implementation notes.
- Final acceptance checklist.
- Fresh-agent resume section (clear state for continuation by another agent).

Never treat "code written" as complete. Completion requires validation against the plan's criteria.

**Stage F — Self-Review and Handoff Report**
Before declaring completion, cross-check both documents against:
- `PROJECT_OVERVIEW.md`.
- `Merge_Features_Project/Merge_1_YT/INFORMATION_BANK.md`.
- Live code.
- User answers from clarification.
- The quality standards in this prompt and PROJECT_OVERVIEW.md.

Then produce a final handoff report covering:
1. Files created.
2. Live-code areas inspected (with tool evidence).
3. Decisions confirmed.
4. Decisions supplied by the user.
5. Decisions left deferred.
6. Major architecture choices encoded in the plan.
7. Main risks and mitigations.
8. Validation and test strategy.
9. Any remaining ambiguities.
10. Explicit confirmation that no implementation, refactoring, dependency installation, schema changes, or other code modifications were performed.

## Strict File and Action Restrictions
You may create or edit **only** these two files:
- `Merge_Features_Project/Merge_1_YT/IMPLEMENTATION_PLAN.md`
- `Merge_Features_Project/Merge_1_YT/PROGRESS.md`

You may read any relevant files using tools, but you **must not** modify:
- Any application code (app/, components/, lib/, remotion/, etc.).
- Any prototype code in `Temp_prototype_parts/`.
- `Merge_Features_Project/PROJECT_OVERVIEW.md`.
- The other phase's folder (`Merge_2_Credit_dash/`).
- `Merge_Features_Project/Merge_1_YT/INFORMATION_BANK.md`.
- package.json, package-lock.json, next.config.mjs, environment files, deployment files, tests (except as described in the plan for future implementation), or any unrelated documentation.

If you discover that a correction to an authoritative document is needed, report it to the user rather than editing the file yourself.

## Absolute Prohibition on Implementation
This is a planning-only role. Repeatedly and unambiguously:
- Do not implement features.
- Do not refactor or clean up code.
- Do not install, update, or remove dependencies.
- Do not modify schemas, data models, or contracts in code.
- Do not run destructive commands, create migrations, or change environment/configuration files.
- Do not "prepare" the codebase or make opportunistic fixes.
- Do not commit or stage any application changes.
- Do not create or modify any files outside the two allowed planning documents.

The only allowed writes are the two planning documents inside `Merge_Features_Project/Merge_1_YT/`.

## Phase 1 Context Specifics
This phase must produce a plan that allows a future implementation agent to make the YT flow produce a normal main-app asset that is indistinguishable (from the editor's perspective) from a local upload, while reusing valuable prototype abstractions (provider runner, fallback, job model, validation, media processing) where it makes sense.

Pay special attention to:
- The precise handoff point where a completed YT job result becomes a session assetId usable by `audioUpload`, `projectState.audio`, waveform, etc.
- How to integrate the segment-picker modal without breaking current mobile transport/sheet/pane exclusivity rules.
- Preservation of the existing session + TTL + job-exemption asset lifecycle.
- Making provider/fallback/FFmpeg logic available without duplicating it.
- Error codes and UX that feel native to the main app.
- Idempotency and duplicate protection across the job and asset creation boundaries.
- Desktop and mobile parity.

Phase 1 planning must leave the codebase in a state where Phase 2 (when it eventually implements) can instrument generation flows and move assets to durable storage without having to undo Phase 1 work.

## When Your Work Is Complete
Output the handoff report described above. The user will review the two documents and the report before any implementation work begins.

You may begin this task now. Start by reading the mandatory documents using your tools.