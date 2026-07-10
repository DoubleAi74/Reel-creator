import mongoose from "mongoose";
import { NextResponse } from "next/server";

import { isCreditsEnabled } from "../../../../../lib/credits/flags.js";
import { connectToDatabase } from "../../../../../lib/db/mongoose.js";
import { Generation } from "../../../../../lib/models/Generation.js";
import {
  buildGenerationVisibilityFilter,
  getSessionIdFromRequest,
} from "../../../../../lib/generations/visibility.js";
import {
  getR2Object,
  toSafeR2ErrorCode,
} from "../../../../../lib/r2/r2-client.js";
import { getR2PublicBaseUrl } from "../../../../../lib/r2/r2-env.js";

export const runtime = "nodejs";

function buildPublicObjectUrl(baseUrl, key) {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

  return new URL(key, normalizedBaseUrl).toString();
}

function toResponseBody(body) {
  if (body && typeof body.transformToWebStream === "function") {
    return body.transformToWebStream();
  }

  return body;
}

function shouldProxyMedia(request) {
  try {
    const url = new URL(request.url);

    return url.searchParams.get("proxy") === "1";
  } catch {
    return false;
  }
}

export async function GET(_request, context) {
  if (!isCreditsEnabled()) {
    return NextResponse.json({ enabled: false, error: "credits_disabled" }, { status: 404 });
  }

  const { id } = await context.params;

  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Generation not found." }, { status: 404 });
  }

  await connectToDatabase();

  const sessionId = getSessionIdFromRequest(_request);
  const generation = await Generation.findOne({
    _id: id,
    deletedAt: null,
    r2Status: "created",
    saved: true,
    ...buildGenerationVisibilityFilter(sessionId),
  }).lean();

  if (!generation?.r2ObjectKey) {
    return NextResponse.json({ error: "Generation not found." }, { status: 404 });
  }

  const publicBaseUrl = getR2PublicBaseUrl();

  if (publicBaseUrl && !shouldProxyMedia(_request)) {
    return NextResponse.redirect(
      buildPublicObjectUrl(publicBaseUrl, generation.r2ObjectKey),
    );
  }

  try {
    const object = await getR2Object({ key: generation.r2ObjectKey });
    const headers = {
      "Cache-Control": "public, max-age=300",
      "Content-Type": object.contentType || "audio/mpeg",
    };

    if (Number.isFinite(object.contentLength)) {
      headers["Content-Length"] = String(object.contentLength);
    }

    return new NextResponse(toResponseBody(object.body), { headers });
  } catch (error) {
    const errorCode = toSafeR2ErrorCode(error);
    const status = errorCode === "R2_OBJECT_NOT_FOUND" ? 404 : 500;

    return NextResponse.json(
      {
        error: status === 404 ? "Generation media not found." : "Generation media unavailable.",
      },
      { status },
    );
  }
}
