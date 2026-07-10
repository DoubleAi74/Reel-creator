import { AudioProcessingError } from "./audio-ffmpeg";
import { AudioMediaFetchError } from "./media-fetcher";
import { logConvertTrace, logDiagnostic, sanitizeError } from "./diagnostics";
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

/**
 * Vercel (and multi-instance hosts) cannot rely on in-memory background jobs:
 * the function freezes after the HTTP response, and the next poll often hits a
 * different isolate with an empty job map. Run the convert inline in that case.
 */
export function shouldRunYoutubeAudioJobsSynchronously() {
  if (process.env.YT_AUDIO_SYNC === "1" || process.env.YT_AUDIO_SYNC === "true") {
    return true;
  }

  if (process.env.YT_AUDIO_SYNC === "0" || process.env.YT_AUDIO_SYNC === "false") {
    return false;
  }

  return process.env.VERCEL === "1";
}

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

/**
 * Run a job to completion on this process (awaited). Used on Vercel so POST
 * does not return until the MP3 is ready (or failed) in the same isolate.
 */
export async function runYoutubeAudioJobNow(jobId) {
  const startedAt = Date.now();
  logConvertTrace("sync-start", { jobId });

  if (runtime.active.has(jobId)) {
    logDiagnostic("job-already-active-sync-wait", { jobId });
  }

  // Remove from queue if present so drainQueue does not double-start it.
  const queueIndex = runtime.queued.indexOf(jobId);
  if (queueIndex >= 0) {
    runtime.queued.splice(queueIndex, 1);
  }

  runtime.active.add(jobId);
  logDiagnostic("job-started-sync", {
    jobId,
    active: runtime.active.size,
    vercel: process.env.VERCEL === "1",
  });

  try {
    await processJob(jobId);
    const job = getJob(jobId);
    logConvertTrace("sync-done", {
      jobId,
      status: job?.status ?? null,
      phase: job?.phase ?? null,
      errorCode: job?.errorCode ?? null,
      ms: Date.now() - startedAt,
    });
  } catch (error) {
    const errorCode = errorCodeFromError(error);
    const errorMessage = errorMessageFromError(error);
    logConvertTrace(
      "sync-threw",
      {
        jobId,
        errorCode,
        message: errorMessage,
        ms: Date.now() - startedAt,
      },
      "error",
    );
    logDiagnostic(
      "job-failed",
      {
        jobId,
        errorCode,
        error: sanitizeError(error),
        mode: "sync",
      },
      "warn",
    );
    markJobFailed(jobId, errorCode, errorMessage);
  } finally {
    runtime.active.delete(jobId);
    logDiagnostic("job-finished-sync", {
      jobId,
      active: runtime.active.size,
    });
    drainQueue();
  }

  return getJob(jobId);
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
        const errorCode = errorCodeFromError(error);
        const errorMessage = errorMessageFromError(error);
        logDiagnostic(
          "job-failed",
          {
            jobId,
            errorCode,
            error: sanitizeError(error),
          },
          "warn",
        );
        markJobFailed(jobId, errorCode, errorMessage);
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
    logConvertTrace("process-skipped", {
      jobId,
      status: job?.status || "missing",
    });
    return;
  }

  const config = getYoutubeAudioConfig();
  const phaseStartedAt = Date.now();

  logDiagnostic("job-phase", {
    jobId,
    providerId: job.providerId,
    phase: "calling_provider",
  });
  logConvertTrace("phase", {
    jobId,
    phase: "calling_provider",
    providerId: job.providerId,
    startTime: job.startTime,
    endTime: job.endTime,
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
        logConvertTrace("provider-attempt", {
          jobId,
          providerId: attemptInfo.providerId || job.providerId,
          preferredFormat: attemptInfo.preferredFormat ?? null,
        });
      },
      onPhase: (phase, details = {}) => {
        logDiagnostic("job-phase", {
          jobId,
          providerId: details.providerId || job.providerId,
          phase,
        });
        logConvertTrace("phase", {
          jobId,
          phase,
          providerId: details.providerId || job.providerId,
          msSinceStart: Date.now() - phaseStartedAt,
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
  logConvertTrace("provider-prepared", {
    jobId,
    providerId: providerResult.providerId,
    trimMode: providerResult.trimMode,
    mediaFormat: providerResult.mediaFormat,
    mediaHost: safeHost(providerResult.mediaUrl),
    msSinceStart: Date.now() - phaseStartedAt,
  });

  logDiagnostic("job-complete", {
    jobId,
    providerId: providerResult.providerId,
    stored: true,
    mediaResult: storedAsset.mediaResult,
  });
  logConvertTrace("stored", {
    jobId,
    providerId: providerResult.providerId,
    outputDurationSec: storedAsset.outputDurationSec ?? null,
    msSinceStart: Date.now() - phaseStartedAt,
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

function errorMessageFromError(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error.message === "string") {
    return error.message;
  }

  return null;
}
