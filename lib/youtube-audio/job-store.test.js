import { describe, expect, it, afterEach, beforeEach } from "vitest";

import {
  __resetYoutubeAudioJobsForTests,
  createOrReuseJob,
  getActiveYoutubeAudioSessionIds,
  getYoutubeAudioJobCounts,
  markJobFailed,
  publicJob,
  registerJobSession,
} from "./job-store";

const CONFIG = {
  maxQueueDepth: 2,
  maxActivePerSession: 1,
};

function baseJobInput(overrides = {}) {
  return {
    sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    startTime: 0,
    endTime: 2,
    providerId: "auto",
    providerName: "Automatic fallback",
    sessionId: "session-a",
    config: CONFIG,
    ...overrides,
  };
}

describe("youtube audio job store", () => {
  beforeEach(() => {
    __resetYoutubeAudioJobsForTests();
  });

  afterEach(() => {
    __resetYoutubeAudioJobsForTests();
  });

  it("dedupes reusable jobs and associates each requesting session", () => {
    const first = createOrReuseJob(baseJobInput());
    const second = createOrReuseJob(baseJobInput({ sessionId: "session-b" }));

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.job.id).toBe(first.job.id);
    expect(getActiveYoutubeAudioSessionIds().sort()).toEqual([
      "session-a",
      "session-b",
    ]);
  });

  it("enforces per-session active job caps", () => {
    const first = createOrReuseJob(baseJobInput());
    const second = createOrReuseJob(
      baseJobInput({
        startTime: 4,
        endTime: 7,
      }),
    );

    expect(first.job).toBeTruthy();
    expect(second).toMatchObject({
      job: null,
      reused: false,
      rejected: "RESOURCE_LIMIT_REACHED",
    });
  });

  it("enforces global queue depth caps", () => {
    createOrReuseJob(baseJobInput({ sessionId: "session-a" }));
    createOrReuseJob(
      baseJobInput({
        startTime: 4,
        endTime: 7,
        sessionId: "session-b",
      }),
    );

    const rejected = createOrReuseJob(
      baseJobInput({
        startTime: 8,
        endTime: 10,
        sessionId: "session-c",
      }),
    );

    expect(getYoutubeAudioJobCounts()).toEqual({
      active: 2,
      activeForSession: 0,
    });
    expect(rejected.rejected).toBe("RESOURCE_LIMIT_REACHED");
  });

  it("registers a session against an existing job", () => {
    const { job } = createOrReuseJob(baseJobInput({ sessionId: null }));

    registerJobSession(job.id, "session-c");

    expect(getActiveYoutubeAudioSessionIds()).toEqual(["session-c"]);
  });

  it("surfaces errorCode and errorMessage on failed public jobs", () => {
    const { job } = createOrReuseJob(baseJobInput());

    markJobFailed(
      job.id,
      "FFMPEG_MISSING",
      "Audio binary not found (ffprobe). Install ffmpeg/ffprobe.",
    );

    expect(publicJob(job)).toMatchObject({
      status: "failed",
      phase: "failed",
      errorCode: "FFMPEG_MISSING",
      errorMessage: "Audio binary not found (ffprobe). Install ffmpeg/ffprobe.",
    });
  });
});
