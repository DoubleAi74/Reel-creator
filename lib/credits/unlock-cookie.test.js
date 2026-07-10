import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildGenerationUnlockSetCookie,
  createGenerationUnlockCookieValue,
  getGenerationUnlockTtlSeconds,
  isGenerationUnlockCookieValid,
  verifyGenerationPassword,
} from "./unlock-cookie.js";

const ORIGINAL_ENV = {
  GENERATION_PASSWORD: process.env.GENERATION_PASSWORD,
  GENERATION_UNLOCK_SECRET: process.env.GENERATION_UNLOCK_SECRET,
  GENERATION_UNLOCK_TTL_SECONDS: process.env.GENERATION_UNLOCK_TTL_SECONDS,
};

describe("generation unlock cookie", () => {
  beforeEach(() => {
    process.env.GENERATION_PASSWORD = "shared-password";
    process.env.GENERATION_UNLOCK_SECRET = "test-secret";
    process.env.GENERATION_UNLOCK_TTL_SECONDS = "60";
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("validates passwords and signs expiring unlock cookies", () => {
    const now = 1000;
    const value = createGenerationUnlockCookieValue({ now });

    expect(getGenerationUnlockTtlSeconds()).toBe(60);
    expect(verifyGenerationPassword("shared-password")).toBe(true);
    expect(verifyGenerationPassword("wrong")).toBe(false);
    expect(isGenerationUnlockCookieValid(value, { now: now + 59_000 })).toBe(true);
    expect(isGenerationUnlockCookieValid(value, { now: now + 60_001 })).toBe(false);
    expect(isGenerationUnlockCookieValid(`${value}x`, { now })).toBe(false);
    expect(buildGenerationUnlockSetCookie(value)).toContain("HttpOnly");
    expect(buildGenerationUnlockSetCookie(value)).toContain("Max-Age=60");
    expect(buildGenerationUnlockSetCookie(value)).not.toContain("Secure");

    const previousBase = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = "https://example.com";
    expect(buildGenerationUnlockSetCookie(value)).toContain("Secure");
    if (previousBase == null) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previousBase;
  });
});
