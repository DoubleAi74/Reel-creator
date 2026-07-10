import { beforeEach, describe, expect, it, vi } from "vitest";

const sourceLanguage = {
  id: "auto",
  label: "Auto-detect",
  transcriptionLanguage: null,
};

let cookieSessionId = "session-route";
let unlockCookieValue = null;
let creditsEnabled = false;

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn((name) => {
      if (name === "reel-creator-session" && cookieSessionId) {
        return { value: cookieSessionId };
      }

      if (name === "rc_gen_unlock" && unlockCookieValue) {
        return { value: unlockCookieValue };
      }

      return undefined;
    }),
  })),
}));

vi.mock("@/lib/files", () => ({
  SESSION_COOKIE_NAME: "reel-creator-session",
  findSessionIdForAsset: vi.fn(),
  readAssetMetadata: vi.fn(),
  storeUploadedAsset: vi.fn(),
  touchSessionAndSweep: vi.fn(),
}));

vi.mock("@/lib/ai/openai-lyrics", () => ({
  normalizeSourceLanguage: vi.fn(() => sourceLanguage),
}));

vi.mock("@/lib/ai/transcribe-job", () => ({
  normalizeTranscribePhase: vi.fn((phase) => phase || "full"),
  runTranscribeJob: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/ai/transcribe-store", () => ({
  createTranscribeJob: vi.fn(),
  enqueueTranscribeJob: vi.fn(),
  findInFlightTranscribeForSession: vi.fn(),
}));

vi.mock("@/lib/render/store", () => ({
  removeRenderJobsForSessions: vi.fn(),
}));

vi.mock("@/lib/credits/flags", () => ({
  isCreditsEnabled: vi.fn(() => creditsEnabled),
}));

vi.mock("@/lib/credits/unlock-cookie", () => ({
  GENERATION_UNLOCK_COOKIE: "rc_gen_unlock",
  isGenerationUnlockCookieValid: vi.fn((value) => value === "valid-unlock"),
}));

vi.mock("@/lib/credits/rate-limit", () => ({
  checkGenerationRateLimit: vi.fn(() => ({
    allowed: true,
    retryAfter: 0,
  })),
}));

vi.mock("@/lib/credits/credit-service", () => ({
  assertCanStartGeneration: vi.fn(async () => ({
    enabled: true,
  })),
}));

describe("POST /api/ai/transcribe", () => {
  beforeEach(async () => {
    cookieSessionId = "session-route";
    unlockCookieValue = null;
    creditsEnabled = false;
    const files = await import("@/lib/files");
    const store = await import("@/lib/ai/transcribe-store");
    const rateLimit = await import("@/lib/credits/rate-limit");
    const creditService = await import("@/lib/credits/credit-service");
    const unlockCookie = await import("@/lib/credits/unlock-cookie");

    files.findSessionIdForAsset.mockReset();
    files.readAssetMetadata.mockReset();
    files.readAssetMetadata.mockResolvedValue({
      kind: "audio",
    });
    files.storeUploadedAsset.mockReset();
    files.storeUploadedAsset.mockResolvedValue({
      assetId: "asset-reattached",
      kind: "audio",
      name: "reattach.mp3",
    });
    files.touchSessionAndSweep.mockReset();
    files.touchSessionAndSweep.mockResolvedValue([]);
    store.createTranscribeJob.mockReset();
    store.createTranscribeJob.mockReturnValue({ jobId: "job-route" });
    store.enqueueTranscribeJob.mockReset();
    store.findInFlightTranscribeForSession.mockReset();
    store.findInFlightTranscribeForSession.mockReturnValue(null);
    rateLimit.checkGenerationRateLimit.mockClear();
    rateLimit.checkGenerationRateLimit.mockReturnValue({
      allowed: true,
      retryAfter: 0,
    });
    creditService.assertCanStartGeneration.mockClear();
    creditService.assertCanStartGeneration.mockResolvedValue({
      enabled: true,
    });
    unlockCookie.isGenerationUnlockCookieValid.mockClear();
    unlockCookie.isGenerationUnlockCookieValid.mockImplementation(
      (value) => value === "valid-unlock",
    );
  });

  it("passes pipeline run and final-save flags into the queued job", async () => {
    const { POST } = await import("./route");
    const store = await import("@/lib/ai/transcribe-store");
    const transcribeJob = await import("@/lib/ai/transcribe-job");

    const response = await POST(
      new Request("http://localhost/api/ai/transcribe", {
        body: JSON.stringify({
          audio: {
            duration: 12,
            endOffset: null,
            startOffset: 0,
          },
          audioAssetId: "asset-route",
          includeRomanization: true,
          lines: [{ id: "line-1", original: "hello" }],
          phase: "time",
          pipelineRunId: "run-route",
          save: false,
          saveOnCompletion: true,
          sourceLanguage: "auto",
        }),
        method: "POST",
      }),
    );

    await expect(response.json()).resolves.toEqual({ jobId: "job-route" });
    expect(response.status).toBe(200);
    expect(store.createTranscribeJob).toHaveBeenCalledWith({
      assetId: "asset-route",
      phase: "time",
      pipelineRunId: "run-route",
      save: false,
      saveOnCompletion: true,
      sessionId: "session-route",
    });
    expect(store.enqueueTranscribeJob).toHaveBeenCalledWith(
      "job-route",
      expect.any(Function),
    );

    await store.enqueueTranscribeJob.mock.calls[0][1]();

    expect(transcribeJob.runTranscribeJob).toHaveBeenCalledWith(
      expect.objectContaining({
        audioAssetId: "asset-route",
        jobId: "job-route",
        phase: "time",
        pipelineRunId: "run-route",
        save: false,
        saveOnCompletion: true,
        sessionId: "session-route",
      }),
    );
  });

  it("starts generate jobs without forwarding stale editor lines", async () => {
    const { POST } = await import("./route");
    const store = await import("@/lib/ai/transcribe-store");
    const transcribeJob = await import("@/lib/ai/transcribe-job");

    const response = await POST(
      new Request("http://localhost/api/ai/transcribe", {
        body: JSON.stringify({
          audio: {
            duration: 12,
            endOffset: null,
            startOffset: 0,
          },
          audioAssetId: "asset-route",
          lines: [{ id: "stale-line", original: "do not lock me" }],
          phase: "generate",
          sourceLanguage: "auto",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await store.enqueueTranscribeJob.mock.calls[0][1]();

    expect(store.createTranscribeJob).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "asset-route",
        phase: "generate",
      }),
    );
    expect(transcribeJob.runTranscribeJob).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [],
        phase: "generate",
      }),
    );
  });

  it("preserves the disabled generation path without invoking credit gates", async () => {
    creditsEnabled = false;
    const { POST } = await import("./route");
    const store = await import("@/lib/ai/transcribe-store");
    const creditService = await import("@/lib/credits/credit-service");
    const rateLimit = await import("@/lib/credits/rate-limit");
    const unlockCookie = await import("@/lib/credits/unlock-cookie");

    const response = await POST(
      new Request("http://localhost/api/ai/transcribe", {
        body: JSON.stringify({
          audio: {
            duration: 12,
            endOffset: null,
            startOffset: 0,
          },
          audioAssetId: "asset-route",
          includeRomanization: true,
          lines: [{ id: "line-1", original: "hello" }],
          phase: "time",
          sourceLanguage: "auto",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ jobId: "job-route" });
    expect(store.createTranscribeJob).toHaveBeenCalledTimes(1);
    expect(unlockCookie.isGenerationUnlockCookieValid).not.toHaveBeenCalled();
    expect(rateLimit.checkGenerationRateLimit).not.toHaveBeenCalled();
    expect(creditService.assertCanStartGeneration).not.toHaveBeenCalled();
  });

  it("skips credit gates when adopting an in-flight job", async () => {
    creditsEnabled = true;
    const { POST } = await import("./route");
    const store = await import("@/lib/ai/transcribe-store");
    const creditService = await import("@/lib/credits/credit-service");
    const unlockCookie = await import("@/lib/credits/unlock-cookie");

    store.findInFlightTranscribeForSession.mockReturnValue({ jobId: "job-existing" });

    const response = await POST(
      new Request("http://localhost/api/ai/transcribe", {
        body: JSON.stringify({
          audioAssetId: "asset-route",
          phase: "time",
          sourceLanguage: "auto",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ jobId: "job-existing" });
    expect(store.findInFlightTranscribeForSession).toHaveBeenCalledWith(
      "session-route",
      "asset-route",
      "time",
    );
    expect(unlockCookie.isGenerationUnlockCookieValid).not.toHaveBeenCalled();
    expect(creditService.assertCanStartGeneration).not.toHaveBeenCalled();
  });

  it("reattaches a client MP3 onto this isolate when multipart file is sent", async () => {
    cookieSessionId = null;
    const { POST } = await import("./route");
    const files = await import("@/lib/files");
    const store = await import("@/lib/ai/transcribe-store");
    const transcribeJob = await import("@/lib/ai/transcribe-job");

    // Minimal MP3-ish buffer with frame sync (storeUploadedAsset validates).
    const bytes = new Uint8Array([0xff, 0xe0, 0x00, 0x00, 1, 2, 3, 4]);
    const formData = new FormData();
    formData.append(
      "payload",
      JSON.stringify({
        audio: { duration: 12, endOffset: null, startOffset: 0 },
        audioAssetId: "stale-asset",
        phase: "generate",
        sourceLanguage: "auto",
      }),
    );
    formData.append(
      "file",
      new File([bytes], "client.mp3", { type: "audio/mpeg" }),
    );

    // Bypass buffer validation — unit test focuses on routing.
    files.storeUploadedAsset.mockResolvedValue({
      assetId: "asset-reattached",
      kind: "audio",
      name: "client.mp3",
    });

    const response = await POST(
      new Request("http://localhost/api/ai/transcribe", {
        body: formData,
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      audioAssetId: "asset-reattached",
      jobId: "job-route",
    });
    expect(files.storeUploadedAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "audio",
        sessionId: expect.any(String),
      }),
    );
    expect(store.createTranscribeJob).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "asset-reattached",
        phase: "generate",
      }),
    );

    await store.enqueueTranscribeJob.mock.calls[0][1]();
    expect(transcribeJob.runTranscribeJob).toHaveBeenCalledWith(
      expect.objectContaining({
        audioAssetId: "asset-reattached",
        phase: "generate",
      }),
    );
  });

  it("blocks a new enabled generation when the unlock cookie is missing", async () => {
    creditsEnabled = true;
    const { POST } = await import("./route");
    const store = await import("@/lib/ai/transcribe-store");

    const response = await POST(
      new Request("http://localhost/api/ai/transcribe", {
        body: JSON.stringify({
          audioAssetId: "asset-route",
          phase: "time",
          sourceLanguage: "auto",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "locked" });
    expect(store.createTranscribeJob).not.toHaveBeenCalled();
  });

  it("returns 429 when the enabled generation rate limit is exceeded", async () => {
    creditsEnabled = true;
    unlockCookieValue = "valid-unlock";
    const { POST } = await import("./route");
    const rateLimit = await import("@/lib/credits/rate-limit");

    rateLimit.checkGenerationRateLimit.mockReturnValue({
      allowed: false,
      retryAfter: 42,
    });

    const response = await POST(
      new Request("http://localhost/api/ai/transcribe", {
        body: JSON.stringify({
          audioAssetId: "asset-route",
          phase: "time",
          sourceLanguage: "auto",
        }),
        headers: {
          "x-forwarded-for": "203.0.113.9",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "rate_limited",
      retryAfter: 42,
    });
    expect(rateLimit.checkGenerationRateLimit).toHaveBeenCalledWith({
      ip: "203.0.113.9",
      sessionId: "session-route",
    });
  });

  it("returns pricing and balance gate errors without starting a job", async () => {
    creditsEnabled = true;
    unlockCookieValue = "valid-unlock";
    const { POST } = await import("./route");
    const store = await import("@/lib/ai/transcribe-store");
    const creditService = await import("@/lib/credits/credit-service");

    creditService.assertCanStartGeneration.mockRejectedValueOnce({
      code: "PRICING_UNAVAILABLE",
      details: { model: "missing-model" },
    });

    const pricingResponse = await POST(
      new Request("http://localhost/api/ai/transcribe", {
        body: JSON.stringify({
          audioAssetId: "asset-route",
          phase: "time",
          sourceLanguage: "auto",
        }),
        method: "POST",
      }),
    );

    expect(pricingResponse.status).toBe(500);
    await expect(pricingResponse.json()).resolves.toEqual({
      error: "pricing_unavailable",
      model: "missing-model",
    });

    creditService.assertCanStartGeneration.mockRejectedValueOnce({
      code: "INSUFFICIENT_BALANCE",
      details: { balanceMinor: 0 },
    });

    const balanceResponse = await POST(
      new Request("http://localhost/api/ai/transcribe", {
        body: JSON.stringify({
          audioAssetId: "asset-route",
          phase: "time",
          sourceLanguage: "auto",
        }),
        method: "POST",
      }),
    );

    expect(balanceResponse.status).toBe(402);
    await expect(balanceResponse.json()).resolves.toEqual({
      balanceMinor: 0,
      error: "insufficient_balance",
    });
    expect(store.createTranscribeJob).toHaveBeenCalledTimes(0);
  });

  it("still invokes the credit gate for enrich (service exempts balance floor)", async () => {
    creditsEnabled = true;
    unlockCookieValue = "valid-unlock";
    const { POST } = await import("./route");
    const store = await import("@/lib/ai/transcribe-store");
    const creditService = await import("@/lib/credits/credit-service");

    creditService.assertCanStartGeneration.mockResolvedValueOnce({
      balanceMinor: 0,
      enabled: true,
      gateExempt: true,
    });

    const response = await POST(
      new Request("http://localhost/api/ai/transcribe", {
        body: JSON.stringify({
          audioAssetId: "asset-route",
          phase: "enrich",
          sourceLanguage: "auto",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ jobId: "job-route" });
    expect(creditService.assertCanStartGeneration).toHaveBeenCalledWith({
      phase: "enrich",
    });
    expect(store.createTranscribeJob).toHaveBeenCalledTimes(1);
  });

  it("rejects phase full when credits are enabled (REP-201a)", async () => {
    creditsEnabled = true;
    unlockCookieValue = "valid-unlock";
    const { POST } = await import("./route");
    const store = await import("@/lib/ai/transcribe-store");
    const creditService = await import("@/lib/credits/credit-service");
    const transcribeJob = await import("@/lib/ai/transcribe-job");

    const explicitFull = await POST(
      new Request("http://localhost/api/ai/transcribe", {
        body: JSON.stringify({
          audioAssetId: "asset-route",
          phase: "full",
          sourceLanguage: "auto",
        }),
        method: "POST",
      }),
    );

    expect(explicitFull.status).toBe(400);
    await expect(explicitFull.json()).resolves.toEqual({
      error: "full_phase_disabled",
      message:
        "When credits are enabled, run Generate lyrics, then Time lyrics.",
    });

    // Default / omitted phase normalizes to "full" and is also rejected.
    transcribeJob.normalizeTranscribePhase.mockReturnValueOnce("full");
    const defaultFull = await POST(
      new Request("http://localhost/api/ai/transcribe", {
        body: JSON.stringify({
          audioAssetId: "asset-route",
          sourceLanguage: "auto",
        }),
        method: "POST",
      }),
    );

    expect(defaultFull.status).toBe(400);
    await expect(defaultFull.json()).resolves.toMatchObject({
      error: "full_phase_disabled",
    });
    expect(store.createTranscribeJob).not.toHaveBeenCalled();
    expect(creditService.assertCanStartGeneration).not.toHaveBeenCalled();
  });

  it("allows phase full when credits are disabled (REP-201a parity)", async () => {
    creditsEnabled = false;
    const { POST } = await import("./route");
    const store = await import("@/lib/ai/transcribe-store");
    const transcribeJob = await import("@/lib/ai/transcribe-job");

    transcribeJob.normalizeTranscribePhase.mockReturnValueOnce("full");

    const response = await POST(
      new Request("http://localhost/api/ai/transcribe", {
        body: JSON.stringify({
          audioAssetId: "asset-route",
          phase: "full",
          sourceLanguage: "auto",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ jobId: "job-route" });
    expect(store.createTranscribeJob).toHaveBeenCalledTimes(1);
  });
});
