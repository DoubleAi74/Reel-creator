import { readFile } from "node:fs/promises";

import { getAssetFilePath, readAssetMetadata, touchSession } from "../files";
import {
  enrichLyricLines,
  generateLyricLines,
  runLyricTimingPipeline,
  timeLyricLinesFromAudio,
  transcribeAndCleanLyrics,
} from "./openai-lyrics";
import {
  markTranscribeJobAccounting,
  markTranscribeJobComplete,
  markTranscribeJobProgress,
  markTranscribeJobRunning,
} from "./transcribe-store";
import { createUsageCollector } from "./openai-usage.js";
import { isCreditsEnabled } from "../credits/flags.js";
import {
  isCreditServiceError,
  recordUsageOnly,
  settlePhase,
} from "../credits/credit-service.js";
import {
  buildGenerationSnapshot,
  persistGeneration,
} from "../generations/persist-generation.js";

// Re-touch the session at most this often while a job runs so its file assets
// stay outside the sweep window even when the browser has stopped polling.
const SESSION_KEEPALIVE_INTERVAL_MS = 30_000;
const TRANSCRIBE_PHASES = new Set([
  "full",
  "generate",
  "transcribe",
  "enrich",
  "time",
]);

function getFallbackMimeType(metadata) {
  return metadata.mimeType || "audio/mpeg";
}

function getBillingPhasesForTranscribePhase(phase) {
  if (phase === "full") {
    return ["transcribe", "enrich", "time"];
  }

  if (phase === "generate") {
    return ["transcribe", "enrich"];
  }

  return [phase];
}

async function recordUnsettledUsage({ collector, phase }) {
  if (!collector) {
    return;
  }

  const calls = collector.serialize().calls;

  await Promise.all(
    getBillingPhasesForTranscribePhase(phase).map((billingPhase) =>
      recordUsageOnly({
        phase: billingPhase,
        usageRecords: calls.filter((record) => record.phase === billingPhase),
      }),
    ),
  );
}

async function settleCompletedUsage({ collector, jobId, phase, pipelineRunId }) {
  if (!collector) {
    markTranscribeJobAccounting(jobId, { error: null, status: "none" });
    return;
  }

  try {
    let totalWriteOffMinor = 0;
    let balanceExhausted = false;

    for (const billingPhase of getBillingPhasesForTranscribePhase(phase)) {
      const usageRecords = await collector.markPhaseComplete(billingPhase);
      // AI settlement clamps to available balance (REP-201); insufficient
      // balance no longer yields unresolved — only transient settlement/DB errors do.
      const settlement = await settlePhase({
        jobId,
        phase: billingPhase,
        pipelineRunId,
        usageRecords,
      });

      if (Number.isInteger(settlement?.writeOffMinor) && settlement.writeOffMinor > 0) {
        totalWriteOffMinor += settlement.writeOffMinor;
      }

      if (
        settlement?.balanceExhausted === true ||
        settlement?.clamped === true ||
        (Number.isInteger(settlement?.balance?.amountMinor) &&
          settlement.balance.amountMinor <= 0)
      ) {
        balanceExhausted = true;
      }
    }

    markTranscribeJobAccounting(jobId, {
      balanceExhausted,
      error: null,
      status: "settled",
      writeOffMinor: totalWriteOffMinor,
    });
  } catch (error) {
    // unresolved = transient settlement/DB error only (not insufficient balance).
    const code = isCreditServiceError(error)
      ? error.code
      : "ACCOUNTING_ERROR";

    console.error(
      `[credits] Failed to settle AI usage for job ${jobId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    markTranscribeJobAccounting(jobId, { error: code, status: "unresolved" });
  }
}

async function persistCompletedGeneration({
  assetMetadata,
  audio,
  audioAssetId,
  jobId,
  lines,
  pipelineRunId,
  result,
  save,
  saveOnCompletion,
  sessionId,
  sourceLanguage,
  title = "",
}) {
  if (!isCreditsEnabled() || save === false || saveOnCompletion !== true) {
    return;
  }

  const generationAssetMetadata =
    assetMetadata ?? (await readAssetMetadata(sessionId, audioAssetId).catch(() => null));

  try {
    await persistGeneration({
      assetId: audioAssetId,
      audioDurationSeconds: audio?.duration,
      finalJobId: jobId,
      jobIds: [jobId],
      pipelineRunId,
      save,
      sessionId,
      snapshot: buildGenerationSnapshot({
        assetMetadata: generationAssetMetadata ?? {},
        audio,
        lines,
        result,
        sourceLanguage,
      }),
      sourceType: generationAssetMetadata?.sourceType,
      // REP-403 / D-C: only an explicit user title publishes; never default to filename.
      title,
    });
  } catch (error) {
    console.error(
      `[credits] Failed to persist generation for job ${jobId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
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
  pipelineRunId = jobId,
  save = true,
  saveOnCompletion = false,
  sessionId,
  sourceLanguage,
  title = "",
}) {
  const normalizedPhase = normalizeTranscribePhase(phase);
  const usageCollector = isCreditsEnabled()
    ? createUsageCollector({
        jobId,
        pipelineRunId,
      })
    : null;

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
  let assetMetadata = null;
  let audioFilePath = null;
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
    assetMetadata = metadata;
    audioFilePath = filePath;
    fileBuffer = await readFile(filePath);
    contentType = getFallbackMimeType(metadata);
    fileName = metadata.name;
  }

  const assetDurationSec = Number.isFinite(assetMetadata?.durationSec)
    ? assetMetadata.durationSec
    : null;

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

  try {
    if (normalizedPhase === "transcribe") {
      result = await transcribeAndCleanLyrics({
        assetDurationSec,
        audio,
        audioFilePath,
        contentType,
        fileBuffer,
        fileName,
        lines,
        onProgress,
        onTranscriptDelta,
        sourceLanguage,
        usageCollector,
      });
    } else if (normalizedPhase === "generate") {
      result = await generateLyricLines({
        assetDurationSec,
        audio,
        audioFilePath,
        contentType,
        fileBuffer,
        fileName,
        includeRomanization,
        onProgress,
        onTranscriptDelta,
        sourceLanguage,
        usageCollector,
      });
    } else if (normalizedPhase === "enrich") {
      result = await enrichLyricLines({
        includeRomanization,
        lines,
        onProgress,
        sourceLanguage,
        usageCollector,
      });
    } else if (normalizedPhase === "time") {
      result = await timeLyricLinesFromAudio({
        assetDurationSec,
        audio,
        audioFilePath,
        contentType,
        fileBuffer,
        fileName,
        lines,
        onProgress,
        sourceLanguage,
        usageCollector,
      });
    } else {
      result = await runLyricTimingPipeline({
        assetDurationSec,
        audio,
        audioFilePath,
        contentType,
        fileBuffer,
        fileName,
        includeRomanization,
        includeWordMeanings: true,
        lines,
        onProgress,
        onTranscriptDelta,
        sourceLanguage,
        usageCollector,
      });
    }
  } catch (error) {
    await recordUnsettledUsage({
      collector: usageCollector,
      phase: normalizedPhase,
    }).catch((usageError) => {
      console.warn(
        `[credits] Failed to record uncharged usage for job ${jobId}: ${
          usageError instanceof Error ? usageError.message : String(usageError)
        }`,
      );
    });
    throw error;
  }

  await settleCompletedUsage({
    collector: usageCollector,
    jobId,
    phase: normalizedPhase,
    pipelineRunId,
  });

  await persistCompletedGeneration({
    assetMetadata,
    audio,
    audioAssetId,
    jobId,
    lines,
    pipelineRunId,
    result,
    save,
    saveOnCompletion,
    sessionId,
    sourceLanguage,
    title,
  });

  markTranscribeJobComplete(jobId, result);

  return result;
}
