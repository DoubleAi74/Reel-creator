import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/youtube-audio/config", () => {
  it("returns disabled when the RapidAPI key is absent", async () => {
    const originalKey = process.env.RAPIDAPI_YOUTUBE_MP3_KEY;
    delete process.env.RAPIDAPI_YOUTUBE_MP3_KEY;

    try {
      const response = await GET();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ enabled: false });
    } finally {
      if (originalKey === undefined) {
        delete process.env.RAPIDAPI_YOUTUBE_MP3_KEY;
      } else {
        process.env.RAPIDAPI_YOUTUBE_MP3_KEY = originalKey;
      }
    }
  });
});
