import { readFile } from "node:fs/promises";

import { getAssetFilePath, readAssetMetadata, touchSession } from "../files";
import { runLyricTimingPipeline } from "./openai-lyrics";
import {
  markTranscribeJobComplete,
  markTranscribeJobProgress,
  markTranscribeJobRunning,
} from "./transcribe-store";

// Re-touch the session at most this often while a job runs so its file assets
// stay outside the sweep window even when the browser has stopped polling.
const SESSION_KEEPALIVE_INTERVAL_MS = 30_000;

function getFallbackMimeType(metadata) {
  return metadata.mimeType || "audio/mpeg";
}

// The runner owns everything that used to live inside the SSE ReadableStream in
// the transcribe route. It is decoupled from any request, so a dropped
// connection (sleep / reload / navigation) no longer aborts the work.
export async function runTranscribeJob({
  audio,
  audioAssetId,
  includeRomanization,
  jobId,
  lines,
  sessionId,
  sourceLanguage,
}) {
  markTranscribeJobRunning(jobId);

  let lastSessionTouchAt = Date.now();
  await touchSession(sessionId);

  const keepSessionWarm = async () => {
    const now = Date.now();

    if (now - lastSessionTouchAt < SESSION_KEEPALIVE_INTERVAL_MS) {
      return;
    }

    lastSessionTouchAt = now;
    // Best-effort; a failed touch must not abort the pipeline.
    await touchSession(sessionId).catch(() => {});
  };

  markTranscribeJobProgress(jobId, {
    detail: "Loading the uploaded MP3 from this editing session.",
    stage: "loading-audio",
    title: "Loading audio",
  });

  const metadata = await readAssetMetadata(sessionId, audioAssetId);

  if (metadata.kind !== "audio") {
    throw new Error("Choose an uploaded MP3 before generating lyrics.");
  }

  const filePath = await getAssetFilePath(sessionId, audioAssetId);
  const fileBuffer = await readFile(filePath);
  let lastTranscriptProgressAt = 0;
  let lastTranscriptProgressLength = 0;

  const result = await runLyricTimingPipeline({
    audio,
    contentType: getFallbackMimeType(metadata),
    fileBuffer,
    fileName: metadata.name,
    includeRomanization,
    includeWordMeanings: true,
    lines,
    onProgress: (progress) => {
      markTranscribeJobProgress(jobId, progress);
      void keepSessionWarm();
    },
    onTranscriptDelta: (_delta, transcriptText) => {
      const now = Date.now();

      if (
        now - lastTranscriptProgressAt < 750 &&
        transcriptText.length - lastTranscriptProgressLength < 400
      ) {
        return;
      }

      lastTranscriptProgressAt = now;
      lastTranscriptProgressLength = transcriptText.length;
      markTranscribeJobProgress(jobId, {
        detail: `${transcriptText.length.toLocaleString()} transcript character${
          transcriptText.length === 1 ? "" : "s"
        } received so far.`,
        stage: "transcribing",
        title: "Transcribing audio",
      });
      void keepSessionWarm();
    },
    sourceLanguage,
  });

  markTranscribeJobComplete(jobId, result);

  return result;
}
