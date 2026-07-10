import { describe, expect, it } from "vitest";

import {
  getAudioBinaryCommands,
  looksLikeMp3,
} from "./audio-ffmpeg";
import {
  parseYoutubeAudioSegmentRequest,
  MAX_SEGMENT_SECONDS,
  MIN_SEGMENT_SECONDS,
} from "./validation";
import { providerFormatAttempts, providerPlanForInput } from "./provider-runner";
import { isYoutubeAudioConfigured } from "./server-config";
import { extractYouTubeVideoId } from "./youtube-url";

describe("youtube audio Stage 0 scaffold", () => {
  it("extracts supported YouTube URL shapes", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(extractYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(extractYouTubeVideoId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(extractYouTubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });

  it("validates the allowed segment bounds without zod", () => {
    expect(
      parseYoutubeAudioSegmentRequest({
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        startTime: 5,
        endTime: 5 + MIN_SEGMENT_SECONDS,
      }),
    ).toMatchObject({ success: true });

    expect(
      parseYoutubeAudioSegmentRequest({
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        startTime: 0,
        endTime: MAX_SEGMENT_SECONDS,
      }),
    ).toMatchObject({ success: true });

    expect(
      parseYoutubeAudioSegmentRequest({
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        startTime: 0,
        endTime: MAX_SEGMENT_SECONDS + 0.001,
      }),
    ).toMatchObject({ success: false, errorCode: "SEGMENT_TOO_LONG" });

    expect(
      parseYoutubeAudioSegmentRequest({
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        startTime: 4,
        endTime: 4.5,
      }),
    ).toMatchObject({ success: false, errorCode: "INVALID_INPUT" });
  });

  it("keeps automatic provider fallback and active local trim formats", () => {
    const originalVercel = process.env.VERCEL;
    const originalNoFfmpeg = process.env.YT_AUDIO_NO_FFMPEG;
    delete process.env.VERCEL;
    delete process.env.YT_AUDIO_NO_FFMPEG;

    try {
      expect(providerPlanForInput({ providerId: "auto" })).toEqual([
        "youtube-mp36",
        "youtube-mp3-2025",
      ]);
      expect(providerFormatAttempts({ providerId: "youtube-mp36" })).toEqual([
        { preferredFormat: null },
      ]);
      expect(providerFormatAttempts({ providerId: "youtube-mp3-2025" })).toEqual([
        { preferredFormat: "mp3" },
        { preferredFormat: "m4a" },
      ]);
    } finally {
      if (originalVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = originalVercel;
      if (originalNoFfmpeg === undefined) delete process.env.YT_AUDIO_NO_FFMPEG;
      else process.env.YT_AUDIO_NO_FFMPEG = originalNoFfmpeg;
    }
  });

  it("drops local-trim providers when local ffmpeg is unavailable (Vercel)", () => {
    const originalVercel = process.env.VERCEL;
    const originalFfmpeg = process.env.FFMPEG_PATH;
    const originalFfprobe = process.env.FFPROBE_PATH;
    const originalNoFfmpeg = process.env.YT_AUDIO_NO_FFMPEG;
    process.env.VERCEL = "1";
    delete process.env.FFMPEG_PATH;
    delete process.env.FFPROBE_PATH;
    delete process.env.YT_AUDIO_NO_FFMPEG;

    try {
      expect(providerPlanForInput({ providerId: "auto" })).toEqual(["youtube-mp36"]);
      expect(providerPlanForInput({ providerId: "youtube-mp3-2025" })).toEqual([]);
    } finally {
      if (originalVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = originalVercel;
      if (originalFfmpeg === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = originalFfmpeg;
      if (originalFfprobe === undefined) delete process.env.FFPROBE_PATH;
      else process.env.FFPROBE_PATH = originalFfprobe;
      if (originalNoFfmpeg === undefined) delete process.env.YT_AUDIO_NO_FFMPEG;
      else process.env.YT_AUDIO_NO_FFMPEG = originalNoFfmpeg;
    }
  });

  it("uses system ffmpeg and ffprobe commands by default", () => {
    const originalFfmpeg = process.env.FFMPEG_PATH;
    const originalFfprobe = process.env.FFPROBE_PATH;
    delete process.env.FFMPEG_PATH;
    delete process.env.FFPROBE_PATH;

    try {
      expect(getAudioBinaryCommands()).toEqual({
        ffmpeg: "ffmpeg",
        ffprobe: "ffprobe",
      });
    } finally {
      if (originalFfmpeg === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = originalFfmpeg;
      if (originalFfprobe === undefined) delete process.env.FFPROBE_PATH;
      else process.env.FFPROBE_PATH = originalFfprobe;
    }
  });

  it("detects provider MP3 media for serverless passthrough", () => {
    expect(looksLikeMp3({ mediaFormat: "mp3" })).toBe(true);
    expect(looksLikeMp3({ contentType: "audio/mpeg" })).toBe(true);
    expect(looksLikeMp3({ mediaFormat: "m4a" })).toBe(false);
  });

  it("reports disabled config when the server key is absent", () => {
    const originalKey = process.env.RAPIDAPI_YOUTUBE_MP3_KEY;
    delete process.env.RAPIDAPI_YOUTUBE_MP3_KEY;

    try {
      expect(isYoutubeAudioConfigured()).toBe(false);
    } finally {
      if (originalKey === undefined) {
        delete process.env.RAPIDAPI_YOUTUBE_MP3_KEY;
      } else {
        process.env.RAPIDAPI_YOUTUBE_MP3_KEY = originalKey;
      }
    }
  });
});
