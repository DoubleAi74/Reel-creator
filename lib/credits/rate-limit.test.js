import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  checkGenerationRateLimit,
  getGenerationRateLimitConfig,
  resetGenerationRateLimitForTests,
} from "./rate-limit.js";

const ORIGINAL_GEN_RATE_MAX = process.env.GEN_RATE_MAX;
const ORIGINAL_GEN_RATE_WINDOW_SECONDS = process.env.GEN_RATE_WINDOW_SECONDS;

describe("generation rate limit", () => {
  beforeEach(() => {
    process.env.GEN_RATE_MAX = "2";
    process.env.GEN_RATE_WINDOW_SECONDS = "60";
    resetGenerationRateLimitForTests();
  });

  afterEach(() => {
    resetGenerationRateLimitForTests();

    if (ORIGINAL_GEN_RATE_MAX == null) {
      delete process.env.GEN_RATE_MAX;
    } else {
      process.env.GEN_RATE_MAX = ORIGINAL_GEN_RATE_MAX;
    }

    if (ORIGINAL_GEN_RATE_WINDOW_SECONDS == null) {
      delete process.env.GEN_RATE_WINDOW_SECONDS;
    } else {
      process.env.GEN_RATE_WINDOW_SECONDS = ORIGINAL_GEN_RATE_WINDOW_SECONDS;
    }
  });

  it("limits by session and IP within a fixed window", () => {
    const now = 1000;

    expect(getGenerationRateLimitConfig()).toEqual({
      max: 2,
      windowMs: 60_000,
    });
    expect(
      checkGenerationRateLimit({ ip: "203.0.113.1", now, sessionId: "session-1" }),
    ).toMatchObject({ allowed: true, remaining: 1 });
    expect(
      checkGenerationRateLimit({
        ip: "203.0.113.1",
        now: now + 1000,
        sessionId: "session-1",
      }),
    ).toMatchObject({ allowed: true, remaining: 0 });
    expect(
      checkGenerationRateLimit({
        ip: "203.0.113.1",
        now: now + 2000,
        sessionId: "session-1",
      }),
    ).toMatchObject({ allowed: false, retryAfter: 58 });
    expect(
      checkGenerationRateLimit({
        ip: "203.0.113.1",
        now: now + 61_000,
        sessionId: "session-1",
      }),
    ).toMatchObject({ allowed: true, remaining: 1 });
  });
});
