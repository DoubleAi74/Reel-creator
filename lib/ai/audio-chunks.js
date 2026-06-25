import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_CHUNK_SECONDS = 45;
const DEFAULT_OVERLAP_SECONDS = 6;
const MIN_CHUNK_SECONDS = 10;

function getChunkBaseDir() {
  return process.env.TMP_DIR
    ? path.resolve(process.env.TMP_DIR)
    : path.join(os.tmpdir(), "reel-creator");
}

async function probeDurationSeconds(filePath) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    const duration = Number.parseFloat(stdout.trim());

    return Number.isFinite(duration) && duration > 0 ? duration : null;
  } catch {
    return null;
  }
}

// Plan overlapping chunk windows. Each chunk is transcribed in full so no word
// is cut at a boundary; the caller removes the resulting overlap duplicates when
// merging word timings.
function planChunks(totalSeconds, chunkSeconds, overlapSeconds) {
  const step = Math.max(1, chunkSeconds - overlapSeconds);
  const plans = [];
  const starts = [];

  for (let start = 0; start < totalSeconds; start += step) {
    starts.push(start);

    if (start + chunkSeconds >= totalSeconds) {
      break;
    }
  }

  for (const start of starts) {
    const end = Math.min(start + chunkSeconds, totalSeconds);

    plans.push({ duration: end - start, end, start });
  }

  return plans;
}

function normalizeWindowTime(value, fallback) {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

async function writeInputAudio(workDir, fileBuffer, fileName) {
  const inputExtension = path.extname(fileName || "").toLowerCase() || ".mp3";
  const inputName = `input${inputExtension}`;
  const inputPath = path.join(workDir, inputName);

  await writeFile(inputPath, fileBuffer);

  return { inputName, inputPath };
}

async function encodeMp3Window({ duration, inputName, outputName, start, workDir }) {
  await execFileAsync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-ss",
      String(start),
      "-t",
      String(duration),
      "-i",
      inputName,
      "-c:a",
      "libmp3lame",
      "-q:a",
      "5",
      outputName,
    ],
    { cwd: workDir },
  );
}

export async function cutAudioWindow({
  end,
  fileBuffer,
  fileName = "audio.mp3",
  start = 0,
}) {
  if (!fileBuffer || fileBuffer.length === 0) {
    throw new Error("Cannot cut empty audio.");
  }

  const workDir = path.join(getChunkBaseDir(), `window-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });

  try {
    const { inputName, inputPath } = await writeInputAudio(workDir, fileBuffer, fileName);
    const totalSeconds = await probeDurationSeconds(inputPath);
    const windowStart = Math.max(0, normalizeWindowTime(start, 0));
    const requestedEnd = normalizeWindowTime(end, totalSeconds ?? windowStart);
    const boundedEnd = totalSeconds
      ? Math.min(Math.max(requestedEnd, windowStart), totalSeconds)
      : Math.max(requestedEnd, windowStart);
    const duration = boundedEnd - windowStart;

    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("Audio section is empty.");
    }

    const outputName = "window.mp3";
    await encodeMp3Window({
      duration,
      inputName,
      outputName,
      start: windowStart,
      workDir,
    });

    return {
      buffer: await readFile(path.join(workDir, outputName)),
      contentType: "audio/mpeg",
      end: boundedEnd,
      fileName: outputName,
      start: windowStart,
    };
  } finally {
    await rm(workDir, { force: true, recursive: true }).catch(() => {});
  }
}

// Split an audio buffer into overlapping MP3 chunks using ffmpeg. Re-encoding
// gives each chunk clean frame boundaries and timestamps relative to its own
// start (offset back to the source timeline via `start`). Returns an empty
// array if the audio is short enough to transcribe in a single request.
export async function splitAudioIntoChunks({
  chunkSeconds = DEFAULT_CHUNK_SECONDS,
  fileBuffer,
  fileName = "audio.mp3",
  overlapSeconds = DEFAULT_OVERLAP_SECONDS,
}) {
  if (!fileBuffer || fileBuffer.length === 0) {
    throw new Error("Cannot split empty audio.");
  }

  const seconds = Math.max(MIN_CHUNK_SECONDS, Math.floor(chunkSeconds));
  const overlap = Math.max(0, Math.min(overlapSeconds, Math.floor(seconds / 2)));
  const workDir = path.join(getChunkBaseDir(), `chunks-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });

  try {
    const { inputName, inputPath } = await writeInputAudio(workDir, fileBuffer, fileName);
    const totalSeconds = await probeDurationSeconds(inputPath);

    if (!totalSeconds || totalSeconds <= seconds) {
      return [];
    }

    const plans = planChunks(totalSeconds, seconds, overlap);
    const chunks = [];

    for (let index = 0; index < plans.length; index += 1) {
      const plan = plans[index];
      const outputName = `chunk_${String(index).padStart(4, "0")}.mp3`;

      await encodeMp3Window({
        duration: plan.duration,
        inputName,
        outputName,
        start: plan.start,
        workDir,
      });

      const buffer = await readFile(path.join(workDir, outputName));

      chunks.push({
        buffer,
        contentType: "audio/mpeg",
        end: plan.end,
        fileName: outputName,
        start: plan.start,
      });
    }

    return chunks;
  } finally {
    await rm(workDir, { force: true, recursive: true }).catch(() => {});
  }
}
