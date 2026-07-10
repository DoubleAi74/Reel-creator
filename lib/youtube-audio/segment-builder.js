import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import {
  assertDurationClose,
  convertAudioToMp3,
  isMp3Audio,
  probeAudio,
  trimAudioToMp3,
} from "./audio-ffmpeg";
import { fetchMediaToFileWithRetry } from "./media-fetcher";
import { logDiagnostic } from "./diagnostics";
import { getYoutubeAudioConfig } from "./server-config";
import { storeFinalMp3 } from "./storage";

const WORK_DIR_NAME = "work";

export async function buildYoutubeAudioSegment(job, providerResult, options = {}) {
  const config = options.config || getYoutubeAudioConfig();
  const workDir = path.join(config.tmpDir, WORK_DIR_NAME, job.id);
  const sourcePath = path.join(
    workDir,
    `source.${extensionForFormat(providerResult.mediaFormat)}`,
  );
  const processedPath = path.join(workDir, "segment.mp3");

  await mkdir(workDir, { recursive: true });

  try {
    logDiagnostic("segment-download-start", {
      jobId: job.id,
      providerId: providerResult.providerId,
      trimMode: providerResult.trimMode,
      mediaFormat: providerResult.mediaFormat,
    });

    // Stage A: retry transient provider media timeouts (full file often large
    // even when the user selected a short segment).
    const mediaResult = await fetchMediaToFileWithRetry(
      providerResult,
      {
        outputPath: sourcePath,
        maxBytes: config.maxSourceBytes,
      },
      { jobId: job.id },
    );

    const sourceProbe = await probeAudio(sourcePath);
    logDiagnostic("segment-source-probed", {
      jobId: job.id,
      providerId: providerResult.providerId,
      duration: sourceProbe.duration,
      codecName: sourceProbe.codecName,
      formatName: sourceProbe.formatName,
      mediaResult,
    });
    let finalCandidatePath = sourcePath;

    if (providerResult.trimMode === "local") {
      options.onPhase?.("trimming");
      logDiagnostic("segment-ffmpeg-trim-start", {
        jobId: job.id,
        startTime: job.startTime,
        endTime: job.endTime,
      });
      await trimAudioToMp3({
        inputPath: sourcePath,
        outputPath: processedPath,
        startTime: job.startTime,
        endTime: job.endTime,
      });
      finalCandidatePath = processedPath;
    } else if (!isMp3Audio(sourceProbe)) {
      options.onPhase?.("finalizing");
      logDiagnostic("segment-ffmpeg-convert-start", {
        jobId: job.id,
        sourceCodec: sourceProbe.codecName,
        sourceFormat: sourceProbe.formatName,
      });
      await convertAudioToMp3({
        inputPath: sourcePath,
        outputPath: processedPath,
      });
      finalCandidatePath = processedPath;
    }

    options.onPhase?.("finalizing");
    const finalProbe = await probeAudio(finalCandidatePath);
    logDiagnostic("segment-final-probed", {
      jobId: job.id,
      expectedDuration: job.endTime - job.startTime,
      duration: finalProbe.duration,
      codecName: finalProbe.codecName,
      formatName: finalProbe.formatName,
    });
    assertDurationClose(finalProbe.duration, job.endTime - job.startTime);

    const finalStat = await stat(finalCandidatePath);

    if (finalStat.size > config.maxOutputBytes) {
      logDiagnostic(
        "segment-output-too-large",
        {
          jobId: job.id,
          size: finalStat.size,
          maxOutputBytes: config.maxOutputBytes,
        },
        "warn",
      );
      const error = new Error("Final MP3 exceeds the maximum output size");
      error.errorCode = "PROVIDER_REJECTED";
      throw error;
    }

    return {
      ...(await storeFinalMp3(finalCandidatePath, job.id, { config })),
      outputDurationSec: finalProbe.duration,
      mediaResult: {
        contentType: mediaResult.contentType,
        contentLength: mediaResult.contentLength,
        sourceHost: mediaResult.sourceHost,
        quotaHeaders: mediaResult.quotaHeaders,
      },
    };
  } finally {
    logDiagnostic("segment-workdir-cleanup", {
      jobId: job.id,
    });
    await rm(workDir, { recursive: true, force: true });
  }
}

function extensionForFormat(format) {
  const normalized = String(format || "").toLowerCase();

  if (["mp3", "m4a", "aac", "wav", "ogg", "opus", "webm"].includes(normalized)) {
    return normalized;
  }

  return "audio";
}
