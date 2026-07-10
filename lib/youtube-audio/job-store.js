import { createHash, randomUUID } from "node:crypto";

import { logDiagnostic } from "./diagnostics";
import { deleteStoredResult } from "./storage";
import { extractYouTubeVideoId } from "./youtube-url";

export const JOB_TTL_MS = 60 * 60 * 1000;
export const REUSABLE_JOB_MS = 10 * 60 * 1000;

const globalStore = globalThis.__reelCreatorYoutubeAudioJobStore || {
  jobs: new Map(),
  fingerprints: new Map(),
};

globalThis.__reelCreatorYoutubeAudioJobStore = globalStore;

export function buildJobFingerprint({ sourceUrl, startTime, endTime, providerId }) {
  const videoId = extractYouTubeVideoId(sourceUrl) || sourceUrl;
  const normalized = [
    providerId,
    videoId,
    normalizeTime(startTime),
    normalizeTime(endTime),
    "mp3",
    "128k",
  ].join("|");

  return createHash("sha256").update(normalized).digest("hex");
}

export function createOrReuseJob({
  sourceUrl,
  startTime,
  endTime,
  providerId,
  providerName,
  sessionId = null,
  config = null,
}) {
  pruneExpiredJobs();

  const fingerprint = buildJobFingerprint({
    sourceUrl,
    startTime,
    endTime,
    providerId,
  });
  const existingJobId = globalStore.fingerprints.get(fingerprint);
  const existingJob = existingJobId ? getJob(existingJobId) : null;

  if (existingJob && isReusableJob(existingJob)) {
    registerJobSession(existingJob.id, sessionId);
    return {
      job: existingJob,
      reused: true,
      rejected: null,
    };
  }

  const rejection = admissionRejection({ sessionId, config });

  if (rejection) {
    return {
      job: null,
      reused: false,
      rejected: rejection,
    };
  }

  const now = new Date();
  const job = {
    id: randomUUID(),
    fingerprint,
    sourceUrl,
    startTime,
    endTime,
    providerId,
    providerName,
    status: "queued",
    phase: "queued",
    title: null,
    providerStatus: null,
    currentProviderId: null,
    currentProviderName: null,
    finalProviderId: null,
    finalProviderName: null,
    attempts: [],
    storedAssetPath: null,
    storedAssetContentType: null,
    outputDurationSec: null,
    mediaResult: null,
    errorCode: null,
    sessionIds: new Set(),
    ingestedBySession: new Map(),
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + JOB_TTL_MS),
  };

  if (sessionId) {
    job.sessionIds.add(sessionId);
  }

  globalStore.jobs.set(job.id, job);
  globalStore.fingerprints.set(fingerprint, job.id);

  return {
    job,
    reused: false,
    rejected: null,
  };
}

export function registerJobSession(jobId, sessionId) {
  if (!sessionId) {
    return null;
  }

  const job = getJob(jobId);

  if (!job) {
    return null;
  }

  ensureJobCollections(job);
  job.sessionIds.add(sessionId);
  job.updatedAt = new Date();

  return job;
}

export function markJobProcessing(jobId, phase = "processing", details = {}) {
  const job = getJob(jobId);

  if (!job || job.status === "complete" || job.status === "failed") {
    return null;
  }

  job.status = "processing";
  job.phase = phase;
  job.providerStatus = details.providerStatus || job.providerStatus;
  job.title = details.title || job.title;
  job.currentProviderId = details.providerId || job.currentProviderId;
  job.currentProviderName = details.providerName || job.currentProviderName;
  job.updatedAt = new Date();

  return job;
}

export function markJobStored(
  jobId,
  {
    storedAssetPath,
    storedAssetContentType,
    outputDurationSec = null,
    mediaResult = null,
    providerStatus = null,
    title = null,
    providerId = null,
    providerName = null,
  },
) {
  const job = getJob(jobId);

  if (!job || job.status === "failed") {
    return null;
  }

  job.status = "complete";
  job.phase = "ready";
  job.providerStatus = providerStatus;
  job.title = title || job.title;
  job.finalProviderId = providerId || job.finalProviderId || job.currentProviderId;
  job.finalProviderName =
    providerName || job.finalProviderName || job.currentProviderName;
  job.storedAssetPath = storedAssetPath;
  job.storedAssetContentType = storedAssetContentType;
  job.outputDurationSec = outputDurationSec;
  job.mediaResult = mediaResult;
  job.updatedAt = new Date();

  return job;
}

export function markJobFailed(jobId, errorCode, errorMessage = null) {
  const job = getJob(jobId);

  if (!job || job.status === "complete") {
    return null;
  }

  job.status = "failed";
  job.phase = "failed";
  job.errorCode = errorCode;
  if (errorMessage) {
    job.errorMessage = String(errorMessage).slice(0, 500);
  }
  job.updatedAt = new Date();
  deleteStoredResult(job).catch((error) => {
    logDiagnostic(
      "job-result-delete-failed",
      { jobId, error },
      "warn",
    );
  });

  return job;
}

export function markJobAttemptStarted(jobId, { providerId, providerName }) {
  const job = getJob(jobId);

  if (!job || job.status === "complete" || job.status === "failed") {
    return null;
  }

  const now = new Date();
  const attempt = getOrCreateAttempt(job, providerId, providerName);
  attempt.status = "running";
  attempt.startedAt = attempt.startedAt || now;
  attempt.finishedAt = null;
  attempt.errorCode = null;
  attempt.userMessage = null;
  attempt.usedForFinalOutput = false;
  job.currentProviderId = providerId;
  job.currentProviderName = providerName;
  job.updatedAt = now;

  return attempt;
}

export function markJobAttemptSucceeded(
  jobId,
  {
    providerId,
    providerName,
    preferredFormat = null,
    trimMode = null,
    mediaFormat = null,
    quota = null,
    usedForFinalOutput = true,
  },
) {
  return finishJobAttempt(jobId, providerId, providerName, {
    status: "succeeded",
    preferredFormat,
    trimMode,
    mediaFormat,
    quota,
    usedForFinalOutput,
  });
}

export function markJobAttemptFailed(
  jobId,
  {
    providerId,
    providerName,
    preferredFormat = null,
    trimMode = null,
    mediaFormat = null,
    errorCode = "INTERNAL_ERROR",
    userMessage = null,
    quota = null,
  },
) {
  return finishJobAttempt(jobId, providerId, providerName, {
    status: "failed",
    preferredFormat,
    trimMode,
    mediaFormat,
    errorCode,
    userMessage,
    quota,
    usedForFinalOutput: false,
  });
}

export function markJobAttemptSkipped(jobId, { providerId, providerName }) {
  return finishJobAttempt(jobId, providerId, providerName, {
    status: "skipped",
    usedForFinalOutput: false,
  });
}

export function getJob(jobId) {
  const job = globalStore.jobs.get(jobId);

  if (!job) {
    return null;
  }

  ensureJobCollections(job);

  if (job.expiresAt.getTime() < Date.now()) {
    deleteJob(job);
    return null;
  }

  return job;
}

export function publicJob(job) {
  const response = {
    jobId: job.id,
    status: job.status,
    phase: job.phase,
    providerId: job.providerId,
    providerName: job.providerName,
    currentProviderId: job.currentProviderId || null,
    currentProviderName: job.currentProviderName || null,
    finalProviderId: job.finalProviderId || null,
    finalProviderName: job.finalProviderName || null,
    attempts: publicAttempts(job.attempts || []),
  };

  if (job.title) {
    response.title = job.title;
  }

  if (job.status === "complete") {
    response.outputDurationSec = job.outputDurationSec || null;
  }

  if (job.status === "failed") {
    response.errorCode = job.errorCode || "INTERNAL_ERROR";
    if (job.errorMessage) {
      response.errorMessage = job.errorMessage;
    }
  }

  return response;
}

export function getIngestedAssetForSession(jobId, sessionId) {
  const job = getJob(jobId);

  if (!job || !sessionId) {
    return null;
  }

  ensureJobCollections(job);
  return job.ingestedBySession.get(sessionId) || null;
}

export function recordIngestedAssetForSession(jobId, sessionId, asset) {
  const job = getJob(jobId);

  if (!job || !sessionId || !asset) {
    return null;
  }

  ensureJobCollections(job);
  job.ingestedBySession.set(sessionId, asset);
  job.updatedAt = new Date();

  return asset;
}

export function getActiveYoutubeAudioSessionIds() {
  const sessionIds = new Set();

  for (const job of globalStore.jobs.values()) {
    ensureJobCollections(job);

    if (!isActiveJob(job)) {
      continue;
    }

    for (const sessionId of job.sessionIds) {
      sessionIds.add(sessionId);
    }
  }

  return [...sessionIds];
}

export function findInFlightYoutubeAudioForSession(sessionId) {
  if (!sessionId) {
    return null;
  }

  for (const job of globalStore.jobs.values()) {
    ensureJobCollections(job);

    if (isActiveJob(job) && job.sessionIds.has(sessionId)) {
      return job;
    }
  }

  return null;
}

export function getYoutubeAudioJobCounts(sessionId = null) {
  let active = 0;
  let activeForSession = 0;

  for (const job of globalStore.jobs.values()) {
    ensureJobCollections(job);

    if (!isActiveJob(job)) {
      continue;
    }

    active += 1;

    if (sessionId && job.sessionIds.has(sessionId)) {
      activeForSession += 1;
    }
  }

  return { active, activeForSession };
}

export function pruneExpiredJobs({ now = Date.now() } = {}) {
  const removed = [];

  for (const job of globalStore.jobs.values()) {
    if (job.expiresAt.getTime() < now) {
      deleteJob(job);
      removed.push(job.id);
    }
  }

  return removed;
}

export function deleteJob(job) {
  globalStore.jobs.delete(job.id);

  if (globalStore.fingerprints.get(job.fingerprint) === job.id) {
    globalStore.fingerprints.delete(job.fingerprint);
  }

  deleteStoredResult(job).catch((error) => {
    logDiagnostic("job-result-delete-failed", { jobId: job.id, error }, "warn");
  });
}

export function __resetYoutubeAudioJobsForTests() {
  for (const job of globalStore.jobs.values()) {
    deleteStoredResult(job).catch(() => {});
  }

  globalStore.jobs.clear();
  globalStore.fingerprints.clear();
}

function finishJobAttempt(jobId, providerId, providerName, details) {
  const job = getJob(jobId);

  if (!job || job.status === "complete" || job.status === "failed") {
    return null;
  }

  const attempt = getOrCreateAttempt(job, providerId, providerName);
  const now = new Date();
  attempt.status = details.status;
  attempt.startedAt = attempt.startedAt || now;
  attempt.finishedAt = now;
  attempt.preferredFormat = details.preferredFormat ?? attempt.preferredFormat;
  attempt.trimMode = details.trimMode ?? attempt.trimMode;
  attempt.mediaFormat = details.mediaFormat ?? attempt.mediaFormat;
  attempt.errorCode = details.errorCode || null;
  attempt.userMessage = details.userMessage || null;
  attempt.quota = details.quota || attempt.quota || null;
  attempt.usedForFinalOutput = Boolean(details.usedForFinalOutput);
  job.updatedAt = now;

  if (attempt.usedForFinalOutput) {
    job.finalProviderId = providerId;
    job.finalProviderName = providerName;
  }

  return attempt;
}

function getOrCreateAttempt(job, providerId, providerName) {
  job.attempts ||= [];

  let attempt = job.attempts.find((entry) => entry.providerId === providerId);

  if (!attempt) {
    attempt = {
      providerId,
      providerName,
      status: "pending",
      startedAt: null,
      finishedAt: null,
      preferredFormat: null,
      trimMode: null,
      mediaFormat: null,
      errorCode: null,
      userMessage: null,
      quota: null,
      usedForFinalOutput: false,
    };
    job.attempts.push(attempt);
  }

  attempt.providerName = providerName || attempt.providerName;
  return attempt;
}

function publicAttempts(attempts) {
  return attempts.map((attempt) => ({
    providerId: attempt.providerId,
    providerName: attempt.providerName,
    status: attempt.status,
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
    preferredFormat: attempt.preferredFormat || null,
    trimMode: attempt.trimMode || null,
    mediaFormat: attempt.mediaFormat || null,
    errorCode: attempt.errorCode || null,
    userMessage: attempt.userMessage || null,
    quota: attempt.quota || null,
    usedForFinalOutput: Boolean(attempt.usedForFinalOutput),
  }));
}

function isReusableJob(job) {
  if (job.status === "failed") {
    return false;
  }

  return Date.now() - job.createdAt.getTime() <= REUSABLE_JOB_MS;
}

function admissionRejection({ sessionId, config }) {
  if (!config) {
    return null;
  }

  const { active, activeForSession } = getYoutubeAudioJobCounts(sessionId);

  if (active >= config.maxQueueDepth) {
    return "RESOURCE_LIMIT_REACHED";
  }

  if (sessionId && activeForSession >= config.maxActivePerSession) {
    return "RESOURCE_LIMIT_REACHED";
  }

  return null;
}

function isActiveJob(job) {
  return job.status === "queued" || job.status === "processing";
}

function ensureJobCollections(job) {
  if (!(job.sessionIds instanceof Set)) {
    job.sessionIds = new Set(job.sessionIds || []);
  }

  if (!(job.ingestedBySession instanceof Map)) {
    job.ingestedBySession = new Map(Object.entries(job.ingestedBySession || {}));
  }
}

function normalizeTime(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}
