import { AudioProcessingError } from "./audio-ffmpeg";
import { AudioMediaFetchError } from "./media-fetcher";
import { logDiagnostic, sanitizeError } from "./diagnostics";
import {
  AUTO_YOUTUBE_AUDIO_PROVIDER_ID,
  YOUTUBE_AUDIO_FALLBACK_PROVIDER_IDS,
  isAutomaticYoutubeAudioProviderId,
} from "./provider-options";
import {
  getYoutubeAudioProviderDisplayName,
  prepareYoutubeAudioMedia,
  YoutubeAudioProviderError,
} from "./providers";
import {
  mergeRapidApiQuotaHeaders,
  normalizeRapidApiQuotaHeaders,
} from "./rapidapi-quota";
import {
  markJobAttemptFailed,
  markJobAttemptSkipped,
  markJobAttemptStarted,
  markJobAttemptSucceeded,
} from "./job-store";
import { buildYoutubeAudioSegment } from "./segment-builder";

const DEFAULT_LOCAL_TRIM_FORMATS = ["m4a", "mp3"];
const PROVIDER_LOCAL_TRIM_FORMATS = {
  "youtube-mp3-2025": ["mp3", "m4a"],
};
const NON_FALLBACK_ERROR_CODES = new Set([
  "INVALID_INPUT",
  "INVALID_PROVIDER",
  "SEGMENT_TOO_LONG",
]);

export async function runProviderSegmentJob(input, job, options = {}) {
  const providerPlan = providerPlanForInput(input);
  let lastError = null;

  for (let index = 0; index < providerPlan.length; index += 1) {
    const providerId = providerPlan[index];
    const providerName = getYoutubeAudioProviderDisplayName(providerId);

    markJobAttemptStarted(job.id, {
      providerId,
      providerName,
    });

    logDiagnostic("fallback-attempt-started", {
      jobId: job.id,
      requestedProviderId: input.providerId,
      providerId,
      providerName,
      attemptIndex: index + 1,
      providerCount: providerPlan.length,
    });

    try {
      const result = await runSingleProviderSegmentJob(
        {
          ...input,
          providerId,
        },
        job,
        {
          ...options,
          onPhase: (phase) => {
            options.onPhase?.(phase, {
              providerId,
              providerName,
            });
          },
        },
      );
      const quota = quotaSummaryFromHeaders(
        result.providerResult.quotaHeaders,
        result.storedAsset.mediaResult?.quotaHeaders,
      );

      markJobAttemptSucceeded(job.id, {
        providerId,
        providerName,
        preferredFormat: result.attempt.preferredFormat || null,
        trimMode: result.providerResult.trimMode,
        mediaFormat: result.providerResult.mediaFormat,
        quota,
      });

      markRemainingProvidersSkipped(job.id, providerPlan, index + 1);

      logDiagnostic("fallback-attempt-succeeded", {
        jobId: job.id,
        providerId,
        providerName,
        attemptIndex: index + 1,
        quota,
      });

      return result;
    } catch (error) {
      lastError = error;
      const errorCode = errorCodeFromError(error);
      const quota = quotaSummaryFromHeaders(error.quotaHeaders);
      const willFallback =
        index < providerPlan.length - 1 && shouldTryNextProvider(error);

      markJobAttemptFailed(job.id, {
        providerId,
        providerName,
        errorCode,
        userMessage: userMessageForErrorCode(errorCode),
        quota,
      });

      logDiagnostic(
        "fallback-attempt-failed",
        {
          jobId: job.id,
          requestedProviderId: input.providerId,
          providerId,
          providerName,
          errorCode,
          error: sanitizeError(error),
          quota,
          willFallback,
        },
        "warn",
      );

      if (!willFallback) {
        throw error;
      }
    }
  }

  throw lastError || new Error("Provider attempts failed");
}

async function runSingleProviderSegmentJob(input, job, options = {}) {
  const attempts = providerFormatAttempts(input);
  let lastError = null;
  let lastProviderQuotaHeaders = {};

  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];

    try {
      logDiagnostic("provider-attempt-start", {
        jobId: job.id,
        providerId: input.providerId,
        preferredFormat: attempt.preferredFormat || null,
      });

      options.onAttempt?.({
        ...attempt,
        providerId: input.providerId,
      });

      const providerResult = await prepareYoutubeAudioMedia(
        {
          ...input,
          preferredFormat: attempt.preferredFormat,
        },
        {
          config: options.config,
        },
      );
      lastProviderQuotaHeaders = providerResult.quotaHeaders || {};

      options.onPhase?.("downloading");

      const storedAsset = await buildYoutubeAudioSegment(job, providerResult, {
        config: options.config,
        onPhase: options.onPhase,
      });

      return {
        providerResult,
        storedAsset,
        attempt,
      };
    } catch (error) {
      attachQuotaHeadersToError(error, lastProviderQuotaHeaders);
      lastError = error;

      logDiagnostic(
        "provider-attempt-failed",
        {
          jobId: job.id,
          providerId: input.providerId,
          preferredFormat: attempt.preferredFormat || null,
          error: sanitizeError(error),
          willRetry: index < attempts.length - 1 && shouldTryNextFormat(error),
        },
        "warn",
      );

      if (index >= attempts.length - 1 || !shouldTryNextFormat(error)) {
        throw error;
      }
    }
  }

  throw lastError || new Error("Provider attempts failed");
}

export function providerPlanForInput(input) {
  if (
    !input.providerId ||
    input.providerId === AUTO_YOUTUBE_AUDIO_PROVIDER_ID ||
    isAutomaticYoutubeAudioProviderId(input.providerId)
  ) {
    return [...YOUTUBE_AUDIO_FALLBACK_PROVIDER_IDS];
  }

  return [input.providerId];
}

export function providerFormatAttempts(input) {
  if (input.providerId === "youtube-mp36") {
    return [{ preferredFormat: null }];
  }

  const formats =
    PROVIDER_LOCAL_TRIM_FORMATS[input.providerId] || DEFAULT_LOCAL_TRIM_FORMATS;

  if (input.preferredFormat) {
    const fallbackFormats = formats.filter(
      (format) => format !== input.preferredFormat,
    );

    return [
      { preferredFormat: input.preferredFormat },
      ...fallbackFormats.map((preferredFormat) => ({ preferredFormat })),
    ];
  }

  return formats.map((preferredFormat) => ({ preferredFormat }));
}

function shouldTryNextFormat(error) {
  if (error instanceof YoutubeAudioProviderError) {
    return ["PROVIDER_REJECTED", "PROVIDER_MALFORMED_RESPONSE", "CONVERSION_FAILED"].includes(
      error.errorCode,
    );
  }

  if (error instanceof AudioMediaFetchError) {
    return [
      "PROVIDER_TIMEOUT",
      "PROVIDER_REJECTED",
      "PROVIDER_MALFORMED_RESPONSE",
      "CONVERSION_FAILED",
      "RESULT_EXPIRED",
    ].includes(error.errorCode);
  }

  if (error instanceof AudioProcessingError) {
    return ["CONVERSION_FAILED", "PROVIDER_MALFORMED_RESPONSE"].includes(
      error.errorCode,
    );
  }

  return false;
}

function shouldTryNextProvider(error) {
  return !NON_FALLBACK_ERROR_CODES.has(errorCodeFromError(error));
}

function markRemainingProvidersSkipped(jobId, providerPlan, startIndex) {
  for (let index = startIndex; index < providerPlan.length; index += 1) {
    const providerId = providerPlan[index];
    const providerName = getYoutubeAudioProviderDisplayName(providerId);

    markJobAttemptSkipped(jobId, {
      providerId,
      providerName,
    });

    logDiagnostic("fallback-provider-skipped", {
      jobId,
      providerId,
      providerName,
      reason: "earlier_provider_succeeded",
    });
  }
}

function quotaSummaryFromHeaders(...quotaHeaderSets) {
  return normalizeRapidApiQuotaHeaders(
    mergeRapidApiQuotaHeaders(...quotaHeaderSets),
  );
}

function attachQuotaHeadersToError(error, ...quotaHeaderSets) {
  if (!error || typeof error !== "object") {
    return;
  }

  error.quotaHeaders = mergeRapidApiQuotaHeaders(
    ...quotaHeaderSets,
    error.quotaHeaders,
  );
}

function errorCodeFromError(error) {
  if (
    error instanceof YoutubeAudioProviderError ||
    error instanceof AudioMediaFetchError ||
    error instanceof AudioProcessingError
  ) {
    return error.errorCode;
  }

  if (error && typeof error.errorCode === "string") {
    return error.errorCode;
  }

  return "INTERNAL_ERROR";
}

function userMessageForErrorCode(errorCode) {
  switch (errorCode) {
    case "PROVIDER_RATE_LIMITED":
      return "Provider quota or rate limit was reached.";
    case "PROVIDER_AUTH_FAILED":
      return "Provider authentication or subscription failed.";
    case "PROVIDER_REJECTED":
      return "Provider could not convert this video.";
    case "PROVIDER_TIMEOUT":
      return "Provider request timed out.";
    case "PROVIDER_MALFORMED_RESPONSE":
      return "Provider returned an unusable response.";
    case "CONVERSION_FAILED":
      return "Audio conversion failed.";
    case "RESULT_EXPIRED":
      return "Provider result expired before it could be downloaded.";
    default:
      return "Provider attempt failed.";
  }
}
