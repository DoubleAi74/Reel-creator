import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  findSessionIdForAsset,
  readAssetMetadata,
  SESSION_COOKIE_NAME,
  touchSessionAndSweep,
} from "@/lib/files";
import { normalizeTextLayerMode } from "@/lib/render/formats";
import { runRenderJob } from "@/lib/render/render-job";
import {
  createRenderJob,
  enqueueRenderJob,
  findInFlightRenderForSession,
  removeRenderJobsForSessions,
} from "@/lib/render/store";

export const runtime = "nodejs";
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24;

function createJsonResponse(payload, { sessionIdToRestore, status = 200 } = {}) {
  const response = NextResponse.json(payload, { status });

  if (sessionIdToRestore) {
    response.cookies.set(SESSION_COOKIE_NAME, sessionIdToRestore, {
      httpOnly: true,
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "lax",
    });
  }

  return response;
}

function badRequest(message, status = 400, options = {}) {
  return createJsonResponse({ error: message }, { ...options, status });
}

async function resolveSessionIdForAudioAsset(sessionIdFromCookie, audioAssetId) {
  if (sessionIdFromCookie) {
    try {
      await readAssetMetadata(sessionIdFromCookie, audioAssetId);

      return {
        recovered: false,
        sessionId: sessionIdFromCookie,
      };
    } catch {}
  }

  const recoveredSessionId = await findSessionIdForAsset(audioAssetId);

  return {
    recovered: Boolean(recoveredSessionId),
    sessionId: recoveredSessionId,
  };
}

export async function POST(request) {
  try {
    const cookieStore = await cookies();
    const sessionIdFromCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    const payload = await request.json();
    const audioAssetId = payload?.audioAssetId;
    const backgroundAssetId = payload?.backgroundAssetId;
    const transparent = payload?.transparent === true;
    const textLayerMode = transparent
      ? normalizeTextLayerMode(payload?.textLayerMode)
      : null;

    if (typeof audioAssetId !== "string" || audioAssetId.length === 0) {
      return badRequest("audioAssetId is required.");
    }

    if (
      backgroundAssetId != null &&
      (typeof backgroundAssetId !== "string" || backgroundAssetId.length === 0)
    ) {
      return badRequest("backgroundAssetId must be a non-empty string.");
    }

    const { recovered, sessionId } = await resolveSessionIdForAudioAsset(
      sessionIdFromCookie,
      audioAssetId,
    );

    if (!sessionId) {
      return badRequest("Upload an MP3 in this session before exporting.");
    }

    const sessionIdToRestore = recovered ? sessionId : null;
    const sweptSessionIds = await touchSessionAndSweep(sessionId);

    removeRenderJobsForSessions(sweptSessionIds);

    const inFlightJob = findInFlightRenderForSession(sessionId);

    if (inFlightJob) {
      return createJsonResponse(
        {
          error:
            "A render is already queued or running for this session. Wait for it to finish before starting another.",
          jobId: inFlightJob.jobId,
        },
        { sessionIdToRestore, status: 409 },
      );
    }

    const job = createRenderJob({
      projectTitle: payload?.project?.meta?.title,
      sessionId,
      textLayerMode,
      transparent,
    });

    enqueueRenderJob(job.jobId, () =>
      runRenderJob({
        audioAssetId,
        backgroundAssetId,
        job,
        project: payload?.project,
        requestUrl: request.url,
        textLayerMode,
        transparent,
      }),
    );

    return createJsonResponse({ jobId: job.jobId }, { sessionIdToRestore });
  } catch (error) {
    return badRequest(
      error instanceof Error ? error.message : "Render could not be started.",
    );
  }
}
