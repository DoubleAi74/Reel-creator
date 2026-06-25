import { access, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { renderMedia, selectComposition } from "@remotion/renderer";

import { getAssetFilePath, readAssetMetadata } from "@/lib/files";
import { createDefaultProject } from "@/lib/project";
import { renderChromaTextLayer } from "@/lib/render/chroma-text-layer";
import { getTextLayerFormat, normalizeTextLayerMode } from "@/lib/render/formats";
import { renderVideoBackgroundComposite } from "@/lib/render/video-background-composite";
import { getSectionBounds } from "@/lib/timing";
import { validateProjectInput } from "@/lib/validate";
import { REMOTION_COMPOSITION_ID, VIDEO_FPS } from "@/remotion/constants";

import { getRemotionServeUrl } from "./bundle";
import {
  markRenderJobComplete,
  markRenderJobFailed,
  markRenderJobProgress,
  markRenderJobRunning,
} from "./store";

const RENDER_AUDIO_SAMPLE_RATE = 48_000;
const STANDARD_RENDER_CRF = 23;
const STANDARD_RENDER_JPEG_QUALITY = 88;
const STANDARD_RENDER_X264_PRESET = "veryfast";
// Remotion's AAC output lands about 2048 samples late in Chrome without compensation.
const AAC_ENCODER_DELAY_SAMPLES = 2_048;

function getAudioPrimingCompensationFrames(fps = VIDEO_FPS) {
  return (AAC_ENCODER_DELAY_SAMPLES / RENDER_AUDIO_SAMPLE_RATE) * fps;
}

function getPublicAssetUrl({ assetId, requestUrl, sessionId }) {
  const url = new URL(`/api/assets/${assetId}`, requestUrl);

  url.searchParams.set("sessionId", sessionId);

  return url.toString();
}

function getPlaywrightCacheDir() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library/Caches/ms-playwright");
  }

  if (process.platform === "win32") {
    return path.join(os.homedir(), "AppData/Local/ms-playwright");
  }

  return path.join(os.homedir(), ".cache/ms-playwright");
}

async function findLocalBrowserExecutable() {
  const cacheDir = getPlaywrightCacheDir();

  try {
    const entries = await readdir(cacheDir, { withFileTypes: true });
    const browserDir = entries
      .filter(
        (entry) =>
          entry.isDirectory() && entry.name.startsWith("chromium_headless_shell-"),
      )
      .sort((left, right) => right.name.localeCompare(left.name))[0];

    if (!browserDir) {
      return null;
    }

    const candidatePaths =
      process.platform === "darwin"
        ? [
            path.join(
              cacheDir,
              browserDir.name,
              "chrome-headless-shell-mac-arm64/chrome-headless-shell",
            ),
            path.join(
              cacheDir,
              browserDir.name,
              "chrome-headless-shell-mac-x64/chrome-headless-shell",
            ),
          ]
        : process.platform === "win32"
          ? [
              path.join(
                cacheDir,
                browserDir.name,
                "chrome-headless-shell-win64/chrome-headless-shell.exe",
              ),
            ]
          : [
              path.join(
                cacheDir,
                browserDir.name,
                "chrome-headless-shell-linux64/chrome-headless-shell",
              ),
            ];

    for (const executablePath of candidatePaths) {
      try {
        await access(executablePath);
        return executablePath;
      } catch {
        continue;
      }
    }

    return null;
  } catch {
    return null;
  }
}

async function resolveSessionAsset({ assetId, expectedKinds, label, sessionId }) {
  try {
    const metadata = await readAssetMetadata(sessionId, assetId);

    if (!expectedKinds.includes(metadata.kind)) {
      throw new Error(
        `${label} asset ${assetId} is not a supported ${label.toLowerCase()} upload.`,
      );
    }

    const filePath = await getAssetFilePath(sessionId, assetId);
    await access(filePath);

    return {
      filePath,
      metadata,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `${label} upload could not be found for this session. Re-upload it and try again.`,
      );
    }

    throw error;
  }
}

function getNormalizedProject(projectInput) {
  const project = createDefaultProject(validateProjectInput(projectInput));
  const sectionBounds = getSectionBounds(project.audio);

  if (sectionBounds.duration <= 0) {
    throw new Error(
      "The project is missing audio duration metadata. Re-upload the MP3 before exporting.",
    );
  }

  if (sectionBounds.sectionDuration <= 0) {
    throw new Error(
      "The selected audio section is empty. Move the end past the start before exporting.",
    );
  }

  return project;
}

export async function runRenderJob({
  audioAssetId,
  backgroundAssetId,
  job,
  project: projectInput,
  requestUrl,
  textLayerMode = null,
  transparent = false,
}) {
  try {
    const project = getNormalizedProject(projectInput);
    const resolvedTextLayerMode = transparent
      ? normalizeTextLayerMode(textLayerMode)
      : null;
    const textLayerFormat = resolvedTextLayerMode
      ? getTextLayerFormat(resolvedTextLayerMode)
      : null;
    const audioAsset = await resolveSessionAsset({
      assetId: audioAssetId,
      expectedKinds: ["audio"],
      label: "Audio",
      sessionId: job.sessionId,
    });
    const inputProps = {
      audioUrl: transparent
        ? null
        : getPublicAssetUrl({
            assetId: audioAssetId,
            requestUrl,
            sessionId: job.sessionId,
          }),
      audioPrimingCompensationFrames: transparent
        ? 0
        : getAudioPrimingCompensationFrames(VIDEO_FPS),
      backgroundDurationSec: null,
      backgroundUrl: null,
      project,
      textLayerMode: resolvedTextLayerMode,
      transparent,
    };
    let backgroundAsset = null;

    if (
      !transparent &&
      (project.background.type === "image" || project.background.type === "video")
    ) {
      const backgroundLabel =
        project.background.type === "video" ? "video background" : "image background";

      if (!backgroundAssetId) {
        throw new Error(
          `The selected ${backgroundLabel} is missing from this session. Re-upload it before exporting.`,
        );
      }

      backgroundAsset = await resolveSessionAsset({
        assetId: backgroundAssetId,
        expectedKinds: [project.background.type],
        label: "Background",
        sessionId: job.sessionId,
      });

      if (
        project.background.type === "video" &&
        !(
          Number.isFinite(backgroundAsset.metadata.durationSec) &&
          backgroundAsset.metadata.durationSec > 0
        )
      ) {
        throw new Error(
          "The uploaded video background could not be read. Re-upload a short MP4 or WebM clip before exporting.",
        );
      }

      inputProps.backgroundUrl = getPublicAssetUrl({
        assetId: backgroundAssetId,
        requestUrl,
        sessionId: job.sessionId,
      });
      inputProps.backgroundDurationSec = backgroundAsset.metadata.durationSec;
    }

    const outputLocation = path.join(
      path.dirname(audioAsset.filePath),
      `render-${job.jobId}.${transparent ? textLayerFormat.extension : "mp4"}`,
    );

    markRenderJobRunning(job.jobId);

    if (
      transparent &&
      (resolvedTextLayerMode === "alpha" || resolvedTextLayerMode === "chroma")
    ) {
      await renderChromaTextLayer({
        onProgress: (progress) => {
          markRenderJobProgress(job.jobId, progress);
        },
        outputLocation,
        project,
        textLayerMode: resolvedTextLayerMode,
      });

      markRenderJobComplete(job.jobId, {
        filePath: outputLocation,
        fileUrl: `/api/render/${job.jobId}/file`,
      });
      return;
    }

    if (
      !transparent &&
      project.background.type === "video" &&
      backgroundAsset?.filePath
    ) {
      await renderVideoBackgroundComposite({
        audioFilePath: audioAsset.filePath,
        backgroundFilePath: backgroundAsset.filePath,
        onProgress: (progress) => {
          markRenderJobProgress(job.jobId, progress);
        },
        outputLocation,
        project,
      });

      markRenderJobComplete(job.jobId, {
        filePath: outputLocation,
        fileUrl: `/api/render/${job.jobId}/file`,
      });
      return;
    }

    const browserExecutable = await findLocalBrowserExecutable();
    const serveUrl = await getRemotionServeUrl();

    const composition = await selectComposition({
      browserExecutable,
      id: REMOTION_COMPOSITION_ID,
      inputProps,
      serveUrl,
    });

    markRenderJobProgress(job.jobId, 0.05);

    await renderMedia({
      ...(transparent
        ? resolvedTextLayerMode === "chroma"
          ? {
              audioCodec: null,
              codec: "h264",
              crf: 26,
              imageFormat: "jpeg",
              jpegQuality: 88,
              x264Preset: "veryfast",
            }
          : {
              audioCodec: null,
              codec: "vp9",
              crf: 32,
              imageFormat: "png",
              pixelFormat: "yuva420p",
            }
        : {
            audioCodec: "aac",
            codec: "h264",
            crf: STANDARD_RENDER_CRF,
            hardwareAcceleration: "if-possible",
            imageFormat: "jpeg",
            jpegQuality: STANDARD_RENDER_JPEG_QUALITY,
            pixelFormat: "yuv420p",
            x264Preset: STANDARD_RENDER_X264_PRESET,
          }),
      browserExecutable,
      composition,
      inputProps,
      onProgress: ({ progress }) => {
        markRenderJobProgress(job.jobId, progress);
      },
      outputLocation,
      overwrite: true,
      sampleRate: RENDER_AUDIO_SAMPLE_RATE,
      serveUrl,
    });

    markRenderJobComplete(job.jobId, {
      filePath: outputLocation,
      fileUrl: `/api/render/${job.jobId}/file`,
    });
  } catch (error) {
    markRenderJobFailed(
      job.jobId,
      error instanceof Error ? error.message : "Render failed unexpectedly.",
    );
  }
}
