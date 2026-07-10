import { afterEach, describe, expect, it } from "vitest";

import { shouldEmbedYoutubeAssetBytes } from "./ingest-completed-job.js";

const ORIGINAL = {
  VERCEL: process.env.VERCEL,
  YT_AUDIO_EMBED_BYTES: process.env.YT_AUDIO_EMBED_BYTES,
};

afterEach(() => {
  if (ORIGINAL.VERCEL == null) delete process.env.VERCEL;
  else process.env.VERCEL = ORIGINAL.VERCEL;
  if (ORIGINAL.YT_AUDIO_EMBED_BYTES == null) delete process.env.YT_AUDIO_EMBED_BYTES;
  else process.env.YT_AUDIO_EMBED_BYTES = ORIGINAL.YT_AUDIO_EMBED_BYTES;
});

describe("shouldEmbedYoutubeAssetBytes", () => {
  it("embeds by default on Vercel", () => {
    delete process.env.YT_AUDIO_EMBED_BYTES;
    process.env.VERCEL = "1";
    expect(shouldEmbedYoutubeAssetBytes()).toBe(true);
  });

  it("does not embed by default off Vercel", () => {
    delete process.env.YT_AUDIO_EMBED_BYTES;
    delete process.env.VERCEL;
    expect(shouldEmbedYoutubeAssetBytes()).toBe(false);
  });

  it("respects YT_AUDIO_EMBED_BYTES override", () => {
    process.env.VERCEL = "1";
    process.env.YT_AUDIO_EMBED_BYTES = "0";
    expect(shouldEmbedYoutubeAssetBytes()).toBe(false);

    delete process.env.VERCEL;
    process.env.YT_AUDIO_EMBED_BYTES = "true";
    expect(shouldEmbedYoutubeAssetBytes()).toBe(true);
  });
});
