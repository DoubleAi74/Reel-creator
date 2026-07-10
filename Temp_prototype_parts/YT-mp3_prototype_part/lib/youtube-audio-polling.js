import {
  getJob,
  markJobFailed,
  markJobProcessing,
  markJobStored,
} from "./youtube-audio-job-store.js";
import {
  YoutubeAudioFileError,
  fetchAndStoreMp3,
} from "./youtube-audio-files.js";
import {
  YoutubeMp3ProviderError,
  getYoutubeMp3ConversionStatus,
} from "./youtube-mp3-provider.js";

const INITIAL_DELAY_MS = 1000;
const MAX_ATTEMPTS = 60;
const MAX_ELAPSED_MS = 180_000;

const activePolls = globalThis.__youtubeAudioSegmentActivePolls || new Set();

globalThis.__youtubeAudioSegmentActivePolls = activePolls;

export function startBackgroundPolling(jobId) {
  if (activePolls.has(jobId)) {
    return;
  }

  activePolls.add(jobId);
  pollJob(jobId).finally(() => {
    activePolls.delete(jobId);
  });
}

async function pollJob(jobId) {
  const startedAt = Date.now();
  await delay(INITIAL_DELAY_MS);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const job = getJob(jobId);

    if (!job || job.status === "complete" || job.status === "failed") {
      return;
    }

    if (Date.now() - startedAt > MAX_ELAPSED_MS) {
      markJobFailed(jobId, "PROVIDER_TIMEOUT");
      return;
    }

    try {
      const status = await getYoutubeMp3ConversionStatus(job.providerJobId);

      if (status.state === "complete") {
        if (!status.downloadUrl) {
          markJobFailed(jobId, "RESULT_EXPIRED");
          return;
        }

        try {
          const storedAsset = await fetchAndStoreMp3(status.downloadUrl, jobId);
          markJobStored(jobId, {
            ...storedAsset,
            providerDownloadUrl: status.downloadUrl,
            providerStatus: status.providerStatus,
          });
          return;
        } catch (error) {
          if (isProbablyNotReadyYet(error, status.providerStatus)) {
            markJobProcessing(jobId, status.providerStatus);
          } else if (error instanceof YoutubeAudioFileError) {
            markJobFailed(jobId, error.errorCode);
            return;
          } else {
            throw error;
          }
        }
      } else if (status.state === "failed") {
        markJobFailed(jobId, "CONVERSION_FAILED");
        return;
      }

      markJobProcessing(jobId, status.providerStatus);
    } catch (error) {
      if (isTerminalProviderError(error)) {
        markJobFailed(jobId, error.errorCode);
        return;
      }

      if (error instanceof YoutubeAudioFileError) {
        markJobFailed(jobId, error.errorCode);
        return;
      }
    }

    await delay(nextPollDelayMs());
  }

  markJobFailed(jobId, "PROVIDER_TIMEOUT");
}

function isTerminalProviderError(error) {
  if (!(error instanceof YoutubeMp3ProviderError)) {
    return false;
  }

  return !["PROVIDER_TIMEOUT", "PROVIDER_RATE_LIMITED"].includes(error.errorCode);
}

function isProbablyNotReadyYet(error) {
  if (!(error instanceof YoutubeAudioFileError)) {
    return false;
  }

  return error.errorCode === "CONVERSION_FAILED";
}

function nextPollDelayMs() {
  return 2000 + Math.floor(Math.random() * 500);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
