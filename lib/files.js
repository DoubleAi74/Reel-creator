import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { getActiveJobSessionIds } from "./ai/transcribe-store";
import { getActiveRenderSessionIds } from "./render/store";
import { getActiveYoutubeAudioSessionIds } from "./youtube-audio/job-store";

export const SESSION_COOKIE_NAME = "reel-creator-session";
export const DEFAULT_ASSET_TTL_HOURS = 24;
// OpenAI's audio transcription endpoint rejects files larger than 25 MB, so
// keep the default upload cap at or below that to avoid accept-then-fail.
export const MAX_AUDIO_BYTES =
  Number(process.env.MAX_AUDIO_MB ?? 25) * 1024 * 1024;
export const MAX_IMAGE_BYTES =
  Number(process.env.MAX_IMAGE_MB ?? 10) * 1024 * 1024;
export const MAX_VIDEO_BYTES =
  Number(process.env.MAX_VIDEO_MB ?? 50) * 1024 * 1024;

const APP_TMP_DIR = "reel-creator";
const SESSION_METADATA_FILE_NAME = ".session.json";
const AUDIO_MIME_TYPES = new Set(["audio/mpeg", "audio/mp3"]);
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm"]);
const execFileAsync = promisify(execFile);
const KIND_CONFIG = {
  audio: {
    defaultExtension: ".mp3",
    maxBytes: MAX_AUDIO_BYTES,
    mimeTypes: AUDIO_MIME_TYPES,
  },
  image: {
    defaultExtension: ".png",
    maxBytes: MAX_IMAGE_BYTES,
    mimeTypes: IMAGE_MIME_TYPES,
  },
  video: {
    defaultExtension: ".mp4",
    maxBytes: MAX_VIDEO_BYTES,
    mimeTypes: VIDEO_MIME_TYPES,
  },
};

function getBaseTempDir() {
  return process.env.TMP_DIR
    ? path.resolve(process.env.TMP_DIR)
    : path.join(os.tmpdir(), APP_TMP_DIR);
}

function getSessionDir(sessionId) {
  return path.join(getBaseTempDir(), sessionId);
}

function getSessionMetadataPath(sessionId) {
  return path.join(getSessionDir(sessionId), SESSION_METADATA_FILE_NAME);
}

function getMetadataPath(sessionId, assetId) {
  return path.join(getSessionDir(sessionId), `${assetId}.json`);
}

function getExtension(fileName, fallbackExtension) {
  const extension = path.extname(fileName ?? "").toLowerCase();

  return extension || fallbackExtension;
}

function isMp3Buffer(buffer) {
  if (!buffer || buffer.length < 3) {
    return false;
  }

  if (buffer.subarray(0, 3).toString("utf8") === "ID3") {
    return true;
  }

  return buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
}

async function readVideoDurationSec(filePath) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    const durationSec = Number.parseFloat(stdout.trim());

    return Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null;
  } catch {
    return null;
  }
}

/** Public ffprobe duration helper (REP-204 last-resort audio billing fallback). */
export async function probeMediaDurationSec(filePath) {
  if (!filePath || typeof filePath !== "string") {
    return null;
  }

  return readVideoDurationSec(filePath);
}

function getAssetTtlHours() {
  const parsedValue = Number.parseFloat(process.env.ASSET_TTL_HOURS ?? "");

  return Number.isFinite(parsedValue) && parsedValue > 0
    ? parsedValue
    : DEFAULT_ASSET_TTL_HOURS;
}

async function readSessionMetadata(sessionId) {
  const metadata = await readFile(getSessionMetadataPath(sessionId), "utf8");

  return JSON.parse(metadata);
}

async function getSessionUpdatedAtMs(sessionId) {
  try {
    const metadata = await readSessionMetadata(sessionId);
    const timestamp = Date.parse(metadata.updatedAt ?? metadata.createdAt ?? "");

    if (Number.isFinite(timestamp)) {
      return timestamp;
    }
  } catch {}

  try {
    const sessionStats = await stat(getSessionDir(sessionId));

    return sessionStats.mtimeMs;
  } catch {
    return null;
  }
}

export async function ensureSessionDir(sessionId) {
  const sessionDir = getSessionDir(sessionId);
  await mkdir(sessionDir, { recursive: true });

  return sessionDir;
}

export async function touchSession(sessionId) {
  const now = new Date().toISOString();
  const metadataPath = getSessionMetadataPath(sessionId);

  await ensureSessionDir(sessionId);

  let createdAt = now;

  try {
    const currentMetadata = await readSessionMetadata(sessionId);

    if (typeof currentMetadata.createdAt === "string" && currentMetadata.createdAt) {
      createdAt = currentMetadata.createdAt;
    }
  } catch {}

  const nextMetadata = {
    createdAt,
    sessionId,
    updatedAt: now,
  };

  await writeFile(metadataPath, JSON.stringify(nextMetadata, null, 2), "utf8");

  return nextMetadata;
}

export function getAssetTtlMs() {
  return getAssetTtlHours() * 60 * 60 * 1000;
}

export async function removeSessionAssets(sessionId) {
  await rm(getSessionDir(sessionId), {
    force: true,
    recursive: true,
  });
}

export async function sweepExpiredSessions({
  excludeSessionIds = [],
  now = Date.now(),
} = {}) {
  const excludedSessionIds = new Set(
    excludeSessionIds.filter(
      (sessionId) => typeof sessionId === "string" && sessionId.length > 0,
    ),
  );

  // An asset backing a queued or running job must never be swept just because
  // the browser stopped polling, so exempt every session with an active
  // transcription or render job regardless of how stale its files look.
  for (const sessionId of [
    ...getActiveJobSessionIds(),
    ...getActiveRenderSessionIds(),
    ...getActiveYoutubeAudioSessionIds(),
  ]) {
    excludedSessionIds.add(sessionId);
  }

  const sessionTtlCutoff = now - getAssetTtlMs();

  let sessionEntries = [];

  try {
    sessionEntries = await readdir(getBaseTempDir(), {
      withFileTypes: true,
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const removedSessionIds = [];

  for (const entry of sessionEntries) {
    if (!entry.isDirectory() || excludedSessionIds.has(entry.name)) {
      continue;
    }

    const updatedAtMs = await getSessionUpdatedAtMs(entry.name);

    if (updatedAtMs != null && updatedAtMs >= sessionTtlCutoff) {
      continue;
    }

    await removeSessionAssets(entry.name);
    removedSessionIds.push(entry.name);
  }

  return removedSessionIds;
}

export async function touchSessionAndSweep(sessionId) {
  await touchSession(sessionId);

  return sweepExpiredSessions({
    excludeSessionIds: [sessionId],
  });
}

function normalizeAssetSourceType(value) {
  return value === "upload" || value === "youtube" ? value : "unknown";
}

function normalizeAssetMetadata(metadata) {
  return {
    ...metadata,
    sourceType: normalizeAssetSourceType(metadata?.sourceType),
  };
}

export async function readAssetMetadata(sessionId, assetId) {
  const metadata = await readFile(getMetadataPath(sessionId, assetId), "utf8");

  return normalizeAssetMetadata(JSON.parse(metadata));
}

export async function findSessionIdForAsset(assetId) {
  const safeAssetId = typeof assetId === "string" ? assetId.trim() : "";

  if (!/^[a-zA-Z0-9_-]+$/.test(safeAssetId)) {
    return null;
  }

  let sessionEntries = [];

  try {
    sessionEntries = await readdir(getBaseTempDir(), {
      withFileTypes: true,
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }

  for (const entry of sessionEntries) {
    if (!entry.isDirectory()) {
      continue;
    }

    try {
      const metadata = await readAssetMetadata(entry.name, safeAssetId);

      if (metadata.assetId === safeAssetId) {
        return entry.name;
      }
    } catch {}
  }

  return null;
}

export async function getAssetFilePath(sessionId, assetId) {
  const safeAssetId = typeof assetId === "string" ? assetId.trim() : "";

  // REP-407: charset guard + realpath containment.
  if (!/^[a-zA-Z0-9_-]+$/.test(safeAssetId)) {
    throw new Error("Invalid asset id.");
  }

  const metadata = await readAssetMetadata(sessionId, safeAssetId);
  const sessionDir = await realpathSafe(getSessionDir(sessionId));
  const joinedPath = path.join(sessionDir, metadata.storedFileName);
  const resolvedPath = await realpathSafe(joinedPath);

  if (
    resolvedPath !== sessionDir &&
    !resolvedPath.startsWith(`${sessionDir}${path.sep}`)
  ) {
    throw new Error("Asset path escapes session directory.");
  }

  return resolvedPath;
}

async function realpathSafe(targetPath) {
  try {
    return await realpath(targetPath);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      // File may not exist yet; resolve parents and append basename.
      const parent = path.dirname(targetPath);
      const parentReal = await realpath(parent).catch(() => parent);
      return path.join(parentReal, path.basename(targetPath));
    }

    throw error;
  }
}

export async function storeUploadedAsset({ file, kind, sessionId }) {
  const kindConfig = KIND_CONFIG[kind];

  if (!kindConfig) {
    throw new Error("Unsupported upload kind.");
  }

  if (!(file instanceof File)) {
    throw new Error("Upload is missing a file.");
  }

  if (file.size === 0) {
    throw new Error("Uploaded file is empty.");
  }

  if (file.size > kindConfig.maxBytes) {
    const maxSizeMb = Math.round(kindConfig.maxBytes / 1024 / 1024);
    throw new Error(`File is too large. ${kind} uploads are limited to ${maxSizeMb} MB.`);
  }

  if (file.type && !kindConfig.mimeTypes.has(file.type)) {
    throw new Error(`Unsupported ${kind} file type: ${file.type}.`);
  }

  const sessionDir = await ensureSessionDir(sessionId);
  const buffer = Buffer.from(await file.arrayBuffer());
  const extension = getExtension(file.name, kindConfig.defaultExtension);

  if (kind === "audio") {
    if (extension !== ".mp3") {
      throw new Error("Only .mp3 audio files are supported right now.");
    }

    if (!isMp3Buffer(buffer)) {
      throw new Error("Only MP3 audio files are supported right now.");
    }
  }

  const assetId = crypto.randomUUID();
  const storedFileName = `${kind}-${assetId}${extension}`;
  const filePath = path.join(sessionDir, storedFileName);
  const metadata = {
    assetId,
    createdAt: new Date().toISOString(),
    durationSec: null,
    kind,
    mimeType: file.type || null,
    name: file.name,
    sessionId,
    sizeBytes: file.size,
    sourceType: "upload",
    storedFileName,
  };

  await writeFile(filePath, buffer);

  if (kind === "video") {
    metadata.durationSec = await readVideoDurationSec(filePath);
  }

  await touchSession(sessionId);

  await writeFile(
    getMetadataPath(sessionId, assetId),
    JSON.stringify(metadata, null, 2),
    "utf8",
  );

  return metadata;
}

export async function storeAudioAssetFromPath({
  sourcePath,
  trustedRootDir,
  sessionId,
  name,
  durationSec,
  sourceType = "youtube",
}) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error("Audio duration must be a finite positive number.");
  }

  const [realSourcePath, realTrustedRootDir] = await Promise.all([
    realpath(sourcePath),
    realpath(trustedRootDir),
  ]);
  const relativeSourcePath = path.relative(realTrustedRootDir, realSourcePath);

  if (
    !relativeSourcePath ||
    relativeSourcePath.startsWith("..") ||
    path.isAbsolute(relativeSourcePath)
  ) {
    throw new Error("Audio source path is outside the trusted root.");
  }

  const sourceStats = await stat(realSourcePath);

  if (!sourceStats.isFile()) {
    throw new Error("Audio source path must point to a file.");
  }

  if (sourceStats.size === 0) {
    throw new Error("Audio source file is empty.");
  }

  if (sourceStats.size > MAX_AUDIO_BYTES) {
    const maxSizeMb = Math.round(MAX_AUDIO_BYTES / 1024 / 1024);
    throw new Error(`File is too large. audio uploads are limited to ${maxSizeMb} MB.`);
  }

  const buffer = await readFile(realSourcePath);

  if (!isMp3Buffer(buffer)) {
    throw new Error("Only MP3 audio files are supported right now.");
  }

  const sessionDir = await ensureSessionDir(sessionId);
  const assetId = crypto.randomUUID();
  const storedFileName = `audio-${assetId}.mp3`;
  const tempStoredFileName = `audio-${assetId}.${crypto.randomUUID()}.tmp`;
  const filePath = path.join(sessionDir, storedFileName);
  const tempFilePath = path.join(sessionDir, tempStoredFileName);
  const metadata = {
    assetId,
    createdAt: new Date().toISOString(),
    durationSec,
    kind: "audio",
    mimeType: "audio/mpeg",
    name: normalizeStoredAudioName(name),
    sessionId,
    sizeBytes: sourceStats.size,
    sourceType: normalizeAssetSourceType(sourceType),
    storedFileName,
  };

  try {
    await copyFile(realSourcePath, tempFilePath);
    await rename(tempFilePath, filePath);
    await touchSession(sessionId);
    await writeFile(
      getMetadataPath(sessionId, assetId),
      JSON.stringify(metadata, null, 2),
      "utf8",
    );
  } catch (error) {
    await rm(tempFilePath, { force: true }).catch(() => {});
    await rm(filePath, { force: true }).catch(() => {});
    throw error;
  }

  return metadata;
}

function normalizeStoredAudioName(name) {
  const trimmedName = typeof name === "string" ? name.trim() : "";
  const fallback = "YouTube audio.mp3";
  const nextName = trimmedName || fallback;

  return path.extname(nextName).toLowerCase() === ".mp3"
    ? nextName
    : `${nextName}.mp3`;
}
