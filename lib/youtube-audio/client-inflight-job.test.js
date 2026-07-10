import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearInflightYoutubeAudioJob,
  inflightMatchesSourceUrl,
  loadInflightYoutubeAudioJob,
  saveInflightYoutubeAudioJob,
  YT_AUDIO_INFLIGHT_MAX_AGE_MS,
  YT_AUDIO_INFLIGHT_STORAGE_KEY,
} from "./client-inflight-job.js";

describe("client inflight youtube audio job", () => {
  let store;

  beforeEach(() => {
    store = new Map();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => {
          store.set(key, String(value));
        },
        removeItem: (key) => {
          store.delete(key);
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves loads and clears inflight jobs", () => {
    expect(
      saveInflightYoutubeAudioJob({
        jobId: " job-1 ",
        sourceUrl: " https://youtu.be/abc ",
        startedAt: 1_000,
      }),
    ).toBe(true);

    expect(loadInflightYoutubeAudioJob({ now: 2_000 })).toEqual({
      jobId: "job-1",
      sourceUrl: "https://youtu.be/abc",
      startedAt: 1_000,
    });

    clearInflightYoutubeAudioJob();
    expect(loadInflightYoutubeAudioJob({ now: 2_000 })).toBeNull();
    expect(store.has(YT_AUDIO_INFLIGHT_STORAGE_KEY)).toBe(false);
  });

  it("clears corrupt JSON and expired jobs", () => {
    store.set(YT_AUDIO_INFLIGHT_STORAGE_KEY, "{not-json");
    expect(loadInflightYoutubeAudioJob({ now: 1 })).toBeNull();

    saveInflightYoutubeAudioJob({
      jobId: "job-old",
      sourceUrl: "https://youtu.be/old",
      startedAt: 10,
    });
    expect(
      loadInflightYoutubeAudioJob({
        now: 10 + YT_AUDIO_INFLIGHT_MAX_AGE_MS + 1,
      }),
    ).toBeNull();
  });

  it("matches source URLs strictly by trimmed equality", () => {
    expect(
      inflightMatchesSourceUrl(
        { jobId: "j", sourceUrl: "https://youtu.be/a" },
        " https://youtu.be/a ",
      ),
    ).toBe(true);
    expect(
      inflightMatchesSourceUrl(
        { jobId: "j", sourceUrl: "https://youtu.be/a" },
        "https://youtu.be/b",
      ),
    ).toBe(false);
  });
});
