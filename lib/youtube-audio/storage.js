import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { getYoutubeAudioConfig } from "./server-config";

const RESULT_DIR_NAME = "results";
const RESULT_GRACE_MS = 5 * 60 * 1000;
const DEFAULT_JOB_TTL_MS = 60 * 60 * 1000;

export class YoutubeAudioStorageError extends Error {
  constructor(message, errorCode = "INTERNAL_ERROR") {
    super(message);
    this.name = "YoutubeAudioStorageError";
    this.errorCode = errorCode;
  }
}

export function getYoutubeAudioTmpDir(config = getYoutubeAudioConfig()) {
  return config.tmpDir;
}

export function getYoutubeAudioResultDir(config = getYoutubeAudioConfig()) {
  return path.join(config.tmpDir, RESULT_DIR_NAME);
}

export async function storeFinalMp3(sourcePath, jobId, options = {}) {
  const config = options.config || getYoutubeAudioConfig();
  const resultDir = getYoutubeAudioResultDir(config);
  await mkdir(resultDir, { recursive: true });

  const storedAssetPath = path.join(resultDir, `${jobId}.mp3`);
  const tempPath = path.join(resultDir, `${jobId}.${crypto.randomUUID()}.tmp`);

  try {
    await copyFile(sourcePath, tempPath);
    await rename(tempPath, storedAssetPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }

  return {
    storedAssetPath,
    storedAssetContentType: "audio/mpeg",
  };
}

export async function readStoredAudio(job) {
  if (!job.storedAssetPath) {
    throw new YoutubeAudioStorageError("Stored result is missing", "RESULT_EXPIRED");
  }

  const fileStat = await statStoredResult(job.storedAssetPath);

  return {
    buffer: await readFile(job.storedAssetPath),
    contentType: job.storedAssetContentType || "audio/mpeg",
    contentLength: fileStat.size,
  };
}

export async function getStoredAudioStream(job) {
  if (!job.storedAssetPath) {
    throw new YoutubeAudioStorageError("Stored result is missing", "RESULT_EXPIRED");
  }

  const fileStat = await statStoredResult(job.storedAssetPath);

  return {
    body: Readable.toWeb(createReadStream(job.storedAssetPath)),
    contentLength: fileStat.size,
    contentType: job.storedAssetContentType || "audio/mpeg",
  };
}

export async function deleteStoredResult(jobOrPath) {
  const storedAssetPath =
    typeof jobOrPath === "string" ? jobOrPath : jobOrPath?.storedAssetPath;

  if (!storedAssetPath) {
    return false;
  }

  await rm(storedAssetPath, { force: true });

  return true;
}

export async function sweepStaleYoutubeAudioResults({
  now = Date.now(),
  maxAgeMs = DEFAULT_JOB_TTL_MS + RESULT_GRACE_MS,
  config,
} = {}) {
  const resultDir = getYoutubeAudioResultDir(config || getYoutubeAudioConfig());
  let entries = [];

  try {
    entries = await readdir(resultDir, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const removed = [];
  const cutoff = now - maxAgeMs;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".mp3")) {
      continue;
    }

    const filePath = path.join(resultDir, entry.name);
    const fileStat = await stat(filePath).catch(() => null);

    if (!fileStat || fileStat.mtimeMs >= cutoff) {
      continue;
    }

    await rm(filePath, { force: true });
    removed.push(filePath);
  }

  return removed;
}

async function statStoredResult(filePath) {
  const fileStat = await stat(filePath).catch(() => null);

  if (!fileStat?.isFile()) {
    throw new YoutubeAudioStorageError("Stored result is missing", "RESULT_EXPIRED");
  }

  return fileStat;
}
