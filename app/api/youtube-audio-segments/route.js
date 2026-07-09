import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "../../../lib/files";
import { getYoutubeAudioProviderDisplayName } from "../../../lib/youtube-audio/providers";
import {
  createOrReuseJob,
  publicJob,
} from "../../../lib/youtube-audio/job-store";
import { startBackgroundProcessing } from "../../../lib/youtube-audio/processing";
import {
  getYoutubeAudioConfig,
  isYoutubeAudioConfigured,
} from "../../../lib/youtube-audio/server-config";
import { parseYoutubeAudioSegmentRequest } from "../../../lib/youtube-audio/validation";

export const runtime = "nodejs";

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

    if (!reused && job.status === "queued") {
      startBackgroundProcessing(job.id);
    }

    const response = NextResponse.json(publicJob(job));

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
    return errorResponse(error?.errorCode || "INTERNAL_ERROR", 500);
  }
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
