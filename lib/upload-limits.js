/**
 * Shared upload limits (safe for client + server).
 *
 * Vercel serverless request bodies are capped (~4.5 MB). A 50 MB video default
 * cannot succeed there and often surfaces as a non-JSON 413 with a vague UI error.
 */

function readPositiveMb(name, fallback) {
  const raw =
    typeof process !== "undefined" && process.env
      ? process.env[name]
      : undefined;
  const parsed = Number(raw);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Default video cap on Vercel-like hosts for *multipart* body uploads. */
export const VERCEL_SAFE_VIDEO_MB = 4;

/** Direct-to-R2 background videos (presigned PUT). */
export const DEFAULT_BACKGROUND_VIDEO_R2_MB = 80;

export function getDefaultVideoMaxMb() {
  if (typeof process !== "undefined" && process.env?.VERCEL === "1") {
    return readPositiveMb("MAX_VIDEO_MB", VERCEL_SAFE_VIDEO_MB);
  }

  // Local/dev can allow larger clips; still override with MAX_VIDEO_MB / NEXT_PUBLIC_.
  return readPositiveMb(
    "NEXT_PUBLIC_MAX_VIDEO_MB",
    readPositiveMb("MAX_VIDEO_MB", 50),
  );
}

export function getMaxVideoBytes() {
  return getDefaultVideoMaxMb() * 1024 * 1024;
}

/** Max size for R2 presigned background video uploads. */
export function getMaxBackgroundVideoR2Bytes() {
  return (
    readPositiveMb("MAX_BACKGROUND_VIDEO_MB", DEFAULT_BACKGROUND_VIDEO_R2_MB) *
    1024 *
    1024
  );
}

/**
 * @param {{ r2Mode?: boolean }} [options]
 * @returns {number}
 */
export function getMaxVideoBytesForMode(options = {}) {
  if (options.r2Mode) {
    return getMaxBackgroundVideoR2Bytes();
  }

  return getMaxVideoBytes();
}

export const ALLOWED_VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/webm",
  // iPhone Photos / camera roll often reports QuickTime for short clips.
  "video/quicktime",
];

export const ALLOWED_VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov"];

export function isAllowedVideoMimeType(mimeType) {
  if (!mimeType || typeof mimeType !== "string") {
    return true; // empty type: fall through to extension check
  }

  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  return ALLOWED_VIDEO_MIME_TYPES.includes(normalized);
}

export function isAllowedVideoFileName(fileName) {
  if (!fileName || typeof fileName !== "string") {
    return false;
  }

  const lower = fileName.toLowerCase();
  return ALLOWED_VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Client-side preflight for background video picks.
 * @param {File|{name?:string,size?:number,type?:string}|null} file
 * @param {{ r2Mode?: boolean }} [options]
 * @returns {string|null} Error message or null if OK.
 */
export function getVideoUploadRejectionMessage(file, options = {}) {
  if (!file) {
    return "No video file selected.";
  }

  if (!file.size) {
    return "That video file is empty.";
  }

  const maxBytes = getMaxVideoBytesForMode(options);
  const maxMb = Math.round(maxBytes / 1024 / 1024);

  if (file.size > maxBytes) {
    return `Video is too large (${formatMb(file.size)}). Use a shorter clip under ${maxMb} MB.`;
  }

  const typeOk = isAllowedVideoMimeType(file.type);
  const nameOk = isAllowedVideoFileName(file.name);

  if (!typeOk && !nameOk) {
    return `Unsupported video type${file.type ? ` (${file.type})` : ""}. Use MP4, WebM, or MOV.`;
  }

  if (!typeOk && nameOk) {
    // Rare: wrong MIME but ok extension — allow server to accept by extension.
    return null;
  }

  if (typeOk && !nameOk && file.type) {
    // MIME ok but weird name — allow.
    return null;
  }

  if (!typeOk) {
    return `Unsupported video type (${file.type}). Use MP4, WebM, or MOV.`;
  }

  return null;
}

function formatMb(bytes) {
  return `${(Number(bytes) / 1024 / 1024).toFixed(1)} MB`;
}
