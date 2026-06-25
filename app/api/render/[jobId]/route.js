import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME, touchSessionAndSweep } from "@/lib/files";
import {
  getRenderJob,
  removeRenderJobsForSessions,
  toRenderJobResponse,
} from "@/lib/render/store";

export const runtime = "nodejs";

export async function GET(_request, context) {
  const { jobId } = await context.params;
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const job = getRenderJob(jobId);

  if (!sessionId || !job || job.sessionId !== sessionId) {
    return NextResponse.json({ error: "Render job not found." }, { status: 404 });
  }

  const sweptSessionIds = await touchSessionAndSweep(sessionId);

  removeRenderJobsForSessions(sweptSessionIds);

  return NextResponse.json(toRenderJobResponse(job));
}
