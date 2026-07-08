# YT Merge — Phase 1 Progress

Mirrors `IMPLEMENTATION_PLAN.md`. Maintained by the implementation agent.
Statuses: **Not started / In progress / Implemented-not-validated / Validated / Blocked /
Deferred / Superseded**. "Code written" is never "done" — done requires validation.

---

## Phase status
- **Current stage**: Planning complete → awaiting user approval to begin implementation.
- **Last verified checkpoint**: Plan + Progress authored; live code inspected (§ evidence in plan §6). No code changed.
- **Next action**: On approval, execute Stage 0.
- **Blockers**: None (needs a valid `RAPIDAPI_YOUTUBE_MP3_KEY` for live provider validation; CI uses mocked providers).
- **Unresolved decisions**: None (D1–D9 confirmed 2026-07-08).

## Decision records
- D1 system ffmpeg/ffprobe · D2 `storeAudioAssetFromPath` w/ real duration · D3 ingest on
  complete, serve via `/api/assets` · D4 auto provider only · D5 session sweep-exemption ·
  D6 server-only key + graceful disable · D7 diagnostics out of main UI (kept for admin) ·
  D8 no zod (hand-written validator) · D9 URL input below "Choose MP3", modal picker.

---

## Stage 0 — Scaffolding & config
- [ ] Port `lib/youtube-audio/*` (job-store, processing, provider-runner, providers/*, segment-builder, media-fetcher, storage, server-config, provider-options, youtube-url, rapidapi-quota, diagnostics) — Files: `lib/youtube-audio/**` — Validate: imports/build clean.
- [ ] `audio-ffmpeg.js` **system-binary** variant (no ffmpeg-static) — Validate: `probeAudio`/`trimAudioToMp3` resolve `ffmpeg`/`ffprobe` from PATH.
- [ ] Hand-written `validation.js` (D8) — Validate: unit tests for bounds/URL.
- [ ] `app/api/youtube-audio/config/route.js` — Validate: `{enabled:false}` with no key.
- Status: Not started

## Stage 1 — Server request/processing
- [ ] `POST /api/youtube-audio-segments` (session cookie like `/api/upload`, validation, auto provider) — Files: `app/api/youtube-audio-segments/route.js` — Validate: dedupe + Set-Cookie.
- [ ] Job-store session tracking + `outputDurationSec` + `getActiveYoutubeAudioSessionIds` — Files: `lib/youtube-audio/job-store.js`.
- [ ] Wire processing/runner/builder; capture `finalProbe.duration` — Files: `.../processing.js`, `.../segment-builder.js`.
- [ ] Validate: POST→poll reaches `complete` with valid temp MP3, `assertDurationClose` passes (mocked provider in CI; one live run with key).
- Status: Not started

## Stage 2 — Ingestion + status contract (D2/D3)
- [ ] `storeAudioAssetFromPath` in `lib/files.js` (mp3 check, `MAX_AUDIO_BYTES`, metadata incl. `durationSec`) — Files: `lib/files.js`.
- [ ] Status route ingest-on-complete + `(jobId,sessionId)` idempotency; return `asset`; delete `/file` route — Files: `app/api/youtube-audio-segments/[jobId]/route.js`.
- [ ] Validate: complete→`asset`; `/api/assets/{id}` serves; double-poll same assetId; transcribe + render accept asset.
- Status: Not started

## Stage 3 — Sweep exemption (D5)
- [ ] Add YT active sessions to `sweepExpiredSessions` exemption — Files: `lib/files.js`.
- [ ] Validate: forced sweep with active YT job keeps session; post-completion normal TTL.
- Status: Not started

## Stage 4 — Client handoff + Audio-tab controls (D9)
- [ ] Audio-tab: URL input + "Choose segment" below "Choose MP3"; `audio.youtube` props — Files: `components/tabs/audio-tab.js`.
- [ ] Shell: modal state, URL state, `handleYoutubeSegmentComplete` (mirror `handleAudioFile`, server `audioObjectUrl`), `/config` gating — Files: `components/editor-shell.js`, `components/editor-modals.js`.
- [ ] Validate: end-to-end parity with manual upload (waveform, timing, pipeline, preview, autosave-restore, export).
- Status: Not started

## Stage 5 — Modal UI + responsive polish
- [ ] `components/youtube-segment-modal.js` (ported timeline + polling, tokenized, no provider select/diagnostics) — Files: `components/youtube-segment-modal.js`, `app/globals.css`.
- [ ] Validate: desktop + narrow-viewport drag; layers above transport/sheet; no responsive regression.
- Status: Not started

## Stage 6 — Hardening & tests
- [ ] Unit + integration (mocked providers) + handoff/consumer + ffmpeg tests (plan §16).
- [ ] Error-copy map; diagnostics preserved server-side (D7); `.env.example` + README note.
- [ ] Validate: `vitest` green; manual failure paths friendly; acceptance §18 met.
- Status: Not started

---

## Final acceptance checklist (plan §18)
- [ ] Manual upload byte-identical (regression).
- [ ] URL→segment→convert→normal session asset; full editor parity.
- [ ] Automatic fallback verified.
- [ ] Feature hidden when unconfigured.
- [ ] Session survives sweep mid-job; ingestion idempotent.
- [ ] No diagnostics in main UI; data in API/logs.
- [ ] No new npm dep; no `next.config.mjs` change.
- [ ] All tests pass.

## Deviation records
- _(none yet)_

## Implementation notes
- _(none yet)_

## Fresh-agent resume section
- **State**: Planning documents complete; implementation not started; zero code changed.
- **To resume**: read `PROJECT_OVERVIEW.md`, `IMPLEMENTATION_PLAN.md`, `INFORMATION_BANK.md`,
  this file; inspect plan §6/§9 live files; start at the first unchecked box (Stage 0);
  update statuses + files + test results as you go; escalate architecture conflicts.
