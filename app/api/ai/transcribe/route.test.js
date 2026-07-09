import { beforeEach, describe, expect, it, vi } from "vitest";

const sourceLanguage = {
  id: "auto",
  label: "Auto-detect",
  transcriptionLanguage: null,
};

let cookieSessionId = "session-route";

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn((name) =>
      name === "reel-creator-session" && cookieSessionId
        ? { value: cookieSessionId }
        : undefined,
    ),
  })),
}));

vi.mock("@/lib/files", () => ({
  SESSION_COOKIE_NAME: "reel-creator-session",
  findSessionIdForAsset: vi.fn(),
  readAssetMetadata: vi.fn(),
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

describe("POST /api/ai/transcribe", () => {
  beforeEach(async () => {
    cookieSessionId = "session-route";
    const files = await import("@/lib/files");
    const store = await import("@/lib/ai/transcribe-store");

    files.findSessionIdForAsset.mockReset();
    files.readAssetMetadata.mockReset();
    files.readAssetMetadata.mockResolvedValue({
      kind: "audio",
    });
    files.touchSessionAndSweep.mockReset();
    files.touchSessionAndSweep.mockResolvedValue([]);
    store.createTranscribeJob.mockReset();
    store.createTranscribeJob.mockReturnValue({ jobId: "job-route" });
    store.enqueueTranscribeJob.mockReset();
    store.findInFlightTranscribeForSession.mockReset();
    store.findInFlightTranscribeForSession.mockReturnValue(null);
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
});
