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
# Force sync convert in the POST request (auto-enabled on Vercel via VERCEL=1).
# YT_AUDIO_SYNC=1
```

Do not use `NEXT_PUBLIC_` for provider keys. With no key, `/api/youtube-audio/config` returns
`{"enabled":false}` and the editor hides/disables the YouTube acquisition controls.

## Convert behaviour (localhost vs Vercel)

- **Server-owned:** convert downloads provider audio and trims on the **server**. The browser
  does not download the MP3.
- **Localhost (`next dev`):** jobs can run in the background; the UI polls status until
  complete (progress: requesting → downloading → …).
- **Vercel (and multi-instance hosts):** in-memory background jobs do **not** work reliably
  (function freezes after the response; the next poll often hits another isolate with no job).
  On Vercel the POST **awaits the full convert** in the same request (`maxDuration` 60s) and
  returns `status: "complete"` + `asset` when successful. Override with `YT_AUDIO_SYNC=0/1`.
- **Short segment ≠ short download:** providers often return a full/large file first; the
  server then trims to your start/end.
- **Mobile / iOS (any host):** if the tab freezes mid-poll, re-open the import (same URL) —
  the client resumes the in-flight `jobId` from `sessionStorage` when using poll mode.
- **Cookies:** same-origin session cookie is required to attach the MP3 as an editor asset.
- **ffmpeg:** provider `trimMode: "provider"` paths avoid local ffmpeg; local-trim providers
  need `ffmpeg`/`ffprobe` on the server PATH (available on typical localhost, not always on
  stock Vercel images).
