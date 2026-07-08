# Progress — YouTube → MP3 Segment Prototype

## Tier
Simple (standalone prototype)

## Stack
Next.js (App Router) + JavaScript; Route Handlers under `app/api/*` keep the RapidAPI key
server-side. Provider adapters in `lib/providers/`. In-memory job store + local temp-file
storage (prototype only).

## Current State
Stage 1 look-and-feel build is complete and verified locally with placeholder data. The Next.js
App Router prototype runs locally via `npm run dev`, opens a centered segment-picker modal,
reads real YouTube durations through a hidden IFrame, supports two-handle dragging plus synced
time fields, validates segment limits, and submits a real provider-aware conversion job that
returns the app's own MP3 endpoint when complete.

Stage 2 has been redirected from the old single-provider flow to an approved provider fallback
prototype. The UI now defaults to automatic fallback, the internal API accepts `providerId`,
and the backend actively tries `youtube-mp36` first, then `youtube-mp3-2025` if needed.
`youtube-mp36` uses provider-side start/end cutting; `youtube-mp3-2025` downloads source
audio and uses local FFmpeg trimming/conversion. The implementation is verified by unit tests,
lint, production build, and a live auto-mode API smoke where `youtube-mp36` completed and
per-provider quota was returned. Broader reliability testing across more videos/segment
positions is still pending.

## Command Baseline
- Install: `npm install`
- Run: `npm run dev` (recent live smoke used the existing dev server at `http://localhost:3007`)
- Lint: `npm run lint`
- Test: `npm test`
- Build: `npm run build`
- Provider smoke script: `npm run providers:check -- "https://www.youtube.com/watch?v=VIDEO_ID"`
- Diagnostic logs: `YT_AUDIO_DEBUG=1 npm run providers:check -- "https://www.youtube.com/watch?v=VIDEO_ID"`

## Tasks — Stage 1 (look & feel, placeholder data)
- [x] T01 — Scaffold the Next.js app (App Router, JS) + a single page with URL input,
  "Choose segment" button, and an empty results area — done when the page renders at localhost.
- [x] T02 — Centered pop-up modal that opens on button click (with the pasted URL) and closes
  via ✕/Cancel/overlay — done when it toggles open/closed cleanly.
- [x] T03 — Hidden YouTube IFrame that loads the pasted video and reports its **duration**
  (and thumbnail if available), with a loading state and an error/retry if it can't read it —
  done when a real URL yields a duration the timeline can use (no visible playback).
- [x] T04 — Timeline scrubber: two draggable start/end handles + a highlighted selected range,
  spanning 0→duration, defaulting to the first ~15s — done when handles drag and report start/end.
- [x] T05 — Numeric Start/End inputs (mm:ss) synced two-way with the handles — done when editing
  either the input or the handle updates the other.
- [x] T06 — Client-side segment validation: min 1s, **max 6min**, end > start; disable "Convert"
  and show inline messages when invalid — done when invalid ranges block confirm.
- [x] T07 — Fake "convert": on confirm, show a converting state, then load a **sample MP3** into an
  audio player + a download button in the results area — done when a placeholder clip plays and downloads.

## Tasks — Stage 2 (make it live)
- [x] T08 — Env + config: read `RAPIDAPI_YOUTUBE_MP3_KEY` / `RAPIDAPI_YOUTUBE_MP3_HOST` server-side,
  validate at startup, add `.env.example` (names only), git-ignore `.env.local` — done when a missing
  key fails fast with a clear message and no secret is committed.
- [x] T09 — Manual API test FIRST: run one real `/download` + `/status/{id}` (playground/curl), save
  sanitized fixtures, and confirm the real job-id / status / download-URL field names — done when the
  live shapes are documented and fixtures saved. **(Needs the RapidAPI account/key — see setup in plan §7.)**
- [x] T10 — Provider adapter in `lib/` (`AudioSegmentProvider`: start + status) with tolerant parsing
  narrowed to the T09 findings; per-request timeouts — done when unit tests parse the fixtures correctly.
- [x] T11 — Internal job API: `POST /api/youtube-audio-segments` (start) + `GET /api/youtube-audio-segments/{jobId}`
  (status), with an in-memory job store and internal jobIds (provider id kept private) — done when start
  returns a jobId and status reflects the job.
- [x] T12 — Background poll loop: after start, poll provider status (initial ~1s, then ~2–3s + jitter,
  max ~60 attempts / ~180s), updating the job record — done when a real job transitions to complete/failed.
- [x] T13 — Fetch/stream the temporary MP3 to **local temp storage** with SSRF host-allowlist +
  content-type + size checks, and serve it via `GET /api/youtube-audio-segments/{jobId}/file` — done when
  a real clip plays and downloads from the app's own endpoint.
- [x] T14 — Wire the real flow into the UI: replace the fake convert (T07) with start→poll→ready; on
  complete, show the real audio player + download button — done when a real segment plays end to end.
- [ ] T15 — Robustness: idempotency fingerprint + duplicate-request prevention, concurrency cap (1–3),
  retries w/ backoff on 408/429/5xx (not 400/401/403), and error-code → UX mapping (plan §9) — done when
  error/timeout/duplicate paths behave per plan.
- [ ] T16 — Live smoke test with a short real authorized video: `startTime>0`, `startTime=0` (verify the
  flaky edge), a 5–10s clip from a long video, and a near-end segment; verify duration ≈ end−start via
  `ffprobe`; plus invalid URL, out-of-range times, unavailable video, two identical requests, bad key
  (non-prod) — done when a real segment plays end to end and the checks pass.

## Tasks — Multi-provider implementation (approved 2026-07-05)
- [x] MP01 — Add shared provider IDs/options and server-side host config for the three RapidAPI
  providers — done when UI/backend share IDs without exposing credentials.
- [x] MP02 — Add isolated provider adapters for `youtube-mp36`, `youtube-info-download-api`,
  and `youtube-mp3-2025` — done when each returns a normalized media request/result.
- [x] MP03 — Use `youtube-mp36` provider-side `cut=1&sStart=...&sEnd=...` instead of secondary
  FFmpeg trimming — done when its adapter returns `trimMode: "provider"`.
- [x] MP04 — Add safe media fetching, streamed file writes, size limits, JSON-link extraction,
  private-network rejection, and FFprobe validation — done when provider `200` is not treated as
  success until audio bytes are fetchable/probeable.
- [x] MP05 — Add static FFmpeg/FFprobe processing for local trim/convert providers — done when
  local providers produce final MP3 output and duration validation runs.
- [x] MP06 — Replace the fake UI conversion with real start→poll→ready flow and a provider
  selector — done when the UI submits `providerId` and uses the app file endpoint on completion.
- [x] MP07 — Add `providers:check` terminal script for manual provider testing with sanitized
  output — done when each provider can be tested independently without printing keys/signed URLs.
- [x] MP08 — Verify non-live implementation with `npm test`, `npm run lint`, and `npm run build`.
- [x] MP09 — Run live manual tests against all three providers and record reliability/results —
  done when all three providers complete at least one live dev-server UI conversion and the
  observed speed/reliability differences are recorded.
- [x] MP10 — Add safe diagnostic logging for failed provider tests — done when provider/media
  requests log sanitized host/path, status, content-type, quota headers, processing phase, and
  redacted error details without printing keys or signed URLs.
- [x] MP11 — Patch async/progress handling found by diagnostics — done when `youtube-mp36`
  waits for `processing` to become `ok`, and generic media handling polls progress URLs while
  rejecting thumbnails/event streams as final audio.
- [x] MP12 — Add local-provider format fallback — done when local-trim providers automatically
  retry another format if the first format returns undecodable audio or a timeout. The current
  two-provider flow now makes `youtube-mp3-2025` try MP3 first, then M4A.
- [x] MP13 — Fix Next dev-server static FFmpeg/FFprobe path resolution — done when imported
  `/ROOT/node_modules/...` paths fall back to the real local `process.cwd()/node_modules/...`
  binary paths.

## Tasks — Two-provider fallback and quota implementation
- [x] FP01 — Add automatic provider mode — done when validation accepts `auto`, it is the default
  UI/API mode, and manual provider IDs still validate.
- [x] FP02 — Limit user-facing providers to `youtube-mp36` and `youtube-mp3-2025` — done when
  `youtube-info-download-api` is hidden from the normal selector but can remain unused in code.
- [x] FP03 — Implement ordered provider runner — done when automatic mode tries `youtube-mp36`
  then `youtube-mp3-2025`, stops on success, and records attempts.
- [x] FP04 — Make `youtube-mp3-2025` MP3-first with M4A fallback — done when manual and fallback
  jobs try MP3 before M4A.
- [x] FP05 — Normalize per-provider quota summaries — done when only whitelisted RapidAPI quota
  headers are converted into browser-safe per-provider summaries.
- [x] FP06 — Return sanitized attempt/quota data from job status — done when polling responses
  include attempt status, final provider, and separate quota summaries without secrets.
- [x] FP07 — Update UI provider selector and quota display — done when automatic mode is default
  and results show provider attempts plus separate quotas.
- [x] FP08 — Add sanitized fallback diagnostics — done when logs explain fallback decisions without
  keys, signed URLs, or raw provider payloads.
- [x] FP09 — Add automated tests — done when provider options, fallback order, MP3-first behavior,
  quota normalization, and public job shape are covered.
- [x] FP10 — Run verification — done when `npm test`, `npm run lint`, `npm run build`, and the
  relevant smoke checks pass.

## Notes & Blockers
- Stage 1 verification completed:
  - `npm run lint` passes.
  - `npm run build` passes.
  - `npm test` passes with 0 tests (runner baseline only).
  - Browser checks verified modal open/close, hidden YouTube duration loading, handle dragging,
    synced time inputs, invalid-range blocking, and the fake MP3 result.
- T09 live schema notes:
  - `/download` requires query parameters; JSON body returned HTTP 400.
  - Job id field is `id`.
  - Status/download URL fields are `status` and `downloadUrl`.
  - A response with `downloadUrl` must normalize as complete even when `status` is still `CONVERTING`.
  - A response with `status: "CONVERSION_ERROR"` must normalize as failed even if `downloadUrl` is present.
  - Observed provider result hosts so far: `45.76.15.135`, `78.141.232.210`.
- T13/T14 verification:
  - The multi-provider processing path now fetches provider media into temp storage, probes/trims as
    needed, serves from the app file endpoint, and has completed live UI runs for all three providers.
- Multi-provider implementation verification completed:
  - `npm test` passes with provider utility/validation tests plus the existing legacy provider tests.
  - `npm run lint` passes.
  - `npm run build` passes.
  - Local UI smoke check at `http://localhost:3001` verified the provider selector renders.
  - API validation smoke checks verified invalid URL and invalid provider requests return stable errors.
  - Initial implementation verification did not run live provider conversions; MP09 is now complete
    and the broader T16 matrix remains pending.
  - Added diagnostic logging controlled by `YT_AUDIO_DEBUG=1`; development mode also emits
    sanitized `[yt-audio]` logs.
  - First live diagnostic run showed:
    - `youtube-mp36` returned `status: processing` before a final link was ready.
    - `youtube-info-download-api` returned a progress URL, then a thumbnail URL, which must not
      be treated as audio.
    - `youtube-mp3-2025` returned an SSE progress URL, which must be polled/parsed instead of
      sent to FFprobe as an M4A.
  - Second live diagnostic run showed:
    - `youtube-mp36` succeeded end to end for `0s` to `5s`, with a valid 5.04s MP3.
    - `youtube-info-download-api` eventually returned full M4A audio, but FFmpeg failed to decode
      that M4A cleanly, so MP3 fallback is now needed.
    - `youtube-mp3-2025` returned a direct M4A download URL that timed out with HTTP 504, so MP3
      fallback is now needed.
  - Third live diagnostic run showed:
    - `youtube-mp36` succeeded with provider-side cut and returned a valid 5.04s MP3.
    - `youtube-info-download-api` succeeded after M4A failed and MP3 fallback was used; final
      trimmed MP3 duration was 5.04s.
    - `youtube-mp3-2025` succeeded with M4A on the retry run; final trimmed MP3 duration was 5.04s.
  - Dev-server UI run initially failed for all providers because Next/Turbopack resolved
    `ffprobe-static` to `/ROOT/node_modules/...`; the FFmpeg helper now validates binary paths
    and falls back to the real local `node_modules` path.
  - Latest dev-server UI run showed:
    - `youtube-mp36` succeeded fastest: provider-side 15s cut, small 276 KB MP3, no local trim.
    - `youtube-info-download-api` succeeded slowest: M4A attempt returned undecodable audio,
      MP3 fallback downloaded the full 13.7 MB source, then FFmpeg trimmed locally.
    - `youtube-mp3-2025` succeeded with a direct 5.5 MB M4A source and local FFmpeg trim.
    - FFmpeg/FFprobe static binary fallback was confirmed in the dev server.
    - Diagnostic URL summaries now redact token-like path segments before logs are shared.
- Two-provider fallback and quota implementation verification:
  - `auto` is now the default UI/API provider mode.
  - User-facing provider choices are `auto`, `youtube-mp36`, and `youtube-mp3-2025`.
  - `youtube-info-download-api` remains in code but is hidden from normal validation/UI.
  - Automatic mode tries `youtube-mp36` first and `youtube-mp3-2025` second.
  - `youtube-mp3-2025` tries MP3 first, then M4A.
  - Job status responses include sanitized provider attempts and separate quota summaries.
  - Live API smoke on `http://127.0.0.1:3007` completed with requested provider `auto`,
    final provider `youtube-mp36`, a local download URL, ytjar quota remaining, and
    `youtube-mp3-2025` marked skipped/not checked.
  - `npm test`, `npm run lint`, `npm run build`, and a local page-load smoke all pass.
- **RapidAPI account/key required for live provider tests.** The key is present locally. All three
  providers have completed at least one live UI conversion; broader reliability testing is still pending.
- Keep the provider parser tolerant until T09 confirms the live schema (guide forbids hard-coding it).
- Background poll loop is localhost-only (in-process); production needs a durable worker (plan §11).
- No auth in the prototype — auth + rate limits are merge-time requirements.
- Verify `startTime = 0` behavior in T16 (historically flaky per the guide).

## Build Handoff
- Start with (from the project root): `read Temp_prototype_parts/YT-mp3_prototype_part/plan.md and progress.md and build`
- Tier: Simple (standalone prototype)
- Stack: Next.js App Router / JavaScript; `app/api/*` route handlers; provider adapter in `lib/`
- Start at: T01
- Keys/accounts the build needs: RapidAPI "YouTube to mp3" (key + subscription) — needed from **T09** on; see plan §7
- Reference: `Current .md docs/rapidapi-youtube-mp3-segment-integration-guide.md` (authoritative for the backend)
- Anything not already in plan.md: none — plan.md is the source of truth
