import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.CREDITS_ENABLED = "true";

vi.mock("../../../../lib/generations/persist-generation.js", () => ({
  persistGeneration: vi.fn(),
}));

vi.mock("../../../../lib/credits/flags.js", () => ({
  isCreditsEnabled: vi.fn(() => true),
}));

import { isCreditsEnabled } from "../../../../lib/credits/flags.js";
import { persistGeneration } from "../../../../lib/generations/persist-generation.js";
import { POST } from "./route.js";

const ORIGINAL_CREDITS_ENABLED = process.env.CREDITS_ENABLED;

function makeRequest(body, { cookie = "reel-creator-session=session-save-test" } = {}) {
  return new Request("http://localhost/api/dashboard/generations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/dashboard/generations", () => {
  beforeEach(() => {
    process.env.CREDITS_ENABLED = "true";
    isCreditsEnabled.mockReturnValue(true);
    persistGeneration.mockReset();
  });

  afterEach(() => {
    if (ORIGINAL_CREDITS_ENABLED == null) {
      delete process.env.CREDITS_ENABLED;
    } else {
      process.env.CREDITS_ENABLED = ORIGINAL_CREDITS_ENABLED;
    }
  });

  it("returns 404 when credits are disabled", async () => {
    isCreditsEnabled.mockReturnValue(false);

    const response = await POST(
      makeRequest({
        finalJobId: "job-1",
        pipelineRunId: "run-1",
        project: { lines: [] },
      }),
    );

    expect(response.status).toBe(404);
    expect(persistGeneration).not.toHaveBeenCalled();
  });

  it("requires a session cookie", async () => {
    const response = await POST(
      makeRequest(
        {
          finalJobId: "job-1",
          pipelineRunId: "run-1",
          project: { lines: [] },
        },
        { cookie: "" },
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("session_required");
    expect(persistGeneration).not.toHaveBeenCalled();
  });

  it("saves YouTube reference by default without MP3", async () => {
    const generationId = "aaaaaaaaaaaaaaaaaaaaaaaa";
    persistGeneration.mockResolvedValue({
      audioStored: false,
      generation: {
        _id: { toString: () => generationId },
        audioDurationSeconds: 12,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        ownerScope: { sessionId: "session-save-test", type: "session" },
        public: true,
        r2Status: "not_required",
        snapshot: {
          project: {
            lines: [{ original: "hello" }],
          },
          source: {
            segmentEndSec: 90,
            segmentStartSec: 30,
            type: "youtube",
            youtubeUrl: "https://www.youtube.com/watch?v=abc",
          },
        },
        title: "My song",
        userTitled: true,
      },
      promoted: true,
      saved: true,
      storeAudio: false,
    });

    const response = await POST(
      makeRequest({
        finalJobId: "job-final",
        pipelineRunId: "run-final",
        project: {
          audio: { duration: 12, name: "track.mp3", startOffset: 0 },
          lines: [{ id: "line-1", original: "hello" }],
          meta: { title: "My song" },
        },
        source: {
          segmentEndSec: 90,
          segmentStartSec: 30,
          type: "youtube",
          youtubeUrl: "https://www.youtube.com/watch?v=abc",
        },
        title: "My song",
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(persistGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        finalJobId: "job-final",
        pipelineRunId: "run-final",
        save: true,
        sessionId: "session-save-test",
        storeAudio: false,
        title: "My song",
      }),
    );
    expect(payload).toMatchObject({
      audioStored: false,
      id: generationId,
      saved: true,
      generation: {
        id: generationId,
        title: "My song",
        youtubeUrl: "https://www.youtube.com/watch?v=abc",
      },
    });
  });

  it("rejects MP3 save with the wrong audio password", async () => {
    const response = await POST(
      makeRequest({
        assetId: "asset-1",
        audioPassword: "wrong",
        finalJobId: "job-final",
        includeMp3: true,
        pipelineRunId: "run-final",
        project: { lines: [] },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe("audio_password_invalid");
    expect(persistGeneration).not.toHaveBeenCalled();
  });

  it("stores MP3 when includeMp3 and password are valid", async () => {
    const generationId = "bbbbbbbbbbbbbbbbbbbbbbbb";
    persistGeneration.mockResolvedValue({
      audioStored: true,
      generation: {
        _id: { toString: () => generationId },
        audioDurationSeconds: 12,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        ownerScope: { sessionId: "session-save-test", type: "session" },
        public: false,
        r2Status: "created",
        snapshot: { project: { lines: [] } },
        title: "Generation 1",
        userTitled: false,
      },
      promoted: true,
      saved: true,
      storeAudio: true,
    });

    const response = await POST(
      makeRequest({
        assetId: "asset-1",
        audioPassword: "123a",
        finalJobId: "job-final",
        includeMp3: true,
        pipelineRunId: "run-final",
        project: { lines: [] },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(persistGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "asset-1",
        storeAudio: true,
      }),
    );
    expect(payload.audioStored).toBe(true);
  });
});
