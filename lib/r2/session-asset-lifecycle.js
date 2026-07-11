import path from "node:path";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";

import {
  deleteR2Object,
  deleteR2Prefix,
  getR2Object,
  headR2Object,
  toSafeR2ErrorCode,
} from "./r2-client.js";
import { isR2Enabled } from "./r2-env.js";
import { createPresignedGetUrl, createPresignedPutUrl } from "./r2-presign.js";

export const SESSION_ASSET_R2_PREFIX = "session-assets";
export const PENDING_UPLOAD_MAX_AGE_MS = 60 * 60 * 1000;

const SAFE_ASSET_ID = /^[a-zA-Z0-9_-]+$/;
const SAFE_SESSION_ID = /^[a-zA-Z0-9_-]+$/;

export function isR2SessionAssetsEnabled() {
  if (!isR2Enabled()) {
    return false;
  }

  const flag = String(process.env.R2_SESSION_ASSETS ?? "true")
    .trim()
    .toLowerCase();

  return flag !== "0" && flag !== "false" && flag !== "off";
}

export function buildSessionVideoObjectKey({
  assetId,
  extension,
  sessionId,
}) {
  if (!SAFE_SESSION_ID.test(sessionId) || !SAFE_ASSET_ID.test(assetId)) {
    throw new Error("Invalid session or asset id for R2 key.");
  }

  const ext = normalizeExtension(extension);

  return `${SESSION_ASSET_R2_PREFIX}/${sessionId}/video/${assetId}${ext}`;
}

export function normalizeExtension(extension) {
  const raw = String(extension || ".mp4").toLowerCase();
  const withDot = raw.startsWith(".") ? raw : `.${raw}`;

  if ([".mp4", ".webm", ".mov"].includes(withDot)) {
    return withDot;
  }

  return ".mp4";
}

export function extensionForVideoContentType(contentType, fileName = "") {
  const type = String(contentType || "")
    .toLowerCase()
    .split(";")[0]
    .trim();

  if (type === "video/webm") {
    return ".webm";
  }

  if (type === "video/quicktime") {
    return ".mov";
  }

  if (type === "video/mp4") {
    return ".mp4";
  }

  const fromName = path.extname(fileName || "").toLowerCase();

  return normalizeExtension(fromName || ".mp4");
}

export async function presignSessionVideoUpload({
  assetId = randomUUID(),
  contentType,
  sessionId,
  sizeBytes,
}) {
  const extension = extensionForVideoContentType(contentType);
  const objectKey = buildSessionVideoObjectKey({
    assetId,
    extension,
    sessionId,
  });

  const signed = await createPresignedPutUrl({
    contentType,
    key: objectKey,
  });

  console.info("[r2:session-asset] presign", {
    assetId,
    contentType,
    sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
  });

  return {
    assetId,
    expiresInSeconds: signed.expiresInSeconds,
    headers: signed.headers,
    objectKey,
    uploadUrl: signed.uploadUrl,
  };
}

export async function verifySessionVideoObject({
  expectedContentType,
  expectedSizeBytes,
  objectKey,
}) {
  const head = await headR2Object({ key: objectKey });

  if (!head.exists) {
    return {
      error: "UPLOAD_MISSING",
      message: "Video was not found in storage. Upload again.",
      ok: false,
    };
  }

  if (
    Number.isFinite(expectedSizeBytes) &&
    expectedSizeBytes > 0 &&
    head.contentLength != null &&
    head.contentLength !== expectedSizeBytes
  ) {
    return {
      error: "SIZE_MISMATCH",
      message: "Uploaded video size does not match the declared size.",
      ok: false,
    };
  }

  if (
    expectedContentType &&
    head.contentType &&
    head.contentType.split(";")[0].trim().toLowerCase() !==
      expectedContentType.split(";")[0].trim().toLowerCase()
  ) {
    // Soft check: some clients/R2 normalize types; log only if wildly different.
    console.info("[r2:session-asset] content-type-diff", {
      expected: expectedContentType,
      got: head.contentType,
      objectKey,
    });
  }

  return {
    contentLength: head.contentLength,
    contentType: head.contentType || expectedContentType || "video/mp4",
    ok: true,
  };
}

export async function deleteSessionAssetObject(objectKey) {
  if (!objectKey || !isR2Enabled()) {
    return { ok: true, skipped: true };
  }

  try {
    const result = await deleteR2Object({ key: objectKey });
    console.info("[r2:session-asset] delete", {
      alreadyMissing: result.alreadyMissing === true,
      key: objectKey,
    });
    return result;
  } catch (error) {
    console.warn("[r2:session-asset] delete-failed", {
      code: toSafeR2ErrorCode(error),
      key: objectKey,
    });
    return { ok: false, key: objectKey };
  }
}

export async function deleteSessionR2Assets(sessionId) {
  if (!sessionId || !isR2SessionAssetsEnabled()) {
    return { deleted: 0, ok: true, skipped: true };
  }

  const prefix = `${SESSION_ASSET_R2_PREFIX}/${sessionId}/`;

  try {
    const result = await deleteR2Prefix({ prefix });
    console.info("[r2:session-asset] sweep", {
      deleted: result.deleted,
      sessionId,
    });
    return result;
  } catch (error) {
    console.warn("[r2:session-asset] sweep-failed", {
      code: toSafeR2ErrorCode(error),
      sessionId,
    });
    return { deleted: 0, ok: false, sessionId };
  }
}

export async function downloadR2ObjectToFile({ key, outputPath }) {
  const object = await getR2Object({ key });
  await mkdir(path.dirname(outputPath), { recursive: true });

  const body = object.body;
  const nodeStream =
    body && typeof body.pipe === "function"
      ? body
      : body?.transformToWebStream
        ? Readable.fromWeb(body.transformToWebStream())
        : null;

  if (!nodeStream) {
    // Fallback: buffer entire object
    const bytes = await body.transformToByteArray();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(outputPath, Buffer.from(bytes));
    return {
      contentType: object.contentType,
      filePath: outputPath,
      sizeBytes: bytes.byteLength,
    };
  }

  await pipeline(nodeStream, createWriteStream(outputPath));

  return {
    contentType: object.contentType,
    filePath: outputPath,
  };
}

export async function createSessionAssetSignedReadUrl({ key }) {
  return createPresignedGetUrl({ key });
}

export async function cleanupTempDownload(filePath) {
  if (!filePath) {
    return;
  }

  await rm(filePath, { force: true }).catch(() => {});
}
