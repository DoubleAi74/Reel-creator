import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const sampleProjectPath = path.join(rootDir, "samples", "aaj-se-teri.json");
const sampleAudioPath = path.join(
  rootDir,
  "samples",
  "Aaj-Se-Teri-Lyrical-Padman-Aksha.mp3",
);
const defaultOutDir = path.join(rootDir, ".timing-runs");
const defaultWordsPath = path.join(rootDir, "samples", "aaj-se-teri.words.json");

function readFlag(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return fallback;
  }
  return process.argv[index + 1] ?? fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function stableLineId(index) {
  return `aaj-se-teri-${String(index + 1).padStart(2, "0")}`;
}

function parseSetCookie(setCookie) {
  if (!setCookie) {
    return "";
  }
  return setCookie
    .split(",")
    .map((entry) => entry.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function parseStreamEvent(block) {
  const event = {
    data: "",
    event: "message",
  };

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      event.event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      event.data += line.slice("data:".length).trim();
    }
  }

  return {
    data: event.data ? JSON.parse(event.data) : null,
    event: event.event,
  };
}

async function readCompleteStreamPayload(response) {
  const text = await response.text();
  let completePayload = null;

  for (const block of text.split(/\n\n+/)) {
    if (!block.trim()) {
      continue;
    }

    const event = parseStreamEvent(block);

    if (event.event === "complete") {
      completePayload = event.data;
    } else if (event.event === "error") {
      throw new Error(event.data?.message ?? "Unified timing route failed.");
    }
  }

  if (!completePayload) {
    throw new Error("Unified timing route finished without a complete event.");
  }

  return completePayload;
}

async function uploadAudio(baseUrl) {
  const audioBuffer = await readFile(sampleAudioPath);
  const formData = new FormData();
  formData.append(
    "file",
    new File([audioBuffer], path.basename(sampleAudioPath), { type: "audio/mpeg" }),
  );
  formData.append("kind", "audio");

  const response = await fetch(`${baseUrl}/api/upload`, {
    body: formData,
    method: "POST",
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error ?? `Upload failed with HTTP ${response.status}`);
  }

  return {
    cookie: parseSetCookie(response.headers.get("set-cookie")),
    payload,
  };
}

async function runAutoTime({ baseUrl, cookie, project, uploadPayload }) {
  const lines = project.lines.map((line, index) => ({
    id: stableLineId(index),
    original: String(line?.original ?? "").trim(),
  }));
  const response = await fetch(`${baseUrl}/api/ai/transcribe`, {
    body: JSON.stringify({
      audio: {
        ...(project.audio ?? {}),
        duration: Number.isFinite(uploadPayload.durationSec)
          ? uploadPayload.durationSec
          : Number(project.audio?.duration ?? 0),
      },
      audioAssetId: uploadPayload.assetId,
      includeRomanization: false,
      lines,
      otherLanguage: "",
      sourceLanguage: readFlag("source-language", "hi"),
    }),
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    method: "POST",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? `Auto-time failed with HTTP ${response.status}`);
  }

  return readCompleteStreamPayload(response);
}

async function main() {
  const baseUrl = readFlag("base-url", "http://127.0.0.1:3000").replace(/\/$/, "");
  const count = Math.max(1, Number.parseInt(readFlag("count", "1"), 10) || 1);
  const outDir = path.resolve(readFlag("out-dir", defaultOutDir));
  const wordsPath = path.resolve(readFlag("words-out", defaultWordsPath));
  const project = await readJson(sampleProjectPath);

  await mkdir(outDir, { recursive: true });

  console.log(`Uploading ${path.relative(rootDir, sampleAudioPath)} to ${baseUrl}`);
  const upload = await uploadAudio(baseUrl);
  console.log(`Uploaded asset ${upload.payload.assetId}`);

  let latestResult = null;
  for (let runIndex = 0; runIndex < count; runIndex += 1) {
    const startedAt = new Date();
    console.log(`Run ${runIndex + 1}/${count}: POST /api/ai/transcribe`);
    const result = await runAutoTime({
      baseUrl,
      cookie: upload.cookie,
      project,
      uploadPayload: upload.payload,
    });
    const capturedAt = new Date().toISOString();
    const fileName = `auto-time-${capturedAt.replace(/[:.]/g, "-")}.json`;
    const capture = {
      audio: path.relative(rootDir, sampleAudioPath),
      baseUrl,
      capturedAt,
      durationMs: Date.now() - startedAt.getTime(),
      lineCount: project.lines.length,
      request: {
        sourceLanguage: readFlag("source-language", "hi"),
      },
      result,
      upload: upload.payload,
    };
    const outPath = path.join(outDir, fileName);

    await writeFile(outPath, JSON.stringify(capture, null, 2) + "\n", "utf8");
    latestResult = result;

    console.log(
      `Wrote ${path.relative(rootDir, outPath)}: ` +
        `${result.timingSummary?.matchedCount ?? result.lines?.length ?? 0}/` +
        `${result.timingSummary?.lineCount ?? project.lines.length} matched, ` +
        `${result.words?.length ?? 0} words`,
    );
  }

  if (latestResult?.words?.length && !hasFlag("no-words-out")) {
    await writeFile(wordsPath, JSON.stringify(latestResult.words, null, 2) + "\n", "utf8");
    console.log(`Wrote ${path.relative(rootDir, wordsPath)} (${latestResult.words.length} words)`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
