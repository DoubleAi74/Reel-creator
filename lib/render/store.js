import { getTextLayerFormat, normalizeTextLayerMode } from "@/lib/render/formats";

const DEFAULT_RENDER_CONCURRENCY = 1;

function getRenderStore() {
  if (!globalThis.__reelCreatorRenderStore) {
    globalThis.__reelCreatorRenderStore = {
      activeCount: 0,
      jobs: new Map(),
      queue: [],
    };
  }

  return globalThis.__reelCreatorRenderStore;
}

function clampProgress(progress) {
  if (!Number.isFinite(progress)) {
    return 0;
  }

  return Math.min(1, Math.max(0, progress));
}

function getRenderConcurrency() {
  const parsedValue = Number.parseInt(process.env.RENDER_CONCURRENCY ?? "", 10);

  return Number.isFinite(parsedValue) && parsedValue > 0
    ? parsedValue
    : DEFAULT_RENDER_CONCURRENCY;
}

function slugifyTitle(title) {
  return (
    String(title ?? "reel-creator")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "reel-creator"
  );
}

function stamp(job, patch) {
  return {
    ...job,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}

function drainQueue() {
  const store = getRenderStore();

  while (
    store.activeCount < getRenderConcurrency() &&
    store.queue.length > 0
  ) {
    const task = store.queue.shift();

    store.activeCount += 1;

    Promise.resolve()
      .then(() => task.run())
      .catch((error) => {
        const job = getRenderJob(task.jobId);

        if (!job || job.status === "done" || job.status === "error") {
          return;
        }

        markRenderJobFailed(
          task.jobId,
          error instanceof Error ? error.message : "Render failed unexpectedly.",
        );
      })
      .finally(() => {
        store.activeCount -= 1;
        drainQueue();
      });
  }
}

export function createRenderJob({
  projectTitle,
  sessionId,
  textLayerMode = null,
  transparent = false,
}) {
  const jobId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const slug = slugifyTitle(projectTitle);
  const resolvedTextLayerMode = transparent
    ? normalizeTextLayerMode(textLayerMode)
    : null;
  const textLayerFormat = resolvedTextLayerMode
    ? getTextLayerFormat(resolvedTextLayerMode)
    : null;
  const downloadName = transparent
    ? `${slug}-text-layer-${jobId.slice(0, 8)}.${textLayerFormat.extension}`
    : `${slug}-${jobId.slice(0, 8)}.mp4`;
  const job = {
    createdAt,
    downloadName,
    error: null,
    filePath: null,
    fileUrl: null,
    jobId,
    progress: 0,
    sessionId,
    status: "queued",
    textLayerMode: resolvedTextLayerMode,
    updatedAt: createdAt,
  };

  getRenderStore().jobs.set(jobId, job);

  return job;
}

export function enqueueRenderJob(jobId, run) {
  getRenderStore().queue.push({ jobId, run });
  drainQueue();
}

export function findInFlightRenderForSession(sessionId) {
  for (const job of getRenderStore().jobs.values()) {
    if (
      job.sessionId === sessionId &&
      (job.status === "queued" || job.status === "rendering")
    ) {
      return job;
    }
  }

  return null;
}

export function removeRenderJobsForSessions(
  sessionIds,
  { includeInFlight = false } = {},
) {
  const removableSessionIds = new Set(
    Array.isArray(sessionIds)
      ? sessionIds.filter(
          (sessionId) => typeof sessionId === "string" && sessionId.length > 0,
        )
      : [],
  );

  if (removableSessionIds.size === 0) {
    return [];
  }

  const removedJobIds = [];
  const store = getRenderStore();

  for (const [jobId, job] of store.jobs.entries()) {
    if (!removableSessionIds.has(job.sessionId)) {
      continue;
    }

    if (
      !includeInFlight &&
      (job.status === "queued" || job.status === "rendering")
    ) {
      continue;
    }

    store.jobs.delete(jobId);
    removedJobIds.push(jobId);
  }

  return removedJobIds;
}

export function getRenderJob(jobId) {
  return getRenderStore().jobs.get(jobId) ?? null;
}

export function updateRenderJob(jobId, updater) {
  const store = getRenderStore();
  const currentJob = store.jobs.get(jobId);

  if (!currentJob) {
    return null;
  }

  const patch =
    typeof updater === "function" ? updater(currentJob) : updater;

  if (!patch) {
    return currentJob;
  }

  const nextJob = stamp(currentJob, patch);
  store.jobs.set(jobId, nextJob);

  return nextJob;
}

export function markRenderJobRunning(jobId) {
  return updateRenderJob(jobId, (job) => ({
    error: null,
    progress: Math.max(job.progress, 0.01),
    status: "rendering",
  }));
}

export function markRenderJobProgress(jobId, progress) {
  return updateRenderJob(jobId, (job) => ({
    progress: Math.max(job.progress, clampProgress(progress)),
    status: "rendering",
  }));
}

export function markRenderJobComplete(jobId, { filePath, fileUrl }) {
  return updateRenderJob(jobId, {
    error: null,
    filePath,
    fileUrl,
    progress: 1,
    status: "done",
  });
}

export function markRenderJobFailed(jobId, errorMessage) {
  return updateRenderJob(jobId, (job) => ({
    error: errorMessage,
    progress: job.progress,
    status: "error",
  }));
}

export function toRenderJobResponse(job) {
  if (!job) {
    return null;
  }

  return {
    error: job.error,
    fileUrl: job.fileUrl,
    progress: clampProgress(job.progress),
    status: job.status,
  };
}
