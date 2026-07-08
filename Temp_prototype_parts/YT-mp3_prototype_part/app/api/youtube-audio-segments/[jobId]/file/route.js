import { NextResponse } from "next/server";
import { getJob } from "../../../../../lib/youtube-audio-job-store.js";
import {
  YoutubeAudioStorageError,
  getStoredAudioStream,
} from "../../../../../lib/youtube-audio-storage.js";

export async function GET(request, { params }) {
  const { jobId } = await params;
  const job = getJob(jobId);

  if (!job || job.status !== "complete") {
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

  try {
    const result = await getStoredAudioStream(job);
    const shouldDownload = request.nextUrl.searchParams.get("download") === "1";

    return new Response(result.body, {
      headers: {
        "Content-Type": result.contentType,
        "Content-Length": String(result.contentLength),
        "Content-Disposition": `${
          shouldDownload ? "attachment" : "inline"
        }; filename="youtube-segment-${job.id}.mp3"`,
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "failed",
        errorCode:
          error instanceof YoutubeAudioStorageError
            ? error.errorCode
            : "INTERNAL_ERROR",
      },
      {
        status: 410,
      },
    );
  }
}
