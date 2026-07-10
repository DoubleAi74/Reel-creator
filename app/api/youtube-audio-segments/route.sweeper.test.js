/**
 * REP-701 / REP-601 — sweeper is invoked from the YouTube POST route.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sweepStaleYoutubeAudioResults = vi.fn(async () => 0);

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => undefined),
  })),
}));

vi.mock("../../../lib/youtube-audio/server-config", () => ({
  getYoutubeAudioConfig: vi.fn(() => ({
    jobTtlMs: 60_000,
    maxConcurrentJobs: 2,
    maxQueuedJobs: 10,
  })),
  isYoutubeAudioConfigured: vi.fn(() => true),
}));

vi.mock("../../../lib/youtube-audio/validation", () => ({
  parseYoutubeAudioSegmentRequest: vi.fn(() => ({
    success: true,
    data: {
      endTime: 10,
      providerId: "auto",
      startTime: 0,
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    },
  })),
}));

vi.mock("../../../lib/youtube-audio/providers", () => ({
  getYoutubeAudioProviderDisplayName: vi.fn(() => "auto"),
}));

vi.mock("../../../lib/youtube-audio/job-store", () => ({
  createOrReuseJob: vi.fn(() => ({
    job: {
      id: "job-sweeper-test",
      status: "queued",
    },
    rejected: null,
    reused: false,
  })),
  getJob: vi.fn((id) => ({
    id,
    status: "queued",
    phase: "queued",
  })),
  publicJob: vi.fn((job) => ({ jobId: job.id, status: job.status })),
}));

vi.mock("../../../lib/youtube-audio/processing", () => ({
  runYoutubeAudioJobNow: vi.fn(),
  shouldRunYoutubeAudioJobsSynchronously: vi.fn(() => false),
  startBackgroundProcessing: vi.fn(),
}));

vi.mock("../../../lib/youtube-audio/ingest-completed-job", () => ({
  ingestCompletedYoutubeJob: vi.fn(),
}));

vi.mock("../../../lib/youtube-audio/storage", () => ({
  sweepStaleYoutubeAudioResults,
}));

describe("REP-601 sweeper wired into POST /api/youtube-audio-segments", () => {
  beforeEach(() => {
    sweepStaleYoutubeAudioResults.mockClear();
    sweepStaleYoutubeAudioResults.mockResolvedValue(0);
  });

  it("invokes sweepStaleYoutubeAudioResults best-effort on POST", async () => {
    const { POST } = await import("./route.js");
    const response = await POST(
      new Request("http://localhost/api/youtube-audio-segments", {
        body: JSON.stringify({
          endTime: 10,
          startTime: 0,
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    // void-fire-and-forget: allow microtask to run
    await Promise.resolve();
    expect(sweepStaleYoutubeAudioResults).toHaveBeenCalled();
  });
});
