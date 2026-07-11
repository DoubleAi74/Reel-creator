import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  resolveAssetStorage,
  SESSION_COOKIE_NAME,
  touchSessionAndSweep,
} from "@/lib/files";
import { getR2Object } from "@/lib/r2/r2-client";
import { removeRenderJobsForSessions } from "@/lib/render/store";

export const runtime = "nodejs";

function getFallbackMimeType(metadata) {
  if (metadata.kind === "audio") {
    return "audio/mpeg";
  }

  if (metadata.kind === "image") {
    return "image/png";
  }

  if (metadata.kind === "video") {
    return "video/mp4";
  }

  return "application/octet-stream";
}

function bodyToWebStream(body) {
  if (!body) {
    return null;
  }

  if (typeof body.transformToWebStream === "function") {
    return body.transformToWebStream();
  }

  if (typeof body.getReader === "function") {
    return body;
  }

  if (typeof body.pipe === "function") {
    return Readable.toWeb(body);
  }

  return null;
}

export async function GET(request, context) {
  const { assetId } = await context.params;
  const cookieStore = await cookies();
  const sessionIdFromQuery = request.nextUrl.searchParams.get("sessionId");
  const sessionId = sessionIdFromQuery ?? cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionId) {
    return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  }

  try {
    if (!sessionIdFromQuery) {
      const sweptSessionIds = await touchSessionAndSweep(sessionId);

      removeRenderJobsForSessions(sweptSessionIds);
    }

    const resolved = await resolveAssetStorage(sessionId, assetId);
    const contentType =
      resolved.metadata.mimeType ?? getFallbackMimeType(resolved.metadata);

    if (resolved.mode === "r2") {
      const object = await getR2Object({ key: resolved.r2ObjectKey });
      const stream = bodyToWebStream(object.body);

      if (!stream) {
        const bytes = await object.body.transformToByteArray();
        return new NextResponse(Buffer.from(bytes), {
          headers: {
            "Cache-Control": "no-store",
            "Content-Length": String(bytes.byteLength),
            "Content-Type": object.contentType || contentType,
          },
        });
      }

      const headers = {
        "Cache-Control": "no-store",
        "Content-Type": object.contentType || contentType,
      };

      if (
        Number.isFinite(object.contentLength) &&
        object.contentLength != null &&
        object.contentLength >= 0
      ) {
        headers["Content-Length"] = String(object.contentLength);
      }

      return new NextResponse(stream, { headers });
    }

    const buffer = await readFile(resolved.filePath);

    return new NextResponse(buffer, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Length": String(buffer.byteLength),
        "Content-Type": contentType,
      },
    });
  } catch {
    return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  }
}
