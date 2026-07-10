import { spawn } from "node:child_process";

import { logDiagnostic } from "./diagnostics";

const COMMAND_TIMEOUT_MS = 180_000;
const OUTPUT_CAPTURE_LIMIT = 8_000;
const FFMPEG_COMMAND = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE_COMMAND = process.env.FFPROBE_PATH || "ffprobe";

export class AudioProcessingError extends Error {
  constructor(message, { errorCode = "CONVERSION_FAILED", cause } = {}) {
    super(message);
    this.name = "AudioProcessingError";
    this.errorCode = errorCode;
    this.cause = cause;
  }
}

export function getAudioBinaryCommands() {
  return {
    ffmpeg: FFMPEG_COMMAND,
    ffprobe: FFPROBE_COMMAND,
  };
}

export async function probeAudio(filePath) {
  const result = await runCommand(FFPROBE_COMMAND, [
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
  const duration = Math.max(0, endTime - startTime);

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new AudioProcessingError("Invalid trim duration", {
      errorCode: "INVALID_INPUT",
    });
  }

  await runCommand(FFMPEG_COMMAND, [
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
  await runCommand(FFMPEG_COMMAND, [
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
      reject(
        new AudioProcessingError("Audio processing command failed to start", {
          errorCode: "INTERNAL_ERROR",
          cause: error,
        }),
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
