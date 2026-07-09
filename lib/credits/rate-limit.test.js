import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  checkGenerationRateLimit,
  evictExpiredRateLimitKeys,
  getGenerationRateLimitConfig,
  getRateLimitStoreSizeForTests,
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

  it("defaults match .env.example / CREDITS_SETUP when env unset (REP-801)", () => {
    delete process.env.GEN_RATE_MAX;
    delete process.env.GEN_RATE_WINDOW_SECONDS;
    expect(getGenerationRateLimitConfig()).toEqual({
      max: 20,
      windowMs: 3_600_000,
    });
    process.env.GEN_RATE_MAX = "2";
    process.env.GEN_RATE_WINDOW_SECONDS = "60";
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

  it("evicts expired keys and leaves active windows intact (REP-804)", () => {
    const now = 10_000;
    checkGenerationRateLimit({
      ip: "203.0.113.50",
      now,
      sessionId: "active-session",
    });
    checkGenerationRateLimit({
      ip: "203.0.113.51",
      now: now - 120_000,
      sessionId: "stale-session",
    });

    // Force the stale entry's resetAt into the past by re-inserting via a second call
    // after the window (the first call above used now-120s with 60s window → expired).
    expect(getRateLimitStoreSizeForTests()).toBeGreaterThan(0);

    const removed = evictExpiredRateLimitKeys(now);
    expect(removed).toBeGreaterThan(0);

    // Active key still counts toward the limit.
    expect(
      checkGenerationRateLimit({
        ip: "203.0.113.50",
        now: now + 1,
        sessionId: "active-session",
      }),
    ).toMatchObject({ allowed: true, remaining: 0 });
  });
});
