# Multi-Provider YouTube Audio Development Plan

Status: Approved and implemented in the prototype.

This document describes the development plan for adding three selectable
RapidAPI YouTube audio providers to the prototype. The goal is to build a
functional provider-testing version of the app first, then manually test each
provider for reliability before choosing a single provider for final
integration.

No provider should expose RapidAPI credentials to the browser. Provider-specific
request formats, response parsing, errors, polling behavior, and media-link
handling must stay isolated behind adapter modules.

## Goal

Build the prototype into a real provider-testing lab with:

- three selectable RapidAPI providers;
- shared input validation;
- server-side-only RapidAPI credentials;
- real media fetching;
- provider-side trimming where supported;
- local FFmpeg trimming/conversion where needed;
- final downloadable MP3 output;
- a structure that lets us remove two providers later without rewriting the main
  flow.

## Providers

| Provider | RapidAPI Host | Backend Strategy | Trim Strategy |
| --- | --- | --- | --- |
| `youtube-mp36` by `ytjar` | `youtube-mp36.p.rapidapi.com` | Request a downloadable MP3 link using the YouTube video ID. | Use provider-side cut with `cut=1`, `sStart`, and `sEnd`. Do not run a secondary FFmpeg cut unless testing proves provider-side cut is inaccurate or invalid. |
| `youtube-info-download-api` by `valsuttlej53` | `youtube-info-download-api.p.rapidapi.com` | Request full audio from `/ajax/download.php`, preferably `m4a` if it returns usable audio. | Download full audio, then trim and convert locally with FFmpeg. |
| `youtube-mp3-2025` by `nguyenmanhict-MuTUtGWD7K` | `youtube-mp3-2025.p.rapidapi.com` | Prefer direct audio stream/download from `/v1/social/youtube/audio`, using `m4a` first if usable. | Download or stream full audio, then trim and convert locally with FFmpeg. |

## High-Level Flow

1. User enters a YouTube URL.
2. User selects a start and end time.
3. User selects a provider.
4. Client submits `{ url, startTime, endTime, providerId }`.
5. Server validates the input and provider ID.
6. Server calls the selected provider adapter.
7. Provider adapter returns either an already-trimmed media URL or full-source
   audio.
8. Server fetches and verifies the media.
9. Server runs FFmpeg only when local trimming or MP3 conversion is needed.
10. Server stores the final MP3 in the app/storage layer.
11. Client polls job status and downloads the finished MP3.

## Phase 1: Configuration

Add provider-aware configuration without exposing secrets.

Required behavior:

- Keep RapidAPI keys server-side only.
- Continue using environment variable names only in committed files.
- Use one RapidAPI key variable unless testing proves separate keys/apps are
  needed: `RAPIDAPI_YOUTUBE_MP3_KEY`.
- Add server-side provider host constants.
- Add optional default provider env var: `YT_AUDIO_DEFAULT_PROVIDER`.
- Update `.env.example` with names only.
- Ensure `.env.local` remains ignored by git.

Acceptance criteria:

- Build does not include RapidAPI secrets in client bundles.
- No key, signed URL, provider token, cookie, or secret appears in fixtures,
  logs, docs, or committed code.
- Provider host names are configurable or centralized server-side.

## Phase 2: Shared Provider Interface

Create a normalized provider contract used by the main job flow.

Recommended normalized shape:

```js
{
  providerId,
  title,
  sourceDurationSeconds,
  mediaUrl,
  mediaHeaders,
  mediaFormat,
  trimMode: "provider" | "local",
  raw
}
```

Provider adapters may return extra diagnostic metadata internally, but the main
route should only depend on the normalized contract.

Acceptance criteria:

- The API route does not know provider-specific endpoint paths.
- The API route does not know provider-specific response field names.
- Adding or removing a provider only requires changes in provider modules and
  provider registration.

## Phase 3: Provider Adapters

Create isolated provider modules:

- `lib/providers/youtube-mp36.js`
- `lib/providers/youtube-info-download-api.js`
- `lib/providers/youtube-mp3-2025.js`
- `lib/providers/index.js`
- `lib/providers/rapidapi-client.js`

### Provider 1: `youtube-mp36`

Known docs shape:

```text
GET https://youtube-mp36.p.rapidapi.com/dl?id=VIDEO_ID
```

Provider-side cut parameters:

```text
cut=1
sStart=HH:MM:SS
sEnd=HH:MM:SS
```

Implementation behavior:

- Extract YouTube video ID from the submitted URL.
- Format start/end times as `HH:MM:SS`.
- Call `/dl` with `id`, `cut=1`, `sStart`, and `sEnd`.
- Parse likely fields:
  - `link`
  - `title`
  - `progress`
  - `duration`
  - `status`
  - `msg`
- Treat `status: "ok"` plus a non-empty `link` as a candidate success.
- Return `trimMode: "provider"`.

Important note:

The provider docs indicate quota cost can be based on the original MP3 length
for trim/cut requests, with an extra cut cost. Manual testing should capture
quota headers.

### Provider 2: `youtube-info-download-api`

Known docs shape:

```text
GET https://youtube-info-download-api.p.rapidapi.com/ajax/download.php
```

Known query parameters:

- `format`
- `add_info`
- `url`
- `audio_quality`
- `allow_extended_duration`
- `no_merge`
- `audio_language`

Known companion info endpoint:

```text
GET https://youtube-info-download-api.p.rapidapi.com/ajax/api.php?function=i&u=...
```

Implementation behavior:

- Prefer `format=m4a` first.
- Use `audio_quality=128` for MP3 requests if MP3 is needed.
- Use `allow_extended_duration=false` initially.
- Keep parsing tolerant because the public examples currently show empty JSON.
- Search for likely downloadable fields such as:
  - `url`
  - `link`
  - `downloadUrl`
  - `download_url`
  - nested media URLs
- Also support the possibility that the endpoint returns binary media or a
  redirect instead of JSON.
- Return `trimMode: "local"` when a full audio file or stream is obtained.

### Provider 3: `youtube-mp3-2025`

Known GET docs shape:

```text
GET https://youtube-mp3-2025.p.rapidapi.com/v1/social/youtube/audio?id=VIDEO_ID&quality=128kbps&ext=m4a
```

Known POST docs shape:

```text
POST https://youtube-mp3-2025.p.rapidapi.com/v1/social/youtube/audio
Content-Type: application/json

{
  "id": "VIDEO_ID",
  "ext": "m4a"
}
```

The docs also show an example body using a full YouTube URL, quality, and ext,
but the minimal schema sample shows `id`. This inconsistency must be verified
with real responses.

Implementation behavior:

- Prefer GET with video ID, `quality=128kbps`, and `ext=m4a`.
- Support `ext=mp3` as a fallback.
- Keep POST support available if GET proves unreliable.
- Support response as either:
  - direct binary audio;
  - redirect to media;
  - JSON containing a media link.
- Return `trimMode: "local"` when full audio is obtained.

Acceptance criteria for all adapters:

- Each provider returns a normalized result or a clear provider-specific error.
- Provider errors are mapped to app-level error codes.
- Raw provider responses are sanitized before being written to fixtures or logs.

## Phase 4: Media Fetching And Validation

Add a shared media fetch/validation layer.

Required behavior:

- Follow safe redirects.
- Reject non-HTTP(S) media URLs.
- Reject localhost and private-network destinations where practical.
- Enforce maximum downloaded source size.
- Enforce maximum output size.
- Enforce maximum source duration where practical.
- Check `content-type`, but do not rely on it alone.
- Stream files to disk where practical rather than buffering entire audio files
  in memory.
- Save work files under a unique temp directory per job.
- Run `ffprobe` or equivalent validation before treating provider media as
  usable.
- Never log full signed URLs.

Acceptance criteria:

- A provider HTTP `200` is not treated as success until actual audio bytes are
  fetchable and probeable.
- Invalid HTML, JSON error bodies, expired links, and non-audio files fail with
  clear errors.

## Phase 5: FFmpeg Pipeline

Add local processing only when needed.

For `youtube-mp36`:

- Skip FFmpeg trimming if provider-side cut returns valid audio.
- If the provider returns a non-MP3 format, convert the finished result to MP3.
- Optionally validate that returned duration approximately matches the requested
  segment.

For `youtube-info-download-api` and `youtube-mp3-2025`:

- Download full audio to the job temp directory.
- Trim using requested start/end.
- Convert final output to MP3.
- Validate final duration.

Recommended duration tolerance:

- Allow a small tolerance for encoder delay and container metadata.
- Flag large mismatches as provider or processing failure.

Acceptance criteria:

- Final output is an MP3.
- Final output duration roughly matches requested segment length.
- FFmpeg is not used for provider-side trimming unless needed for conversion or
  validation fallback.

## Phase 6: Job And Storage Flow

For local prototype testing:

- The current job/status shape can be reused temporarily.
- Jobs must become provider-aware.
- Temporary files must be stored in unique per-job directories.
- Temporary files must be cleaned up in `finally` blocks.

For Vercel-ready behavior:

- Do not serve final results from `/tmp` after processing.
- Add a storage abstraction now, even if local storage remains the first
  implementation.
- Recommended persistent storage options:
  - Vercel Blob;
  - S3;
  - Cloudflare R2;
  - Supabase Storage.

Acceptance criteria:

- The final download URL comes from the app/storage layer, not directly from a
  third-party provider URL.
- Provider signed links are never exposed to the browser unless intentionally
  approved later.

## Phase 7: API Routes

Update existing routes.

### `POST /api/youtube-audio-segments`

Request body:

```js
{
  url,
  startTime,
  endTime,
  providerId
}
```

Required behavior:

- Validate URL, start/end time, segment duration, and provider ID.
- Create a provider-aware job.
- Run selected provider flow.
- Return a job ID and initial status.

### `GET /api/youtube-audio-segments/:jobId`

Required behavior:

- Return job status.
- Include provider ID/name.
- Include app-level error code on failure.
- Include final download URL on success.

### `GET /api/youtube-audio-segments/:jobId/file`

Required behavior:

- Keep only as a local prototype fallback unless storage is implemented first.
- Do not rely on this route for Vercel final behavior.

Acceptance criteria:

- Browser never receives RapidAPI key or provider auth headers.
- Browser receives only app-level status, error codes, and final app/storage
  URLs.

## Phase 8: UI

Add a provider selector to the prototype UI.

Recommended visible labels:

- `YouTube MP3 / ytjar`
- `Info Download API`
- `YouTube MP3 2025`

Recommended behavior:

- Treat provider selection as prototype/debug functionality.
- Preserve the existing segment picker.
- Show conversion status:
  - queued;
  - calling provider;
  - downloading;
  - trimming;
  - finalizing;
  - ready;
  - failed.
- Show provider-specific failures in beginner-friendly language.

Acceptance criteria:

- Tester can manually run the same YouTube segment through all three providers.
- UI submits the chosen provider ID.
- UI downloads the real final MP3, not `public/sample-segment.mp3`.

## Phase 9: Manual Test Script

Add one terminal command to test all providers without using the UI.

The script should print:

- provider ID;
- provider display name;
- provider HTTP status;
- RapidAPI quota headers if present;
- content type;
- content length;
- whether media fetched successfully;
- detected source duration;
- final trimmed MP3 duration;
- final local output path for manual inspection.

The script must not print:

- RapidAPI key;
- signed media URL;
- cookies;
- raw provider response containing URLs, tokens, or signatures.

Acceptance criteria:

- Each provider can be tested independently from the terminal.
- The script distinguishes these states:
  - provider auth failure;
  - quota/rate limit;
  - malformed response;
  - media URL not fetchable;
  - media not parseable by FFmpeg;
  - trim/conversion failure;
  - success.

## Phase 10: Manual Testing Matrix

After implementation, manually test:

1. Very short segment, `0s` to `5s`.
2. Mid-video segment, such as `30s` to `45s`.
3. Segment starting exactly at `0`.
4. Longer segment near the current app maximum.
5. Invalid YouTube URL.
6. Private, unavailable, age-restricted, or region-blocked video.
7. Quota-limited provider.
8. Provider returns JSON but media URL fails.
9. Provider returns media directly.
10. Provider returns a signed link that expires quickly.

For each successful test, verify:

- final output is playable;
- final output duration is close to requested length;
- final output contains the expected section of audio;
- no signed provider URL is visible in the browser;
- no secrets appear in logs.

## Main Risks

- Provider docs are incomplete, especially for `youtube-info-download-api` and
  `youtube-mp3-2025`.
- A provider may return `200` while still returning unusable JSON, HTML, or an
  expired link.
- Returned links may require cookies, referrers, fixed IP addresses, or browser
  behavior not available server-side.
- Returned links may expire before processing finishes.
- Provider quota may be charged by original video length rather than requested
  segment length.
- Vercel `/tmp` storage and function duration limits can break long-video
  processing.
- FFmpeg binary size can complicate Vercel deployment bundles.
- YouTube download providers are inherently fragile and may change behavior
  without warning.
- Manual provider selection is useful for testing but probably not desirable in
  the final user-facing product.

## Recommended Build Order

1. Add provider IDs, config, and shared provider registry.
2. Add normalized provider interface.
3. Implement `youtube-mp36` with provider-side trimming.
4. Add shared media fetch and validation.
5. Add FFmpeg trim/convert pipeline.
6. Implement `youtube-mp3-2025`.
7. Implement `youtube-info-download-api`.
8. Add provider selector to the UI.
9. Add all-provider manual test script.
10. Add cleanup, error mapping, and documentation.
11. Run manual tests and compare provider reliability.

## Final Integration Direction

This multi-provider version is intended for testing. After manual testing, the
final product should probably use one default provider rather than exposing
provider selection to normal users.

Preferred final options, in order:

1. Use the single most reliable provider.
2. Use one default provider with one or two hidden fallbacks.
3. Keep manual provider selection only in a developer/debug mode.

The implementation should make it easy to delete unused providers once the final
provider is chosen.
