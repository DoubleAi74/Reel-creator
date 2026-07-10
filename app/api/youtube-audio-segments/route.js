import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "../../../lib/files";
import { logConvertTrace } from "../../../lib/youtube-audio/diagnostics";
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
// Pro/Enterprise can honor up to plan max; Hobby is still capped ~10s by Vercel.
export const maxDuration = 60;

export async function POST(request) {
  const requestStartedAt = Date.now();
  logConvertTrace("post-received", {
    sync: shouldRunYoutubeAudioJobsSynchronously(),
    configured: isYoutubeAudioConfigured(),
  });

  if (!isYoutubeAudioConfigured()) {
    logConvertTrace("post-disabled", {}, "warn");
    return errorResponse("FEATURE_DISABLED", 503);
  }

  let body;

  try {
    body = await request.json();
  } catch {
    logConvertTrace("post-invalid-json", {}, "warn");
    return errorResponse("INVALID_INPUT", 400);
  }

  const parsed = parseYoutubeAudioSegmentRequest(body);

  if (!parsed.success) {
    logConvertTrace(
      "post-invalid-input",
      { errorCode: parsed.errorCode },
      "warn",
    );
    return errorResponse(parsed.errorCode, 400);
  }

  try {
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

    logConvertTrace("post-job", {
      jobId: job.id,
      reused,
      rejected: rejected || null,
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
      segmentSec: parsed.data.endTime - parsed.data.startTime,
      hasSessionCookie: Boolean(existingSessionId),
    });

    if (rejected) {
      return errorResponse(rejected, 429);
    }

    const runSync = shouldRunYoutubeAudioJobsSynchronously();

    if (!reused && job.status === "queued") {
      if (runSync) {
        logConvertTrace("post-run-sync", { jobId: job.id });
        await runYoutubeAudioJobNow(job.id);
      } else {
        logConvertTrace("post-run-async", { jobId: job.id });
        startBackgroundProcessing(job.id);
      }
    } else if (
      runSync &&
      reused &&
      job.status !== "complete" &&
      job.status !== "failed"
    ) {
      logConvertTrace("post-run-sync-reused", {
        jobId: job.id,
        status: job.status,
      });
      await runYoutubeAudioJobNow(job.id);
    }

    const latestJob = getJob(job.id) || job;
    let asset = null;

    if (latestJob.status === "complete") {
      try {
        asset = await ingestCompletedYoutubeJob(latestJob, sessionId);
        logConvertTrace("post-ingest-ok", {
          jobId: latestJob.id,
          assetId: asset?.assetId ?? null,
          ms: Date.now() - requestStartedAt,
        });
      } catch (error) {
        logConvertTrace(
          "post-ingest-failed",
          {
            jobId: latestJob.id,
            message: error instanceof Error ? error.message : String(error),
            errorCode: error?.errorCode || "CONVERSION_FAILED",
            ms: Date.now() - requestStartedAt,
          },
          "error",
        );
        return errorResponse(
          error?.errorCode || "CONVERSION_FAILED",
          500,
          error instanceof Error ? error.message : "Ingest failed",
        );
      }
    }

    if (latestJob.status === "failed") {
      logConvertTrace(
        "post-job-failed",
        {
          jobId: latestJob.id,
          errorCode: latestJob.errorCode || "INTERNAL_ERROR",
          errorMessage: latestJob.errorMessage || null,
          phase: latestJob.phase,
          ms: Date.now() - requestStartedAt,
        },
        "error",
      );
      const publicPayload = publicJob(latestJob);
      const response = NextResponse.json(
        {
          ...publicPayload,
          errorMessage:
            publicPayload.errorMessage ||
            latestJob.errorMessage ||
            (latestJob.errorCode
              ? `Job failed with ${latestJob.errorCode}`
              : "Job failed"),
        },
        { status: 500 },
      );
      appendSessionCookie(response, sessionId);
      return response;
    }

    logConvertTrace("post-respond", {
      jobId: latestJob.id,
      status: latestJob.status,
      phase: latestJob.phase,
      hasAsset: Boolean(asset),
      ms: Date.now() - requestStartedAt,
    });

    const response = NextResponse.json({
      ...publicJob(latestJob),
      ...(asset ? { asset } : {}),
    });
    appendSessionCookie(response, sessionId);
    return response;
  } catch (error) {
    logConvertTrace(
      "post-threw",
      {
        errorCode: error?.errorCode || "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : typeof error,
        ms: Date.now() - requestStartedAt,
      },
      "error",
    );
    return errorResponse(
      error?.errorCode || "INTERNAL_ERROR",
      500,
      error instanceof Error ? error.message : "Unexpected convert error",
    );
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

function errorResponse(errorCode, status, errorMessage = null) {
  return NextResponse.json(
    {
      status: "failed",
      errorCode,
      ...(errorMessage ? { errorMessage } : {}),
    },
    {
      status,
    },
  );
}
