import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_YOUTUBE_AUDIO_PROVIDER_ID,
  YOUTUBE_AUDIO_FALLBACK_PROVIDER_IDS,
  YOUTUBE_AUDIO_PROVIDER_OPTIONS,
  isYoutubeAudioProviderId,
} from "../lib/provider-options.js";
import { sanitizeDiagnosticValue, summarizeUrl } from "../lib/diagnostics.js";
import { formatHms, findUrl } from "../lib/providers/provider-utils.js";
import { normalizeRapidApiQuotaHeaders } from "../lib/rapidapi-quota.js";
import {
  providerFormatAttempts,
  providerPlanForInput,
} from "../lib/youtube-audio-provider-runner.js";
import {
  createOrReuseJob,
  markJobAttemptFailed,
  markJobAttemptSkipped,
  markJobAttemptStarted,
  markJobAttemptSucceeded,
  publicJob,
} from "../lib/youtube-audio-job-store.js";
import { parseYoutubeAudioSegmentRequest } from "../lib/youtube-audio-validation.js";

test("provider options expose automatic mode plus the two active providers", () => {
  assert.deepEqual(
    YOUTUBE_AUDIO_PROVIDER_OPTIONS.map((provider) => provider.id),
    ["auto", "youtube-mp36", "youtube-mp3-2025"],
  );
  assert.deepEqual(YOUTUBE_AUDIO_FALLBACK_PROVIDER_IDS, [
    "youtube-mp36",
    "youtube-mp3-2025",
  ]);
  assert.equal(DEFAULT_YOUTUBE_AUDIO_PROVIDER_ID, "auto");
  assert.equal(isYoutubeAudioProviderId(DEFAULT_YOUTUBE_AUDIO_PROVIDER_ID), true);
  assert.equal(isYoutubeAudioProviderId("missing-provider"), false);
});

test("formatHms formats provider-side trim times", () => {
  assert.equal(formatHms(0), "00:00:00");
  assert.equal(formatHms(65.8), "00:01:05");
  assert.equal(formatHms(65.1, "ceil"), "00:01:06");
  assert.equal(formatHms(3723), "01:02:03");
});

test("findUrl prefers nested non-YouTube media URLs", () => {
  const result = findUrl({
    data: {
      url: "https://www.youtube.com/watch?v=abc123",
      formats: [
        {
          downloadUrl: "https://cdn.example.com/audio.m4a?sig=abc",
        },
      ],
    },
  });

  assert.equal(result.path, "data.formats.0.downloadUrl");
  assert.equal(result.value, "https://cdn.example.com/audio.m4a?sig=abc");
});

test("request validation defaults to automatic mode and accepts selected provider", () => {
  const defaultResult = parseYoutubeAudioSegmentRequest({
    url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
    startTime: 0,
    endTime: 5,
  });

  assert.equal(defaultResult.success, true);
  assert.equal(defaultResult.data.providerId, DEFAULT_YOUTUBE_AUDIO_PROVIDER_ID);

  const selectedResult = parseYoutubeAudioSegmentRequest({
    url: "https://youtu.be/aqz-KE-bpKQ",
    startTime: 10,
    endTime: 20,
    providerId: "youtube-mp3-2025",
  });

  assert.equal(selectedResult.success, true);
  assert.equal(selectedResult.data.providerId, "youtube-mp3-2025");
});

test("request validation rejects unknown provider", () => {
  const result = parseYoutubeAudioSegmentRequest({
    url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
    startTime: 0,
    endTime: 5,
    providerId: "unknown",
  });

  assert.equal(result.success, false);
});

test("request validation rejects the removed info-download provider", () => {
  const result = parseYoutubeAudioSegmentRequest({
    url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
    startTime: 0,
    endTime: 5,
    providerId: "youtube-info-download-api",
  });

  assert.equal(result.success, false);
});

test("automatic provider plan uses ytjar first and 2025 second", () => {
  assert.deepEqual(providerPlanForInput({ providerId: "auto" }), [
    "youtube-mp36",
    "youtube-mp3-2025",
  ]);
  assert.deepEqual(providerPlanForInput({ providerId: "youtube-mp3-2025" }), [
    "youtube-mp3-2025",
  ]);
});

test("youtube-mp3-2025 tries mp3 before m4a", () => {
  assert.deepEqual(providerFormatAttempts({ providerId: "youtube-mp3-2025" }), [
    { preferredFormat: "mp3" },
    { preferredFormat: "m4a" },
  ]);
});

test("quota headers normalize into separate provider quota groups", () => {
  const quota = normalizeRapidApiQuotaHeaders({
    "x-ratelimit-requests-limit": "300",
    "x-ratelimit-requests-remaining": "291",
    "x-ratelimit-units-limit": "500",
    "x-ratelimit-units-remaining": "463",
    "x-ratelimit-rapid-free-plans-hard-limit-limit": "500000",
    "x-ratelimit-rapid-free-plans-hard-limit-remaining": "499991",
    "set-cookie": "do-not-forward",
  });

  assert.equal(quota.requests.limit, 300);
  assert.equal(quota.requests.remaining, 291);
  assert.equal(quota.units.limit, 500);
  assert.equal(quota.units.remaining, 463);
  assert.equal(quota.hardLimit.remaining, 499991);
  assert.equal(Object.hasOwn(quota, "set-cookie"), false);
});

test("public job exposes sanitized provider attempts and quota summaries", () => {
  const { job } = createOrReuseJob({
    sourceUrl: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
    startTime: 101,
    endTime: 106,
    providerId: "auto",
    providerName: "Automatic fallback (recommended)",
  });

  markJobAttemptStarted(job.id, {
    providerId: "youtube-mp36",
    providerName: "YouTube MP3 / ytjar",
  });
  markJobAttemptFailed(job.id, {
    providerId: "youtube-mp36",
    providerName: "YouTube MP3 / ytjar",
    errorCode: "PROVIDER_RATE_LIMITED",
    userMessage: "Provider quota or rate limit was reached.",
    quota: normalizeRapidApiQuotaHeaders({
      "x-ratelimit-request-limit": "300",
      "x-ratelimit-request-remaining": "0",
    }),
  });
  markJobAttemptStarted(job.id, {
    providerId: "youtube-mp3-2025",
    providerName: "YouTube MP3 2025",
  });
  markJobAttemptSucceeded(job.id, {
    providerId: "youtube-mp3-2025",
    providerName: "YouTube MP3 2025",
    preferredFormat: "mp3",
    trimMode: "local",
    mediaFormat: "mp3",
    quota: normalizeRapidApiQuotaHeaders({
      "x-ratelimit-requests-limit": "300",
      "x-ratelimit-requests-remaining": "291",
    }),
  });
  markJobAttemptSkipped(job.id, {
    providerId: "unused-provider",
    providerName: "Unused provider",
  });

  const response = publicJob(job);

  assert.equal(response.providerId, "auto");
  assert.equal(response.finalProviderId, "youtube-mp3-2025");
  assert.equal(response.attempts[0].errorCode, "PROVIDER_RATE_LIMITED");
  assert.equal(response.attempts[0].quota.requests.remaining, 0);
  assert.equal(response.attempts[1].status, "succeeded");
  assert.equal(response.attempts[1].preferredFormat, "mp3");
  assert.equal(response.attempts[1].quota.requests.remaining, 291);
  assert.equal(response.attempts[2].status, "skipped");
});

test("diagnostics redact token-like media URL path segments", () => {
  const result = summarizeUrl(
    "https://logan14.savenow.to/api/v2/download/1rxhoOLgCsTYUoaaCGFipAHt6OI6Ay1EOTQkXen6w0jr67UV",
  );

  assert.equal(result.host, "logan14.savenow.to");
  assert.equal(result.path, "/api/v2/download/[redacted]");
});

test("diagnostics redact escaped URLs inside JSON previews", () => {
  const result = sanitizeDiagnosticValue({
    bodyPreview:
      '{"download_url":"https:\\/\\/logan14.savenow.to\\/api\\/v2\\/download\\/1rxhoOLgCsTYUoaaCGFipAHt6OI6Ay1EOTQkXen6w0jr67UV"}',
  });

  assert.equal(
    result.bodyPreview,
    '{"download_url":"REDACTED_URL(logan14.savenow.to/api/v2/download/[redacted])"}',
  );
});
