# YT Merge — Phase 1 Information Bank

**Purpose**  
This document is the authoritative information bank for merging the YouTube-to-MP3 segment feature (from `Temp_prototype_parts/YT-mp3_prototype_part/`) into the main Reel Creator app as a way to produce MP3 audio files that the editor can use.

It is designed to be handed to a fresh agent along with the subsequent Plan and Progress documents. It contains highly detailed, relevant context from both codebases, precise integration seams, data flows, and important considerations. It does **not** contain the implementation plan or micro-task tracking (those come later).

**Scope for this bank (Phase 1 only)**  
- Focus: Allowing users to paste a YouTube URL, select a time segment (1s–6min), convert it server-side into an MP3, and have that MP3 become a first-class audio source for the existing editor (waveform, timing, lyric pipeline, preview, export).
- The resulting audio must be usable exactly like (or seamlessly interchangeable with) a manually uploaded MP3.
- Out of scope for this bank: Cost tracking / credits (Phase 2), user accounts/auth model, storage durability upgrades beyond what is needed for Phase 1, public dashboard, Mongo/R2 generation cards.
- Deferred decisions (per user): Auth model (currently everything is public/session-based; a shared password for generations mentioned for later).

**Date of research**: 2026-07-08 (based on current codebase state on `mockup-integration-mobile`).

---

## 1. Main App — Audio Ingestion & Asset Architecture (What the YT feature must integrate with)

### 1.1 Core Audio Data Model (`lib/project.js`)

```js
audio: {
  name: string,           // e.g. "song.mp3" or the YT-derived filename
  duration: number,       // seconds (float)
  startOffset: number,    // default 0
  endOffset: number | null,
}
```

- Audio section trimming is supported via `startOffset` / `endOffset`.
- `createDefaultProject()` and `createDefaultProject(overrides)` are used everywhere.
- When importing a YT clip, we will most likely set `startOffset: 0`, `endOffset: null` (or the clip length) initially and let the user trim later if desired.
- The project JSON export (`toProjectJsonValue`) serializes the audio section but not the actual binary.

**Key related files**:
- `lib/project.js` (createLine, normalize, DEFAULTs)
- `lib/validate.js` (ProjectValidationError, normalize audio section)
- `lib/timing.js` (getSectionBounds, clampTimeToSection, isSectionWithinLimit, MAX_SECTION_DURATION_SECONDS)

### 1.2 Asset Upload & Lifecycle (Session-scoped temporary files)

**Client → Server flow (manual MP3 today)**:
1. User picks file (drag or button) in Audio tab or shell.
2. `POST /api/upload` with `FormData` (`file`, `kind="audio"`).
3. Server (`app/api/upload/route.js`):
   - Gets or creates `sessionId` from cookie (`SESSION_COOKIE_NAME = "reel-creator-session"`).
   - Calls `storeUploadedAsset(...)` from `lib/files.js`.
   - Sweeps expired sessions.
   - Removes render jobs for swept sessions.
   - Returns `{ assetId, durationSec, kind, name, sizeBytes }`.
   - Sets the session cookie if new.
4. Client receives `assetId`, updates `audioUpload` state, creates `audioObjectUrl = buildSessionAssetUrl(assetId)` (`/api/assets/${assetId}`), reads duration if needed.

**Server asset storage (`lib/files.js`)** — critical details:
- Uses OS temp dir (or `process.env.TMP_DIR`) + `reel-creator/<sessionId>/`.
- Each asset gets: `<assetId>.mp3` (or appropriate ext) + `<assetId>.json` metadata.
- Metadata includes: `assetId`, `sessionId`, `kind`, `name`, `mimeType`, `sizeBytes`, `durationSec` (for audio), `createdAt`.
- `readAudioDuration` (client) or server-side `ffprobe` equivalent for video/image.
- TTL: default 24 hours (`DEFAULT_ASSET_TTL_HOURS`). Controlled by `ASSET_TTL_HOURS` env.
- `sweepExpiredSessions()` excludes sessions that have active transcription or render jobs (`getActiveJobSessionIds()`, `getActiveRenderSessionIds()`).
- `touchSessionAndSweep()` is called on uploads and some other operations.
- Assets are served by `app/api/assets/[assetId]/route.js` (GET). It accepts optional `?sessionId=` query for recovery. Returns raw buffer with correct `Content-Type`.
- Cleanup also happens in render and transcribe flows.

**Important client state in `components/editor-shell.js`** (around lines 534–580, 2780+):
- `audioUpload`: `{ asset: {assetId, name, durationSec?}, status: "idle"|"success"|"error", message }`
- `audioObjectUrl`: blob: or `/api/assets/...` URL used for `<audio>` elements and Wavesurfer.
- `readAudioDuration(file)`: client-side metadata read using temp `<audio>` + `URL.createObjectURL`.
- On successful upload: `setAudioUpload(...)`, `setAudioObjectUrl(buildSessionAssetUrl(assetId))`, update `projectState.audio` with name + duration.
- Autosave recovery (around line 2981): restores `audioAsset`, verifies it still exists via HEAD-like GET, re-creates the session URL.
- `handleClear` / track clear revokes blob URLs and resets state.
- Waveform, transport, preview, and pipeline all gate heavily on `audioUpload.asset?.assetId` and `audioObjectUrl`.

### 1.3 Audio Tab (`components/tabs/audio-tab.js`)

The primary surface for audio:
- Big dashed upload card with drag-and-drop + "Choose MP3" + "Load sample".
- Status badge + `track-status` line showing `project.audio.name · duration · status`.
- "Auto-lyrics" section with source language select + pipeline preset/phase checkboxes + Run button.
- Lyrics data import/export JSON buttons.
- Clear track / Clear lyrics buttons at bottom.

The `audio` prop passed down from shell contains:
- `upload`, `objectUrl`, `onFile`, `onPickFile`, `onClear`, `onLoadSample`, `isLoadingSample`.

The YT feature will almost certainly appear here (new button "From YouTube" or similar that opens the segment picker).

### 1.4 How Audio Is Consumed Downstream (Integration Contract)

Any new audio source **must** end up producing:
- A valid `assetId` (so `/api/assets/{id}` works).
- `project.audio.name` + `duration`.
- `audioObjectUrl` (for Wavesurfer + native audio elements).
- Satisfy `getExportReadiness` checks (has `audioAssetId`, section within limit).
- Work with `lib/ai/transcribe-job.js` (it reads the asset file server-side via `getAssetFilePath`).

Consumers:
- **Waveform / Transport** (`components/waveform-timeline.js`, `lib/waveform-sync.js`): Uses `audioObjectUrl`, current time, markers derived from timed lines.
- **Preview** (`components/preview-player.js`, `remotion/LyricVideo.jsx`): Passes audio URL into Remotion `<Audio>`.
- **Lyric pipeline** (`lib/ai/*`, `app/api/ai/transcribe/route.js`): Requires `audioAssetId`. Server reads the MP3 bytes.
- **Export** (`lib/render/render-job.js`, `app/api/render/*`): Reads audio asset for mixing.
- **Timing / tap timing**: Uses audio duration and section.
- **Autosave / restore**: Serializes `audioAsset` reference.

**Current limitations / seams for YT**:
- All audio must go through the session asset system (no direct file URLs long-term).
- Duration must be known accurately.
- The editor expects an MP3 (MIME audio/mpeg). Other formats may need conversion (prototype already produces MP3).
- Max size: 25 MB for audio (`MAX_AUDIO_BYTES` in `lib/files.js`).

### 1.5 Job & Polling Patterns (relevant because YT prototype has its own)

Main app uses in-memory job stores + client polling for:
- Transcription (`lib/ai/transcribe-store.js`, `transcribe-job.js`)
- Rendering (`lib/render/store.js`, `render-job.js`)

YT prototype uses a very similar pattern (global in-memory store + polling). This is a good alignment.

---

## 2. YT Prototype — Complete Feature Inventory

**Location**: `Temp_prototype_parts/YT-mp3_prototype_part/`

**High-level goal** (from its `plan.md`): Paste YT URL → open centered modal → choose precise segment via draggable handles + numeric inputs → "Convert segment" → async server job → return playable + downloadable MP3 via the app's own endpoints.

### 2.1 Frontend (app/page.js + supporting)

Key constants:
- `MIN_SEGMENT_SECONDS = 1`
- `MAX_SEGMENT_SECONDS = 6 * 60`
- `POLL_INTERVAL_MS = 2200`
- `MAX_POLL_ATTEMPTS = 120`

**User flow states**:
- Idle (URL input + "Choose segment" button)
- Modal open: loading video duration via hidden YouTube IFrame API
- Selecting segment (timeline with two handles, synced time inputs, length validation)
- Converting (polling the job)
- Ready (modal closes, results show native `<audio>` + download button using the prototype's `/file` route)

**Hidden YouTube IFrame**:
- Loads `https://www.youtube.com/iframe_api`
- Used **only** to read `duration` and thumbnail (no visible video playback in the prototype).
- Careful promise + timeout handling (`VIDEO_LOAD_TIMEOUT_MS = 15000`).

**Segment UI**:
- Draggable handles on a static timeline bar.
- Numeric inputs that parse `mm:ss` or seconds.
- Real-time validation + "Convert segment" disabled when invalid.
- Default ~15s segment.

**Polling & results**:
- After POST `/api/youtube-audio-segments` gets `jobId`, client polls `GET /api/youtube-audio-segments/{jobId}`.
- On complete: uses the job's file URL (prototype serves from its own temp storage).

Error codes are mapped to friendly messages (`ERROR_COPY`).

**Provider selection** (added in later stage of prototype):
- Supports explicit `providerId` or automatic fallback.
- See `lib/provider-options.js`, `DEFAULT_YOUTUBE_AUDIO_PROVIDER_ID`, `YOUTUBE_AUDIO_FALLBACK_PROVIDER_IDS`.

### 2.2 Backend Architecture

**API routes** (`app/api/youtube-audio-segments/`):
- `POST /` — start job. Validates, calls `createOrReuseJob`, starts background processing if new. Returns `publicJob(job)`.
- `GET /[jobId]` — returns current job status (or 404 with `RESULT_EXPIRED`).
- `GET /[jobId]/file` — serves the final MP3 (once complete).

**Core job system** (`lib/youtube-audio-job-store.js`):
- Global in-memory store (attached to `globalThis` for dev server persistence across HMR-ish).
- Fingerprinting for deduping/reuse: `buildJobFingerprint` based on videoId + times + provider + format.
- `createOrReuseJob`, `pruneExpiredJobs`, `JOB_TTL_MS = 1h`, `REUSABLE_JOB_MS = 10m`.
- Jobs carry: attempts history, status, provider attempts, stored asset info, quota, etc.
- `publicJob()` strips internals for client.

**Background processing** (`lib/youtube-audio-processing.js`):
- Simple queue + concurrency limit (`MAX_CONCURRENT_JOBS = 2`).
- `startBackgroundProcessing(jobId)` → `drainQueue` → `processJob`.
- `processJob` calls the provider runner, stores result, marks complete or failed.

**Provider runner & fallback** (`lib/youtube-audio-provider-runner.js`):
- `runProviderSegmentJob(input, job)`.
- Supports "AUTO" mode that tries providers in order (`YOUTUBE_AUDIO_FALLBACK_PROVIDER_IDS`).
- Per-attempt tracking (`markJobAttemptStarted/Succeeded/Failed/Skipped`).
- Skips remaining providers once one succeeds.
- Non-fallback errors (bad input, segment too long) short-circuit.

**Provider abstraction** (`lib/providers/index.js` + individual providers):
- `prepareYoutubeAudioMedia(input, options)` is the main entry.
- Each provider implements `prepare(input, config)`.
- Current providers:
  - `youtube-mp36` (RapidAPI) — provider often does cutting server-side.
  - `youtube-mp3-2025` — full download + local trim.
  - `youtube-info-download-api`.
- `lib/providers/rapidapi-client.js` + quota tracking (`lib/rapidapi-quota.js`).
- `provider-utils.js`: `findMediaUrl` (recursive search for download links in provider responses).

**Local trimming & storage**:
- `lib/audio-ffmpeg.js`: uses `ffmpeg-static` / `ffprobe-static` to trim segments.
- `lib/youtube-audio-segment-builder.js`: orchestrates fetch + trim.
- `lib/youtube-audio-storage.js`: writes final MP3 to local temp, returns serveable path/URL.
- `lib/audio-media-fetcher.js`: downloads from provider URLs (SSRF guards, size limits).
- Prototype stores files locally (explicitly noted as "merge-time upgrade" needed).

**Validation** (`lib/youtube-audio-validation.js` + Zod):
- URL must be valid YouTube.
- Segment bounds, min/max duration.
- Provider ID if supplied.

**Diagnostics & errors**:
- Structured error codes (`INVALID_INPUT`, `PROVIDER_RATE_LIMITED`, `PROVIDER_TIMEOUT`, `SEGMENT_TOO_LONG`, `RESULT_EXPIRED`, etc.).
- `lib/diagnostics.js`.

### 2.3 Key Data Shapes (simplified)

Job (public view):
```js
{
  id, status, sourceUrl, startTime, endTime,
  providerId, providerName,
  attempts: [{ providerId, status, ... }],
  storedAsset: { url: string (internal or /file), ... } | null,
  errorCode?, errorMessage?
}
```

### 2.4 Dependencies the prototype brings
- `ffmpeg-static`, `ffprobe-static`
- (Implicit) RapidAPI key(s) via server config.
- Zod (already used in main app too).

Prototype has its own `server-config.js`, `provider-options.js`.

---

## 3. Integration Seams & Recommended Mapping

**Best path for Phase 1**:
1. Add a new entry point in the Audio tab (or a new "Import" section) that triggers the YT segment picker (adapted into a modal that matches current design system).
2. On successful conversion:
   - The prototype's final MP3 must be **ingested into the main app's asset system**.
   - Options:
     a. Best: After YT job completes, have the main app's server fetch the bytes from the YT route and call the existing `storeUploadedAsset` logic (or a shared internal function). This gives a normal `assetId`.
     b. Alternative (simpler for prototype merge): Extend the asset upload to accept a "remote source" or have the YT completion endpoint directly create an asset record + file in the main session dir.
3. Return the normal `{ assetId, durationSec, name }` shape to the client.
4. Client treats it exactly like a manual upload: `setAudioUpload({asset: ..., status: "success"})`, `setAudioObjectUrl(...)`, update project audio.

**Reusing code**:
- The provider abstraction + runner + fallback logic is high value and should be extracted/shared rather than duplicated.
- Job polling pattern is almost identical to main app's transcription polling — opportunity for light shared utilities later.
- Segment validation logic (1s–6min) can be reused.

**UI integration**:
- The prototype modal is centered overlay. Main app uses sheets on mobile and modals in some places (project JSON, render export).
- Must respect current responsive rules (unlayered CSS in `globals.css`, `data-snap`, pane visibility, etc.).
- Use existing design tokens from `app/app_colours.css`.
- Timeline handle UI will need visual alignment with the existing waveform style.

**File serving after merge**:
- The final MP3 should be served via the main `/api/assets/{id}` so that `buildSessionAssetUrl` works and everything downstream is happy.
- Prototype's `/file` route is temporary.

---

## 4. Dependencies, Environment & Operational Notes

**New for main app (Phase 1)**:
- `ffmpeg-static` + `ffprobe-static` (or equivalent server-side trimming capability).
- RapidAPI key configuration (see prototype `server-config.js` and scripts).
- Possibly new env: `YOUTUBE_AUDIO_*` keys, rate-limit / quota handling.

**Existing patterns to follow**:
- Session + cookie model for now (Phase 1).
- Asset TTL + sweep logic.
- Error surface (return structured errors, show friendly messages).
- Background job + client polling.

**Quota / reliability**:
- Prototype has sophisticated fallback + quota header merging. This should be preserved.
- Main app currently has no user-visible quota display for OpenAI; YT will introduce a new external dependency with its own limits.

---

## 5. Mobile, Responsive & Current Polish Context

The app is in the middle of a detailed mobile redesign driven by `mockup_integration_project/mobile-mockup.html`.

Relevant constraints for a YT feature:
- Transport is (or will be) fixed at top on narrow viewports.
- Editor lives in a bottom sheet with peek/full snaps.
- Preview and Word Board are mutually exclusive on narrow widths.
- New modals / pickers must not break the transport + sheet contract.
- The segment timeline will likely need to live inside the existing modal pattern or a specialized sheet card.

See `mockup_integration_project/implementation_plan.md` (especially D001–D009 and the mobile CSS rules in `app/globals.css`).

---

## 6. Existing Documentation & Reference Material

**Must-read before implementation**:
- `Temp_prototype_parts/YT-mp3_prototype_part/plan.md` (detailed user flow, scope, backend design)
- `Temp_prototype_parts/YT-mp3_prototype_part/progress.md`
- `Temp_prototype_parts/YT-mp3_prototype_part/docs/` (multi-provider plan, two-provider fallback, rapidapi schema)
- `Old .md files/rapidapi-youtube-mp3-segment-integration-guide.md` (authoritative backend reference per the prototype)
- Main app: `lib/files.js`, relevant parts of `components/editor-shell.js` (audio state + handlers), `components/tabs/audio-tab.js`, `app/api/upload/route.js`, `app/api/assets/[assetId]/route.js`
- `lib/project.js` (audio shape)
- Current `app/api/ai/transcribe/route.js` (example of how audioAssetId is consumed server-side)

Prototype also has good test fixtures and provider smoke scripts.

---

## 7. Important Considerations, Risks & Recommendations

### Strong Recommendations
- **Make the output of YT conversion a first-class main-app asset** as early as possible. Avoid leaving "YT audio" as a parallel universe.
- Preserve the multi-provider fallback strategy — it is one of the most mature parts of the prototype.
- Extract a clean "audio source provider" or at least the job runner + storage abstraction early.
- Instrument the YT job completion so it can later emit cost events (Phase 2 foreshadowing) without big rewrites.
- Keep manual MP3 upload 100% working and as the primary path during the merge.
- Match the current mobile sheet / transport / view-toggle patterns exactly.

### Risks & Gotchas
- **Duration accuracy**: YT providers + ffmpeg trimming must produce byte-identical duration metadata to what the client expects. Mismatches break timing and preview.
- **Large files / long segments**: 6-minute limit is enforced in prototype; main app has its own  (see `MAX_SECTION_DURATION_SECONDS` in timing). Coordinate limits.
- **Provider fragility**: External YT-to-MP3 services change frequently. The fallback + diagnostic system is valuable.
- **Session lifetime vs job lifetime**: A YT job might outlive the browser session that started it (prototype has TTLs). Align with main app's job + asset exemptions.
- **Mobile timeline UX**: Draggable handles on a narrow screen + existing waveform will require careful interaction design.
- **Cleanup**: Ensure completed YT assets participate in the same sweep logic (or are promoted to durable if we decide so in Phase 1).
- **Error recovery**: Prototype has good `RESULT_EXPIRED`. Main app users expect to be able to re-upload or retry cleanly.
- **No auth yet**: Everything is currently global-per-session. A "shared password for generations" is mentioned for later — do not introduce user concepts in Phase 1.

### Nice-to-haves for the merge
- Share or adapt the fingerprint/dedup logic.
- Make provider choice (auto vs specific) available in the UI (or default to auto).
- Show provider/quota info in results or diagnostics (at least in dev).
- Allow re-triggering a similar segment without re-entering the URL.

---

## 8. Appendix — Quick Reference

**Critical main-app entry points for audio**:
- Client: `editor-shell.js` (audioUpload state, handleFile logic, `readAudioDuration`, recovery)
- Server intake: `/api/upload` → `lib/files.js:storeUploadedAsset`
- Server serve: `/api/assets/[assetId]`
- Consumers: everywhere that checks `audioUpload.asset?.assetId` or `audioObjectUrl`

**Critical YT prototype entry points**:
- UI: `app/page.js` (modal + timeline + polling)
- Start: `POST /api/youtube-audio-segments` → `createOrReuseJob` + `startBackgroundProcessing`
- Core: `lib/youtube-audio-provider-runner.js`, `lib/youtube-audio-processing.js`, `lib/youtube-audio-job-store.js`
- Storage/trim: `lib/youtube-audio-segment-builder.js`, `audio-ffmpeg.js`, `youtube-audio-storage.js`

**Data handoff goal**:
YT success → main-app asset record + file on disk → normal `assetId` → same state updates as manual upload.

---

**End of Information Bank (Phase 1 — YT)**

This document should be read together with the actual source in both `Temp_prototype_parts/YT-mp3_prototype_part/` and the relevant main app files listed above. All statements are based on direct code inspection as of the research date.

When the Plan and Progress documents are written, this bank provides the factual foundation.
