import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = {
  CREDITS_ENABLED: process.env.CREDITS_ENABLED,
  GENERATION_PASSWORD: process.env.GENERATION_PASSWORD,
  GENERATION_UNLOCK_SECRET: process.env.GENERATION_UNLOCK_SECRET,
  GENERATION_UNLOCK_TTL_SECONDS: process.env.GENERATION_UNLOCK_TTL_SECONDS,
};

let creditsEnabled = true;

vi.mock("@/lib/credits/flags", () => ({
  isCreditsEnabled: vi.fn(() => creditsEnabled),
}));

vi.mock("@/lib/credits/unlock-cookie", () => ({
  buildGenerationUnlockSetCookie: vi.fn(
    () => "rc_gen_unlock=cookie-value; Path=/; Max-Age=60; HttpOnly; SameSite=Lax",
  ),
  createGenerationUnlockCookieValue: vi.fn(() => "cookie-value"),
  verifyGenerationPassword: vi.fn((password) => password === "shared-password"),
}));

describe("POST /api/credits/unlock", () => {
  beforeEach(() => {
    creditsEnabled = true;
    process.env.CREDITS_ENABLED = "true";
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

  it("returns disabled when credits are off", async () => {
    creditsEnabled = false;
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/credits/unlock", {
        body: JSON.stringify({ password: "shared-password" }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ enabled: false });
  });

  it("sets an HttpOnly unlock cookie for the correct password", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/credits/unlock", {
        body: JSON.stringify({ password: "shared-password" }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ unlocked: true });
    expect(response.headers.get("set-cookie")).toContain("rc_gen_unlock=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=60");
  });

  it("rejects the wrong password", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/credits/unlock", {
        body: JSON.stringify({ password: "wrong" }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "locked" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
