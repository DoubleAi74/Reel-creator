# Plan — YouTube → MP3 Segment Prototype

> Standalone prototype, built to work well in isolation first, then merged into the
> main `reel-creator` Next.js app. This document is self-contained: a fresh build
> agent should be able to build from `plan.md` + `progress.md` alone.
>
> **Authoritative backend reference:** `Current .md docs/rapidapi-youtube-mp3-segment-integration-guide.md`.
> Where the initial note and that guide disagree on backend behavior, the guide wins.

## 1. Goal & summary
A lightweight page where the user pastes a YouTube link and presses a button, which
opens a **centered modal**. In the modal the user picks **one segment** of the video
by dragging **two boundary handles** (start / end) on a static timeline, with synced
numeric time fields for precision. Confirming sends a server-side request to the
RapidAPI "YouTube to mp3" provider for exactly that segment. When the clip is ready,
an **audio player + download button** appear below the input so the user can play or
save the MP3. It's for quickly grabbing an authorized audio clip from a video, and is
a prototype for a feature that will later live in the main app's audio tab.

## 2. Scope

### In scope (v1)
- Single-page UI: URL text input, a button, and a results area below it.
- Centered pop-up modal triggered by the button.
- **Hidden** YouTube IFrame used only to read the video's **duration** (and thumbnail);
  no visible playback.
- Static timeline scrubber with **two draggable handles** (start/end) + **synced numeric
  start/end time inputs**.
- Segment limits enforced client- and server-side: **min 1s, max 6 minutes**.
- Server-side async conversion flow (start → poll → fetch), key kept server-side.
- Download the finished MP3 to **local temp storage**, served via the app's own endpoint.
- Results area shows an **audio player** (play) **and a download button**.
- Error/timeout/retry/idempotency handling per the API guide.
- Manual API test + mandatory live smoke test.

### Out of scope (v1)
- Multiple segments / a clip list per session — **one segment per session** only.
- Live video playback in the modal (static scrubber only, by decision).
- User accounts / login / auth — **runs open on localhost** (auth is a merge-time requirement).
- User-selectable MP3 quality — **fixed default** (real `quality` param behavior confirmed
  during the manual API test).
- Persistent database, object storage (S3, etc.), background job system — a durable
  store/worker is a **merge-time** upgrade; the prototype uses an in-memory job map +
  local temp files.
- Deployment — local run only.

## 3. Stack & rationale
- **Framework:** **Next.js — App Router**, JavaScript (no TypeScript). Chosen over the
  plain-HTML + mini-Node-server option so the async job flow, the hidden IFrame, and the
  scrubber live in one place, and so this is trivial to merge into `reel-creator` (same
  stack: Next.js 16 / React 19 / JS).
- **Backend:** Next.js **Route Handlers** under `app/api/*` act as the "minimal server"
  that keeps the RapidAPI key server-side and runs the start→poll→fetch flow. The browser
  never sees the key.
- **Styling:** plain CSS or Tailwind — builder's choice; keep it simple and clean.
- **Provider isolation:** a `lib/` provider adapter (see §6) wraps RapidAPI behind a small
  interface so it can be swapped without touching routes/UI.
- **Language is fixed to JavaScript** (merge target is JavaScript).

## 4. User flow (step by step)
1. **Idle.** Page shows a URL input, a "Choose segment" button, and an empty results area.
2. **Paste + click.** User pastes a YouTube URL and clicks the button.
   - If the URL isn't a valid YouTube URL, show an inline error and don't open the modal.
3. **Modal opens (loading video).** Modal appears centered; a hidden YouTube IFrame loads
   to read the video's **duration** (and thumbnail). Timeline shows a loading state until
   duration is known. If duration can't be read, show an error with a retry/close.
4. **Select segment.** Timeline spans 0 → duration. Two handles (start/end) are draggable;
   numeric start/end inputs stay in sync (edit either). Default span opens at the **first
   ~15s** (or the whole video if shorter). Enforce min 1s / max 6min; block confirm if invalid.
5. **Confirm.** User clicks "Convert segment". Modal shows a **converting/polling** state.
   Client calls `POST /api/youtube-audio-segments` and gets an internal `jobId`.
6. **Convert (async, server-side).** Server validates, dedupes (idempotency), calls the
   provider's `/download`, stores the provider job id, then polls `/status/{id}` in the
   background until complete/failed/timeout. On completion it downloads the temp MP3 URL
   to local temp storage (SSRF + size/type checks).
7. **Poll.** Client polls `GET /api/youtube-audio-segments/{jobId}` every ~2–3s until
   `complete` or `failed`.
8. **Ready.** On `complete`, modal closes; results area shows an **audio player** (source =
   the app's own file endpoint) **and a download button**.
9. **Error states** (any step): friendly message + retry/close (see §9).

## 5. UI & layout
- **Page:** URL input, "Choose segment" button, results area (audio player + download button
  render here after success).
- **Modal (centered overlay):**
  - Header: video title (from provider `/title` or IFrame) + close (✕).
  - Hidden IFrame (offscreen/`display` handled so it's not visibly playing) — duration source.
  - Timeline scrubber: full-width bar, two draggable handles, a highlighted selected range.
  - Numeric **Start** / **End** inputs (mm:ss or seconds), synced with handles.
  - Read-out of selected length; inline validation for min 1s / max 6min.
  - "Convert segment" (primary) + "Cancel" (secondary) buttons.
- **States:** `idle` → `loading video` (reading duration) → `selecting` → `converting`
  (progress/polling) → `ready` → `error`. Each has a clear visual.

## 6. Backend / API design

### Endpoints the front end calls (internal, job-based)
- `POST /api/youtube-audio-segments` — start a conversion.
  - Request: `{ "url": string, "startTime": number, "endTime": number }`
  - Response: `{ "jobId": string, "status": "queued" }`
- `GET /api/youtube-audio-segments/{jobId}` — read status.
  - Processing: `{ "jobId", "status": "processing" }`
  - Complete: `{ "jobId", "status": "complete", "downloadUrl": "/api/youtube-audio-segments/{jobId}/file" }`
  - Failed: `{ "jobId", "status": "failed", "errorCode": "..." }`
- `GET /api/youtube-audio-segments/{jobId}/file` — streams the stored MP3 (used by both the
  `<audio>` player and the download button; download sets `Content-Disposition: attachment`).

**Use an internal jobId in public URLs; store the provider's id privately** (never expose it).

### Provider adapter (server-only) — `lib/`
Wrap RapidAPI behind a small interface so it's swappable:
```
interface AudioSegmentProvider {
  start(input): Promise<{ providerJobId }>
  status(providerJobId): Promise<NormalizedConversionStatus>
}
```
- `start` → `POST https://{HOST}/download` with `{ url, format: "mp3", startTime, endTime }`
  and headers `X-RapidAPI-Key`, `X-RapidAPI-Host`. Parse the job id tolerantly
  (`id|jobId|conversionId|...`) per the guide's `findString` approach.
- `status` → `GET /status/{id}`; normalize to `queued|processing|complete|failed|unknown`
  and extract a `downloadUrl` when present. **The exact live schema must be confirmed by the
  manual API test (§10) before narrowing the parser** — do not hard-code an assumed schema.

### Async flow (per the guide — not a single blocking request)
- On `POST`: validate → compute idempotency fingerprint → dedupe → provider `start` →
  create internal job record (`queued`) → **kick off a background poll loop** → return `jobId`.
- Background loop polls provider `/status/{id}`: initial delay ~1s, then ~2–3s with jitter,
  **max ~60 attempts / ~180s**. On `complete`, fetch + store the file, mark job `complete`.
  On `failed`/timeout, mark job `failed` with an error code. Stop on cancel/expiry.
- `GET status` just reads the internal job record (no open-request polling of RapidAPI).

> **Prototype note:** the background loop runs inside the local Next dev/node process, which
> is fine for localhost. In production/serverless this must become a durable worker
> (BullMQ/Inngest/Cloud Tasks/etc.) — recorded as a merge follow-up (§11).

### Request/response shapes to confirm during the manual API test
- The real `/download` success body and the **field name of the job id**.
- The real `/status/{id}` bodies for processing vs complete, and the **download-URL field name**.
- Whether/how the `quality` param works, and `startTime = 0` behavior (flagged in the guide).

### Robustness (bake in)
- **Timeouts:** `AbortSignal.timeout(~20s)` on every provider request.
- **Retries:** retry network errors and `408/429/selected 5xx` with exponential backoff
  (immediate, 1s, 2s, 4s); **do not** blindly retry `400/401/403`; limit retries to avoid
  duplicate charges.
- **Idempotency:** fingerprint = normalized videoId + startTime + endTime + format + quality
  (user id added at merge). Reuse an active/recent matching job instead of issuing a duplicate
  `/download` (prevents duplicate jobs on refresh/double-click). In-memory `Map` for the prototype.
- **Concurrency cap:** limit to ~1–3 concurrent conversions (moderate expected volume).
- **SSRF protection:** the provider-supplied result URL is fetched server-side with
  `redirect: "follow"` but restricted to the **provider host(s) observed during integration
  testing** (allowlist); validate **content-type** (`audio/*` or `application/octet-stream`)
  and **size** (cap, e.g. 100 MB). Never a general "fetch any client URL" endpoint.
- **Logging:** never log the API key or full provider responses; redact temporary signed URLs.

## 7. External service setup (for the user)
The user does **not** yet have a subscribed RapidAPI account, so include these steps:
1. Open the listing: <https://rapidapi.com/marcocollatina/api/youtube-to-mp315> and sign in.
2. Open **Pricing** and select a plan. Record (in internal notes) the request allowance,
   rate limit, overage cost, and whether **status polls / failed conversions are billable**
   (one user conversion = one `/download` + several `/status` calls — not one billable request).
3. Open **Playground**, select `POST /download`, and confirm the host
   (`youtube-to-mp315.p.rapidapi.com`) and header names (`X-RapidAPI-Key`, `X-RapidAPI-Host`).
4. Copy the RapidAPI **key** into `.env.local` (never into source, logs, or chat).
5. Run one short authorized test conversion in the playground and save the exact JSON — this
   feeds the manual API test in §10.

## 8. Environment variables (names + purpose only — never values)
- `RAPIDAPI_YOUTUBE_MP3_KEY` — the RapidAPI key; **server-only**, validated at startup.
- `RAPIDAPI_YOUTUBE_MP3_HOST` — provider host, defaults to `youtube-to-mp315.p.rapidapi.com`.
- (optional) `YT_MP3_TMP_DIR` — path for local temp MP3 storage; defaults to an OS temp subdir.

Provide a `.env.example` with these **names only** (host default may be shown; key left blank).
Ensure `.env.local` / `.env*.local` are git-ignored.

## 9. Error & failure handling
Map provider/internal failures to stable app error codes (`INVALID_INPUT`, `UNSUPPORTED_VIDEO`,
`SEGMENT_TOO_LONG`, `PROVIDER_RATE_LIMITED`, `PROVIDER_AUTH_FAILED`, `PROVIDER_REJECTED`,
`PROVIDER_TIMEOUT`, `PROVIDER_MALFORMED_RESPONSE`, `CONVERSION_FAILED`, `RESULT_EXPIRED`,
`INTERNAL_ERROR`). Never expose the API key, raw stack traces, or raw provider fields to the client.

| Situation | User sees | HTTP (internal) |
|---|---|---|
| Invalid / non-YouTube URL | Inline "Enter a valid YouTube link"; modal won't open | 400 |
| Bad times (end ≤ start, >6min, <1s) | Inline validation in modal; confirm disabled | 400 |
| Duration can't be read (blocked embed) | Modal error + retry/close | — |
| Unsupported / private / age-restricted / unavailable video | "This video can't be converted" | 422 |
| Provider auth error (401/403) | Generic "Service unavailable, try later"; log config error | 502 |
| Provider rate-limited (429) | "Busy right now, try again shortly" | 503/429 |
| Provider 5xx | "Conversion service error" | 502 |
| Conversion timeout (>~180s) | "Took too long — try a shorter clip" | 504 / terminal failed |
| Missing/expired result URL | "Clip expired, please retry" | 410 |

## 10. Validation & smoke tests (how we'll know it works)
- [ ] **Manual API test first:** run one real `/download` + `/status/{id}` (playground or curl),
      save sanitized fixtures, and confirm the real request/response shapes (job-id field,
      status values, download-URL field). Narrow the parser to match.
- [ ] Unit tests: URL validation (valid `youtube.com` + `youtu.be`, negative start, end ≤ start,
      >6min, non-YouTube, malformed); provider client (extracts id, recognizes queued/processing/
      complete + url, recognizes failure, rejects malformed, maps 429/5xx, times out).
- [ ] Job flow: starts exactly one provider job, dedupes duplicates, polls to completion, stops on
      failure/timeout, downloads result, rejects wrong content-type / oversized, never returns the key.
- [ ] **Mandatory live smoke test** with a short real authorized YouTube video: segment with
      `startTime > 0`, one with `startTime = 0` (verify this edge — historically flaky), a 5–10s clip
      from a long video, and a segment near the end. Verify output duration ≈ `endTime − startTime`
      via `ffprobe`. Also test an invalid URL, out-of-range times, an unavailable video, two identical
      simultaneous requests, and an intentionally bad key (non-prod).

## 11. Merge notes (into the main reel-creator project)
- **Target stack:** Next.js App Router / JavaScript (Next 16 / React 19) — same as the prototype,
  so the merge is low-friction.
- **Likely home (user's intent):** surface it **inside the existing Audio tab**
  (`components/tabs/audio-tab.js`) — a button (and/or pasting a URL then pressing a button) opens
  the **segment-picker modal**; the produced clip flows into the editor's audio handling. Reuse the
  app's existing audio/preview components (e.g. `components/preview-player.js`) rather than a new
  standalone `<audio>` where it fits.
- **Route home:** move the routes under `app/api/youtube-audio-segments/*`; keep the provider
  adapter in `lib/` (matches the repo's `lib/ai/*` pattern).
- **Follow-ups needed at merge time:**
  - Add **auth** + **per-user/per-IP rate limits** (required by the guide for production).
  - Replace the in-memory job `Map` with a **durable store** (DB) and the fire-and-forget poll
    loop with a **background worker/durable job system**.
  - Replace **local temp storage** with the app's real storage strategy; apply a retention/cleanup policy.
  - Reconcile env-var names/`.env.example` with the app's existing config.
  - Add the idempotency **userId** to the fingerprint.

## 12. Assumptions & open questions
- **A1 — Default segment span:** modal opens with handles at the first ~15s (or whole video if
  shorter). Low risk; easy to change. *(Assumed, not asked.)*
- **A2 — Time input format:** numeric inputs shown as mm:ss (accepting raw seconds too). Cosmetic.
- **A3 — Live provider schema unknown** until the manual API test; the parser stays tolerant until
  then. Risk: wiring parsing before testing → guide forbids it, so §10 gates this.
- **A4 — Background poll loop in-process** is acceptable for localhost only; **not** production-safe
  (see §11). Risk if run serverless before the merge upgrade.
- **A5 — `startTime = 0` may misbehave** on this provider (guide's caution); must be verified in the
  smoke test, with a fallback (e.g. nudge to a tiny offset) only if confirmed broken.
- **A6 — Thumbnail source:** IFrame/oEmbed thumbnail is nice-to-have; if unavailable, timeline renders
  without it. No functional impact.
- **Open:** exact provider pricing/limits — to be recorded once the user subscribes (§7).
