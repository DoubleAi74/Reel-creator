# YouTube Audio Setup

Phase 1 is disabled unless the server has a RapidAPI key. The browser never receives provider
keys or provider diagnostics.

## Environment

Set this server-only variable in local or deployment environment:

```bash
RAPIDAPI_YOUTUBE_MP3_KEY=your_rapidapi_key
```

Optional tuning variables:

```bash
YT_MP3_TMP_DIR=/tmp/youtube-mp3-segments
YT_AUDIO_DEFAULT_PROVIDER=auto
YT_AUDIO_MAX_SOURCE_BYTES=157286400
YT_AUDIO_MAX_OUTPUT_BYTES=52428800
YT_AUDIO_MAX_QUEUE_DEPTH=20
YT_AUDIO_MAX_ACTIVE_PER_SESSION=2
YT_AUDIO_DEBUG=0
# Retries after the first media download attempt on transient timeouts (default 2).
YT_MEDIA_DOWNLOAD_RETRIES=2
```

Do not use `NEXT_PUBLIC_` for provider keys. With no key, `/api/youtube-audio/config` returns
`{"enabled":false}` and the editor hides/disables the YouTube acquisition controls.

## Convert behaviour (desktop + mobile)

- **Server-owned:** after you tap Convert, the app server downloads provider audio and
  trims it. The phone/browser only **polls** job status; it does not download the MP3.
- **Short segment ≠ short download:** providers often return a full/large file first; the
  server then trims to your start/end. Expect “Downloading source audio…” even for 5s clips.
- **Mobile / iOS:** if the screen locks or the tab freezes, polling pauses. The job can still
  finish on the server. Re-open the import (same YouTube URL) or return to the tab — the
  client **resumes** the in-flight `jobId` from `sessionStorage` and keeps checking.
- **Cookies:** same-origin session cookie is required so a completed job can be attached as
  an editor audio asset. Allow cookies for your site on the phone.
- **Errors:** provider timeouts may be retried a few times server-side; definitive failures
  should show a specific message (timeout / rejected / expired), not only a generic fail.
