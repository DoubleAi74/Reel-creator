import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  checkRateLimit,
  getRequestIp,
} from "../../../../../lib/credits/rate-limit.js";
import {
  createPendingR2VideoAsset,
  SESSION_COOKIE_NAME,
  touchSessionAndSweep,
} from "../../../../../lib/files.js";
import { removeRenderJobsForSessions } from "../../../../../lib/render/store.js";
import {
  isR2SessionAssetsEnabled,
  presignSessionVideoUpload,
} from "../../../../../lib/r2/session-asset-lifecycle.js";
import {
  getMaxBackgroundVideoR2Bytes,
  isAllowedVideoFileName,
  isAllowedVideoMimeType,
} from "../../../../../lib/upload-limits.js";

export const runtime = "nodejs";

const PRESIGN_RATE_MAX = 30;
const PRESIGN_RATE_WINDOW_MS = 10 * 60 * 1000;

function normalizeContentType(value, fileName) {
  const raw = typeof value === "string" ? value.split(";")[0].trim().toLowerCase() : "";

  if (raw && isAllowedVideoMimeType(raw)) {
    return raw;
  }

  const name = String(fileName || "").toLowerCase();

  if (name.endsWith(".webm")) {
    return "video/webm";
  }

  if (name.endsWith(".mov")) {
    return "video/quicktime";
  }

  return "video/mp4";
}

export async function POST(request) {
  if (!isR2SessionAssetsEnabled()) {
    return NextResponse.json(
      {
        error:
          "Large video upload requires R2. Set R2_ENABLED=true (and R2_SESSION_ASSETS not false).",
        code: "R2_SESSION_ASSETS_DISABLED",
      },
      { status: 503 },
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const fileName =
    typeof body?.fileName === "string" && body.fileName.trim()
      ? body.fileName.trim().slice(0, 200)
      : "video.mp4";
  const sizeBytes = Number(body?.sizeBytes);
  const contentType = normalizeContentType(body?.contentType, fileName);
  const maxBytes = getMaxBackgroundVideoR2Bytes();

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return NextResponse.json(
      { error: "sizeBytes must be a positive number." },
      { status: 400 },
    );
  }

  if (sizeBytes > maxBytes) {
    const maxMb = Math.round(maxBytes / 1024 / 1024);
    return NextResponse.json(
      {
        error: `Video is too large. Maximum is ${maxMb} MB.`,
        maxBytes,
      },
      { status: 400 },
    );
  }

  if (!isAllowedVideoMimeType(contentType) && !isAllowedVideoFileName(fileName)) {
    return NextResponse.json(
      { error: "Unsupported video type. Use MP4, WebM, or MOV." },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  const existingSessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const sessionId = existingSessionId || randomUUID();

  const rate = checkRateLimit({
    config: { max: PRESIGN_RATE_MAX, windowMs: PRESIGN_RATE_WINDOW_MS },
    ip: getRequestIp(request),
    namespace: "bg-video-presign",
    sessionId,
  });

  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfter: rate.retryAfter },
      { status: 429 },
    );
  }

  try {
    const swept = await touchSessionAndSweep(sessionId);
    removeRenderJobsForSessions(swept);

    const assetId = randomUUID();
    const signed = await presignSessionVideoUpload({
      assetId,
      contentType,
      sessionId,
      sizeBytes,
    });

    await createPendingR2VideoAsset({
      assetId: signed.assetId,
      contentType,
      fileName,
      r2ObjectKey: signed.objectKey,
      sessionId,
      sizeBytes,
    });

    const response = NextResponse.json({
      assetId: signed.assetId,
      expiresInSeconds: signed.expiresInSeconds,
      headers: signed.headers,
      maxBytes,
      objectKey: signed.objectKey,
      uploadUrl: signed.uploadUrl,
    });

    if (!existingSessionId) {
      response.cookies.set(SESSION_COOKIE_NAME, sessionId, {
        httpOnly: true,
        maxAge: 60 * 60 * 24,
        path: "/",
        sameSite: "lax",
      });
    }

    return response;
  } catch (error) {
    console.error("[upload:bg-video:presign] failed", {
      message: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not prepare video upload.",
      },
      { status: 500 },
    );
  }
}
