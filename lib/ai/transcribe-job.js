import { readFile } from "node:fs/promises";

import { getAssetFilePath, readAssetMetadata, touchSession } from "../files";
import {
  enrichLyricLines,
  runLyricTimingPipeline,
  timeLyricLinesFromAudio,
  transcribeAndCleanLyrics,
} from "./openai-lyrics";
import {
  markTranscribeJobComplete,
  markTranscribeJobProgress,
  markTranscribeJobRunning,
} from "./transcribe-store";

// Re-touch the session at most this often while a job runs so its file assets
// stay outside the sweep window even when the browser has stopped polling.
const SESSION_KEEPALIVE_INTERVAL_MS = 30_000;
const TRANSCRIBE_PHASES = new Set(["full", "transcribe", "enrich", "time"]);

function getFallbackMimeType(metadata) {
  return metadata.mimeType || "audio/mpeg";
}

export function normalizeTranscribePhase(phase) {
  if (phase == null || phase === "") {
    return "full";
  }

  if (typeof phase !== "string") {
    throw new Error("Unsupported lyric pipeline phase.");
  }

  const normalizedPhase = phase.trim().toLowerCase();

  if (!TRANSCRIBE_PHASES.has(normalizedPhase)) {
    throw new Error("Unsupported lyric pipeline phase.");
  }

  return normalizedPhase;
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
  phase = "full",
  sessionId,
  sourceLanguage,
}) {
  const normalizedPhase = normalizeTranscribePhase(phase);

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

  const needsAudioFile = normalizedPhase !== "enrich";
  let contentType = "audio/mpeg";
  let fileBuffer = null;
  let fileName = "";

  if (needsAudioFile) {
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
    fileBuffer = await readFile(filePath);
    contentType = getFallbackMimeType(metadata);
    fileName = metadata.name;
  }

  let lastTranscriptProgressAt = 0;
  let lastTranscriptProgressLength = 0;
  const onProgress = (progress) => {
    markTranscribeJobProgress(jobId, progress);
    void keepSessionWarm();
  };
  const onTranscriptDelta = (_delta, transcriptText) => {
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
  };

  let result;

  if (normalizedPhase === "transcribe") {
    result = await transcribeAndCleanLyrics({
      contentType,
      fileBuffer,
      fileName,
      lines,
      onProgress,
      onTranscriptDelta,
      sourceLanguage,
    });
  } else if (normalizedPhase === "enrich") {
    result = await enrichLyricLines({
      includeRomanization,
      lines,
      onProgress,
      sourceLanguage,
    });
  } else if (normalizedPhase === "time") {
    result = await timeLyricLinesFromAudio({
      audio,
      contentType,
      fileBuffer,
      fileName,
      lines,
      onProgress,
      sourceLanguage,
    });
  } else {
    result = await runLyricTimingPipeline({
      audio,
      contentType,
      fileBuffer,
      fileName,
      includeRomanization,
      includeWordMeanings: true,
      lines,
      onProgress,
      onTranscriptDelta,
      sourceLanguage,
    });
  }

  markTranscribeJobComplete(jobId, result);

  return result;
}
