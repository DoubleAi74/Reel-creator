import { AudioProcessingError } from "./audio-ffmpeg";
import { AudioMediaFetchError } from "./media-fetcher";
import { logDiagnostic, sanitizeError } from "./diagnostics";
import { YoutubeAudioProviderError } from "./providers";
import { getYoutubeAudioConfig } from "./server-config";
import {
  getJob,
  markJobFailed,
  markJobProcessing,
  markJobStored,
} from "./job-store";
import { runProviderSegmentJob } from "./provider-runner";
import { YoutubeAudioStorageError } from "./storage";

const MAX_CONCURRENT_JOBS = 2;

const runtime = globalThis.__reelCreatorYoutubeAudioProcessor || {
  active: new Set(),
  queued: [],
};

globalThis.__reelCreatorYoutubeAudioProcessor = runtime;

export function startBackgroundProcessing(jobId) {
  if (runtime.active.has(jobId) || runtime.queued.includes(jobId)) {
    logDiagnostic("job-already-scheduled", { jobId });
    return;
  }

  runtime.queued.push(jobId);
  logDiagnostic("job-queued", {
    jobId,
    queued: runtime.queued.length,
    active: runtime.active.size,
  });
  drainQueue();
}

export function getYoutubeAudioProcessorState() {
  return {
    active: [...runtime.active],
    queued: [...runtime.queued],
  };
}

export function __resetYoutubeAudioProcessorForTests() {
  runtime.active.clear();
  runtime.queued.splice(0, runtime.queued.length);
}

function drainQueue() {
  while (runtime.active.size < MAX_CONCURRENT_JOBS && runtime.queued.length > 0) {
    const jobId = runtime.queued.shift();
    runtime.active.add(jobId);
    logDiagnostic("job-started", {
      jobId,
      active: runtime.active.size,
    });

    processJob(jobId)
      .catch((error) => {
        logDiagnostic(
          "job-failed",
          {
            jobId,
            errorCode: errorCodeFromError(error),
            error: sanitizeError(error),
          },
          "warn",
        );
        markJobFailed(jobId, errorCodeFromError(error));
      })
      .finally(() => {
        runtime.active.delete(jobId);
        logDiagnostic("job-finished", {
          jobId,
          active: runtime.active.size,
        });
        drainQueue();
      });
  }
}

async function processJob(jobId) {
  const job = getJob(jobId);

  if (!job || job.status === "complete" || job.status === "failed") {
    logDiagnostic("job-skipped", {
      jobId,
      status: job?.status || "missing",
    });
    return;
  }

  const config = getYoutubeAudioConfig();

  logDiagnostic("job-phase", {
    jobId,
    providerId: job.providerId,
    phase: "calling_provider",
  });
  markJobProcessing(jobId, "calling_provider");

  const { providerResult, storedAsset, attempt } = await runProviderSegmentJob(
    {
      url: job.sourceUrl,
      startTime: job.startTime,
      endTime: job.endTime,
      providerId: job.providerId,
    },
    job,
    {
      config,
      onAttempt: (attemptInfo) => {
        logDiagnostic("job-provider-format-attempt", {
          jobId,
          providerId: attemptInfo.providerId || job.providerId,
          preferredFormat: attemptInfo.preferredFormat,
        });
      },
      onPhase: (phase, details = {}) => {
        logDiagnostic("job-phase", {
          jobId,
          providerId: details.providerId || job.providerId,
          phase,
        });
        markJobProcessing(jobId, phase, details);
      },
    },
  );

  logDiagnostic("provider-prepared", {
    jobId,
    providerId: providerResult.providerId,
    providerName: providerResult.providerName,
    trimMode: providerResult.trimMode,
    mediaFormat: providerResult.mediaFormat,
    preferredFormat: attempt.preferredFormat,
    mediaHost: safeHost(providerResult.mediaUrl),
    quotaHeaders: providerResult.quotaHeaders,
  });

  logDiagnostic("job-complete", {
    jobId,
    providerId: providerResult.providerId,
    stored: true,
    mediaResult: storedAsset.mediaResult,
  });

  markJobStored(jobId, {
    ...storedAsset,
    providerStatus: providerResult.trimMode,
    title: providerResult.title,
    providerId: providerResult.providerId,
    providerName: providerResult.providerName,
  });
}

function safeHost(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function errorCodeFromError(error) {
  if (
    error instanceof YoutubeAudioProviderError ||
    error instanceof AudioMediaFetchError ||
    error instanceof AudioProcessingError ||
    error instanceof YoutubeAudioStorageError
  ) {
    return error.errorCode;
  }

  if (error && typeof error.errorCode === "string") {
    return error.errorCode;
  }

  return "INTERNAL_ERROR";
}
