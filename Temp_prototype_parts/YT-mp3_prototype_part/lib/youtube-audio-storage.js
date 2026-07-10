import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { getYoutubeAudioConfig } from "./server-config.js";

const RESULT_DIR_NAME = "results";

export class YoutubeAudioStorageError extends Error {
  constructor(message, errorCode = "INTERNAL_ERROR") {
    super(message);
    this.name = "YoutubeAudioStorageError";
    this.errorCode = errorCode;
  }
}

export async function storeFinalMp3(sourcePath, jobId, options = {}) {
  const config = options.config || getYoutubeAudioConfig();
  const resultDir = path.join(config.tmpDir, RESULT_DIR_NAME);
  await mkdir(resultDir, { recursive: true });

  const storedAssetPath = path.join(resultDir, `${jobId}.mp3`);
  await copyFile(sourcePath, storedAssetPath);

  return {
    storedAssetPath,
    storedAssetContentType: "audio/mpeg",
  };
}

export async function readStoredAudio(job) {
  if (!job.storedAssetPath) {
    throw new YoutubeAudioStorageError("Stored result is missing", "RESULT_EXPIRED");
  }

  const fileStat = await stat(job.storedAssetPath);

  if (!fileStat.isFile()) {
    throw new YoutubeAudioStorageError("Stored result is missing", "RESULT_EXPIRED");
  }

  return {
    buffer: await readFile(job.storedAssetPath),
    contentType: job.storedAssetContentType || "audio/mpeg",
  };
}

export async function getStoredAudioStream(job) {
  if (!job.storedAssetPath) {
    throw new YoutubeAudioStorageError("Stored result is missing", "RESULT_EXPIRED");
  }

  const fileStat = await stat(job.storedAssetPath);

  if (!fileStat.isFile()) {
    throw new YoutubeAudioStorageError("Stored result is missing", "RESULT_EXPIRED");
  }

  return {
    body: Readable.toWeb(createReadStream(job.storedAssetPath)),
    contentLength: fileStat.size,
    contentType: job.storedAssetContentType || "audio/mpeg",
  };
}
