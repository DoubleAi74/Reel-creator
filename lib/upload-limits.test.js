import { afterEach, describe, expect, it } from "vitest";

import {
  getMaxBackgroundVideoR2Bytes,
  getMaxVideoBytes,
  getVideoUploadRejectionMessage,
  isAllowedVideoFileName,
  isAllowedVideoMimeType,
} from "./upload-limits.js";

const ORIGINAL = {
  MAX_BACKGROUND_VIDEO_MB: process.env.MAX_BACKGROUND_VIDEO_MB,
  MAX_VIDEO_MB: process.env.MAX_VIDEO_MB,
  NEXT_PUBLIC_MAX_VIDEO_MB: process.env.NEXT_PUBLIC_MAX_VIDEO_MB,
  VERCEL: process.env.VERCEL,
};

afterEach(() => {
  if (ORIGINAL.MAX_VIDEO_MB == null) delete process.env.MAX_VIDEO_MB;
  else process.env.MAX_VIDEO_MB = ORIGINAL.MAX_VIDEO_MB;
  if (ORIGINAL.NEXT_PUBLIC_MAX_VIDEO_MB == null) {
    delete process.env.NEXT_PUBLIC_MAX_VIDEO_MB;
  } else {
    process.env.NEXT_PUBLIC_MAX_VIDEO_MB = ORIGINAL.NEXT_PUBLIC_MAX_VIDEO_MB;
  }
  if (ORIGINAL.MAX_BACKGROUND_VIDEO_MB == null) {
    delete process.env.MAX_BACKGROUND_VIDEO_MB;
  } else {
    process.env.MAX_BACKGROUND_VIDEO_MB = ORIGINAL.MAX_BACKGROUND_VIDEO_MB;
  }
  if (ORIGINAL.VERCEL == null) delete process.env.VERCEL;
  else process.env.VERCEL = ORIGINAL.VERCEL;
});

describe("upload-limits video", () => {
  it("accepts mobile QuickTime MIME and mov extension", () => {
    expect(isAllowedVideoMimeType("video/quicktime")).toBe(true);
    expect(isAllowedVideoFileName("IMG_1234.MOV")).toBe(true);
    expect(isAllowedVideoFileName("clip.mp4")).toBe(true);
    expect(isAllowedVideoFileName("clip.avi")).toBe(false);
  });

  it("defaults to a Vercel-safe video size when VERCEL=1", () => {
    delete process.env.MAX_VIDEO_MB;
    delete process.env.NEXT_PUBLIC_MAX_VIDEO_MB;
    process.env.VERCEL = "1";
    expect(getMaxVideoBytes()).toBe(4 * 1024 * 1024);
  });

  it("rejects oversized videos with a clear message", () => {
    process.env.VERCEL = "1";
    delete process.env.MAX_VIDEO_MB;
    const big = {
      name: "big.mp4",
      size: 8 * 1024 * 1024,
      type: "video/mp4",
    };
    expect(getVideoUploadRejectionMessage(big)).toMatch(/too large/i);
  });

  it("allows a small iPhone-style quicktime clip", () => {
    process.env.VERCEL = "1";
    const clip = {
      name: "IMG_0001.MOV",
      size: 1.5 * 1024 * 1024,
      type: "video/quicktime",
    };
    expect(getVideoUploadRejectionMessage(clip)).toBeNull();
  });

  it("allows larger clips in R2 mode up to 80 MB default", () => {
    delete process.env.MAX_BACKGROUND_VIDEO_MB;
    process.env.VERCEL = "1";
    delete process.env.MAX_VIDEO_MB;
    expect(getMaxBackgroundVideoR2Bytes()).toBe(80 * 1024 * 1024);

    const clip = {
      name: "long.mp4",
      size: 40 * 1024 * 1024,
      type: "video/mp4",
    };
    expect(getVideoUploadRejectionMessage(clip, { r2Mode: true })).toBeNull();
    expect(getVideoUploadRejectionMessage(clip, { r2Mode: false })).toMatch(
      /too large/i,
    );
  });
});
