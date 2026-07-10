# Two-Provider Fallback And Quota Plan

Status: Draft for approval.

This plan narrows the prototype from three active provider options to a cleaner
two-provider flow:

1. `youtube-mp36`
2. `youtube-mp3-2025`

The slow `youtube-info-download-api` provider should be removed from the normal
UI and automatic fallback path. It may remain in code temporarily for reference,
but it should not be part of the user-facing conversion flow unless we decide to
restore it later.

The goal is to make the prototype behave more like the final integration:

- default to an automatic ordered fallback flow;
- try `youtube-mp36` first;
- fall back to `youtube-mp3-2025` only when needed;
- keep credentials server-side;
- show each provider's quota separately;
- keep individual provider testing available during the prototype phase;
- keep provider-specific request, response, quota, and error handling isolated.

## Recommendation

Use `youtube-mp36` as the primary provider because it supports provider-side
segment cutting. It returns a small already-trimmed MP3 and avoids downloading a
full source file when it works.

Use `youtube-mp3-2025` as the fallback provider because the latest live UI run
showed that it can return a direct audio file that FFmpeg can trim locally.

Do not include `youtube-info-download-api` in the automatic flow. It worked, but
it was slower and more complicated because it required progress polling, had an
undecodable M4A path in testing, downloaded a larger full-source MP3, and then
needed local trimming.

## User-Facing Behavior

The provider selector should offer:

- `Automatic fallback (recommended)`
- `YouTube MP3 / ytjar`
- `YouTube MP3 2025`

The default selection should be `Automatic fallback (recommended)`.

Manual provider selections are still useful because they let us test reliability
and quota behavior for each provider independently.

When automatic mode is selected, the backend should try:

1. `youtube-mp36`
2. `youtube-mp3-2025`

The client should not perform fallback itself. The client should submit one job,
poll one job ID, and receive a final result that includes the provider attempts.

## Fallback Rules

Fallback to the next provider when the current provider fails because of:

- HTTP `429`;
- explicit quota or credit exhaustion message;
- timeout;
- network failure;
- provider `5xx`;
- malformed provider response;
- no usable media URL;
- media URL fetch failure;
- media content is not valid audio;
- FFprobe cannot probe the downloaded source;
- FFmpeg cannot trim or convert the source;
- provider-specific conversion failure.

Do not fallback for user-input problems:

- invalid YouTube URL;
- invalid start or end time;
- segment duration outside app limits;
- unsupported provider ID;
- missing required request body fields.

Handle account/auth failures carefully:

- HTTP `401` should usually fail the whole job with a clear bad-key message,
  because the same RapidAPI key is used for both providers.
- HTTP `403` can fall back if it looks provider-specific, such as not subscribed
  to that provider, but should be reported in the attempt details.
- If both providers fail from auth/subscription issues, the UI should say the
  RapidAPI account or subscriptions need attention.

## Provider Format Strategy

### `youtube-mp36`

Keep the current provider-side cut behavior:

- extract the video ID;
- call `/dl`;
- send `cut=1`;
- send `sStart=HH:MM:SS`;
- send `sEnd=HH:MM:SS`;
- wait while status is `processing`;
- accept only a final downloadable audio link;
- verify the downloaded file with FFprobe.

No local FFmpeg trim should be run for this provider unless the provider returns
an inaccurate segment in testing.

### `youtube-mp3-2025`

Use this as the fallback provider and request MP3 first:

1. try `ext=mp3`;
2. if MP3 fails, try `ext=m4a`;
3. download the full source audio;
4. verify the source with FFprobe;
5. trim locally with FFmpeg;
6. convert the final output to MP3.

MP3-first may download a larger file than M4A-first, but it reduces ambiguity
around the final output format and matches the current product goal. If manual
testing shows MP3 is materially slower or less reliable than M4A, we can switch
this provider back to M4A-first later without changing the fallback architecture.

## Quota Display

Quota must be represented separately for each provider.

RapidAPI quota headers are not perfectly consistent across providers. The app
should not show one universal "credits remaining" number. Instead, it should
show the quota data reported by each provider.

For each provider attempt, capture a normalized quota summary from whitelisted
headers only:

- `x-ratelimit-requests-limit`
- `x-ratelimit-requests-remaining`
- `x-ratelimit-requests-reset`
- `x-ratelimit-request-limit`
- `x-ratelimit-request-remaining`
- `x-ratelimit-request-reset`
- `x-ratelimit-units-limit`
- `x-ratelimit-units-remaining`
- `x-ratelimit-units-reset`
- `x-ratelimit-rapid-free-plans-hard-limit-limit`
- `x-ratelimit-rapid-free-plans-hard-limit-remaining`
- `x-ratelimit-rapid-free-plans-hard-limit-reset`

Do not forward arbitrary response headers to the browser. Do not forward signed
URLs, cookies, tokens, provider raw response bodies, or RapidAPI keys.

Recommended normalized shape:

```js
{
  providerId: "youtube-mp36",
  providerName: "YouTube MP3 / ytjar",
  status: "succeeded",
  quota: {
    requests: {
      limit: 300,
      remaining: 292,
      resetSeconds: 2671033
    },
    units: null,
    hardLimit: {
      limit: 500000,
      remaining: 499990,
      resetSeconds: 2671033
    },
    reportedAt: "2026-07-05T00:00:00.000Z"
  }
}
```

Quota display labels should be plain and separate:

```text
YouTube MP3 / ytjar
Status: completed
Requests remaining: 292 / 300
Hard limit remaining: 499990 / 500000

YouTube MP3 2025
Status: not used
Quota: not checked this run
```

If fallback occurs:

```text
YouTube MP3 / ytjar
Status: failed
Requests remaining: 0 / 300
Reason: quota exhausted

YouTube MP3 2025
Status: completed
Requests remaining: 291 / 300
```

If a provider does not return quota headers, show:

```text
Quota: not reported by provider
```

## Data Model

Each job should store an ordered `attempts` array.

Recommended attempt shape:

```js
{
  providerId,
  providerName,
  status: "pending" | "running" | "succeeded" | "failed" | "skipped",
  startedAt,
  finishedAt,
  preferredFormat,
  trimMode,
  mediaFormat,
  errorCode,
  userMessage,
  quota,
  usedForFinalOutput: true | false
}
```

Job status responses should include:

```js
{
  id,
  status,
  phase,
  providerId,
  providerName,
  attempts,
  fileUrl,
  error
}
```

The final output should identify which provider succeeded.

## Backend Implementation Tasks

### FP01: Add Automatic Provider Mode

Add a new provider option ID for automatic fallback, for example:

```js
"auto"
```

Acceptance criteria:

- the UI can submit `providerId: "auto"`;
- validation accepts `"auto"`;
- `"auto"` is the default provider mode;
- existing manual provider IDs still validate.

### FP02: Limit User-Facing Providers To Two

Update shared provider options so the visible choices are:

- automatic fallback;
- `youtube-mp36`;
- `youtube-mp3-2025`.

Acceptance criteria:

- `youtube-info-download-api` is not shown in the normal UI selector;
- manual tests for the first two providers still work;
- no RapidAPI credentials are exposed in client code.

Decision point:

- either leave `youtube-info-download-api` adapter code unused for now;
- or remove it after the two-provider flow is stable.

For this prototype, leaving it unused is lower risk than deleting it immediately.

### FP03: Implement Ordered Provider Runner

Update the provider runner so it can execute a provider plan:

- automatic mode: `youtube-mp36`, then `youtube-mp3-2025`;
- manual mode: only the selected provider.

Acceptance criteria:

- a successful first provider stops the flow;
- a fallback provider runs only after a fallback-eligible failure;
- non-fallback validation errors stop the job immediately;
- attempts are recorded in order;
- the job response shows which provider produced the final file.

### FP04: Make `youtube-mp3-2025` MP3-First

Change format attempt order for `youtube-mp3-2025`:

1. `mp3`;
2. `m4a`.

Acceptance criteria:

- manual `youtube-mp3-2025` jobs try MP3 first;
- automatic fallback jobs try MP3 first when they reach `youtube-mp3-2025`;
- M4A remains available as a fallback format;
- FFmpeg still outputs a final MP3 segment.

### FP05: Add Quota Normalization

Create or extend a quota helper that extracts only approved RapidAPI quota
headers from provider responses and media-fetch responses.

Acceptance criteria:

- quota parsing is centralized;
- separate quota records are attached to each provider attempt;
- only whitelisted quota headers can reach the browser;
- no signed URLs, provider raw payloads, cookies, tokens, or keys are returned.

### FP06: Return Attempt And Quota Data From Job Status

Update the job store and API status response to include sanitized attempt data.

Acceptance criteria:

- polling responses include attempts while a job is running;
- completed responses include the final attempt list;
- failed responses include all attempted providers and their quota summaries;
- the file endpoint remains unchanged.

### FP07: Update The UI

Update the page to display:

- the automatic provider option as the default;
- the successful provider name in the result area;
- a compact provider-attempt list after each generation;
- separate quota rows for each attempted provider;
- `not checked this run` for providers not attempted;
- clear fallback messages when the first provider fails and the second succeeds.

Acceptance criteria:

- a successful primary run shows only `youtube-mp36` as completed and
  `youtube-mp3-2025` as not checked;
- a fallback run shows `youtube-mp36` as failed and `youtube-mp3-2025` as
  completed;
- quota text remains readable on mobile;
- no in-app explanatory wall of text is added.

### FP08: Update Diagnostics

Keep the existing diagnostic logs, but add attempt-level fallback events:

- `fallback-attempt-started`;
- `fallback-attempt-succeeded`;
- `fallback-attempt-failed`;
- `fallback-provider-skipped`;
- `quota-captured`.

Acceptance criteria:

- diagnostics explain why fallback happened;
- logs remain sanitized;
- no keys or signed URLs appear in logs.

### FP09: Update Tests

Add or update tests for:

- automatic provider validation;
- visible provider options;
- automatic provider order;
- fallback-eligible errors;
- non-fallback validation errors;
- `youtube-mp3-2025` MP3-first format order;
- quota-header normalization;
- sanitized status response shape.

Acceptance criteria:

- `npm test` passes;
- `npm run lint` passes;
- `npm run build` passes.

### FP10: Manual Verification

Run the live dev server with diagnostics enabled:

```bash
YT_AUDIO_DEBUG=1 npm run dev -- -p 3007
```

Manual test matrix:

- automatic mode, normal short segment, primary succeeds;
- manual `youtube-mp36`, normal short segment;
- manual `youtube-mp3-2025`, normal short segment;
- automatic mode with forced primary failure, fallback succeeds;
- invalid YouTube URL, no fallback;
- invalid segment range, no fallback;
- one `startTime = 0` segment;
- one `startTime > 0` segment;
- one near-end segment;
- one longer segment near the maximum allowed duration.

Acceptance criteria:

- final MP3 plays in the browser;
- final duration is approximately `endTime - startTime`;
- provider attempts are shown accurately;
- quota is shown separately per provider;
- fallback reason is visible when fallback occurs;
- no keys, signed URLs, or provider secrets are printed or shown.

## Progress Tracking Updates

After approval, add these tasks to `progress.md`:

- FP01: Add automatic provider mode.
- FP02: Limit user-facing providers to `youtube-mp36` and `youtube-mp3-2025`.
- FP03: Implement ordered provider runner.
- FP04: Make `youtube-mp3-2025` MP3-first with M4A fallback.
- FP05: Normalize per-provider quota summaries.
- FP06: Return sanitized attempt/quota data from job status.
- FP07: Update UI provider selector and quota display.
- FP08: Add sanitized fallback diagnostics.
- FP09: Add automated tests.
- FP10: Run live manual verification.

Each task should be marked `in_progress` before work starts and `done` only
after its acceptance criteria are verified.

## Risks And Trade-Offs

- RapidAPI quota headers are provider-specific, so the UI must avoid implying
  that all providers share a single credit counter.
- `youtube-mp36` may report quota based on source length rather than segment
  length; show the provider-reported numbers without trying to reinterpret them.
- `youtube-mp3-2025` MP3-first may use more bandwidth than M4A-first.
- Local FFmpeg work remains a Vercel serverless risk for longer videos and
  larger downloads.
- In-memory quota and job state are prototype-only; production needs persistent
  job records and durable storage.
- Automatic fallback can consume quota on more than one provider for a single
  user generation.

## Final Production Direction

For the final integration, we should still choose one provider once manual
testing identifies the strongest option. The two-provider automatic fallback is
valuable now because it makes the prototype more reliable and gives better
comparative data, but it should not automatically become the production design
without more reliability and cost testing.
