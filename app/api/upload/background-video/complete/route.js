import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  markR2VideoAssetReady,
  readAssetMetadata,
  SESSION_COOKIE_NAME,
  touchSessionAndSweep,
} from "../../../../../lib/files.js";
import { removeRenderJobsForSessions } from "../../../../../lib/render/store.js";
import {
  deleteSessionAssetObject,
  isR2SessionAssetsEnabled,
  verifySessionVideoObject,
} from "../../../../../lib/r2/session-asset-lifecycle.js";

export const runtime = "nodejs";

const MAX_DURATION_SEC = 600;

function sanitizeDurationSec(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }

  return Math.min(MAX_DURATION_SEC, number);
}

export async function POST(request) {
  if (!isR2SessionAssetsEnabled()) {
    return NextResponse.json(
      {
        error: "R2 session video uploads are not enabled.",
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

  const assetId =
    typeof body?.assetId === "string" ? body.assetId.trim() : "";

  if (!/^[a-zA-Z0-9_-]+$/.test(assetId)) {
    return NextResponse.json({ error: "Invalid asset id." }, { status: 400 });
  }

  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionId) {
    return NextResponse.json(
      { error: "Session expired. Refresh and try again." },
      { status: 401 },
    );
  }

  try {
    const swept = await touchSessionAndSweep(sessionId);
    removeRenderJobsForSessions(swept);

    let metadata;

    try {
      metadata = await readAssetMetadata(sessionId, assetId);
    } catch {
      return NextResponse.json({ error: "Asset not found." }, { status: 404 });
    }

    if (metadata.kind !== "video" || metadata.storage !== "r2") {
      return NextResponse.json(
        { error: "Asset is not an R2 video upload." },
        { status: 400 },
      );
    }

    if (metadata.status === "ready") {
      return NextResponse.json({
        assetId: metadata.assetId,
        durationSec: metadata.durationSec,
        kind: metadata.kind,
        name: metadata.name,
        sizeBytes: metadata.sizeBytes,
        storage: "r2",
      });
    }

    const verified = await verifySessionVideoObject({
      expectedContentType: metadata.mimeType,
      expectedSizeBytes: metadata.sizeBytes,
      objectKey: metadata.r2ObjectKey,
    });

    if (!verified.ok) {
      await deleteSessionAssetObject(metadata.r2ObjectKey);
      return NextResponse.json(
        { error: verified.message || "Video upload incomplete." },
        { status: 400 },
      );
    }

    const durationSec = sanitizeDurationSec(body?.durationSec);
    const ready = await markR2VideoAssetReady({
      assetId,
      contentType: verified.contentType || metadata.mimeType,
      durationSec,
      sessionId,
      sizeBytes: verified.contentLength ?? metadata.sizeBytes,
    });

    console.info("[r2:session-asset] complete", {
      assetId,
      durationSec: ready.durationSec,
      sizeBytes: ready.sizeBytes,
    });

    return NextResponse.json({
      assetId: ready.assetId,
      durationSec: ready.durationSec,
      kind: ready.kind,
      name: ready.name,
      sizeBytes: ready.sizeBytes,
      storage: "r2",
    });
  } catch (error) {
    console.error("[upload:bg-video:complete] failed", {
      message: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not finalize video upload.",
      },
      { status: 500 },
    );
  }
}
