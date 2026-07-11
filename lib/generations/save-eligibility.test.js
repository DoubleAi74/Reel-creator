import { describe, expect, it } from "vitest";

import {
  buildStableSaveIds,
  canSaveProjectToDashboard,
  createEmptyGenerationSave,
  ensureReadyGenerationSave,
  normalizeGenerationSave,
} from "./save-eligibility.js";

describe("save-eligibility", () => {
  it("requires lines and audio to save", () => {
    expect(
      canSaveProjectToDashboard({
        assetId: "a1",
        lines: [{ original: "hello" }],
      }),
    ).toBe(true);

    expect(
      canSaveProjectToDashboard({
        assetId: "a1",
        lines: [],
      }),
    ).toBe(false);

    expect(
      canSaveProjectToDashboard({
        assetId: "",
        hasPlayableAudio: true,
        lines: [{ original: "hi" }],
      }),
    ).toBe(true);
  });

  it("builds stable ids per asset", () => {
    expect(buildStableSaveIds({ assetId: "abc" })).toEqual({
      finalJobId: "client-save-final:abc",
      pipelineRunId: "client-save-run:abc",
    });
  });

  it("promotes idle saveable projects to ready with stable ids", () => {
    const next = ensureReadyGenerationSave({
      assetId: "asset-9",
      current: createEmptyGenerationSave(),
      lines: [{ original: "line" }],
    });

    expect(next.status).toBe("ready");
    expect(next.finalJobId).toBe("client-save-final:asset-9");
    expect(next.pipelineRunId).toBe("client-save-run:asset-9");
  });

  it("keeps pipeline job ids when already ready", () => {
    const next = ensureReadyGenerationSave({
      assetId: "asset-9",
      current: normalizeGenerationSave({
        assetId: "asset-9",
        finalJobId: "job-uuid",
        pipelineRunId: "run-uuid",
        status: "ready",
      }),
      lines: [{ original: "line" }],
    });

    expect(next.finalJobId).toBe("job-uuid");
    expect(next.pipelineRunId).toBe("run-uuid");
    expect(next.status).toBe("ready");
  });

  it("preserves saved status", () => {
    const next = ensureReadyGenerationSave({
      assetId: "asset-9",
      current: { status: "saved", finalJobId: "x", pipelineRunId: "y" },
      lines: [{ original: "line" }],
    });

    expect(next.status).toBe("saved");
  });
});
