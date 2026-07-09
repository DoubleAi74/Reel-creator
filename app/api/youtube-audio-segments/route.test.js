import { execFile } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAssetFilePath,
  readAssetMetadata,
  SESSION_COOKIE_NAME,
} from "../../../lib/files";
import {
  __resetYoutubeAudioJobsForTests,
  getJob,
} from "../../../lib/youtube-audio/job-store";
import { __resetYoutubeAudioProcessorForTests } from "../../../lib/youtube-audio/processing";

let cookieSessionId = null;

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn((name) =>
      name === "reel-creator-session" && cookieSessionId
        ? { value: cookieSessionId }
        : undefined,
    ),
  })),
}));

const execFileAsync = promisify(execFile);
const ORIGINAL_ENV = {
  RAPIDAPI_YOUTUBE_MP3_KEY: process.env.RAPIDAPI_YOUTUBE_MP3_KEY,
  TMP_DIR: process.env.TMP_DIR,
  YT_MP3_TMP_DIR: process.env.YT_MP3_TMP_DIR,
};

describe("POST /api/youtube-audio-segments", () => {
  let tempDir = "";
  let mp3Fixture = null;
  let originalFetch;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `yt-route-${crypto.randomUUID()}`);
    await mkdir(tempDir, { recursive: true });
    const fixturePath = path.join(tempDir, "fixture.mp3");
    await execFileAsync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=mono",
      "-t",
      "2",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "128k",
      fixturePath,
    ]);
    mp3Fixture = await readFile(fixturePath);
    originalFetch = global.fetch;
    process.env.RAPIDAPI_YOUTUBE_MP3_KEY = "test-key";
    process.env.TMP_DIR = path.join(tempDir, "session-assets");
    process.env.YT_MP3_TMP_DIR = path.join(tempDir, "yt-results");
    cookieSessionId = null;
    __resetYoutubeAudioJobsForTests();
    __resetYoutubeAudioProcessorForTests();
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    __resetYoutubeAudioProcessorForTests();
    __resetYoutubeAudioJobsForTests();
    await rm(tempDir, { recursive: true, force: true });
    restoreEnv();
    cookieSessionId = null;
  });

  it("creates a session-aware job and processes it to a temp MP3", async () => {
    const { POST } = await import("./route");
    const { GET } = await import("./[jobId]/route");
    global.fetch = vi.fn(async (input) => {
      const url = String(input);

      if (url.includes("youtube-mp36.p.rapidapi.com")) {
        return new Response(
          JSON.stringify({
            status: "ok",
            title: "Fixture Track",
            link: "https://example.com/audio.mp3",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (url === "https://example.com/audio.mp3") {
        return new Response(mp3Fixture, {
          status: 200,
          headers: {
            "content-type": "audio/mpeg",
            "content-length": String(mp3Fixture.length),
          },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const response = await POST(
      new Request("http://localhost/api/youtube-audio-segments", {
        method: "POST",
        body: JSON.stringify({
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          startTime: 0,
          endTime: 2,
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain(SESSION_COOKIE_NAME);
    expect(["queued", "processing"]).toContain(body.status);
    expect(body.providerId).toBe("auto");
    cookieSessionId = setCookie.match(/reel-creator-session=([^;]+)/)?.[1] || null;
    expect(cookieSessionId).toBeTruthy();

    const completed = await waitForComplete(body.jobId);
    expect(completed).toMatchObject({
      status: "complete",
      outputDurationSec: expect.any(Number),
      storedAssetContentType: "audio/mpeg",
    });
    expect(completed.outputDurationSec).toBeGreaterThan(0);

    const statusResponse = await GET(new Request("http://localhost/status"), {
      params: Promise.resolve({ jobId: body.jobId }),
    });
    const statusBody = await statusResponse.json();

    expect(statusBody).toMatchObject({
      jobId: body.jobId,
      status: "complete",
      outputDurationSec: expect.any(Number),
      finalProviderId: "youtube-mp36",
      asset: {
        assetId: expect.any(String),
        durationSec: expect.any(Number),
        kind: "audio",
        name: "Fixture Track.mp3",
        sizeBytes: mp3Fixture.length,
      },
    });

    await expect(readAssetMetadata(cookieSessionId, statusBody.asset.assetId)).resolves.toMatchObject(
      {
        assetId: statusBody.asset.assetId,
        durationSec: statusBody.asset.durationSec,
        kind: "audio",
        mimeType: "audio/mpeg",
        name: "Fixture Track.mp3",
      },
    );
    await expect(
      readFile(await getAssetFilePath(cookieSessionId, statusBody.asset.assetId)),
    ).resolves.toEqual(mp3Fixture);

    const secondStatusResponse = await GET(new Request("http://localhost/status"), {
      params: Promise.resolve({ jobId: body.jobId }),
    });
    const secondStatusBody = await secondStatusResponse.json();

    expect(secondStatusBody.asset.assetId).toBe(statusBody.asset.assetId);
  });

  it("returns FEATURE_DISABLED when no provider key is configured", async () => {
    const { POST } = await import("./route");
    delete process.env.RAPIDAPI_YOUTUBE_MP3_KEY;

    const response = await POST(
      new Request("http://localhost/api/youtube-audio-segments", {
        method: "POST",
        body: JSON.stringify({
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          startTime: 0,
          endTime: 2,
        }),
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "failed",
      errorCode: "FEATURE_DISABLED",
    });
  });
});

async function waitForComplete(jobId) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const job = getJob(jobId);

    if (job?.status === "complete") {
      return job;
    }

    if (job?.status === "failed") {
      throw new Error(`Job failed with ${job.errorCode}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error("Timed out waiting for YouTube audio job completion");
}

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
