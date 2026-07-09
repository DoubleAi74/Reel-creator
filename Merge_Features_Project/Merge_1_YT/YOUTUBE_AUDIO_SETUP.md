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
```

Do not use `NEXT_PUBLIC_` for provider keys. With no key, `/api/youtube-audio/config` returns
`{"enabled":false}` and the editor hides/disables the YouTube acquisition controls.
