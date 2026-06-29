// In-memory store for background transcription/timing jobs. Mirrors
// lib/render/store.js so the lifecycle (queue -> running -> done/error) and the
// poll-based client recovery match the render flow. Jobs are keyed by jobId and
// additionally carry their assetId so in-flight detection and client recovery
// can match on sessionId + assetId rather than session alone.

const DEFAULT_TRANSCRIBE_CONCURRENCY = 1;

// Completed/failed jobs are retained so a client that reloads or navigates away
// can still recover the result. Aligned with the 24h asset-recovery window.
const FINISHED_JOB_TTL_MS = 24 * 60 * 60 * 1000;

function getTranscribeStore() {
  if (!globalThis.__reelCreatorTranscribeStore) {
    globalThis.__reelCreatorTranscribeStore = {
      activeCount: 0,
      jobs: new Map(),
      queue: [],
    };
  }

  return globalThis.__reelCreatorTranscribeStore;
}

function clampProgress(progress) {
  if (!Number.isFinite(progress)) {
    return 0;
  }

  return Math.min(1, Math.max(0, progress));
}

function getTranscribeConcurrency() {
  const parsedValue = Number.parseInt(
    process.env.TRANSCRIBE_CONCURRENCY ?? "",
    10,
  );

  return Number.isFinite(parsedValue) && parsedValue > 0
    ? parsedValue
    : DEFAULT_TRANSCRIBE_CONCURRENCY;
}

function isFinishedStatus(status) {
  return status === "done" || status === "error";
}

// Lazily drop finished jobs past their retention window so the map cannot grow
// unbounded. Called on each store access; cheap for the small job counts here.
function purgeExpiredFinishedJobs(now = Date.now()) {
  const store = getTranscribeStore();

  for (const [jobId, job] of store.jobs.entries()) {
    if (!isFinishedStatus(job.status)) {
      continue;
    }

    const finishedAtMs = Date.parse(job.updatedAt ?? job.createdAt ?? "");

    if (Number.isFinite(finishedAtMs) && now - finishedAtMs >= FINISHED_JOB_TTL_MS) {
      store.jobs.delete(jobId);
    }
  }
}

function stamp(job, patch) {
  return {
    ...job,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}

function drainQueue() {
  const store = getTranscribeStore();

  while (
    store.activeCount < getTranscribeConcurrency() &&
    store.queue.length > 0
  ) {
    const task = store.queue.shift();

    store.activeCount += 1;

    Promise.resolve()
      .then(() => task.run())
      .catch((error) => {
        const job = getTranscribeJob(task.jobId);

        if (!job || isFinishedStatus(job.status)) {
          return;
        }

        markTranscribeJobFailed(
          task.jobId,
          error instanceof Error
            ? error.message
            : "Lyric timing failed unexpectedly.",
        );
      })
      .finally(() => {
        store.activeCount -= 1;
        drainQueue();
      });
  }
}

export function createTranscribeJob({ assetId, sessionId }) {
  const jobId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const job = {
    assetId,
    createdAt,
    detail: "",
    error: null,
    jobId,
    progress: 0,
    result: null,
    sessionId,
    stage: "queued",
    status: "queued",
    title: "Queued",
    updatedAt: createdAt,
  };

  getTranscribeStore().jobs.set(jobId, job);

  return job;
}

export function enqueueTranscribeJob(jobId, run) {
  getTranscribeStore().queue.push({ jobId, run });
  drainQueue();
}

export function findInFlightTranscribeForSession(sessionId, assetId) {
  purgeExpiredFinishedJobs();

  for (const job of getTranscribeStore().jobs.values()) {
    if (
      job.sessionId === sessionId &&
      job.assetId === assetId &&
      (job.status === "queued" || job.status === "running")
    ) {
      return job;
    }
  }

  return null;
}

// Sessions backing a queued or running job, so the file sweeper can exempt them
// even when the browser has stopped polling.
export function getActiveJobSessionIds() {
  const sessionIds = new Set();

  for (const job of getTranscribeStore().jobs.values()) {
    if (job.status === "queued" || job.status === "running") {
      if (typeof job.sessionId === "string" && job.sessionId.length > 0) {
        sessionIds.add(job.sessionId);
      }
    }
  }

  return [...sessionIds];
}

export function getTranscribeJob(jobId) {
  purgeExpiredFinishedJobs();

  return getTranscribeStore().jobs.get(jobId) ?? null;
}

export function updateTranscribeJob(jobId, updater) {
  const store = getTranscribeStore();
  const currentJob = store.jobs.get(jobId);

  if (!currentJob) {
    return null;
  }

  const patch = typeof updater === "function" ? updater(currentJob) : updater;

  if (!patch) {
    return currentJob;
  }

  const nextJob = stamp(currentJob, patch);
  store.jobs.set(jobId, nextJob);

  return nextJob;
}

export function markTranscribeJobRunning(jobId) {
  return updateTranscribeJob(jobId, (job) => ({
    error: null,
    progress: Math.max(job.progress, 0.01),
    status: "running",
  }));
}

export function markTranscribeJobProgress(jobId, patch = {}) {
  return updateTranscribeJob(jobId, (job) => ({
    detail: typeof patch.detail === "string" ? patch.detail : job.detail,
    progress: Number.isFinite(patch.progress)
      ? Math.max(job.progress, clampProgress(patch.progress))
      : job.progress,
    stage: typeof patch.stage === "string" ? patch.stage : job.stage,
    status: "running",
    title: typeof patch.title === "string" ? patch.title : job.title,
  }));
}

export function markTranscribeJobComplete(jobId, result) {
  return updateTranscribeJob(jobId, {
    detail: "",
    error: null,
    progress: 1,
    result,
    stage: "complete",
    status: "done",
    title: "Complete",
  });
}

export function markTranscribeJobFailed(jobId, errorMessage) {
  return updateTranscribeJob(jobId, (job) => ({
    error: errorMessage,
    progress: job.progress,
    status: "error",
  }));
}

export function toTranscribeJobResponse(job) {
  if (!job) {
    return null;
  }

  return {
    assetId: job.assetId,
    detail: job.detail,
    error: job.error,
    progress: clampProgress(job.progress),
    stage: job.stage,
    status: job.status,
    title: job.title,
    // Only surface the (potentially large) pipeline result once finished.
    ...(job.status === "done" ? { result: job.result } : {}),
  };
}
