import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "../../../../lib/files";
import {
  ingestCompletedYoutubeJob,
  publicYoutubeAsset,
} from "../../../../lib/youtube-audio/ingest-completed-job";
import {
  getIngestedAssetForSession,
  getJob,
  publicJob,
} from "../../../../lib/youtube-audio/job-store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(_request, { params }) {
  const { jobId } = await params;
  const job = getJob(jobId);

  if (!job) {
    return NextResponse.json(
      {
        status: "failed",
        errorCode: "RESULT_EXPIRED",
      },
      {
        status: 404,
      },
    );
  }

  if (job.status !== "complete") {
    return NextResponse.json(publicJob(job));
  }

  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionId) {
    return NextResponse.json(publicJob(job));
  }

  const existingAsset = getIngestedAssetForSession(job.id, sessionId);

  if (existingAsset) {
    return NextResponse.json({
      ...publicJob(job),
      asset: publicYoutubeAsset(existingAsset),
    });
  }

  try {
    const asset = await ingestCompletedYoutubeJob(job, sessionId);

    return NextResponse.json({
      ...publicJob(job),
      asset,
    });
  } catch (error) {
    console.error("YouTube job ingest failed:", {
      jobId: job.id,
      message: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        ...publicJob(job),
        status: "failed",
        errorCode: "CONVERSION_FAILED",
        errorMessage:
          error instanceof Error ? error.message : "Failed to attach audio asset.",
      },
      { status: 500 },
    );
  }
}
