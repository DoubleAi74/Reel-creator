# Phase 1 Plan Verification — YouTube Audio Merge

**Status — NOT READY — PLAN CORRECTIONS REQUIRED**

The plan is directionally aligned with the live app's session-asset architecture, but implementation should not start yet. Three plan corrections are blocking: the active prototype fetcher does not validate HTTP redirect targets despite the plan's SSRF/allowlist claim, completed job result temp files have no bounded deletion path, and the stated `npm test`/all-tests acceptance gate is not currently executable against this repository without out-of-scope failures.

---

## Evidence reviewed

- **Docs read in order:** `Merge_Features_Project/PROJECT_OVERVIEW.md`, `Merge_Features_Project/Merge_1_YT/INFORMATION_BANK.md`, `Merge_Features_Project/Merge_1_YT/IMPLEMENTATION_PLAN.md`, `Merge_Features_Project/Merge_1_YT/PROGRESS.md`.
- **Main app source:** `lib/files.js`, `app/api/upload/route.js`, `app/api/assets/[assetId]/route.js`, `lib/project.js`, `lib/timing.js`, `components/tabs/audio-tab.js`, `components/editor-shell.js`, `components/project-json-modal.js`, `components/editor-modals.js`, `app/api/ai/transcribe/route.js`, `app/api/ai/transcribe/[jobId]/route.js`, `lib/ai/transcribe-job.js`, `lib/ai/transcribe-store.js`, `app/api/render/route.js`, `app/api/render/[jobId]/route.js`, `app/api/render/[jobId]/file/route.js`, `lib/render/render-job.js`, `lib/render/store.js`, `lib/ai/audio-chunks.js`, `app/api/cleanup/route.js`, `app/globals.css`.
- **Prototype active path:** `app/page.js`, `app/api/youtube-audio-segments/route.js`, `app/api/youtube-audio-segments/[jobId]/route.js`, `app/api/youtube-audio-segments/[jobId]/file/route.js`, `lib/youtube-audio-job-store.js`, `lib/youtube-audio-processing.js`, `lib/youtube-audio-provider-runner.js`, `lib/providers/*`, `lib/youtube-audio-segment-builder.js`, `lib/audio-media-fetcher.js`, `lib/audio-ffmpeg.js`, `lib/youtube-audio-storage.js`, `lib/server-config.js`, `lib/provider-options.js`, `lib/youtube-url.js`, `lib/youtube-audio-validation.js`, `lib/diagnostics.js`.
- **Supporting checks:** `package.json`, `next.config.mjs`, root env/docs presence, current branch, git status, system `ffmpeg`/`ffprobe`.
- **Read-only commands run:** `rg`, `nl -ba`, `sed`, `find`, `wc -l`, `git status --short`, `git branch --show-current`, `which ffmpeg`, `which ffprobe`, `ffmpeg -version`, `ffprobe -version`, `npm test`.

## Verified architecture summary

The main app stores uploaded assets under a session temp root via `lib/files.js:storeUploadedAsset`, serves them through `app/api/assets/[assetId]/route.js:GET`, and recovers ownership with `findSessionIdForAsset`. Audio consumers use `audioUpload.asset.assetId`, `project.audio.duration`, and `audioObjectUrl`; they do not require a browser `File` after handoff.

The prototype active path is `POST /api/youtube-audio-segments` -> `createOrReuseJob` -> `startBackgroundProcessing` -> `runProviderSegmentJob` -> provider `prepare` -> `buildYoutubeAudioSegment` -> `fetchMediaToFile` -> ffmpeg probe/trim/convert -> `storeFinalMp3` -> status/file routes. The legacy `youtube-audio-files.js`, `youtube-mp3-provider.js`, and `youtube-audio-polling.js` are not imported by the route-driven active path.

The planned seam is real: after a YouTube job completes, the server can copy the MP3 into the existing session asset directory and the client can use `buildSessionAssetUrl(assetId)` just like autosave restore.

## Verification matrix

| Plan area | Plan claim | Live-code evidence | Result | Severity | Required action |
|---|---|---|---|---|---|
| Scope | Phase 1 excludes credits/Mongo/R2/auth/dashboard | `PROJECT_OVERVIEW.md` Phase 1 boundaries; plan §§2,4 | Confirmed | None | Keep scope unchanged. |
| Main asset model | Session asset store is the right integration point | `lib/files.js:storeUploadedAsset`, `readAssetMetadata`, `getAssetFilePath`; `app/api/assets/[assetId]/route.js:GET` | Confirmed | None | Use normal asset metadata and `/api/assets`. |
| Audio handoff | No browser `File` is required after server-originated audio | `components/editor-shell.js:verifyAssetExists`, autosave restore sets `audioObjectUrl = buildSessionAssetUrl(...)`; consumers use `audioUpload.asset?.assetId` | Confirmed | None | Mirror restore-style URL for YT asset. |
| Duration | Server-provided YT duration can become authoritative | `project.audio.duration` drives `lib/timing.js:getSectionBounds`; render rejects missing duration in `lib/render/render-job.js:getNormalizedProject` | Confirmed with guard | Non-blocking | Validate finite positive `durationSec` in `storeAudioAssetFromPath`. |
| Existing upload | Manual upload currently reads duration client-side and stores metadata `durationSec:null` | `components/editor-shell.js:handleAudioFile`; `lib/files.js:storeUploadedAsset` | Confirmed | None | Preserve manual path. |
| Job stores | In-memory stores and sweep exemptions match app architecture | `lib/ai/transcribe-store.js`, `lib/render/store.js`, `lib/files.js:sweepExpiredSessions` | Confirmed | None | Calibrate restart limitations as known architecture. |
| Prototype active path | Active path and excluded legacy list are accurate | Import graph from routes; legacy files only import each other/tests | Confirmed | None | Do not port legacy polling/files/provider modules. |
| Providers | Automatic fallback exists | `provider-options.js:YOUTUBE_AUDIO_FALLBACK_PROVIDER_IDS`; `provider-runner.js:providerPlanForInput` | Confirmed | None | Remove UI provider picker as planned. |
| Provider inventory | Plan requires `youtube-info-download-api` as ported provider | `provider-options.js` excludes it; prototype test says "removed info-download provider"; `providers/index.js` imports it but fallback never selects it | Discrepancy | Non-blocking | Amend plan to either omit it or mark inactive/supporting only. |
| SSRF/redirect safety | Plan says SSRF guards and provider-result host allowlist are retained | Active `audio-media-fetcher.js:validateFetchUrl` validates initial URL/DNS; `fetch(... redirect:"follow")` follows redirects without validating each hop; host allowlist exists only in excluded `youtube-audio-files.js:parseAndValidateProviderUrl` | Discrepancy | **Blocking** | Require manual redirect handling and either remove/replace the allowlist claim or add explicit allowlist policy/tests. |
| Job result cleanup | Plan says result temp can be pruned with job | `youtube-audio-storage.js:storeFinalMp3` writes `results/<jobId>.mp3`; `youtube-audio-job-store.js:deleteJob` only deletes maps | Discrepancy | **Blocking** | Specify bounded deletion of unclaimed/failed/ingested result temp files and tests. |
| Sweep exemption | Active sessions can be exempted while queued/processing | `lib/files.js:sweepExpiredSessions` already merges active transcribe/render sessions | Confirmed | None | Add YT active sessions as planned. |
| Explicit cleanup | Plan does not define cleanup route behavior during active YT jobs | `app/api/cleanup/route.js` only checks `findInFlightRenderForSession` before deleting session assets/cookie | Coverage gap | Non-blocking | Decide whether cleanup blocks active YT jobs, cancels polling only, or allows orphaned result retry. |
| System ffmpeg | Main app already assumes system `ffmpeg`/`ffprobe` | `lib/files.js:readVideoDurationSec`, `lib/ai/audio-chunks.js`, render composite modules; local `which` found both | Confirmed | None | Keep D1; no static deps or `next.config` change. |
| Dependencies | No new zod/static-ffmpeg dependency needed | root `package.json` has no `zod`, `ffmpeg-static`, `ffprobe-static`; `next.config.mjs` only externalizes Remotion/esbuild | Confirmed | None | Keep hand-written validator. |
| Env docs | Plan lists `.env.example` as modified existing file | Root has no `.env.example`; only prototype env examples and `.env.local` | Discrepancy | Non-blocking | Amend as new root `.env.example` or a setup doc. |
| UI placement/layering | URL control can be placed under Choose MP3 and modal above mobile transport | `audio-tab.js` upload card/button row; `globals.css` transport z-index 40; `ProjectJsonModal` fixed z-50 | Confirmed | None | Add controls without changing transport/sheet CSS. |
| UI a11y/responsive | Plan covers modal basics but not focus trap/Escape/overflow validation | Current modals are basic; plan §16 lacks explicit focus/Escape/a11y tests | Coverage gap | Non-blocking | Add modal keyboard/focus/overflow checks to tests/manual acceptance. |
| Testing gate | Plan says use Vitest and all tests pass | `npm test` failed before implementation: prototype Node tests picked up by Vitest, Phase 2 jsdom missing, existing word-board assertions failing | Discrepancy | **Blocking** | Define scoped baseline/commands or plan separate test-config correction before using "all tests pass" gate. |

## Stage-by-stage verdict

| Stage | Prerequisites/files | Ordering | Missing work / risks | Validation adequacy | Verdict |
|---|---|---|---|---|---|
| Stage 0 — Scaffolding & config | New backend modules and config route are plausible; no root `.env.example` exists. | Correct before routes/UI. | Must include Node runtime where FS/child_process is used; env docs file classification is stale. | Config disabled test is good; import/build wording should avoid `next build` if not desired. | Ready after non-blocking doc/runtime clarifications. |
| Stage 1 — Server request/processing | Prototype processing path exists; session cookie pattern exists in `/api/upload`. | Backend before ingestion/UI is correct. | SSRF redirect handling and media host policy must be corrected before porting fetcher. | Needs tests for redirect-to-private, DNS private IP, malformed redirects, queue caps. | **Not ready.** |
| Stage 2 — Ingestion + status contract | `lib/files.js` is the right seam; status route can ingest on complete. | Correct after temp MP3 exists. | `storeAudioAssetFromPath` lacks required path/canonical/partial-copy/duration validation detail; result temp cleanup after ingestion is undefined. | Needs idempotent double-poll, no-File handoff, path safety, cleanup-after-ingest tests. | **Not ready.** |
| Stage 3 — Sweep exemption | Existing exemption pattern is real. | Correct before production use; could be implemented before status ingestion. | Does not cover explicit `/api/cleanup` behavior. | Forced sweep test is adequate; add explicit cleanup-route decision/test if supported. | Ready with non-blocking correction. |
| Stage 4 — Client handoff + Audio-tab controls | `AudioTab` and `EditorShell` seams exist. | Backend asset contract should precede client. | Must ensure no stale transcription/pipeline state leaks; plan should state client requires `asset` on complete before success. | Parity checks are right but need scoped commands/manual cases. | Ready with non-blocking correction. |
| Stage 5 — Modal UI + responsive polish | Prototype modal/timeline exists; main z-index supports overlay. | Correct after handoff callback exists. | Focus/Escape/backdrop/overflow/a11y not explicit; provider diagnostics removal must be preserved. | Needs desktop/narrow drag, keyboard, screen-reader labels, disabled/error/expired states. | Ready with non-blocking correction. |
| Stage 6 — Hardening & tests | Test categories are directionally complete. | Correct final stage. | Baseline `npm test` is not usable; missing tests for redirect SSRF and result-temp orphan cleanup. | Inadequate until scoped baseline and missing tests are added. | **Not ready.** |

## Factual discrepancies

| Location | Claim | Verified reality | Severity | Correction |
|---|---|---|---|---|
| Plan §13, §9.1 `media-fetcher.js` | SSRF guards and provider-result host allowlist are retained. | Active `audio-media-fetcher.js` validates initial URL only and follows redirects automatically; no allowlist exists in active path. Legacy `youtube-audio-files.js` has an allowlist but is explicitly excluded. | **Implementation-blocking factual/security error** | Amend media-fetcher plan to use `redirect:"manual"`, validate every redirect URL/DNS/IP/protocol/credentials, cap redirect depth, and add tests. Remove or define host allowlist policy. |
| Plan §11 lifecycle | Result temp files can be pruned with the job. | Prototype `deleteJob` removes only Map entries; `storeFinalMp3` result files are outside session sweep and persist. | **Implementation-blocking cleanup error** | Add job-result cleanup ownership: delete on successful ingestion when safe, on failed/expired job prune, and on startup/sweep of stale result dir. |
| Plan §16/§18, Progress final checklist | Use Vitest; all tests pass. | `npm test` currently fails before Phase 1 work due Temp prototype Node tests under Vitest, Phase 2 jsdom absence, and existing word-board assertions. | **Implementation-blocking validation error** | Define scoped validation commands or test-config cleanup so Phase 1 can be judged without modifying prototype/Phase 2/unrelated failures. |
| Plan §9.2 | `.env.example` is a modified existing file. | Root `.env.example` does not exist. | Stale reference | Mark as new root doc or use another setup doc. |
| Plan §9.1 providers | `youtube-info-download-api` is part of the ported provider set. | Prototype `provider-options.js` and tests exclude it from active options/fallback; only `providers/index.js` still imports it. | Harmless stale reference | Omit from required Stage 0 files or explicitly mark inactive. |

## Missing/incomplete coverage

- **Architecture:** No explicit route runtime requirement for new Node-only routes. Existing Node routes use `export const runtime = "nodejs"` in asset/transcribe/render routes.
- **Lifecycle:** No bounded cleanup for job result temp files in `YT_MP3_TMP_DIR/results`.
- **Cleanup:** Explicit `/api/cleanup` behavior during active YT jobs is unspecified.
- **Security:** HTTP redirect SSRF checks are missing; host allowlist claim is unsupported; queue length/per-session active job caps are not specified.
- **Path ingestion:** No canonical trusted-root enforcement, finite duration validation, source file stat/type check, partial-copy cleanup, or source-cleanup ownership in `storeAudioAssetFromPath`.
- **Recovery:** Process-restart limitations are acceptable for the current architecture, but plan should explicitly state a completed-but-not-ingested job is unrecoverable after restart while any already-ingested asset remains recoverable.
- **UI:** Focus management, Escape key, keyboard timeline behavior, narrow overflow, and a11y labels are not mapped to acceptance tests.
- **Testing:** No scoped baseline command; missing tests for redirect SSRF, result-temp pruning, explicit cleanup, no-asset-on-complete defensive path, and root env docs.

## Unsafe / unsupported assumptions

| Where | Why unsupported | Missing evidence | Required action |
|---|---|---|---|
| Plan §13 SSRF/allowlist | Active fetcher follows redirects without validating target and has no host allowlist. | No tests or code for redirect target validation in `audio-media-fetcher.js`. | Blocking amendment with manual redirects and tests. |
| Plan §11 result temp pruning | Job pruning currently deletes only in-memory entries. | No file deletion in `youtube-audio-job-store.js:deleteJob`; no result-dir sweeper. | Blocking amendment with cleanup owner and validation. |
| Plan §18 all tests pass | Full test suite fails before Phase 1. | No scoped test command or baseline failure list in plan/progress. | Blocking amendment defining usable validation gates. |
| Plan §8.4 path ingestion | Internal-only source path is plausible, but arbitrary-path hardening is not specified. | No trusted-root/canonical checks in proposed function. | Non-blocking amendment before implementation. |
| Plan §12 modal behavior | Existing modal pattern lacks focus trap/Escape; plan does not add it. | No UI/a11y tests listed. | Non-blocking acceptance/test amendment. |

## Decision audit

**Confirmed**
- D1 system `ffmpeg`/`ffprobe`: live app uses system binaries in `lib/files.js:readVideoDurationSec` and `lib/ai/audio-chunks.js`; local PATH has both.
- D2 path ingestion seam: `lib/files.js` already owns session dirs, metadata, MP3 sniffing, size caps, and session touch.
- D3 ingest-on-complete: `/api/assets/{assetId}` serving and restore-style URLs already work.
- D4 automatic provider: prototype supports `auto` and fallback order via `providerPlanForInput`.
- D5 sweep exemption: live `sweepExpiredSessions` already accepts active job session IDs.
- D6 server-only keys: prototype uses `process.env.RAPIDAPI_YOUTUBE_MP3_KEY`; no `NEXT_PUBLIC_` key is required.
- D7 diagnostics for later admin: prototype `diagnostics.js` redacts URLs/secrets and `publicJob` carries attempts/quota.
- D8 no zod: root `package.json` has no direct zod dependency; hand-written validation is consistent.
- D9 URL placement: `AudioTab` has a clear upload-card insertion point and modal z-index can exceed transport.

**Planning-agent technical decisions**
- Global in-memory YT job store, session TTL assets, ingest-on-status-poll, no separate `/file` route, no `next.config.mjs` change.

**Evidence-supported assumptions**
- 1s-360s segment aligns with `lib/timing.js:MAX_SECTION_DURATION_SECONDS`.
- 128 kbps six-minute MP3 should remain under `MAX_AUDIO_BYTES`.
- No CSP/middleware is present in inspected app files, so iframe/thumbnails are not currently blocked.

**Unsupported / incorrectly treated as settled**
- Provider-result host allowlist retained.
- Result temp files pruned with job.
- Full Vitest suite usable as-is.

**Unresolved user decisions**
- None required for Phase 1 readiness once plan corrections are made.

**Deferred (Phase 2 / later)**
- Auth/shared password, credits, durable storage, admin dashboard UI, Mongo/R2, cross-session ownership.

## Risk register

| Risk | Likelihood | Impact | Affected stage | Mitigation | Validation |
|---|---:|---:|---|---|---|
| Redirect-based SSRF through provider media URL | Medium | High | 1 | Manual redirects, validate every hop, reject private DNS/IP and credentials | Unit/integration tests with redirect-to-local/private targets |
| Orphaned result MP3s outside session sweep | High | Medium | 1-3 | Job-result cleanup owner on prune/ingest/failure and stale result-dir sweep | Forced expired-job/result-dir tests |
| Test gate unusable due out-of-scope failures | High | High | 6 | Define scoped `vitest` command or config excludes and record baseline | Re-run documented commands |
| Path ingestion becomes arbitrary file copy if reused later | Low | High | 2 | Canonical source root, file stat/type/size checks, partial cleanup | Unit tests with traversal/out-of-root/source missing |
| Public endpoint job queue abuse | Medium | Medium | 1 | Add queue length and per-session active job cap or document best-effort limit | Tests for overload response |
| User cleanup during active YT job loses session cookie | Low | Medium | 3-4 | Define cleanup behavior: block, cancel polling, or allow no-asset completion | Route test/manual flow |
| Provider contract drift | Medium | Medium | 1 | Preserve fallback/error normalization and mocked provider fixtures | Provider fallback tests |
| Mobile timeline overflow/touch issues | Medium | Medium | 5 | Tokenized modal, 44px handles, narrow viewport tests | Playwright/manual narrow checks |

## Testing & acceptance audit

| Behavior / risk | Planned validation | Gap |
|---|---|---|
| URL and 1s/360s validation | Unit tests for `validation.js` and `youtube-url` | Good; ensure no providerId accepted from client. |
| Provider fallback and error classification | Mocked integration tests | Good; add no-diagnostics-main-UI check. |
| Disabled config | `/config` false and UI hidden | Good; add POST disabled response test. |
| Job dedup/reuse/expiry | Fingerprint/idempotency tests | Good; add process-restart limitation note only. |
| Ingestion idempotency | Double-poll same `assetId` | Good. |
| Path ingestion | MP3 check/size/metadata planned | Missing canonical root, partial cleanup, finite duration, source stat tests. |
| Duration fidelity | ffmpeg trim + `assertDurationClose` | Good; add server duration used by client without `File`. |
| Download failure/malformed media | Error classification planned | Add redirect SSRF and HTTP redirect-depth tests. |
| Cleanup | Sweep exemption planned | Missing result-temp prune and explicit cleanup-route behavior. |
| Handoff/reload/no-File | Handoff/consumer tests planned | Good; add test that `audioObjectUrl` is `/api/assets/...`, not `blob:`. |
| Waveform/preview/timing/transcribe/render/export | Parity checks planned | Good, but needs scoped baseline command. |
| Local-upload regression | Acceptance criterion | Good; define exact regression test/manual steps. |
| Mobile/desktop modal/a11y | UI modal checks planned | Missing focus/Escape/backdrop/labels/overflow specifics. |
| Resource limits | Concurrency/time/size caps listed | Missing queue length/per-session cap tests. |
| All tests pass | Plan says Vitest green | Blocked by current `npm test` failures; needs correction. |

## Plan ↔ Progress mapping

- The Progress file structurally mirrors plan Stages 0-6 and final acceptance criteria.
- Progress currently says "Blockers: None"; that is no longer accurate after live verification.
- Missing Progress tasks: redirect SSRF hardening/tests, job-result cleanup/prune tests, path-ingestion safety tests, scoped baseline test command, root env-doc file decision, explicit cleanup route behavior.
- Stage sizing is mostly resumable, but Stage 0 "port `lib/youtube-audio/*`" is broad; split into validator/config, provider plumbing, media fetcher, ffmpeg, storage/job store to avoid unsafe resume points.
- Plan and Progress both omit validation fields for existing failing baseline tests; implementation cannot honestly mark "All tests pass" without plan clarification.

## Required corrections

### Blocking

1. **SSRF redirect/allowlist correction:** Update the plan to replace `fetch(... redirect:"follow")` behavior with explicit redirect validation for every hop and either define or remove the unsupported provider-result host allowlist claim. Evidence: `audio-media-fetcher.js:fetchMediaUrl` and `validateFetchUrl`; legacy allowlist only in excluded `youtube-audio-files.js`.
2. **Bounded job-result cleanup:** Add a concrete owner and tests for deleting `YT_MP3_TMP_DIR/results/<jobId>.mp3` for failed, expired, unclaimed, and successfully ingested jobs. Evidence: `youtube-audio-storage.js:storeFinalMp3`; `youtube-audio-job-store.js:deleteJob`.
3. **Executable test gate:** Amend plan/progress to define a usable Phase 1 validation command/baseline. Evidence: `npm test` currently fails before implementation due prototype Node tests, Phase 2 jsdom, and unrelated word-board assertions.

### Non-blocking

1. Add canonical/trusted-root and partial-copy cleanup requirements to `storeAudioAssetFromPath`.
2. Clarify root `.env.example` as a new file or replace it with a setup doc, since it does not exist.
3. Remove or explicitly mark `youtube-info-download-api` as inactive/supporting only.
4. Specify explicit `/api/cleanup` behavior during active YT jobs.
5. Add route runtime guidance for new Node-only API routes.
6. Add modal focus/Escape/backdrop/overflow/a11y validation.
7. Add queue length/per-session active job cap or document why concurrency-only is acceptable for Phase 1.

### User decisions required

None. The blocking items are technical plan corrections, not product/user choices.

## Recommended amendments

| File | Section | Current problem | Required change | Reason | Downstream effects |
|---|---|---|---|---|---|
| `IMPLEMENTATION_PLAN.md` | §8.2, §9.1, §13, §16 | Media fetcher security overstates SSRF protection and allowlist. | Require manual redirect handling with per-hop URL/DNS/IP validation, max redirect depth, and tests; remove unsupported allowlist claim unless a real policy is added. | Prevents provider URL from becoming SSRF via redirects. | Stage 1/6 tests; provider error mapping. |
| `IMPLEMENTATION_PLAN.md` | §8.2, §11, §17 Stage 2/3 | Result temp cleanup is hand-waved. | Define cleanup owner: on successful ingestion where no reuse needed, job prune, failed jobs, and stale result-dir sweep. | Avoids unbounded orphan MP3 accumulation. | Job store/storage tests; sweep docs. |
| `PROGRESS.md` | Stage 1-3, Stage 6 | Missing cleanup/security micro-deliverables. | Add checkboxes for redirect SSRF tests, result prune, path-ingestion hardening. | Keeps implementation resumable and auditable. | Blocks validation until checked. |
| `IMPLEMENTATION_PLAN.md` | §16, §18 | "All tests pass" is not currently measurable. | Document scoped commands and baseline failures, or plan a test-config change that excludes prototype/Phase2 reference tests. | Prevents implementation from being trapped by unrelated failures. | Stage 6 acceptance becomes enforceable. |
| `PROGRESS.md` | Phase status / blockers | Says no blockers. | Record these verification blockers and next action: return corrections to planning agent. | Progress fidelity. | Prevents premature kickoff. |
| `IMPLEMENTATION_PLAN.md` | §8.4 | Path ingestion lacks safety constraints. | Add trusted temp/result root, `realpath`/canonical containment, `stat.isFile`, finite positive duration, partial-copy cleanup. | Keeps internal helper from becoming arbitrary-file-read/copy primitive. | Unit tests in Stage 2. |
| `IMPLEMENTATION_PLAN.md` | §9.1 | Inactive provider file listed as required. | Remove `youtube-info-download-api` or mark inactive only. | Avoids porting dead/provider-drift code. | Smaller Stage 0. |
| `IMPLEMENTATION_PLAN.md` | §9.2/§19 | `.env.example` reference stale. | Mark root `.env.example` as new or choose `Merge_1_YT/README.md`/setup note. | Main repo has no root env example. | Documentation task clarity. |
| `IMPLEMENTATION_PLAN.md` | §12/§16 | Modal a11y incomplete. | Add Escape, focus return/trap, labels, overflow, and narrow viewport criteria. | Preserves responsive polish. | Stage 5/6 UI validation. |

## Readiness checklist

| Dimension | Status | Note |
|---|---|---|
| Factual accuracy | ⚠️ | Mostly accurate; SSRF/allowlist, cleanup, test gate, env doc need correction. |
| Scope | ✅ | Phase 1 boundaries respected. |
| Architecture | ✅ | Normal session-asset handoff is the correct seam. |
| User decisions | ✅ | No new user decisions required. |
| Ordering | ⚠️ | Stage order is sound, but cleanup/security tasks must move before production readiness. |
| Asset contract | ✅ | `assetId`, `/api/assets`, metadata, duration, and no-File handoff are feasible. |
| Ingestion safety | ⚠️ | Needs canonical path/source validation and partial cleanup requirements. |
| Job lifecycle | ⚠️ | In-memory lifecycle is aligned; temp result lifecycle is incomplete. |
| Idempotency | ✅ | `(jobId, sessionId)` idempotency is planned. |
| Restart | ⚠️ | Acceptable current limitation, but completed-not-ingested restart loss should be documented. |
| Cleanup | ❌ | Result temp orphan risk is blocking. |
| Fallback | ✅ | Automatic fallback and error classification exist. |
| FFmpeg | ✅ | System binaries verified and app already assumes them. |
| Duration fidelity | ✅ | Final probe duration can be authoritative; validate finite positive input. |
| Recovery | ⚠️ | Autosave asset recovery works; YT job restart recovery remains best-effort. |
| Security | ❌ | Redirect SSRF and unsupported allowlist claim are blocking. |
| Abuse | ⚠️ | Concurrency/size/time caps exist; queue/session caps unspecified. |
| Responsive UI | ⚠️ | Layering confirmed; focus/Escape/overflow tests missing. |
| Dependencies | ✅ | No new npm dependency needed. |
| Env | ⚠️ | Server-only key confirmed; root env docs file missing. |
| Tests | ❌ | Current full `npm test` gate fails before implementation. |
| Acceptance | ❌ | "All tests pass" and cleanup/security criteria lack executable coverage. |
| Progress fidelity | ⚠️ | Structurally mirrors plan but misses verification blockers/corrections. |
| Rollback | ✅ | Rollback surface is small and file-scoped. |
| Docs | ⚠️ | Env/setup docs need file-path correction. |
| Phase-2 compatibility | ✅ | Phase-2 seams preserved without pulling Phase-2 scope in. |

## Final recommendation

Return the named corrections to the planning agent before implementation kickoff. Once the plan/progress explicitly cover redirect SSRF validation, result-temp cleanup, and an executable Phase 1 test baseline, Phase 1 can safely proceed without additional user decisions.
