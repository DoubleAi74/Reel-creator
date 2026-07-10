import { afterEach, describe, expect, it } from "vitest";

import { shouldRunYoutubeAudioJobsSynchronously } from "./processing.js";

const ORIGINAL = {
  VERCEL: process.env.VERCEL,
  YT_AUDIO_SYNC: process.env.YT_AUDIO_SYNC,
};

afterEach(() => {
  if (ORIGINAL.VERCEL == null) delete process.env.VERCEL;
  else process.env.VERCEL = ORIGINAL.VERCEL;
  if (ORIGINAL.YT_AUDIO_SYNC == null) delete process.env.YT_AUDIO_SYNC;
  else process.env.YT_AUDIO_SYNC = ORIGINAL.YT_AUDIO_SYNC;
});

describe("shouldRunYoutubeAudioJobsSynchronously", () => {
  it("defaults to sync on Vercel", () => {
    delete process.env.YT_AUDIO_SYNC;
    process.env.VERCEL = "1";
    expect(shouldRunYoutubeAudioJobsSynchronously()).toBe(true);
  });

  it("defaults to async off Vercel", () => {
    delete process.env.YT_AUDIO_SYNC;
    delete process.env.VERCEL;
    expect(shouldRunYoutubeAudioJobsSynchronously()).toBe(false);
  });

  it("respects YT_AUDIO_SYNC override", () => {
    process.env.VERCEL = "1";
    process.env.YT_AUDIO_SYNC = "0";
    expect(shouldRunYoutubeAudioJobsSynchronously()).toBe(false);

    delete process.env.VERCEL;
    process.env.YT_AUDIO_SYNC = "true";
    expect(shouldRunYoutubeAudioJobsSynchronously()).toBe(true);
  });
});
