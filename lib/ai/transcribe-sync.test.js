import { afterEach, describe, expect, it } from "vitest";

import { shouldRunTranscribeJobsSynchronously } from "./transcribe-job.js";

const ORIGINAL = {
  VERCEL: process.env.VERCEL,
  TRANSCRIBE_SYNC: process.env.TRANSCRIBE_SYNC,
};

afterEach(() => {
  if (ORIGINAL.VERCEL == null) delete process.env.VERCEL;
  else process.env.VERCEL = ORIGINAL.VERCEL;
  if (ORIGINAL.TRANSCRIBE_SYNC == null) delete process.env.TRANSCRIBE_SYNC;
  else process.env.TRANSCRIBE_SYNC = ORIGINAL.TRANSCRIBE_SYNC;
});

describe("shouldRunTranscribeJobsSynchronously", () => {
  it("defaults to sync on Vercel", () => {
    delete process.env.TRANSCRIBE_SYNC;
    process.env.VERCEL = "1";
    expect(shouldRunTranscribeJobsSynchronously()).toBe(true);
  });

  it("defaults to async off Vercel", () => {
    delete process.env.TRANSCRIBE_SYNC;
    delete process.env.VERCEL;
    expect(shouldRunTranscribeJobsSynchronously()).toBe(false);
  });

  it("respects TRANSCRIBE_SYNC override", () => {
    process.env.VERCEL = "1";
    process.env.TRANSCRIBE_SYNC = "0";
    expect(shouldRunTranscribeJobsSynchronously()).toBe(false);

    delete process.env.VERCEL;
    process.env.TRANSCRIBE_SYNC = "true";
    expect(shouldRunTranscribeJobsSynchronously()).toBe(true);
  });
});
