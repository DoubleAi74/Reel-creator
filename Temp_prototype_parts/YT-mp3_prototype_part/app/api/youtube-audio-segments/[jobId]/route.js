import { NextResponse } from "next/server";
import {
  getJob,
  publicJob,
} from "../../../../lib/youtube-audio-job-store.js";

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

  return NextResponse.json(publicJob(job));
}
