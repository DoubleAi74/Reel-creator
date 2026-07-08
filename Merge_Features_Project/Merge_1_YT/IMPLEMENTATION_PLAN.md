# YT Merge — Phase 1 Implementation Plan

**Status**: APPROVED-READY (pending user sign-off on this document). Supersedes no prior plan.
**Date**: 2026-07-08
**Branch of record**: `mockup-integration-mobile`
**Authoring agent**: Phase 1 Planning Agent (planning only — no code changed).

This is the executable implementation contract for Phase 1. It is self-contained: a fresh
implementation agent should be able to execute it without repeating the architectural
investigation. Authority order: user instructions → this plan (once approved) →
`PROJECT_OVERVIEW.md` → `Merge_1_YT/INFORMATION_BANK.md` → live code → prototype/older docs.

---

## 1. Phase objective

Let a user paste a YouTube URL, pick a 1s–6min segment via a modal (draggable timeline +
numeric inputs), have the server fetch/trim/convert it to a 128 kbps MP3 using the ported
multi-provider-with-fallback pipeline, and **ingest that MP3 into the main app's existing
session-asset system** so it is indistinguishable from a manually uploaded MP3 across
`assetId`, `project.audio`, `audioObjectUrl`, waveform, timing, lyric pipeline, preview, and
export. Local MP3 upload remains 100% intact and primary.

## 2. Goals / Non-goals

**Goals**
- New "From YouTube" acquisition path producing a first-class session audio asset.
- Reuse prototype provider runner, automatic fallback, job model, media fetch (SSRF-guarded),
  and ffmpeg trimming — ported into the main app, not duplicated ad hoc.
- Preserve manual upload behaviour byte-for-byte.
- Desktop + mobile parity, respecting the transport/sheet/pane contract.
- Leave clean seams for Phase 2 (cost events, durable storage, admin diagnostics).

**Non-goals (Phase 2 / out of scope)**
- Credits/ledger/payments, MongoDB, R2 for user assets, public dashboard, usage charging.
- User accounts/auth, shared-password gating.
- Admin diagnostics **UI** (data is preserved in API/records; the dashboard itself is later).
- Redesigning the session+TTL asset model.

## 3. Confirmed decisions (user-approved 2026-07-08)

| # | Decision |
|---|----------|
| D1 | **Reuse the main app's system `ffmpeg`/`ffprobe`** (as render + `lib/files.js` already do). Do **not** add `ffmpeg-static`/`ffprobe-static`. |
| D2 | Ingest the completed MP3 via a **new internal `storeAudioAssetFromPath` in `lib/files.js`** that writes file + metadata with a **real `durationSec`** (from ffprobe). Do not reconstruct a `File`/reuse `storeUploadedAsset`. |
| D3 | On job completion the MP3 is **ingested into the caller's session asset dir** and the status response returns `{ asset: { assetId, durationSec, name, kind, sizeBytes } }`. No separate `/file` route; served via `/api/assets/{id}`. |
| D4 | **Automatic provider fallback only.** No user-facing provider picker. |
| D5 | The job is **associated with the caller's session** and that session is **exempt from sweeping** while the job is queued/processing. |
| D6 | RapidAPI credentials are **server-only env**; the feature is **gracefully hidden/disabled** when unconfigured (no hard error surfaced to a user who never opted in). |
| D7 | Provider attempt/quota diagnostics are **not shown in the main UI**; the data is preserved in the job API payload/records for a **future admin dashboard**. |
| D8 | **No `zod`.** Port segment validation as a hand-written validator matching the prototype's rules (main app convention; zero new deps). |
| D9 (UI) | YouTube **URL input + "Choose segment" button live in the Audio tab, directly below the "Choose MP3" button.** Interval selection opens in a **modal** (prototype-style, main-app-tokenized). |

## 4. Deferred decisions (do not resolve here)
Auth model / shared password; durable storage (R2) for YT assets; cost accounting; admin
dashboard design; cross-session ownership. All Phase 2.

## 5. Assumptions
- System `ffmpeg` and `ffprobe` are on `PATH` in dev and deploy (already assumed by
  `lib/render/*` and `lib/files.js:readVideoDurationSec`). If absent, YT trimming fails with a
  clear `CONVERSION_FAILED`/`INTERNAL_ERROR` — same class as existing render dependence.
- A 6-min 128 kbps MP3 (~5–6 MB) is well under `MAX_AUDIO_BYTES` (25 MB) and OpenAI's limit.
- No CSP/middleware exists, so the hidden YouTube IFrame API (`youtube.com`) and thumbnails
  (`i.ytimg.com`) load. If a CSP is later added, allow those hosts.
- Node runtime provides `crypto.randomUUID`, `fetch`, `AbortSignal.timeout`, streams (already
  used across the app).

## 6. Verified current-state architecture (evidence)

**Main app audio/asset**
- Model: `audio { name, duration, startOffset:0, endOffset:null }` — `lib/project.js:145`.
- Section cap: `MAX_SECTION_DURATION_SECONDS = 360` — `lib/timing.js:1` (== prototype 6 min).
- Upload: `handleAudioFile` (`components/editor-shell.js:2720`) → `POST /api/upload`
  (`app/api/upload/route.js`) → `storeUploadedAsset` (`lib/files.js:292`) writes
  `<kind>-<assetId><ext>` + `<assetId>.json` in `<tmp>/reel-creator/<sessionId>/`, returns
  `{ assetId, durationSec, kind, name, sizeBytes }`.
- **Audio `durationSec` is stored `null`; duration is read client-side** from the `File`
  (`readAudioDuration`, `editor-shell.js:462`). Only video runs server ffprobe
  (`lib/files.js:81`).
- Object URL: manual upload → `URL.createObjectURL(file)` (blob); **restore** →
  `buildSessionAssetUrl(assetId)` = `/api/assets/{id}` (`editor-shell.js:3037`).
- Serve: `app/api/assets/[assetId]/route.js` (cookie-scoped, `?sessionId=` recovery).
- Lifecycle: 24h TTL; `sweepExpiredSessions` exempts sessions with active transcribe/render
  jobs (`lib/files.js:178`, pulling `getActiveJobSessionIds`/`getActiveRenderSessionIds`).
- Consumers resolve bytes server-side via `findSessionIdForAsset` + `getAssetFilePath`
  (`app/api/ai/transcribe/route.js:62`, `lib/render/render-job.js`).
- Modals are `fixed inset-0 z-50` overlays with `var(--…)` tokens
  (`components/project-json-modal.js:22`, grouped in `components/editor-modals.js`).

**YT prototype (active path)**
- `POST /api/youtube-audio-segments` → `parseYoutubeAudioSegmentRequest` →
  `createOrReuseJob` (fingerprint dedup, global in-memory) → `startBackgroundProcessing`
  (queue, `MAX_CONCURRENT_JOBS=2`) → `runProviderSegmentJob` (provider plan + fallback) →
  `prepareYoutubeAudioMedia` (provider `.prepare`) → `buildYoutubeAudioSegment`
  (`fetchMediaToFile` SSRF-guarded → `probeAudio` → `trimAudioToMp3` or `convertAudioToMp3` →
  `assertDurationClose` → `storeFinalMp3`).
- Status `GET /[jobId]`, file `GET /[jobId]/file`. `publicJob` carries `attempts[]`,
  `finalProviderName`, `downloadUrl`, `errorCode`.
- ffmpeg via `ffmpeg-static`/`ffprobe-static` (**to be replaced with system binaries — D1**).
- **Legacy/unused: `lib/youtube-audio-files.js`, `lib/youtube-mp3-provider.js`,
  `lib/youtube-audio-polling.js`** are not on the active path — DO NOT port.

## 7. Target architecture after Phase 1

```
Audio tab (below "Choose MP3"):  [ YouTube URL ______ ]  ( Choose segment )
        │ opens
        ▼
YoutubeSegmentModal (fixed inset-0 z-50, tokens)
  - hidden YT IFrame → duration + thumbnail
  - draggable timeline + mm:ss inputs, 1s..360s validation
  - Convert → POST /api/youtube-audio-segments (session cookie)
  - poll GET /api/youtube-audio-segments/{jobId}
        │ on complete (server has ingested):
        ▼
Client handoff == handleAudioFile success branch, but:
  - durationSec comes from response.asset.durationSec (no client File)
  - audioObjectUrl = buildSessionAssetUrl(assetId)   // like restore path
  - setProjectState.audio via normalizeAudioSection + clampLineStartsToSection

Server:
POST route → attach session cookie (create if absent) → createOrReuseJob
           → register (jobId, sessionId) for sweep-exemption → start processing
Processing → provider runner/fallback → buildYoutubeAudioSegment writes trimmed
             MP3 to job work/result temp; finalProbe duration captured on job
Status GET → when status=complete AND caller has session AND not yet ingested for
             (jobId, sessionId): storeAudioAssetFromPath(...) into session dir,
             record assetId in job.ingestedBySession[sessionId] (idempotent),
             return { ...publicJob, asset }
Serve      → existing /api/assets/{id}
```

## 8. Exact integration strategy & data/state flow

### 8.1 Server — request
`POST /api/youtube-audio-segments` (new, main-app version):
- Body `{ url, startTime, endTime }` (no `providerId` — auto only, D4).
- Read/create session cookie exactly like `app/api/upload/route.js` (same
  `SESSION_COOKIE_NAME`, maxAge, flags); set it on the response if new.
- Validate with the ported hand-written validator (D8). On failure return
  `{ status:"failed", errorCode }` with 400 (`INVALID_INPUT` / `SEGMENT_TOO_LONG`).
- `createOrReuseJob({ sourceUrl, startTime, endTime, providerId:"auto" })`.
- Register the session against the job for exemption (§8.5). Start processing if new.
- Return `publicJob(job)` (+ `Set-Cookie` if new session).

### 8.2 Server — processing (ported, D1 change only)
Identical control flow to the prototype (`processing` → `runProviderSegmentJob` →
`buildYoutubeAudioSegment`), except `audio-ffmpeg` spawns **system** `ffmpeg`/`ffprobe`
(§9.3). `buildYoutubeAudioSegment` continues to `assertDurationClose(finalProbe.duration,
end-start)` and store the final MP3 to a job temp path; **persist `finalProbe.duration` on the
job** (new field `outputDurationSec`) so ingestion has an authoritative duration without
re-probing.

### 8.3 Server — status + ingestion (D2, D3)
`GET /api/youtube-audio-segments/{jobId}`:
- `getJob`; 404 `{status:"failed",errorCode:"RESULT_EXPIRED"}` if missing/expired.
- If `status !== "complete"`: return `publicJob(job)` (adds `attempts`, `phase`,
  `errorCode`). No `downloadUrl` (removed — D3).
- If `status === "complete"`:
  - Resolve caller session (cookie). If none, return complete without `asset` (defensive;
    normal flow always has a cookie from POST).
  - If `job.ingestedBySession[sessionId]` exists → reuse that assetId (idempotent poll).
  - Else call `storeAudioAssetFromPath({ sourcePath: job.storedAssetPath, sessionId,
    name: deriveAssetName(job), durationSec: job.outputDurationSec })`; store returned
    `assetId` in `job.ingestedBySession[sessionId]`.
  - Return `{ ...publicJob(job), asset: { assetId, durationSec, name, kind:"audio",
    sizeBytes } }`.
- Delete the prototype `[jobId]/file` route entirely.

### 8.4 Server — ingestion function (new, in `lib/files.js`)
`storeAudioAssetFromPath({ sourcePath, sessionId, name, durationSec })`:
- `ensureSessionDir(sessionId)`.
- Read bytes; enforce `size <= MAX_AUDIO_BYTES` (else throw → surfaced as `PROVIDER_REJECTED`
  class); `isMp3Buffer` check (reuse existing helper).
- `assetId = crypto.randomUUID()`; `storedFileName = audio-<assetId>.mp3`; copy/write file.
- Write `<assetId>.json` metadata: `{ assetId, sessionId, kind:"audio", name, mimeType:
  "audio/mpeg", sizeBytes, durationSec, createdAt, storedFileName }` — **note this sets a real
  `durationSec`, unlike manual upload; harmless (video already does).**
- `touchSession(sessionId)`; return metadata.
- This is the single source of asset truth; the YT route imports it (no asset writing in
  `lib/youtube-audio/*`).

### 8.5 Server — sweep exemption (D5)
- `lib/youtube-audio/job-store.js` tracks a `sessionId -> Set<jobId>` (or per-job
  `sessionIds:Set`) for jobs whose status is `queued`/`processing`; expose
  `getActiveYoutubeAudioSessionIds()`.
- `lib/files.js:sweepExpiredSessions` adds those ids to `excludedSessionIds` alongside the
  existing transcribe/render exemptions (one import + one spread in the exemption loop).

### 8.6 Client — handoff (mirror of `handleAudioFile`)
New `handleYoutubeSegmentComplete(asset)` (or inline in the modal's completion callback in the
shell). Given `asset = { assetId, name, durationSec }`:
- `const nextAsset = { ...asset, kind:"audio", durationSec }`.
- `nextAudio = normalizeAudioSection({ ...projectState.audio, duration: durationSec,
  endOffset: null, name: asset.name, startOffset: 0 })`.
- `{ clampedCount, lines } = clampLineStartsToSection(projectState.lines, nextAudio)`.
- `setProjectState(p => ({ ...p, audio: nextAudio, lines }))`.
- `setAudioUpload({ asset: nextAsset, status:"success", message: `${asset.name} added.` })`.
- Revoke any prior `blob:` object URL, then
  `setAudioObjectUrl(buildSessionAssetUrl(asset.assetId))` (server URL, restore-style —
  there is no local File).
- Reset transport: `setIsTransportPlaying(false)`, `setCurrentAudioTime(0)`,
  `setAutoFollowEnabled(true)`, clear auto-lyrics/timing state, apply the same `clampedCount`
  timing notice as `handleAudioFile`.

### 8.7 Client — modal + polling (ported UI)
Port `SegmentTimeline`, `parseTimeInput`, `formatTime`, handle-drag, keyboard nudge, and
`pollConversionJob` into `components/youtube-segment-modal.js`, restyled with main-app tokens
(§12). Constants: `MIN_SEGMENT_SECONDS=1`, `MAX_SEGMENT_SECONDS=360`, `POLL_INTERVAL_MS=2200`,
`MAX_POLL_ATTEMPTS=120`. Remove the provider `<select>` (D4). Do not render the provider/quota
summary (D7). On complete, the modal closes and invokes the shell handoff (§8.6).

## 9. Files

### 9.1 New files
- `components/youtube-segment-modal.js` — modal + `SegmentTimeline` + polling client.
- `lib/youtube-audio/job-store.js` — ported store + `sessionIds`, `outputDurationSec`,
  `ingestedBySession`, `getActiveYoutubeAudioSessionIds()`; drop `downloadUrl` from `publicJob`.
- `lib/youtube-audio/processing.js` — ported queue/processor.
- `lib/youtube-audio/provider-runner.js` — ported runner + fallback.
- `lib/youtube-audio/providers/{index,youtube-mp36,youtube-mp3-2025,youtube-info-download-api,provider-utils,rapidapi-client}.js` — ported.
- `lib/youtube-audio/segment-builder.js` — ported; captures `finalProbe.duration`.
- `lib/youtube-audio/media-fetcher.js` — ported (SSRF guards intact).
- `lib/youtube-audio/audio-ffmpeg.js` — ported **but system-binary** variant (§9.3).
- `lib/youtube-audio/storage.js` — job-temp work/result writer (`storeFinalMp3` → temp only).
- `lib/youtube-audio/{server-config,provider-options,youtube-url,rapidapi-quota,diagnostics,validation}.js` — ported; `validation.js` is hand-written (D8).
- `app/api/youtube-audio-segments/route.js` — POST (session-aware, auto provider).
- `app/api/youtube-audio-segments/[jobId]/route.js` — GET status + ingest-on-complete.
- `app/api/youtube-audio/config/route.js` — GET `{ enabled: Boolean(RAPIDAPI key) }` (D6).

### 9.2 Modified existing files
- `lib/files.js` — add `storeAudioAssetFromPath`; add YT session exemption to
  `sweepExpiredSessions`.
- `components/tabs/audio-tab.js` — URL input + "Choose segment" button below "Choose MP3";
  new `audio.youtube` prop group (`onOpen`, `url`, `onUrlChange`, `enabled`, `error`).
- `components/editor-shell.js` — YT modal open/close state; URL state; completion handoff
  (§8.6); render `YoutubeSegmentModal`; thread props to `AudioTab`; fetch `/config` once for
  `enabled`.
- `components/editor-modals.js` — optionally host the YT modal (or render directly in shell).
- `app/globals.css` — modal/timeline styles under a scoped class using tokens.
- `.env.example` — document RapidAPI vars (implementer; planning agent does not edit env).

### 9.3 `audio-ffmpeg.js` system-binary variant (D1)
Replace `ffmpeg-static`/`ffprobe-static` imports and `resolveFfmpegPath/resolveFfprobePath`
with fixed commands `"ffmpeg"`/`"ffprobe"` resolved from `PATH` (mirroring
`lib/render/video-background-composite.js` and `lib/files.js:83`). Keep `probeAudio`,
`trimAudioToMp3` (`-vn -codec:a libmp3lame -b:a 128k`), `convertAudioToMp3`,
`assertDurationClose`, `isMp3Audio`, timeouts, and arg redaction unchanged. **No
`next.config.mjs` / `serverExternalPackages` change is needed** (no bundled binaries).

### 9.4 Do NOT change / do NOT port
- `lib/project.js`, `lib/timing.js`, `lib/validate.js`, preview/remotion, `lib/waveform-sync.js`,
  transcribe/render stores & jobs (read only, for the exemption pattern).
- Prototype legacy: `youtube-audio-files.js`, `youtube-mp3-provider.js`,
  `youtube-audio-polling.js`.
- Manual-upload path (`/api/upload`, `storeUploadedAsset`, `handleAudioFile`) — behaviour must
  be byte-identical after the merge.

## 10. API contracts

`POST /api/youtube-audio-segments`
- Req: `{ url:string, startTime:number, endTime:number }`.
- 200: `publicJob` `{ jobId, status, phase, attempts[], finalProviderName?, title? }` (+Set-Cookie if new).
- 400: `{ status:"failed", errorCode:"INVALID_INPUT"|"SEGMENT_TOO_LONG" }`.
- 503-ish: if unconfigured, `{ status:"failed", errorCode:"FEATURE_DISABLED" }` (UI hides it anyway).

`GET /api/youtube-audio-segments/{jobId}`
- In progress: `publicJob` `{ jobId, status:"queued"|"processing", phase, attempts[] }`.
- Complete: `{ ...publicJob, status:"complete", asset:{ assetId, durationSec, name, kind:"audio", sizeBytes } }`.
- Failed: `{ status:"failed", errorCode }` (200 or 404 for `RESULT_EXPIRED`).

`GET /api/youtube-audio/config` → `{ enabled: boolean }`.

`GET /api/assets/{assetId}` — unchanged; serves the ingested MP3.

## 11. Lifecycle, concurrency, idempotency
- Job store global in-memory (dev-HMR-safe via `globalThis`), `JOB_TTL_MS=1h`,
  `REUSABLE_JOB_MS=10m`, fingerprint dedup (videoId+times+provider+format).
- Ingestion is idempotent per `(jobId, sessionId)` via `ingestedBySession` — repeated
  completion polls return the same `assetId`, never a duplicate file.
- Cross-session job reuse: a reused job ingests separately into each requesting session's dir.
- POST reconnect: `createOrReuseJob` returns the in-flight job for identical fingerprints
  (client adopts `jobId`), analogous to `findInFlightTranscribeForSession`.
- Sweep exemption keeps the session alive while queued/processing (D5); after completion the
  asset follows the normal 24h TTL like any upload. Job temp files are cleaned by the builder's
  `finally` (work dir) and can be pruned with the job (result temp) — the durable copy is the
  ingested session asset.

## 12. Desktop & mobile UI
- Modal uses the existing `fixed inset-0 z-50` overlay pattern (`project-json-modal.js`) → it
  layers **above** transport/sheet/panes and therefore does **not** interact with the
  `data-snap`/pane-exclusivity rules. No changes to transport/sheet CSS.
- Timeline handles: pointer events already used; ensure ≥44px touch targets and that
  `pointermove` drag works with the modal scroll on narrow widths. Use tokens
  (`--surface`,`--border`,`--accent`,`--muted`,`--text`) — no hardcoded prototype colors.
- Audio-tab additions are plain form controls inside the existing upload card; reuse
  `.pill`/`.field-label` styles.

## 13. Security / abuse / operational
- RapidAPI key server-only (never `NEXT_PUBLIC_`); UI gating via `/config` boolean (D6).
- SSRF guards in `media-fetcher.js` (protocol/credential/private-IP/DNS checks) ported intact;
  provider-result host allowlist in `storage`/fetch retained.
- Size caps: `maxSourceBytes` (150MB default) during fetch; final MP3 capped at
  `maxOutputBytes` (50MB) then re-capped to `MAX_AUDIO_BYTES` (25MB) at ingestion.
- Concurrency `MAX_CONCURRENT_JOBS=2`; ffmpeg command timeout 180s; poll cap 120×2.2s.
- Error normalization preserved (`INVALID_INPUT`, `SEGMENT_TOO_LONG`, `PROVIDER_*`,
  `CONVERSION_FAILED`, `RESULT_EXPIRED`, `INTERNAL_ERROR`) → mapped to friendly copy client-side.

## 14. Observability (D7)
Keep `lib/youtube-audio/diagnostics.js` server logging and the `attempts[]`/`quota` payload in
`publicJob`. Do not render them in the editor. A `// PHASE 2: admin dashboard consumes
attempts/quota` marker documents the seam.

## 15. Compatibility & rollback
- Manual upload untouched; if the YT key is unset the feature is invisible → zero behaviour
  change for existing users.
- Rollback = remove the Audio-tab YT controls + modal + routes + `lib/youtube-audio/*`; revert
  the two `lib/files.js` additions (`storeAudioAssetFromPath`, exemption spread). No schema/data
  migration to undo (assets are ordinary session files).

## 16. Testing strategy
- **Unit**: `validation.js` (bounds, URL forms, end>start, 1s/360s edges); `youtube-url`
  extraction; `storeAudioAssetFromPath` (mp3 check, size cap, metadata incl. `durationSec`,
  filename shape); fingerprint dedup; `providerPlanForInput`/fallback classification.
- **Integration (mocked providers)**: POST→poll→complete happy path yields an ingestable asset;
  provider-1 fail → provider-2 success; non-fallback error short-circuits; `RESULT_EXPIRED`;
  idempotent double-poll returns same `assetId`; unconfigured key → disabled.
- **Handoff/consumer**: ingested asset works with `/api/assets/{id}`, transcribe
  (`findSessionIdForAsset`+`getAssetFilePath`), render, waveform, preview, autosave restore.
- **ffmpeg (D1)**: trim on a fixture; `assertDurationClose` within tolerance; system-binary
  resolution.
- **UI**: modal open/validate/convert/close; desktop + narrow viewport handle drag; sweep
  exemption keeps a mid-job session alive.
- Use the app's existing runner (`vitest`), matching `lib/*.test.js` patterns.

## 17. Stage-by-stage sequence

**Stage 0 — Scaffolding & config**
Objective: ported backend compiles behind a disabled flag. Actions: create `lib/youtube-audio/*`
(system-ffmpeg variant), `/config` route, env docs. Validate: `/config` returns
`{enabled:false}` with no key; build passes. Done when backend imports cleanly and the feature
is invisible.

**Stage 1 — Server request/processing**
Objective: POST creates/dedupes a session-aware job and processes it to a temp MP3. Actions:
POST route (session cookie + validation + auto provider), job-store session tracking +
`outputDurationSec`, wire processing/runner/builder. Validate: with a real key, POST→poll
reaches `complete` with a temp file and `assertDurationClose` passing (mocked provider in CI).
Done when a completed job holds a valid trimmed MP3 + duration.

**Stage 2 — Ingestion + status contract (D2/D3)**
Objective: completion yields a normal session asset. Actions: `storeAudioAssetFromPath` in
`lib/files.js`; status route ingest-on-complete + idempotency; drop `/file` route. Validate:
status complete returns `asset`; `/api/assets/{assetId}` serves bytes; double-poll stable;
transcribe/render accept the asset. Done when the asset is indistinguishable from an upload
server-side.

**Stage 3 — Sweep exemption (D5)**
Objective: mid-job sessions survive sweeps. Actions: `getActiveYoutubeAudioSessionIds` +
`lib/files.js` exemption spread. Validate: forced sweep with an active YT job does not remove
the session; after completion normal TTL applies. Done when exemption test passes.

**Stage 4 — Client handoff + Audio-tab controls (D9)**
Objective: URL input under "Choose MP3" opens the modal; completion mirrors upload. Actions:
Audio-tab controls + `audio.youtube` props; shell state + `handleYoutubeSegmentComplete`;
`/config` gating. Validate: end-to-end produces a playable track, waveform, timing, preview,
autosave-restore, export — identical to a manual upload. Done when parity holds.

**Stage 5 — Modal UI + responsive polish**
Objective: tokenized modal, desktop + mobile. Actions: port `SegmentTimeline`/polling,
restyle, touch targets, layering above transport/sheet. Validate: manual desktop + narrow
runs; no transport/sheet regression. Done when UX matches main-app design and mobile rules.

**Stage 6 — Hardening & tests**
Objective: full test suite + error UX. Actions: unit/integration/handoff tests; error-copy
map; diagnostics preserved (D7). Validate: `vitest` green; manual failure paths friendly. Done
when acceptance criteria (§18) met.

## 18. Acceptance criteria
- Manual MP3 upload behaviour byte-identical (regression check).
- Paste URL → pick 1s–360s segment → Convert → within poll budget a **normal session asset**
  exists; editor state matches a manual upload (waveform, timing, lyric pipeline, preview,
  autosave-restore, export all work).
- Automatic fallback works; provider-1 failure transparently succeeds on provider-2.
- Feature hidden when unconfigured; no user-facing error for non-opted-in users.
- Session survives sweeping while a job runs; ingestion idempotent.
- No provider/quota diagnostics in the main UI; data present in API payload/logs.
- No new npm dependency (no zod, no ffmpeg-static); no `next.config.mjs` change.
- All tests pass.

## 19. Documentation updates
- `PROGRESS.md` kept live per stage.
- `.env.example` + a short README/`.md` note on RapidAPI setup and the enable flag.
- Inline `// PHASE 2:` markers at the cost-event/admin-diagnostics seams.

## 20. Handoff to implementation agent
Read `PROJECT_OVERVIEW.md`, this plan, `INFORMATION_BANK.md`, `PROGRESS.md`, and the live
files in §6/§9 before editing. Execute stages in order, one micro-deliverable at a time,
updating `PROGRESS.md` (status + files + tests). Never mark done without validation. Escalate
any conflict (esp. if system ffmpeg is unexpectedly unavailable, or a provider contract has
drifted) before changing architecture. Do not touch Phase 2 concerns beyond the documented
seams.
