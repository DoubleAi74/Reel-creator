import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import {
  assertDurationClose,
  convertAudioToMp3,
  ensureAudioBinariesAvailable,
  isMp3Audio,
  looksLikeMp3,
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
  const expectedDuration = Math.max(0, job.endTime - job.startTime);

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

    const providerMp3 =
      providerResult.trimMode === "provider" &&
      looksLikeMp3({
        mediaFormat: providerResult.mediaFormat,
        contentType: mediaResult.contentType,
      });

    // Provider already cut + encoded MP3 (e.g. youtube-mp36). Avoid local
    // ffmpeg/ffprobe so serverless hosts without system binaries still work.
    if (providerMp3) {
      options.onPhase?.("finalizing");
      logDiagnostic("segment-provider-mp3-passthrough", {
        jobId: job.id,
        providerId: providerResult.providerId,
        contentType: mediaResult.contentType || null,
        mediaFormat: providerResult.mediaFormat || null,
        expectedDuration,
      });

      const finalStat = await stat(sourcePath);
      assertOutputSize(finalStat.size, config.maxOutputBytes, job.id);

      const outputDurationSec =
        numberOrNull(providerResult.sourceDurationSeconds) || expectedDuration;

      return {
        ...(await storeFinalMp3(sourcePath, job.id, { config })),
        outputDurationSec,
        mediaResult: {
          contentType: mediaResult.contentType,
          contentLength: mediaResult.contentLength,
          sourceHost: mediaResult.sourceHost,
          quotaHeaders: mediaResult.quotaHeaders,
        },
      };
    }

    // Local trim / convert path requires system (or env-pointed) binaries.
    ensureAudioBinariesAvailable();

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
      expectedDuration,
      duration: finalProbe.duration,
      codecName: finalProbe.codecName,
      formatName: finalProbe.formatName,
    });
    assertDurationClose(finalProbe.duration, expectedDuration);

    const finalStat = await stat(finalCandidatePath);
    assertOutputSize(finalStat.size, config.maxOutputBytes, job.id);

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

function assertOutputSize(size, maxOutputBytes, jobId) {
  if (size > maxOutputBytes) {
    logDiagnostic(
      "segment-output-too-large",
      {
        jobId,
        size,
        maxOutputBytes,
      },
      "warn",
    );
    const error = new Error("Final MP3 exceeds the maximum output size");
    error.errorCode = "PROVIDER_REJECTED";
    throw error;
  }
}

function extensionForFormat(format) {
  const normalized = String(format || "").toLowerCase();

  if (["mp3", "m4a", "aac", "wav", "ogg", "opus", "webm"].includes(normalized)) {
    return normalized;
  }

  return "audio";
}

function numberOrNull(value) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? number : null;
}
