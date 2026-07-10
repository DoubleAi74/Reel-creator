import { NextResponse } from "next/server";
import { getYoutubeAudioProviderDisplayName } from "../../../lib/providers/index.js";
import {
  createOrReuseJob,
  publicJob,
} from "../../../lib/youtube-audio-job-store.js";
import { startBackgroundProcessing } from "../../../lib/youtube-audio-processing.js";
import { parseYoutubeAudioSegmentRequest } from "../../../lib/youtube-audio-validation.js";

export async function POST(request) {
  let body;

  try {
    body = await request.json();
  } catch {
    return errorResponse("INVALID_INPUT", 400);
  }

  const parsed = parseYoutubeAudioSegmentRequest(body);

  if (!parsed.success) {
    const segmentTooLong = parsed.error.issues.some((issue) =>
      issue.message.includes("6-minute"),
    );
    const invalidProvider = parsed.error.issues.some(
      (issue) => issue.path.join(".") === "providerId",
    );

    return errorResponse(
      invalidProvider ? "INVALID_PROVIDER" : segmentTooLong ? "SEGMENT_TOO_LONG" : "INVALID_INPUT",
      400,
    );
  }

  const { job, reused } = createOrReuseJob({
    sourceUrl: parsed.data.url,
    startTime: parsed.data.startTime,
    endTime: parsed.data.endTime,
    providerId: parsed.data.providerId,
    providerName: getYoutubeAudioProviderDisplayName(parsed.data.providerId),
  });

  if (!reused && job.status === "queued") {
    startBackgroundProcessing(job.id);
  }

  return NextResponse.json(publicJob(job));
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
