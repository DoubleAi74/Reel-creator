# RapidAPI YouTube MP3 Live Schema Notes

Manual test run: 2026-07-02.

## Request Shape Confirmed

- Host: `youtube-to-mp315.p.rapidapi.com`
- Start endpoint: `POST /download`
- The provider rejected a JSON body with HTTP 400:
  - `detail`: `Required query parameter 'url' is not present.`
- Confirmed working request transport:
  - `POST /download?url=...&format=mp3&startTime=30&endTime=35`
  - RapidAPI headers: `X-RapidAPI-Key`, `X-RapidAPI-Host`

## Response Fields Confirmed

Sanitized fixtures are in `test/fixtures/`.

- `/download` job id field: `id`
- `/download` also returned `downloadUrl` immediately in the successful test.
- `/status/{id}` status field: `status`
- Observed status value with a usable file URL: `CONVERTING`
- `/status/{id}` download URL field: `downloadUrl`
- Observed temporary result hosts: `45.76.15.135`, `78.141.232.210`
- Because `status` can still say `CONVERTING` when `downloadUrl` is present, normalize a provider response with `downloadUrl` as complete.
- Because `CONVERSION_ERROR` can also include `downloadUrl`, failure status values must take precedence over `downloadUrl`.

## Fixture Files

- `rapidapi-youtube-mp3-start.json`
- `rapidapi-youtube-mp3-complete.json`
- `rapidapi-youtube-mp3-error.json`
- `rapidapi-youtube-mp3-schema-summary.json`

No processing-only response was observed during the manual test; the first status poll already included `downloadUrl`.
