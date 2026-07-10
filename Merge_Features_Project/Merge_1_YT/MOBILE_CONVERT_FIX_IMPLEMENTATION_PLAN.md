# YouTube Convert Resilience Fix — Implementation Plan

**Status:** Ready for a fresh implementation agent  
**Date:** 2026-07-10  
**Branch recommendation:** create `fix/youtube-convert-resilience` off current working branch (or `codex/phase-2-credit-dashboard` / `repair/phase-1-2-programme` as directed by the user)  
**Scope:** Fix mobile convert hangs at phase `downloading` / generic failures without redesigning the YouTube feature or the credit layer  

---

## 0. Problem statement (verified against live symptoms + code)

### Observed (user report)
1. Desktop YouTube → MP3 works.
2. iPhone (Safari, Chrome, Firefox — all WebKit) fails even for **very short** segments.
3. UI status advances through:
   - `Preparing audio...` (client local)
   - `Requesting audio...` (server phase `calling_provider`)
   - `Downloading source audio...` (server phase `downloading`)
4. Then it **sticks** on downloading and eventually:
   - times out, or
   - shows **“YouTube import failed unexpectedly.”** (`INTERNAL_ERROR` / unmapped error)

### What that means in code
| UI message | Source | Implication |
|---|---|---|
| Preparing audio | `handleConvert` local `setMessage` | Client started convert |
| Requesting audio | `statusMessage("calling_provider")` | Server job running |
| Downloading source audio | `statusMessage("downloading")` | Provider URL obtained; **server** is fetching media |

So the failure is **not** primarily:
- Hidden YouTube IFrame duration probe (that would fail *before* Convert, with “Video details could not be loaded”)
- In-modal player absence
- Credits / unlock password

The failure is in the **server-owned download/trim job** and/or the **client’s fragile poll wait** while that job runs.

### Architecture fact (important)
Short `startTime`/`endTime` does **not** mean a small download. Flow:

1. RapidAPI provider returns a media URL (often full/large audio).
2. Server phase `downloading`: `fetchMediaToFile` writes the file (`DEFAULT_MEDIA_TIMEOUT_MS = 45_000`).
3. Server then trims/converts (`trimming` / `finalizing`) via ffmpeg.
4. Job marked `complete`; client poll GET ingests into session assets.

Download work is **server-side**. Desktop vs phone should not change the download itself — but **iOS throttles JS timers/`fetch` when backgrounded**, so the UI poll can die while the server is still working (or can surface a generic error after poll budget / job failure).

### Goals
1. Convert remains **server-owned** (download + trim on server).
2. Client becomes a **resumable waiter** (survive iOS background / tab freeze).
3. Server download is **retryable** with **honest error codes**.
4. No credit-layer changes; no provider redesign; no client-side MP3 download.

### Non-goals
- Building a visible in-modal YouTube player as the fix for download hangs.
- Rewriting RapidAPI providers.
- Changing segment bounds (1s–6min) or auth model.
- Making jobs durable across **server restarts** (still in-memory) — optional follow-up, not required for this fix.
- Phase-2 credits / dashboard work.

---

## 1. Authority and constraints

1. User instructions for this fix.
2. This plan.
3. Live code under:
   - `components/youtube-segment-modal.js`
   - `components/editor-shell.js` (completion handoff only)
   - `app/api/youtube-audio-segments/route.js`
   - `app/api/youtube-audio-segments/[jobId]/route.js`
   - `lib/youtube-audio/*` especially `processing.js`, `provider-runner.js`, `segment-builder.js`, `media-fetcher.js`, `job-store.js`
4. Existing tests: `app/api/youtube-audio-segments/route.test.js`, `lib/youtube-audio/media-fetcher.test.js`, `lib/youtube-audio/storage.test.js`, etc.

**Do not edit:** credit repair docs unless user asks; do not change `CREDITS_ENABLED` behaviour.

**Keep:** `CREDITS_ENABLED=false` default; YT feature still gated by RapidAPI key.

---

## 2. Current code map (agent must re-read before editing)

### Client — `components/youtube-segment-modal.js`
- `POLL_INTERVAL_MS = 2200`, `MAX_POLL_ATTEMPTS = 120` (~4.4 min max wait).
- `handleConvert()`:
  1. POST `/api/youtube-audio-segments` with `{ url, startTime, endTime }`, `credentials: "same-origin"`.
  2. `pollConversionJob(jobId)` loops GET `/api/youtube-audio-segments/${jobId}`.
  3. On `status === "complete"` and `payload.asset.assetId`, calls `onComplete(asset)`.
- `statusMessage(phase)` maps server phases to UI copy.
- `ERROR_COPY` maps `errorCode` → user strings; missing codes fall through to `INTERNAL_ERROR` (“failed unexpectedly”).
- **Gap:** no persistence of `jobId`; no resume on `visibilitychange` / focus; poll exhaustion message is generic.

### Server start — `app/api/youtube-audio-segments/route.js`
- POST creates/reuses job via `createOrReuseJob`, attaches session cookie, `startBackgroundProcessing(job.id)`.
- Best-effort `sweepStaleYoutubeAudioResults()` (already wired).

### Server process — `lib/youtube-audio/processing.js`
- In-memory queue, max 2 concurrent.
- `processJob`: mark `calling_provider` → `runProviderSegmentJob` → `markJobStored` / on error `markJobFailed(errorCodeFromError(error))`.
- Unknown errors → `INTERNAL_ERROR`.

### Download — `lib/youtube-audio/provider-runner.js` + `segment-builder.js` + `media-fetcher.js`
- After provider prepare: `onPhase("downloading")`.
- `buildYoutubeAudioSegment` → `fetchMediaToFile` (45s default timeout, redirect-hardened SSRF checks).
- Format/provider fallbacks already exist for some error codes via `shouldTryNextFormat` / provider plan.

### Poll / ingest — `app/api/youtube-audio-segments/[jobId]/route.js`
- Incomplete: returns `publicJob(job)` (status, phase, errorCode if failed).
- Complete + session cookie: `storeAudioAssetFromPath` + return `asset`.
- Complete **without** session cookie: returns public job **without** `asset` (client will throw “completed without an audio asset”).

### Job store — `lib/youtube-audio/job-store.js`
- In-memory `Map`; `JOB_TTL_MS = 1h`.
- `publicJob` includes `jobId`, `status`, `phase`, `errorCode` (failed only).

### Editor handoff — `components/editor-shell.js`
- `handleYoutubeSegmentComplete(asset)` updates audio upload + project audio; closes modal.

---

## 3. Target behaviour (acceptance)

### A. Server download resilience
1. Transient media download failures (`PROVIDER_TIMEOUT`, network abort) are **retried** a small fixed number of times (default **2 retries** = 3 attempts total) with short backoff.
2. Permanent failures still fail the job with a **stable `errorCode`**.
3. Diagnostics log include `jobId`, phase, attempt index, and safe host/error (no secrets).
4. Uncaught generic `Error` without `errorCode` still maps to `INTERNAL_ERROR`, but known media/provider errors must not collapse to that.

### B. Client resume-safe polling
1. On successful POST, persist in-flight job: `{ jobId, sourceUrl, startedAt }` in `sessionStorage` (key namespaced, e.g. `reel-creator:yt-audio-job`).
2. Polling continues as today while the page is active.
3. On `document.visibilitychange` (visible) and `window` `focus`, if a stored in-flight job exists and modal is open (or resume path runs), **resume polling** that `jobId` without creating a new job.
4. On modal open: if stored job matches current `sourceUrl` (or is still active), offer/auto-resume poll instead of only starting fresh (auto-resume is preferred for simplicity).
5. On terminal state (`complete` with asset, or `failed`): clear storage.
6. Poll budget: either increase slightly **or** reset attempt counter on each resume (preferred: **resume resets the poll attempt counter** so background freeze does not burn the budget).
7. User-visible errors use `ERROR_COPY[errorCode]` whenever server sends `errorCode`.

### C. Explicit non-regressions
1. Desktop convert still works (same API).
2. Feature disabled without RapidAPI key.
3. Session cookie still required for asset ingest on complete (document that mobile must allow cookies for same-origin; do not invent a new auth model).
4. No change to credit routes.

---

## 4. Design decisions (settled for the implementer)

| ID | Decision | Rationale |
|---|---|---|
| F1 | **No in-modal player** in this fix | Does not affect server download phase |
| F2 | **Server downloads stay server-side** | Security, CORS, battery, existing pipeline |
| F3 | **Client stores jobId + resumes poll** | Fixes iOS timer/fetch suspension UX |
| F4 | **Retry media download only** (not full provider prepare by default on every timeout) | First retry: re-`fetchMediaToFile` with same `providerResult`; if still failing, existing provider/format fallback may already apply at runner level — keep retry inside `buildYoutubeAudioSegment` or a thin helper around `fetchMediaToFile` |
| F5 | **sessionStorage** not localStorage | Clears with tab session; less stale job confusion |
| F6 | **Resume resets client poll attempts** | Background freeze should not consume poll budget |
| F7 | Do **not** require Redis/DB job store in this fix | Out of scope; in-memory jobs remain |

---

## 5. Implementation stages (execute in order)

Each stage: implement → add/adjust tests → run targeted tests → then full `npm test`, `npm run lint`, `npm run build` before marking the stage done.

---

### Stage A — Server: media download retry + error hygiene

#### A.1 Inspect and instrument (read-only first)
1. Re-read `lib/youtube-audio/media-fetcher.js` (`DEFAULT_MEDIA_TIMEOUT_MS`, `fetchMediaToFile`, error codes).
2. Re-read `lib/youtube-audio/segment-builder.js` download call site.
3. Re-read `errorCodeFromError` in `processing.js` and `provider-runner.js` (keep consistent).

#### A.2 Add a small retry helper (prefer colocated, testable)
**Recommended location:** `lib/youtube-audio/media-fetcher.js` (export for tests) **or** `lib/youtube-audio/segment-builder.js` private helper if you want zero public API surface.

**Behaviour:**
```text
attempt = 0
while true:
  try:
    return await fetchMediaToFile(...)
  catch error:
    if not isTransientMediaError(error) or attempt >= MAX_MEDIA_DOWNLOAD_RETRIES:
      throw error
    attempt += 1
    logDiagnostic("media-download-retry", { jobId?, attempt, errorCode })
    await delay(backoffMs(attempt))  // e.g. 500ms, 1500ms
```

**Transient codes (minimum set):**
- `PROVIDER_TIMEOUT`
- Optionally network-ish failures that already map to `PROVIDER_TIMEOUT` in media-fetcher

**Do not retry** (examples):
- `PROVIDER_MALFORMED_RESPONSE` for private IP / SSRF blocks
- `PROVIDER_REJECTED` (HTTP 4xx from media host that is permanent)
- Size limit exceeded if mapped as non-timeout

**Config (optional env, with safe defaults):**
- `YT_MEDIA_DOWNLOAD_RETRIES` default `2`
- Keep timeout default 45s unless logs prove need; if adding env `YT_MEDIA_TIMEOUT_MS`, document in `YOUTUBE_AUDIO_SETUP.md` only.

#### A.3 Wire retry into `buildYoutubeAudioSegment`
Replace the single `fetchMediaToFile` call with the retry wrapper. Pass `jobId` into diagnostics when available (`job.id`).

#### A.4 Ensure phase stays accurate
- Keep `onPhase?.("downloading")` **before** download starts (already done in provider-runner before `buildYoutubeAudioSegment`).
- Do **not** flip phase back to `calling_provider` on media retry.
- On final failure, `processJob` catch already `markJobFailed` with code.

#### A.5 Tests (required)
Add/extend `lib/youtube-audio/media-fetcher.test.js` and/or new `segment-builder` unit test with mocked `fetch`:

1. **Succeeds on second attempt** after first `PROVIDER_TIMEOUT`.
2. **Does not retry** SSRF/private IP style `PROVIDER_MALFORMED_RESPONSE`.
3. **Exhausts retries** then throws with original error code.
4. Existing media-fetcher SSRF tests remain green.

#### A.6 Validation gate
```bash
npx vitest run lib/youtube-audio/media-fetcher.test.js
# plus any new segment-builder tests
npm run lint
```

---

### Stage B — Client: job persistence + resume polling

#### B.1 Storage helper (same file or tiny module)
Inside `components/youtube-segment-modal.js` (acceptable) or `lib/youtube-audio/client-job-session.js` (if you want unit-test without React):

```text
STORAGE_KEY = "reel-creator:yt-audio-inflight"

saveInflightJob({ jobId, sourceUrl, startedAt })
loadInflightJob() -> null | { jobId, sourceUrl, startedAt }
clearInflightJob()
```

- Guard `typeof window === "undefined"`.
- JSON parse safely; corrupt data → clear + null.
- Optional: ignore jobs older than e.g. 55 minutes (under `JOB_TTL_MS`).

#### B.2 Refactor poll loop for reuse
Extract from `handleConvert`:

```text
async function pollConversionJob(jobId, requestId, { resetAttempts = true } = {})
```

Requirements:
1. Loop with `POLL_INTERVAL_MS`.
2. **On each successful poll**, update status message from `payload.phase`.
3. `status === "complete"` → return payload (caller checks asset).
4. `status === "failed"` or `!response.ok` → throw `errorMessage(payload.errorCode)`.
5. 404 `RESULT_EXPIRED` → clear inflight + throw friendly copy.
6. Abort if `activeRequestRef.current !== requestId` (modal closed / superseded).
7. Export/test pure `errorMessage` behaviour remains.

#### B.3 On convert start
After POST returns `jobId`:
1. `saveInflightJob({ jobId, sourceUrl, startedAt: Date.now() })`.
2. Start poll.
3. On success with asset: `clearInflightJob()`, `onComplete`, close.
4. On failure: `clearInflightJob()` (or keep on “still running” if you choose — **prefer clear on definitive fail; keep on client-only poll budget exhaustion** so resume can still pick up a completed server job).

**Settled rule for poll budget exhaustion:**
- Do **not** clear storage.
- Message: e.g. “Still converting on the server. Keep this page open or reopen the import to check status.”
- Status stays `converting` or a new `status: "waiting"` if cleaner — prefer keep `converting` with that message, or `ready` with error styling. **Recommendation:** `status = "error"` with non-fatal copy is confusing; use `status = "converting"` + message, and enable a “Check status” button **or** auto-resume on visibility. Simplest: stay `converting`, message as above, resume on visibility.

#### B.4 Visibility / focus resume
In `YoutubeSegmentModal` when `isOpen`:

```text
useEffect:
  if !isOpen return
  function onVisible():
    if document.visibilityState !== "visible" return
    const inflight = loadInflightJob()
    if !inflight?.jobId return
    if sourceUrl is set and inflight.sourceUrl !== sourceUrl return  // optional strictness
    if already polling (activeRequestRef / pollingRef) return
    start resume poll (new requestId, resetAttempts true)
  document.addEventListener("visibilitychange", onVisible)
  window.addEventListener("focus", onVisible)
  cleanup remove listeners
```

Use a `pollingRef` boolean so two polls never run concurrently for the same modal.

#### B.5 Resume on modal open
When `isOpen` becomes true:
1. After (or parallel to) video info load, if `loadInflightJob()` has a jobId:
   - Optionally GET once immediately.
   - If `complete` with asset → complete flow.
   - If `failed` → show error, clear storage.
   - If `processing`/`queued` → auto-start resume poll and set UI to converting.

**Matching rule:** resume if `inflight.sourceUrl` equals current `sourceUrl` (normalise trim). If different URL, leave storage alone or clear only when user starts a new convert (new convert overwrites storage).

#### B.6 New convert overwrites
Starting a new successful POST always `saveInflightJob` (overwrite). Do not allow two concurrent client waits.

#### B.7 Close modal while converting
Current code blocks close while `converting` — **keep that** (good).  
If user navigates away without unmounting carefully, storage still allows resume on return.

#### B.8 ERROR_COPY updates
Add/adjust strings:
- Poll exhaustion (client): not an `errorCode` — dedicated message in throw/setMessage.
- Ensure `RESULT_EXPIRED`, `PROVIDER_TIMEOUT`, `INTERNAL_ERROR` remain correct.
- Prefer showing server `errorCode` in dev? **No** in production UI beyond mapped copy; optional append code in parentheses only if already done nowhere — skip unless useful.

#### B.9 Tests
Client is React; options:

1. **Unit-test pure helpers** (storage + error mapping + poll state machine) in a new `components/youtube-segment-modal.helpers.test.js` if helpers are extracted without DOM.
2. Or extract `lib/youtube-audio/client-inflight-job.js` + `poll-policy.js` with vitest (no jsdom required if no DOM APIs beyond sessionStorage mock).

**Minimum required tests:**
1. save/load/clear inflight job (mock `sessionStorage`).
2. corrupt JSON → null + clear.
3. `errorMessage` maps known codes (if not already covered).
4. Optional: poll helper with mocked `fetch` sequence: processing → complete.

#### B.10 Validation gate
```bash
npx vitest run lib/youtube-audio/  # and any new client helper tests
npm run lint
```

---

### Stage C — Status API small hardening (only if needed)

#### C.1 Complete without session cookie
Today complete without cookie returns job without `asset` → client throws “completed without an audio asset”.

**Minimal fix (recommended):**
- On client complete without asset: message *“Conversion finished but this browser session could not attach the audio. Refresh and try opening the import again, or re-convert.”*
- Ensure POST always sets session cookie (already does when new session). Verify mobile same-origin + `credentials: "same-origin"` (already set).

**Do not** invent cross-session public asset download without auth.

#### C.2 Optional: include `errorCode` on failed polls consistently
Already on `publicJob` when `status === "failed"`. Confirm client reads `payload.errorCode` on non-OK and failed status (it uses `errorMessage(payload.errorCode)` — good).

#### C.3 Optional diagnostic field
Not required: `phaseUpdatedAt` for UI. Skip unless easy.

---

### Stage D — Docs (short)

Update `Merge_Features_Project/Merge_1_YT/YOUTUBE_AUDIO_SETUP.md` (or root if that is the live doc) with:

1. Convert is server-side; phone only polls.
2. Keep tab/session cookies; resume after returning to the page.
3. Short segment ≠ short download.
4. Env knobs if any (`YT_MEDIA_DOWNLOAD_RETRIES`).

Do **not** rewrite Phase 1 IMPLEMENTATION_PLAN unless user asks.

---

### Stage E — Full regression + manual checklist

#### E.1 Automated
```bash
npm test
npm run lint
npm run build
```
All must pass; no credit-test regressions.

#### E.2 Manual (implementer or user)
| # | Case | Expected |
|---|---|---|
| M1 | Desktop short segment | complete → audio in editor |
| M2 | Desktop medium segment | complete |
| M3 | iPhone short segment, screen awake, tab foreground | complete |
| M4 | iPhone: start convert, lock screen 30–60s, unlock, return to tab | resume poll → complete or clear errorCode message |
| M5 | Invalid URL / disabled feature | existing errors unchanged |
| M6 | Force provider failure (bad key) | mapped error, not only “unexpectedly” |
| M7 | Double-open modal mid-job | resume or single poll; no duplicate stuck POSTs for same fingerprint if reuse exists |

#### E.3 Log confirmation
On a mobile-triggered run, server logs should show either:
- `segment-download-start` → success → `job-complete`, or
- `media-download-retry` then success/fail with explicit code, or
- `job-failed` with non-empty `errorCode`.

---

## 6. Ordered file change list (expected)

| File | Change |
|---|---|
| `lib/youtube-audio/media-fetcher.js` and/or `segment-builder.js` | Retry wrapper around download |
| `lib/youtube-audio/media-fetcher.test.js` (+ maybe new test file) | Retry tests |
| `components/youtube-segment-modal.js` | Inflight storage, resume poll, visibility/focus, messages |
| Optional `lib/youtube-audio/client-inflight-job.js` | Extracted storage helpers + tests |
| `Merge_Features_Project/Merge_1_YT/YOUTUBE_AUDIO_SETUP.md` | Operator/user notes |
| **Avoid** unless necessary | `editor-shell.js` (only if completion handoff needs inflight clear) |

---

## 7. Detailed client algorithm (pseudocode)

```text
STORAGE_KEY = "reel-creator:yt-audio-inflight"

on Convert click:
  if !canConvert return
  requestId = ++activeRequestRef
  set converting
  POST /api/youtube-audio-segments { url, startTime, endTime }
  if !ok -> show errorMessage(errorCode); return
  saveInflight({ jobId, sourceUrl, startedAt })
  result = await poll(jobId, requestId)  // attempts reset at start
  handleTerminal(result)

async poll(jobId, requestId):
  for attempt in 0..MAX_POLL_ATTEMPTS-1:
    if cancelled(requestId) return null
    GET /api/youtube-audio-segments/jobId
    if complete:
      if asset?.assetId:
        clearInflight()
        return payload
      else:
        throw session/asset attach error
    if failed or !ok:
      clearInflight()
      throw errorMessage(errorCode)
    setMessage(statusMessage(phase))
    await delay(POLL_INTERVAL_MS)
  // budget exhausted — do NOT clear inflight
  setMessage("Still converting on the server. Return to this page to keep checking.")
  return null  // stay converting; visibility handler will poll again

on visibility visible OR focus:
  inflight = loadInflight()
  if !inflight or pollingRef return
  if sourceUrl mismatch return
  requestId = ++activeRequestRef
  pollingRef = true
  try poll(inflight.jobId, requestId)
  finally pollingRef = false

on modal open:
  try resume from inflight if URL matches (same as visibility)
  also loadYoutubeVideoInfo as today
```

---

## 8. Detailed server retry algorithm (pseudocode)

```text
MAX_RETRIES = envInt("YT_MEDIA_DOWNLOAD_RETRIES", 2)  // retries after first failure
function fetchMediaWithRetry(providerResult, options, ctx):
  lastError = null
  for attempt in 0..MAX_RETRIES:
    try:
      return await fetchMediaToFile(providerResult, options)
    catch e:
      lastError = e
      code = e.errorCode
      if code not in TRANSIENT: throw e
      if attempt == MAX_RETRIES: throw e
      log media-download-retry { jobId: ctx.jobId, attempt: attempt+1, code }
      await sleep(500 * (attempt+1))
  throw lastError
```

Wire in `buildYoutubeAudioSegment` only around the download line.

---

## 9. Risk register

| Risk | Mitigation |
|---|---|
| Retry amplifies rate limits on media host | Low retry count; only transient codes |
| Stale jobId in sessionStorage after server restart | GET 404 `RESULT_EXPIRED` → clear + message |
| Double poll | `pollingRef` + single `activeRequestRef` generation |
| Resume wrong video’s job | Match `sourceUrl` |
| sessionStorage blocked (private mode rare) | try/catch; degrade to current behaviour |
| Longer failure latency due to retries | Cap retries at 2; backoff < 2s total extra typically |

---

## 10. Explicitly deferred (do not do in this fix)

1. In-modal / visible YouTube player for duration.
2. Replacing IFrame duration probe with server-side duration (nice follow-up).
3. Redis/DB-backed job store for multi-instance durability.
4. Client downloading provider MP3.
5. Changing RapidAPI provider set or keys.
6. Credit-layer / repair programme items.

---

## 11. Definition of done

- [ ] Stage A retry implemented + tests green  
- [ ] Stage B inflight + resume poll implemented + helper tests green  
- [ ] Docs note short segment ≠ short download + resume behaviour  
- [ ] `npm test` / `lint` / `build` green  
- [ ] Manual M3/M4 on iPhone pass **or** logged server `errorCode` proves remaining issue is provider/infra (not silent UI death)  
- [ ] No credit files changed  

---

## 12. Suggested commit messages

1. `fix(yt-audio): retry transient media downloads with clear errors`  
2. `fix(yt-audio): resume client poll after background for mobile convert`  

Or one commit if small enough.

---

## 13. Fresh agent kickoff checklist

1. Read this plan in full.  
2. Confirm symptoms still match (stuck on `downloading` after convert start).  
3. `git status`; create branch as user directs.  
4. Inspect files in §2 (do not trust this plan alone if code drifted).  
5. Implement Stage A → B → D → E (C only if needed).  
6. Do not expand scope to in-modal player without user approval.  
7. Report: files changed, tests run, manual results, any deviation.

---

**End of plan.**  
**Recommended product decision (locked):** server-owned convert + download retries + client jobId resume polling; **not** an in-modal player for this bug.
