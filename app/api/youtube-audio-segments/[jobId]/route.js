import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  SESSION_COOKIE_NAME,
  storeAudioAssetFromPath,
} from "../../../../lib/files";
import {
  getIngestedAssetForSession,
  getJob,
  publicJob,
  recordIngestedAssetForSession,
} from "../../../../lib/youtube-audio/job-store";
import { getYoutubeAudioConfig } from "../../../../lib/youtube-audio/server-config";
import { getYoutubeAudioResultDir } from "../../../../lib/youtube-audio/storage";
import { extractYouTubeVideoId } from "../../../../lib/youtube-audio/youtube-url";

export const runtime = "nodejs";

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
      asset: publicAsset(existingAsset),
    });
  }

  const asset = await storeAudioAssetFromPath({
    sourcePath: job.storedAssetPath,
    trustedRootDir: getYoutubeAudioResultDir(getYoutubeAudioConfig()),
    sessionId,
    name: deriveAssetName(job),
    durationSec: job.outputDurationSec,
  });

  recordIngestedAssetForSession(job.id, sessionId, asset);

  return NextResponse.json({
    ...publicJob(job),
    asset: publicAsset(asset),
  });
}

function publicAsset(asset) {
  return {
    assetId: asset.assetId,
    durationSec: asset.durationSec,
    kind: asset.kind,
    name: asset.name,
    sizeBytes: asset.sizeBytes,
  };
}

function deriveAssetName(job) {
  const title = typeof job.title === "string" ? job.title.trim() : "";
  const fallbackId = extractYouTubeVideoId(job.sourceUrl) || job.id.slice(0, 8);
  const baseName = title || `youtube-${fallbackId}`;
  const safeName = baseName
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);

  return `${safeName || "YouTube audio"}.mp3`;
}
