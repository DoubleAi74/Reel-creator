import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";

import {
  DEFAULT_TEXT_LAYER_MODE,
  TEXT_LAYER_RENDER_FPS,
  TEXT_LAYER_RENDER_HEIGHT,
  TEXT_LAYER_RENDER_WIDTH,
} from "@/lib/render/formats";
import { renderChromaTextLayer } from "@/lib/render/chroma-text-layer";
import { getSectionBounds } from "@/lib/timing";

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function normalizeHexColor(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }

  const match = value.trim().match(/^#?([0-9a-f]{6})$/i);

  return match ? `#${match[1].toUpperCase()}` : fallback;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function writeBackgroundOverlay({ background, outputPath }) {
  const scrimEnabled = background?.scrim?.enabled ?? true;
  const scrimOpacity = clampNumber(background?.scrim?.opacity ?? 0.4, 0, 1);
  const scrimColor = normalizeHexColor(background?.scrim?.color, "#000000");
  const scrimMarkup =
    scrimEnabled && scrimOpacity > 0
      ? `<rect width="100%" height="100%" fill="${escapeXml(
          scrimColor,
        )}" opacity="${scrimOpacity}"/>`
      : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TEXT_LAYER_RENDER_WIDTH}" height="${TEXT_LAYER_RENDER_HEIGHT}" viewBox="0 0 ${TEXT_LAYER_RENDER_WIDTH} ${TEXT_LAYER_RENDER_HEIGHT}">
    <defs>
      <radialGradient id="top-glow" cx="50%" cy="0%" r="55%">
        <stop offset="0%" stop-color="#FBBF24" stop-opacity="0.15"/>
        <stop offset="52%" stop-color="#FBBF24" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="media-shade" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#050A12" stop-opacity="0.1"/>
        <stop offset="100%" stop-color="#050A12" stop-opacity="0.5"/>
      </linearGradient>
      <linearGradient id="frame-shade" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.04"/>
        <stop offset="24%" stop-color="#FFFFFF" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.2"/>
      </linearGradient>
    </defs>
    ${scrimMarkup}
    <rect width="100%" height="100%" fill="url(#top-glow)"/>
    <rect width="100%" height="100%" fill="url(#media-shade)"/>
    <rect width="100%" height="100%" fill="url(#frame-shade)"/>
  </svg>`;

  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(outputPath);
}

function parseFfmpegProgressTime(value) {
  if (!value) {
    return null;
  }

  if (/^\d+$/.test(value)) {
    return Number(value) / 1_000_000;
  }

  const match = value.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);

  if (!match) {
    return null;
  }

  return (
    Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
  );
}

function composeVideo({
  audioFilePath,
  backgroundFilePath,
  duration,
  onProgress,
  outputLocation,
  overlayPath,
  startOffset,
  textLayerPath,
}) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostats",
        "-y",
        "-stream_loop",
        "-1",
        "-i",
        backgroundFilePath,
        "-ss",
        String(startOffset),
        "-t",
        String(duration),
        "-i",
        audioFilePath,
        "-loop",
        "1",
        "-framerate",
        String(TEXT_LAYER_RENDER_FPS),
        "-t",
        String(duration),
        "-i",
        overlayPath,
        "-i",
        textLayerPath,
        "-filter_complex",
        [
          `[0:v]scale=${TEXT_LAYER_RENDER_WIDTH}:${TEXT_LAYER_RENDER_HEIGHT}:force_original_aspect_ratio=increase,crop=${TEXT_LAYER_RENDER_WIDTH}:${TEXT_LAYER_RENDER_HEIGHT},setsar=1,fps=${TEXT_LAYER_RENDER_FPS},format=rgba[bg]`,
          "[bg][2:v]overlay=0:0:format=auto[base]",
          `[3:v]scale=${TEXT_LAYER_RENDER_WIDTH}:${TEXT_LAYER_RENDER_HEIGHT},format=rgba[text]`,
          "[base][text]overlay=0:0:format=auto,format=yuv420p[v]",
        ].join(";"),
        "-map",
        "[v]",
        "-map",
        "1:a:0",
        "-t",
        String(duration),
        "-shortest",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-ar",
        "48000",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        "-progress",
        "pipe:1",
        outputLocation,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    let stdoutBuffer = "";

    ffmpeg.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const [key, value] = line.split("=");

        if (key !== "out_time" && key !== "out_time_us" && key !== "out_time_ms") {
          continue;
        }

        const time = parseFfmpegProgressTime(value);

        if (time != null && duration > 0) {
          onProgress?.(clampNumber(time / duration, 0, 1));
        }
      }
    });

    ffmpeg.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          stderr.trim() ||
            `FFmpeg video background compose failed with exit code ${
              code ?? "unknown"
            }.`,
        ),
      );
    });
  });
}

export async function renderVideoBackgroundComposite({
  audioFilePath,
  backgroundFilePath,
  onProgress,
  outputLocation,
  project,
}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "reel-video-compose-"));

  try {
    const sectionBounds = getSectionBounds(project.audio);
    const overlayPath = path.join(tempDir, "background-overlay.png");
    const textLayerPath = path.join(tempDir, "text-layer.mov");

    await writeBackgroundOverlay({
      background: project.background,
      outputPath: overlayPath,
    });
    onProgress?.(0.04);
    await renderChromaTextLayer({
      onProgress: (progress) => onProgress?.(0.04 + progress * 0.46),
      outputLocation: textLayerPath,
      project,
      textLayerMode: DEFAULT_TEXT_LAYER_MODE,
    });
    onProgress?.(0.52);
    await composeVideo({
      audioFilePath,
      backgroundFilePath,
      duration: sectionBounds.sectionDuration,
      onProgress: (progress) => onProgress?.(0.52 + progress * 0.46),
      outputLocation,
      overlayPath,
      startOffset: sectionBounds.startOffset,
      textLayerPath,
    });
    onProgress?.(0.98);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}
