# YouTube Audio Setup

Phase 1 is disabled unless the server has a RapidAPI key. The browser never receives provider
keys or provider diagnostics.

## Environment

Set these server-only variables in local or deployment environment:

```bash
RAPIDAPI_YOUTUBE_MP3_KEY=your_rapidapi_key
# Required for youtube-mp36 media downloads (Vercel especially):
# your RapidAPI **account username** (not the API key), used in the MP3 User-Agent.
# Without it, the provider link often returns HTTP 404 from the CDN.
RAPIDAPI_USERNAME=your_rapidapi_username
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
# Alias for RAPIDAPI_USERNAME (same value).
# YT_MP36_RAPIDAPI_USERNAME=your_rapidapi_username
# Retries after the first media download attempt on transient timeouts (default 2).
YT_MEDIA_DOWNLOAD_RETRIES=2
# Force sync convert in the POST request (auto-enabled on Vercel via VERCEL=1).
# YT_AUDIO_SYNC=1
# Always-on convert breadcrumbs in server logs (also auto-on when VERCEL=1).
# YT_AUDIO_DEBUG=1
```

### youtube-mp36 HTTP 404 on media download

Provider API can return `status: ok` + a `link`, but the **CDN** rejects the download with
404 unless the request is whitelisted. ytjar’s fix is: send your RapidAPI username in the
download `User-Agent` (this app does that when `RAPIDAPI_USERNAME` is set). Alternative:
whitelist your server egress IPs in the RapidAPI / provider dashboard (hard on Vercel).

## Debugging convert failures (Vercel)

1. Open the **deployed** site → browser DevTools → **Console**.
2. Run a convert. Look for lines prefixed **`[yt-convert:client]`** (request timing,
   HTTP status, `errorCode`, whether an asset came back).
3. Open **Vercel → Project → Logs** (or `vercel logs`). Filter for **`[yt-audio:convert]`**.
   You should see: `post-received` → `post-job` → `post-run-sync` → `phase` /
   `provider-attempt` → `sync-done` or `sync-threw` / `post-threw`.
4. If the client fails at **~10 seconds** with no useful `errorCode`, the platform
   likely killed the function (Vercel **Hobby** max duration is often **10s** even
   when `maxDuration = 60` is set). Upgrade plan or shorten work / raise limits.

Set `YT_AUDIO_DEBUG=1` in Vercel env for the fuller `[yt-audio] …` diagnostic stream
(URLs/secrets are redacted).

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
- **ffmpeg:** provider `trimMode: "provider"` + MP3 paths (primary `youtube-mp36`) **do not**
  call local ffmpeg/ffprobe — they store the provider file as-is. Local-trim providers
  (`youtube-mp3-2025`) need `ffmpeg`/`ffprobe` on PATH (or `FFMPEG_PATH` / `FFPROBE_PATH`).
  Stock Vercel images do **not** ship those binaries. On `VERCEL=1`, auto **skips**
  local-trim providers so a failed mp36 is not hidden behind a later `FFMPEG_MISSING`.
  Force-disable local tools with `YT_AUDIO_NO_FFMPEG=1`. Client console
  (`[yt-convert:client] post-response`) includes the real `errorCode` / `errorMessage`.
