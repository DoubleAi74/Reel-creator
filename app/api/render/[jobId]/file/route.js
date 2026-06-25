import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME, touchSessionAndSweep } from "@/lib/files";
import { getTextLayerFormat } from "@/lib/render/formats";
import { getRenderJob, removeRenderJobsForSessions } from "@/lib/render/store";

export const runtime = "nodejs";

export async function GET(_request, context) {
  const { jobId } = await context.params;
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const job = getRenderJob(jobId);

  if (!sessionId || !job || job.sessionId !== sessionId) {
    return NextResponse.json({ error: "Render file not found." }, { status: 404 });
  }

  const sweptSessionIds = await touchSessionAndSweep(sessionId);

  removeRenderJobsForSessions(sweptSessionIds);

  if (job.status !== "done" || !job.filePath) {
    return NextResponse.json(
      { error: "Render is not ready to download yet." },
      { status: 409 },
    );
  }

  let fileStats;

  try {
    fileStats = await stat(job.filePath);
  } catch {
    return NextResponse.json(
      { error: "Render file is no longer available." },
      { status: 404 },
    );
  }

  const textLayerFormat = job.textLayerMode
    ? getTextLayerFormat(job.textLayerMode)
    : null;
  const contentType =
    textLayerFormat && job.filePath.endsWith(`.${textLayerFormat.extension}`)
      ? textLayerFormat.mimeType
      : "video/mp4";
  // Stream the file so large exports never hit Node's whole-file buffer limits.
  const webStream = Readable.toWeb(createReadStream(job.filePath));

  return new NextResponse(webStream, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${job.downloadName}"`,
      "Content-Length": String(fileStats.size),
      "Content-Type": contentType,
    },
  });
}
