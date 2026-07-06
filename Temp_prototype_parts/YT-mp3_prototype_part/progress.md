# Progress — YouTube → MP3 Segment Prototype

## Tier
Simple (standalone prototype)

## Stack
Next.js (App Router) + JavaScript; Route Handlers under `app/api/*` keep the RapidAPI key
server-side. Provider adapter in `lib/`. In-memory job store + local temp-file storage (prototype only).

## Current State
Planning complete and approved. `plan.md` is written and self-contained. No code exists yet.
Next step is the Stage 1 look-and-feel build (placeholder data), then Stage 2 wires the live API.
Build has not started.

## Command Baseline
_(Confirm/refine after scaffolding the Next.js app.)_
- Install: `npm install`
- Run: `npm run dev` (open the printed localhost URL)
- Lint: `npm run lint`
- Test: `npm test` (add a runner during T05/Stage 2 if not scaffolded)
- Build: `npm run build`

## Tasks — Stage 1 (look & feel, placeholder data)
- [ ] T01 — Scaffold the Next.js app (App Router, JS) + a single page with URL input,
  "Choose segment" button, and an empty results area — done when the page renders at localhost.
- [ ] T02 — Centered pop-up modal that opens on button click (with the pasted URL) and closes
  via ✕/Cancel/overlay — done when it toggles open/closed cleanly.
- [ ] T03 — Hidden YouTube IFrame that loads the pasted video and reports its **duration**
  (and thumbnail if available), with a loading state and an error/retry if it can't read it —
  done when a real URL yields a duration the timeline can use (no visible playback).
- [ ] T04 — Timeline scrubber: two draggable start/end handles + a highlighted selected range,
  spanning 0→duration, defaulting to the first ~15s — done when handles drag and report start/end.
- [ ] T05 — Numeric Start/End inputs (mm:ss) synced two-way with the handles — done when editing
  either the input or the handle updates the other.
- [ ] T06 — Client-side segment validation: min 1s, **max 6min**, end > start; disable "Convert"
  and show inline messages when invalid — done when invalid ranges block confirm.
- [ ] T07 — Fake "convert": on confirm, show a converting state, then load a **sample MP3** into an
  audio player + a download button in the results area — done when a placeholder clip plays and downloads.

## Tasks — Stage 2 (make it live)
- [ ] T08 — Env + config: read `RAPIDAPI_YOUTUBE_MP3_KEY` / `RAPIDAPI_YOUTUBE_MP3_HOST` server-side,
  validate at startup, add `.env.example` (names only), git-ignore `.env.local` — done when a missing
  key fails fast with a clear message and no secret is committed.
- [ ] T09 — Manual API test FIRST: run one real `/download` + `/status/{id}` (playground/curl), save
  sanitized fixtures, and confirm the real job-id / status / download-URL field names — done when the
  live shapes are documented and fixtures saved. **(Needs the RapidAPI account/key — see setup in plan §7.)**
- [ ] T10 — Provider adapter in `lib/` (`AudioSegmentProvider`: start + status) with tolerant parsing
  narrowed to the T09 findings; per-request timeouts — done when unit tests parse the fixtures correctly.
- [ ] T11 — Internal job API: `POST /api/youtube-audio-segments` (start) + `GET /api/youtube-audio-segments/{jobId}`
  (status), with an in-memory job store and internal jobIds (provider id kept private) — done when start
  returns a jobId and status reflects the job.
- [ ] T12 — Background poll loop: after start, poll provider status (initial ~1s, then ~2–3s + jitter,
  max ~60 attempts / ~180s), updating the job record — done when a real job transitions to complete/failed.
- [ ] T13 — Fetch/stream the temporary MP3 to **local temp storage** with SSRF host-allowlist +
  content-type + size checks, and serve it via `GET /api/youtube-audio-segments/{jobId}/file` — done when
  a real clip plays and downloads from the app's own endpoint.
- [ ] T14 — Wire the real flow into the UI: replace the fake convert (T07) with start→poll→ready; on
  complete, show the real audio player + download button — done when a real segment plays end to end.
- [ ] T15 — Robustness: idempotency fingerprint + duplicate-request prevention, concurrency cap (1–3),
  retries w/ backoff on 408/429/5xx (not 400/401/403), and error-code → UX mapping (plan §9) — done when
  error/timeout/duplicate paths behave per plan.
- [ ] T16 — Live smoke test with a short real authorized video: `startTime>0`, `startTime=0` (verify the
  flaky edge), a 5–10s clip from a long video, and a near-end segment; verify duration ≈ end−start via
  `ffprobe`; plus invalid URL, out-of-range times, unavailable video, two identical requests, bad key
  (non-prod) — done when a real segment plays end to end and the checks pass.

## Notes & Blockers
- **RapidAPI account/key required from T09 onward** — the user does not have one yet; follow plan §7 to
  subscribe and get the key before Stage 2 live tasks. Stage 1 (T01–T07) needs no key.
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
