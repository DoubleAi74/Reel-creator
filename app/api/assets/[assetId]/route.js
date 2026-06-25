import { readFile } from "node:fs/promises";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  getAssetFilePath,
  readAssetMetadata,
  SESSION_COOKIE_NAME,
  touchSessionAndSweep,
} from "@/lib/files";
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

    const metadata = await readAssetMetadata(sessionId, assetId);
    const filePath = await getAssetFilePath(sessionId, assetId);
    const buffer = await readFile(filePath);

    return new NextResponse(buffer, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Length": String(buffer.byteLength),
        "Content-Type": metadata.mimeType ?? getFallbackMimeType(metadata),
      },
    });
  } catch {
    return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  }
}
