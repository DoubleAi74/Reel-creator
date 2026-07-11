import { readFile } from "node:fs/promises";

import { getAssetFilePath, storeAudioAssetFromPath } from "../files";
import {
  getIngestedAssetForSession,
  recordIngestedAssetForSession,
} from "./job-store";
import { getYoutubeAudioConfig } from "./server-config";
import { getYoutubeAudioResultDir } from "./storage";
import { extractYouTubeVideoId } from "./youtube-url";

/** Skip embedding huge payloads; 6 min @ 128kbps is ~5.8MB. */
const MAX_EMBED_BYTES = 12 * 1024 * 1024;

export function publicYoutubeAsset(asset) {
  if (!asset) {
    return null;
  }

  return {
    assetId: asset.assetId,
    durationSec: asset.durationSec,
    kind: asset.kind,
    name: asset.name,
    sizeBytes: asset.sizeBytes,
  };
}

/**
 * On multi-instance hosts (Vercel), /tmp is per-isolate. A follow-up GET
 * /api/assets/:id often hits a cold isolate and 404s. Embed the MP3 so the
 * browser can play via blob: URL (same pattern as local file upload).
 */
export function shouldEmbedYoutubeAssetBytes() {
  if (process.env.YT_AUDIO_EMBED_BYTES === "0" || process.env.YT_AUDIO_EMBED_BYTES === "false") {
    return false;
  }

  if (process.env.YT_AUDIO_EMBED_BYTES === "1" || process.env.YT_AUDIO_EMBED_BYTES === "true") {
    return true;
  }

  return process.env.VERCEL === "1";
}

export function deriveYoutubeAssetName(job) {
  const title = typeof job?.title === "string" ? job.title.trim() : "";
  const fallbackId =
    extractYouTubeVideoId(job?.sourceUrl) || String(job?.id || "").slice(0, 8);
  const baseName = title || `youtube-${fallbackId}`;
  const safeName = baseName
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);

  return `${safeName || "YouTube audio"}.mp3`;
}

/**
 * Attach a completed job's MP3 into the caller's session asset store.
 * Returns the public asset shape or null if the job is not complete.
 */
export async function ingestCompletedYoutubeJob(job, sessionId) {
  if (!job || job.status !== "complete" || !sessionId) {
    return null;
  }

  const existingAsset = getIngestedAssetForSession(job.id, sessionId);

  if (existingAsset) {
    return publicYoutubeAsset(existingAsset);
  }

  if (!job.storedAssetPath) {
    const error = new Error("Completed job is missing stored audio path.");
    error.errorCode = "CONVERSION_FAILED";
    throw error;
  }

  const asset = await storeAudioAssetFromPath({
    sourcePath: job.storedAssetPath,
    trustedRootDir: getYoutubeAudioResultDir(getYoutubeAudioConfig()),
    sessionId,
    name: deriveYoutubeAssetName(job),
    durationSec: job.outputDurationSec,
    sourceType: "youtube",
    sourceUrl: job.sourceUrl,
    segmentStartSec: job.startTime,
    segmentEndSec: job.endTime,
  });

  recordIngestedAssetForSession(job.id, sessionId, asset);

  const publicAsset = publicYoutubeAsset(asset);

  if (shouldEmbedYoutubeAssetBytes() && Number(asset.sizeBytes) <= MAX_EMBED_BYTES) {
    try {
      const filePath = await getAssetFilePath(sessionId, asset.assetId);
      const buffer = await readFile(filePath);
      publicAsset.audioBase64 = buffer.toString("base64");
      publicAsset.mimeType = asset.mimeType || "audio/mpeg";
    } catch {
      // Playback can still try /api/assets; embed is best-effort.
    }
  }

  return publicAsset;
}
