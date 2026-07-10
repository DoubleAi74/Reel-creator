import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";

import {
  __resetYoutubeAudioJobsForTests,
  createOrReuseJob,
  markJobStored,
} from "../../../lib/youtube-audio/job-store";

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

describe("POST /api/cleanup", () => {
  beforeEach(() => {
    cookieSessionId = "cleanup-session";
    __resetYoutubeAudioJobsForTests();
  });

  afterEach(() => {
    cookieSessionId = null;
    __resetYoutubeAudioJobsForTests();
  });

  it("rejects cleanup while a YouTube audio job is active for the session", async () => {
    const { POST } = await import("./route");
    createOrReuseJob({
      sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      startTime: 0,
      endTime: 2,
      providerId: "auto",
      providerName: "Automatic fallback",
      sessionId: cookieSessionId,
      config: {
        maxQueueDepth: 20,
        maxActivePerSession: 2,
      },
    });

    const response = await POST(
      new Request("http://localhost/api/cleanup", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("YouTube audio import"),
    });
  });

  it("does not reject cleanup after the YouTube audio job is complete", async () => {
    const { POST } = await import("./route");
    const { job } = createOrReuseJob({
      sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      startTime: 0,
      endTime: 2,
      providerId: "auto",
      providerName: "Automatic fallback",
      sessionId: cookieSessionId,
      config: {
        maxQueueDepth: 20,
        maxActivePerSession: 2,
      },
    });
    markJobStored(job.id, {
      storedAssetPath: null,
      storedAssetContentType: null,
      outputDurationSec: 2,
    });

    const response = await POST(
      new Request("http://localhost/api/cleanup", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
