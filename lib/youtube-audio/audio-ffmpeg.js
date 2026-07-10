import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

import { logDiagnostic } from "./diagnostics";

const COMMAND_TIMEOUT_MS = 180_000;
const OUTPUT_CAPTURE_LIMIT = 8_000;

export class AudioProcessingError extends Error {
  constructor(message, { errorCode = "CONVERSION_FAILED", cause } = {}) {
    super(message);
    this.name = "AudioProcessingError";
    this.errorCode = errorCode;
    this.cause = cause;
  }
}

/**
 * Resolve ffmpeg/ffprobe for this process.
 * Priority: FFMPEG_PATH / FFPROBE_PATH env → bare system commands.
 * Vercel serverless images do not ship these; provider-trim MP3 paths avoid them.
 */
export function getAudioBinaryCommands() {
  return {
    ffmpeg: process.env.FFMPEG_PATH || "ffmpeg",
    ffprobe: process.env.FFPROBE_PATH || "ffprobe",
  };
}

/**
 * Whether local trim/convert/probe can run on this host.
 * - Explicit FFMPEG_PATH + FFPROBE_PATH must both exist on disk.
 * - On Vercel (or YT_AUDIO_NO_FFMPEG=1), bare PATH names are treated as missing
 *   (stock images do not include ffmpeg/ffprobe).
 * - Elsewhere, bare names are assumed available (spawn fails later if not).
 */
export function canUseLocalFfmpeg() {
  if (process.env.YT_AUDIO_NO_FFMPEG === "1" || process.env.YT_AUDIO_NO_FFMPEG === "true") {
    return false;
  }

  const envFfmpeg = process.env.FFMPEG_PATH;
  const envFfprobe = process.env.FFPROBE_PATH;

  if (envFfmpeg || envFfprobe) {
    return Boolean(
      envFfmpeg &&
        envFfprobe &&
        existsSync(envFfmpeg) &&
        existsSync(envFfprobe),
    );
  }

  if (process.env.VERCEL === "1") {
    return false;
  }

  const { ffmpeg, ffprobe } = getAudioBinaryCommands();
  return Boolean(ffmpeg && ffprobe);
}

/** @deprecated Use canUseLocalFfmpeg — kept for call sites that check configuration only. */
export function areAudioBinariesConfigured() {
  return canUseLocalFfmpeg();
}

export function ensureAudioBinariesAvailable() {
  if (!canUseLocalFfmpeg()) {
    throw new AudioProcessingError(
      "ffmpeg/ffprobe binaries are not available on this host. Set FFMPEG_PATH and FFPROBE_PATH, or use provider-trimmed MP3 (youtube-mp36).",
      { errorCode: "FFMPEG_MISSING" },
    );
  }
}

export async function probeAudio(filePath) {
  const { ffprobe } = getAudioBinaryCommands();
  const result = await runCommand(ffprobe, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);

  let parsed;

  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new AudioProcessingError("FFprobe returned malformed JSON", {
      errorCode: "CONVERSION_FAILED",
      cause: error,
    });
  }

  const audioStream = (parsed.streams || []).find(
    (stream) => stream.codec_type === "audio",
  );

  if (!audioStream) {
    throw new AudioProcessingError("File does not contain an audio stream", {
      errorCode: "PROVIDER_MALFORMED_RESPONSE",
      cause: parsed,
    });
  }

  const duration =
    numberOrNull(audioStream.duration) || numberOrNull(parsed.format?.duration);

  return {
    duration,
    codecName: audioStream.codec_name || null,
    formatName: parsed.format?.format_name || null,
    bitRate: numberOrNull(audioStream.bit_rate) || numberOrNull(parsed.format?.bit_rate),
    raw: parsed,
  };
}

export async function trimAudioToMp3({ inputPath, outputPath, startTime, endTime }) {
  const { ffmpeg } = getAudioBinaryCommands();
  const duration = Math.max(0, endTime - startTime);

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new AudioProcessingError("Invalid trim duration", {
      errorCode: "INVALID_INPUT",
    });
  }

  await runCommand(ffmpeg, [
    "-hide_banner",
    "-y",
    "-ss",
    formatSeconds(startTime),
    "-i",
    inputPath,
    "-t",
    formatSeconds(duration),
    "-vn",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "128k",
    outputPath,
  ]);
}

export async function convertAudioToMp3({ inputPath, outputPath }) {
  const { ffmpeg } = getAudioBinaryCommands();
  await runCommand(ffmpeg, [
    "-hide_banner",
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "128k",
    outputPath,
  ]);
}

export function assertDurationClose(actualDuration, expectedDuration) {
  if (!Number.isFinite(actualDuration) || actualDuration <= 0) {
    throw new AudioProcessingError("Output audio duration could not be verified", {
      errorCode: "CONVERSION_FAILED",
    });
  }

  const tolerance = Math.max(2.5, expectedDuration * 0.08);

  if (Math.abs(actualDuration - expectedDuration) > tolerance) {
    throw new AudioProcessingError("Output audio duration did not match request", {
      errorCode: "CONVERSION_FAILED",
      cause: {
        actualDuration,
        expectedDuration,
        tolerance,
      },
    });
  }
}

export function isMp3Audio(probe) {
  return (
    probe.codecName === "mp3" ||
    (probe.formatName || "").split(",").includes("mp3")
  );
}

export function looksLikeMp3({ mediaFormat, contentType } = {}) {
  const format = String(mediaFormat || "").toLowerCase();
  const type = String(contentType || "").toLowerCase();

  if (format === "mp3" || format.endsWith(".mp3")) {
    return true;
  }

  return (
    type.includes("audio/mpeg") ||
    type.includes("audio/mp3") ||
    type.includes("audio/x-mpeg")
  );
}

function runCommand(command, args) {
  logDiagnostic("audio-command-start", {
    command,
    args: redactArgs(args),
  });

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      settled = true;
      child.kill("SIGKILL");
      reject(
        new AudioProcessingError("Audio processing timed out", {
          errorCode: "PROVIDER_TIMEOUT",
          cause: { command, args: redactArgs(args), stderr },
        }),
      );
    }, COMMAND_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout = appendLimited(stdout, chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk);
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      const missing =
        error?.code === "ENOENT" ||
        /ENOENT|not found|spawn .* ENOENT/i.test(String(error?.message || error));

      reject(
        new AudioProcessingError(
          missing
            ? `Audio binary not found (${command}). Install ffmpeg/ffprobe or set FFMPEG_PATH/FFPROBE_PATH. On Vercel, prefer provider-trimmed MP3 (youtube-mp36).`
            : "Audio processing command failed to start",
          {
            errorCode: missing ? "FFMPEG_MISSING" : "INTERNAL_ERROR",
            cause: error,
          },
        ),
      );
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new AudioProcessingError("Audio processing command failed", {
          errorCode: "CONVERSION_FAILED",
          cause: {
            command,
            args: redactArgs(args),
            code,
            stderr,
          },
        }),
      );
    });
  });
}

function appendLimited(current, chunk) {
  const next = `${current}${chunk.toString()}`;

  return next.length <= OUTPUT_CAPTURE_LIMIT ? next : next.slice(-OUTPUT_CAPTURE_LIMIT);
}

function numberOrNull(value) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? number : null;
}

function formatSeconds(value) {
  return Math.max(0, Number(value) || 0).toFixed(3);
}

function redactArgs(args) {
  return args.map((arg) => (/^https?:\/\//i.test(arg) ? "REDACTED_URL" : arg));
}
