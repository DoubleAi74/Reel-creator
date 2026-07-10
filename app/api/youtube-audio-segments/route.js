import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "../../../lib/files";
import { ingestCompletedYoutubeJob } from "../../../lib/youtube-audio/ingest-completed-job";
import { getYoutubeAudioProviderDisplayName } from "../../../lib/youtube-audio/providers";
import {
  createOrReuseJob,
  getJob,
  publicJob,
} from "../../../lib/youtube-audio/job-store";
import {
  runYoutubeAudioJobNow,
  shouldRunYoutubeAudioJobsSynchronously,
  startBackgroundProcessing,
} from "../../../lib/youtube-audio/processing";
import {
  getYoutubeAudioConfig,
  isYoutubeAudioConfigured,
} from "../../../lib/youtube-audio/server-config";
import { sweepStaleYoutubeAudioResults } from "../../../lib/youtube-audio/storage";
import { parseYoutubeAudioSegmentRequest } from "../../../lib/youtube-audio/validation";

export const runtime = "nodejs";
// Vercel: allow enough time for provider download + trim in the same request.
export const maxDuration = 60;

export async function POST(request) {
  if (!isYoutubeAudioConfigured()) {
    return errorResponse("FEATURE_DISABLED", 503);
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return errorResponse("INVALID_INPUT", 400);
  }

  const parsed = parseYoutubeAudioSegmentRequest(body);

  if (!parsed.success) {
    return errorResponse(parsed.errorCode, 400);
  }

  try {
    // REP-601: best-effort orphan result sweep after restarts (non-blocking).
    void sweepStaleYoutubeAudioResults().catch(() => {});

    const cookieStore = await cookies();
    const existingSessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const sessionId = existingSessionId ?? crypto.randomUUID();
    const config = getYoutubeAudioConfig();
    const { job, reused, rejected } = createOrReuseJob({
      sourceUrl: parsed.data.url,
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
      providerId: parsed.data.providerId,
      providerName: getYoutubeAudioProviderDisplayName(parsed.data.providerId),
      sessionId,
      config,
    });

    if (rejected) {
      return errorResponse(rejected, 429);
    }

    const runSync = shouldRunYoutubeAudioJobsSynchronously();

    if (!reused && job.status === "queued") {
      if (runSync) {
        await runYoutubeAudioJobNow(job.id);
      } else {
        startBackgroundProcessing(job.id);
      }
    } else if (
      runSync &&
      reused &&
      job.status !== "complete" &&
      job.status !== "failed"
    ) {
      // Same-isolate reuse of an unfinished job — finish it here.
      await runYoutubeAudioJobNow(job.id);
    }

    const latestJob = getJob(job.id) || job;
    let asset = null;

    if (latestJob.status === "complete") {
      try {
        asset = await ingestCompletedYoutubeJob(latestJob, sessionId);
      } catch (error) {
        console.error("YouTube POST ingest failed:", {
          jobId: latestJob.id,
          message: error instanceof Error ? error.message : String(error),
        });
        return errorResponse(error?.errorCode || "CONVERSION_FAILED", 500);
      }
    }

    if (latestJob.status === "failed") {
      const response = NextResponse.json(publicJob(latestJob), { status: 500 });
      appendSessionCookie(response, sessionId);
      return response;
    }

    const response = NextResponse.json({
      ...publicJob(latestJob),
      ...(asset ? { asset } : {}),
    });
    appendSessionCookie(response, sessionId);
    return response;
  } catch (error) {
    return errorResponse(error?.errorCode || "INTERNAL_ERROR", 500);
  }
}

function appendSessionCookie(response, sessionId) {
  response.cookies.set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    maxAge: 60 * 60 * 24,
    path: "/",
    sameSite: "lax",
  });
}

function errorResponse(errorCode, status) {
  return NextResponse.json(
    {
      status: "failed",
      errorCode,
    },
    {
      status,
    },
  );
}
