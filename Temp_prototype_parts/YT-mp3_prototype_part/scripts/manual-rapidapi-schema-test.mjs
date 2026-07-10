import nextEnv from "@next/env";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const RAPIDAPI_HOST =
  process.env.RAPIDAPI_YOUTUBE_MP3_HOST || "youtube-to-mp315.p.rapidapi.com";
const RAPIDAPI_KEY = process.env.RAPIDAPI_YOUTUBE_MP3_KEY;
const API_BASE_URL = `https://${RAPIDAPI_HOST}`;
const FIXTURE_DIR = path.join(process.cwd(), "test", "fixtures");
const TEST_URL =
  process.env.YT_MP3_TEST_URL ||
  "https://www.youtube.com/watch?v=aqz-KE-bpKQ";
const START_TIME = Number(process.env.YT_MP3_TEST_START || 30);
const END_TIME = Number(process.env.YT_MP3_TEST_END || 35);

if (!RAPIDAPI_KEY || !RAPIDAPI_KEY.trim()) {
  throw new Error("Missing RAPIDAPI_YOUTUBE_MP3_KEY in .env.local");
}

function headers(includeJson = false) {
  return {
    ...(includeJson ? { "Content-Type": "application/json" } : {}),
    "X-RapidAPI-Key": RAPIDAPI_KEY,
    "X-RapidAPI-Host": RAPIDAPI_HOST,
  };
}

async function readJsonResponse(response) {
  const text = await response.text();

  let body;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { unparsedBody: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

function looksLikeUrl(value) {
  return (
    typeof value === "string" &&
    /^https?:\/\//i.test(value) &&
    !/youtube\.com|youtu\.be/i.test(value)
  );
}

function sanitize(value) {
  if (Array.isArray(value)) {
    return value.map(sanitize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        const lowered = key.toLowerCase();
        const shouldRedact =
          lowered.includes("url") ||
          lowered.includes("link") ||
          lowered.includes("href") ||
          lowered.includes("token") ||
          lowered.includes("signature");

        if (shouldRedact && typeof entry === "string") {
          return [key, "REDACTED"];
        }

        if (looksLikeUrl(entry)) {
          return [key, "REDACTED"];
        }

        return [key, sanitize(entry)];
      }),
    );
  }

  return value;
}

function findString(value, preferredKeys, pathParts = []) {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const result = findString(value[index], preferredKeys, [
        ...pathParts,
        String(index),
      ]);

      if (result) {
        return result;
      }
    }

    return null;
  }

  for (const key of preferredKeys) {
    const candidate = value[key];

    if (typeof candidate === "string" && candidate.trim()) {
      return {
        path: [...pathParts, key].join("."),
        value: candidate,
      };
    }
  }

  for (const [key, entry] of Object.entries(value)) {
    const result = findString(entry, preferredKeys, [...pathParts, key]);

    if (result) {
      return result;
    }
  }

  return null;
}

function findUrl(value, pathParts = []) {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const result = findUrl(value[index], [...pathParts, String(index)]);

      if (result) {
        return result;
      }
    }

    return null;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" && /^https?:\/\//i.test(entry)) {
      return {
        path: [...pathParts, key].join("."),
        value: entry,
      };
    }
  }

  for (const [key, entry] of Object.entries(value)) {
    const result = findUrl(entry, [...pathParts, key]);

    if (result) {
      return result;
    }
  }

  return null;
}

function hostnameFromUrl(value) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function classifyStatus(body) {
  const status = findString(body, [
    "status",
    "state",
    "phase",
    "conversionStatus",
    "conversion_status",
  ]);
  const normalized = status?.value.toLowerCase() || "";
  const downloadUrl = findUrl(body);

  if (
    downloadUrl ||
    ["done", "completed", "complete", "success", "finished"].includes(
      normalized,
    )
  ) {
    return {
      state: "complete",
      statusField: status?.path || null,
      statusValue: status?.value || null,
      downloadUrlField: downloadUrl?.path || null,
      downloadUrl: downloadUrl?.value || null,
    };
  }

  if (["failed", "error", "cancelled", "canceled"].includes(normalized)) {
    return {
      state: "failed",
      statusField: status?.path || null,
      statusValue: status?.value || null,
      downloadUrlField: downloadUrl?.path || null,
      downloadUrl: null,
    };
  }

  if (["queued", "pending", "waiting", "created"].includes(normalized)) {
    return {
      state: "queued",
      statusField: status?.path || null,
      statusValue: status?.value || null,
      downloadUrlField: downloadUrl?.path || null,
      downloadUrl: null,
    };
  }

  if (
    ["processing", "running", "converting", "downloading"].includes(normalized)
  ) {
    return {
      state: "processing",
      statusField: status?.path || null,
      statusValue: status?.value || null,
      downloadUrlField: downloadUrl?.path || null,
      downloadUrl: null,
    };
  }

  return {
    state: "unknown",
    statusField: status?.path || null,
    statusValue: status?.value || null,
    downloadUrlField: downloadUrl?.path || null,
    downloadUrl: null,
  };
}

async function saveFixture(name, body) {
  await mkdir(FIXTURE_DIR, { recursive: true });
  await writeFile(
    path.join(FIXTURE_DIR, name),
    `${JSON.stringify(sanitize(body), null, 2)}\n`,
  );
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const downloadUrl = new URL(`${API_BASE_URL}/download`);
downloadUrl.searchParams.set("url", TEST_URL);
downloadUrl.searchParams.set("format", "mp3");
downloadUrl.searchParams.set("startTime", String(START_TIME));
downloadUrl.searchParams.set("endTime", String(END_TIME));

console.log(
  `Manual schema test: POST /download query params for ${START_TIME}-${END_TIME}s, host ${RAPIDAPI_HOST}`,
);

const startResponse = await fetch(downloadUrl, {
  method: "POST",
  headers: headers(false),
  signal: AbortSignal.timeout(20000),
});

const start = await readJsonResponse(startResponse);
await saveFixture("rapidapi-youtube-mp3-start.json", start.body);

if (!start.ok) {
  throw new Error(`Provider /download returned HTTP ${start.status}`);
}

const job = findString(start.body, [
  "id",
  "jobId",
  "job_id",
  "conversionId",
  "conversion_id",
  "taskId",
  "task_id",
]);

if (!job) {
  throw new Error("No recognizable provider job ID in /download response");
}

let firstProcessing = null;
let finalComplete = null;
let finalStatus = null;

for (let attempt = 1; attempt <= 45; attempt += 1) {
  await delay(attempt === 1 ? 1000 : 2500);

  const statusResponse = await fetch(
    `${API_BASE_URL}/status/${encodeURIComponent(job.value)}`,
    {
      method: "GET",
      headers: headers(false),
      signal: AbortSignal.timeout(20000),
    },
  );
  const status = await readJsonResponse(statusResponse);
  const classification = classifyStatus(status.body);

  if (!status.ok) {
    finalStatus = {
      attempt,
      httpStatus: status.status,
      classification,
    };
    await saveFixture("rapidapi-youtube-mp3-error.json", status.body);
    throw new Error(`Provider /status returned HTTP ${status.status}`);
  }

  if (!firstProcessing && classification.state !== "complete") {
    firstProcessing = {
      attempt,
      body: status.body,
      classification,
    };
    await saveFixture("rapidapi-youtube-mp3-processing.json", status.body);
  }

  if (classification.state === "complete") {
    finalComplete = {
      attempt,
      body: status.body,
      classification,
    };
    await saveFixture("rapidapi-youtube-mp3-complete.json", status.body);
    break;
  }

  if (classification.state === "failed") {
    finalStatus = {
      attempt,
      httpStatus: status.status,
      classification,
    };
    await saveFixture("rapidapi-youtube-mp3-error.json", status.body);
    throw new Error("Provider reported conversion failure");
  }
}

if (!finalComplete) {
  throw new Error("Timed out waiting for provider completion");
}

const summary = {
  startedAt: new Date().toISOString(),
  request: {
    host: RAPIDAPI_HOST,
    transport: "POST /download query parameters",
    format: "mp3",
    startTime: START_TIME,
    endTime: END_TIME,
  },
  startResponse: {
    jobIdField: job.path,
  },
  processingResponse: firstProcessing
    ? {
        observed: true,
        attempt: firstProcessing.attempt,
        statusField: firstProcessing.classification.statusField,
        statusValue: firstProcessing.classification.statusValue,
      }
    : {
        observed: false,
      },
  completeResponse: {
    attempt: finalComplete.attempt,
    statusField: finalComplete.classification.statusField,
    statusValue: finalComplete.classification.statusValue,
    downloadUrlField: finalComplete.classification.downloadUrlField,
    downloadUrlHost: hostnameFromUrl(finalComplete.classification.downloadUrl),
  },
  finalStatus,
};

await writeFile(
  path.join(FIXTURE_DIR, "rapidapi-youtube-mp3-schema-summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);

console.log(JSON.stringify(summary, null, 2));
