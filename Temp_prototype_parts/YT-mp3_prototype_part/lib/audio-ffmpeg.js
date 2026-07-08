import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { logDiagnostic } from "./diagnostics.js";

const COMMAND_TIMEOUT_MS = 180_000;
const OUTPUT_CAPTURE_LIMIT = 8_000;

const resolvedFfmpegPath = resolveFfmpegPath();
const resolvedFfprobePath = resolveFfprobePath();

export class AudioProcessingError extends Error {
  constructor(message, { errorCode = "CONVERSION_FAILED", cause } = {}) {
    super(message);
    this.name = "AudioProcessingError";
    this.errorCode = errorCode;
    this.cause = cause;
  }
}

export async function probeAudio(filePath) {
  ensureBinaries();

  const result = await runCommand(resolvedFfprobePath, [
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
  ensureBinaries();

  const duration = Math.max(0, endTime - startTime);

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new AudioProcessingError("Invalid trim duration", {
      errorCode: "INVALID_INPUT",
    });
  }

  await runCommand(resolvedFfmpegPath, [
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
  ensureBinaries();

  await runCommand(resolvedFfmpegPath, [
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

function ensureBinaries() {
  if (!resolvedFfmpegPath || !resolvedFfprobePath) {
    throw new AudioProcessingError("Static FFmpeg/FFprobe binaries are unavailable", {
      errorCode: "INTERNAL_ERROR",
      cause: {
        importedFfmpegPath: ffmpegPath || null,
        importedFfprobePath: ffprobeStatic.path || null,
      },
    });
  }
}

function resolveFfmpegPath() {
  const binaryName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

  return resolveExistingBinary("ffmpeg", [
    ffmpegPath,
    path.join(process.cwd(), "node_modules", "ffmpeg-static", binaryName),
    path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"),
  ]);
}

function resolveFfprobePath() {
  const binaryName = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";

  return resolveExistingBinary("ffprobe", [
    ffprobeStatic.path,
    path.join(
      process.cwd(),
      "node_modules",
      "ffprobe-static",
      "bin",
      process.platform,
      process.arch,
      binaryName,
    ),
  ]);
}

function resolveExistingBinary(name, candidates) {
  const validCandidates = candidates.filter(Boolean);
  const resolved = validCandidates.find((candidate) => existsSync(candidate));

  logDiagnostic("audio-binary-resolved", {
    name,
    importedPath: validCandidates[0] || null,
    resolvedPath: resolved || null,
    usedFallback: Boolean(resolved && validCandidates[0] && resolved !== validCandidates[0]),
  });

  return resolved || null;
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
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
      clearTimeout(timeout);
      reject(
        new AudioProcessingError("Audio processing command failed to start", {
          errorCode: "INTERNAL_ERROR",
          cause: error,
        }),
      );
    });

    child.on("close", (code) => {
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

  if (next.length <= OUTPUT_CAPTURE_LIMIT) {
    return next;
  }

  return next.slice(-OUTPUT_CAPTURE_LIMIT);
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
