import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getYoutubeMp3Config } from "./server-config.js";

const MAX_RESULT_BYTES = 100 * 1024 * 1024;
const OBSERVED_RESULT_HOSTS = ["45.76.15.135", "78.141.232.210"];

export class YoutubeAudioFileError extends Error {
  constructor(message, errorCode = "INTERNAL_ERROR") {
    super(message);
    this.name = "YoutubeAudioFileError";
    this.errorCode = errorCode;
  }
}

export async function fetchAndStoreMp3(providerUrl, jobId, options = {}) {
  const config = options.config || getYoutubeMp3Config();
  const url = parseAndValidateProviderUrl(providerUrl, config);

  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs || 20_000),
  });

  if (!response.ok) {
    throw new YoutubeAudioFileError(
      `Provider result returned HTTP ${response.status}`,
      response.status === 410 ? "RESULT_EXPIRED" : "CONVERSION_FAILED",
    );
  }

  const contentType = response.headers.get("content-type") || "";
  const allowedType =
    contentType.includes("audio/") ||
    contentType.includes("application/octet-stream");

  if (!allowedType) {
    throw new YoutubeAudioFileError(
      `Unexpected result content type: ${contentType}`,
      "PROVIDER_MALFORMED_RESPONSE",
    );
  }

  const declaredLength = Number(response.headers.get("content-length") || "0");

  if (declaredLength > MAX_RESULT_BYTES) {
    throw new YoutubeAudioFileError(
      "Generated MP3 exceeds the maximum allowed size",
      "PROVIDER_REJECTED",
    );
  }

  const arrayBuffer = await response.arrayBuffer();

  if (arrayBuffer.byteLength > MAX_RESULT_BYTES) {
    throw new YoutubeAudioFileError(
      "Generated MP3 exceeds the maximum allowed size",
      "PROVIDER_REJECTED",
    );
  }

  await mkdir(config.tmpDir, { recursive: true });

  const filePath = path.join(config.tmpDir, `${jobId}.mp3`);
  await writeFile(filePath, Buffer.from(arrayBuffer));

  return {
    storedAssetPath: filePath,
    storedAssetContentType: contentType || "audio/mpeg",
  };
}

export async function readStoredMp3(job) {
  if (!job.storedAssetPath) {
    throw new YoutubeAudioFileError("Stored result is missing", "RESULT_EXPIRED");
  }

  const fileStat = await stat(job.storedAssetPath);

  if (!fileStat.isFile()) {
    throw new YoutubeAudioFileError("Stored result is missing", "RESULT_EXPIRED");
  }

  return {
    buffer: await readFile(job.storedAssetPath),
    contentType: job.storedAssetContentType || "audio/mpeg",
  };
}

function parseAndValidateProviderUrl(providerUrl, config) {
  let url;

  try {
    url = new URL(providerUrl);
  } catch {
    throw new YoutubeAudioFileError(
      "Provider result URL is malformed",
      "PROVIDER_MALFORMED_RESPONSE",
    );
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new YoutubeAudioFileError(
      "Provider result URL protocol is not allowed",
      "PROVIDER_MALFORMED_RESPONSE",
    );
  }

  const allowedHosts = new Set([config.rapidApiHost, ...OBSERVED_RESULT_HOSTS]);

  if (!allowedHosts.has(url.hostname)) {
    throw new YoutubeAudioFileError(
      "Provider result URL host is not allowed",
      "PROVIDER_MALFORMED_RESPONSE",
    );
  }

  return url;
}
