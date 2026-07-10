import { readFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

vi.mock("../files", () => ({
  getAssetFilePath: vi.fn(),
  readAssetMetadata: vi.fn(),
  touchSession: vi.fn(),
}));

vi.mock("./openai-lyrics", () => ({
  enrichLyricLines: vi.fn(),
  generateLyricLines: vi.fn(),
  runLyricTimingPipeline: vi.fn(),
  timeLyricLinesFromAudio: vi.fn(),
  transcribeAndCleanLyrics: vi.fn(),
}));

vi.mock("./openai-usage.js", () => ({
  createUsageCollector: vi.fn(),
}));

vi.mock("../credits/credit-service.js", () => ({
  isCreditServiceError: vi.fn(() => false),
  recordUsageOnly: vi.fn(),
  settlePhase: vi.fn(),
}));

vi.mock("../generations/persist-generation.js", () => ({
  buildGenerationSnapshot: vi.fn(),
  persistGeneration: vi.fn(),
}));

import { getAssetFilePath, readAssetMetadata, touchSession } from "../files";
import { settlePhase } from "../credits/credit-service.js";
import {
  buildGenerationSnapshot,
  persistGeneration,
} from "../generations/persist-generation.js";
import { createUsageCollector } from "./openai-usage.js";
import {
  enrichLyricLines,
  generateLyricLines,
  runLyricTimingPipeline,
  timeLyricLinesFromAudio,
  transcribeAndCleanLyrics,
} from "./openai-lyrics";
import { createTranscribeJob, getTranscribeJob } from "./transcribe-store";
import { normalizeTranscribePhase, runTranscribeJob } from "./transcribe-job";

const sourceLanguage = {
  id: "auto",
  label: "Auto-detect",
  transcriptionLanguage: null,
};
const ORIGINAL_CREDITS_ENABLED = process.env.CREDITS_ENABLED;

function resetAiMocks() {
  runLyricTimingPipeline.mockReset();
  generateLyricLines.mockReset();
  transcribeAndCleanLyrics.mockReset();
  enrichLyricLines.mockReset();
  timeLyricLinesFromAudio.mockReset();
}

describe("normalizeTranscribePhase", () => {
  it("keeps absent phase backward compatible and validates known phases", () => {
    expect(normalizeTranscribePhase()).toBe("full");
    expect(normalizeTranscribePhase("")).toBe("full");
    expect(normalizeTranscribePhase("generate")).toBe("generate");
    expect(normalizeTranscribePhase("TIME")).toBe("time");
    expect(normalizeTranscribePhase(" enrich ")).toBe("enrich");
    expect(() => normalizeTranscribePhase("unknown")).toThrow(
      "Unsupported lyric pipeline phase.",
    );
  });
});

describe("runTranscribeJob phase dispatch", () => {
  beforeEach(() => {
    delete process.env.CREDITS_ENABLED;
    resetAiMocks();
    createUsageCollector.mockReset();
    createUsageCollector.mockImplementation(() => ({
      markPhaseComplete: vi.fn(async (phase) => [
        {
          callId: `mock:${phase}`,
          phase,
          rawCostMicros: 1,
        },
      ]),
      serialize: vi.fn(() => ({ calls: [] })),
    }));
    settlePhase.mockReset();
    settlePhase.mockResolvedValue({ settled: true });
    buildGenerationSnapshot.mockReset();
    buildGenerationSnapshot.mockImplementation(({ result }) => ({
      project: {
        lines: result?.lines ?? [],
      },
    }));
    persistGeneration.mockReset();
    persistGeneration.mockResolvedValue({ saved: true });
    readAssetMetadata.mockReset();
    readAssetMetadata.mockResolvedValue({
      durationSec: 12,
      kind: "audio",
      mimeType: "audio/mpeg",
      name: "song.mp3",
      sourceType: "upload",
    });
    getAssetFilePath.mockReset();
    getAssetFilePath.mockResolvedValue("/tmp/song.mp3");
    readFile.mockReset();
    readFile.mockResolvedValue(Buffer.from("mp3"));
    touchSession.mockReset();
    touchSession.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (ORIGINAL_CREDITS_ENABLED == null) {
      delete process.env.CREDITS_ENABLED;
    } else {
      process.env.CREDITS_ENABLED = ORIGINAL_CREDITS_ENABLED;
    }
  });

  it.each([
    {
      expectedPhase: "full",
      fn: runLyricTimingPipeline,
      needsAudioFile: true,
      phase: undefined,
    },
    {
      expectedPhase: "generate",
      fn: generateLyricLines,
      needsAudioFile: true,
      phase: "generate",
    },
    {
      expectedPhase: "transcribe",
      fn: transcribeAndCleanLyrics,
      needsAudioFile: true,
      phase: "transcribe",
    },
    {
      expectedPhase: "enrich",
      fn: enrichLyricLines,
      needsAudioFile: false,
      phase: "enrich",
    },
    {
      expectedPhase: "time",
      fn: timeLyricLinesFromAudio,
      needsAudioFile: true,
      phase: "time",
    },
  ])(
    "dispatches $expectedPhase jobs to the matching staged function",
    async ({ expectedPhase, fn, needsAudioFile, phase }) => {
      fn.mockResolvedValue({ phase: expectedPhase });
      const job = createTranscribeJob({
        assetId: `asset-${expectedPhase}`,
        sessionId: `session-${expectedPhase}`,
      });
      const lines = [{ id: "line-1", original: "hello world" }];
      const audio = { duration: 2, endOffset: null, startOffset: 0 };

      const result = await runTranscribeJob({
        audio,
        audioAssetId: job.assetId,
        includeRomanization: true,
        jobId: job.jobId,
        lines,
        phase,
        sessionId: job.sessionId,
        sourceLanguage,
      });

      expect(result).toEqual({ phase: expectedPhase });
      expect(getTranscribeJob(job.jobId)).toMatchObject({
        result: { phase: expectedPhase },
        status: "done",
      });
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(
        expect.objectContaining({
          onProgress: expect.any(Function),
          sourceLanguage,
        }),
      );

      if (expectedPhase !== "generate") {
        expect(fn).toHaveBeenCalledWith(expect.objectContaining({ lines }));
      } else {
        expect(fn).not.toHaveBeenCalledWith(expect.objectContaining({ lines }));
      }

      if (
        expectedPhase === "full" ||
        expectedPhase === "generate" ||
        expectedPhase === "enrich"
      ) {
        expect(fn).toHaveBeenCalledWith(
          expect.objectContaining({
            includeRomanization: true,
          }),
        );
      }

      if (expectedPhase === "full") {
        expect(fn).toHaveBeenCalledWith(
          expect.objectContaining({
            includeWordMeanings: true,
            onTranscriptDelta: expect.any(Function),
          }),
        );
      }

      if (expectedPhase === "generate" || expectedPhase === "transcribe") {
        expect(fn).toHaveBeenCalledWith(
          expect.objectContaining({
            onTranscriptDelta: expect.any(Function),
          }),
        );
      }

      if (
        expectedPhase === "generate" ||
        expectedPhase === "time" ||
        expectedPhase === "full"
      ) {
        expect(fn).toHaveBeenCalledWith(expect.objectContaining({ audio }));
      }

      if (needsAudioFile) {
        expect(readAssetMetadata).toHaveBeenCalledWith(job.sessionId, job.assetId);
        expect(getAssetFilePath).toHaveBeenCalledWith(job.sessionId, job.assetId);
        expect(readFile).toHaveBeenCalledWith("/tmp/song.mp3");
        expect(fn).toHaveBeenCalledWith(
          expect.objectContaining({
            contentType: "audio/mpeg",
            fileBuffer: Buffer.from("mp3"),
            fileName: "song.mp3",
          }),
        );
      } else {
        expect(readAssetMetadata).not.toHaveBeenCalled();
        expect(getAssetFilePath).not.toHaveBeenCalled();
        expect(readFile).not.toHaveBeenCalled();
      }
    },
  );

  it("settles transcribe and enrich billing phases for generate jobs", async () => {
    process.env.CREDITS_ENABLED = "true";
    generateLyricLines.mockResolvedValue({
      lines: [{ id: "line-1", original: "hello", translation: "Hello" }],
    });
    const job = createTranscribeJob({
      assetId: "asset-generate",
      phase: "generate",
      pipelineRunId: "run-generate",
      sessionId: "session-generate",
    });

    await runTranscribeJob({
      audio: { duration: 12, endOffset: null, startOffset: 0 },
      audioAssetId: job.assetId,
      includeRomanization: true,
      jobId: job.jobId,
      lines: [{ id: "line-existing", original: "should not dispatch" }],
      phase: "generate",
      pipelineRunId: "run-generate",
      sessionId: job.sessionId,
      sourceLanguage,
    });

    expect(settlePhase).toHaveBeenCalledTimes(2);
    expect(settlePhase).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: job.jobId,
        phase: "transcribe",
        pipelineRunId: "run-generate",
      }),
    );
    expect(settlePhase).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: job.jobId,
        phase: "enrich",
        pipelineRunId: "run-generate",
      }),
    );
    expect(generateLyricLines).toHaveBeenCalledWith(
      expect.not.objectContaining({ lines: expect.any(Array) }),
    );
  });

  it("persists only the enabled final saved phase after settlement", async () => {
    process.env.CREDITS_ENABLED = "true";
    timeLyricLinesFromAudio.mockResolvedValue({
      lines: [{ id: "line-1", original: "done" }],
    });
    readAssetMetadata.mockResolvedValue({
      durationSec: 12,
      kind: "audio",
      mimeType: "audio/mpeg",
      name: "youtube-song.mp3",
      sourceType: "youtube",
    });
    const job = createTranscribeJob({
      assetId: "asset-final",
      pipelineRunId: "run-final",
      save: true,
      saveOnCompletion: true,
      sessionId: "session-final",
    });

    await runTranscribeJob({
      audio: { duration: 12, endOffset: null, startOffset: 0 },
      audioAssetId: job.assetId,
      includeRomanization: false,
      jobId: job.jobId,
      lines: [{ id: "line-1", original: "hello" }],
      phase: "time",
      pipelineRunId: "run-final",
      save: true,
      saveOnCompletion: true,
      sessionId: job.sessionId,
      sourceLanguage,
      title: "My public card",
    });

    expect(createUsageCollector).toHaveBeenCalledWith({
      jobId: job.jobId,
      pipelineRunId: "run-final",
    });
    expect(settlePhase).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: job.jobId,
        phase: "time",
        pipelineRunId: "run-final",
      }),
    );
    expect(buildGenerationSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        assetMetadata: expect.objectContaining({ sourceType: "youtube" }),
        result: {
          lines: [{ id: "line-1", original: "done" }],
        },
      }),
    );
    expect(persistGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "asset-final",
        finalJobId: job.jobId,
        pipelineRunId: "run-final",
        save: true,
        sessionId: "session-final",
        sourceType: "youtube",
        title: "My public card",
      }),
    );
  });

  it("does not persist non-final enabled phase jobs", async () => {
    process.env.CREDITS_ENABLED = "true";
    transcribeAndCleanLyrics.mockResolvedValue({
      lines: [{ id: "line-1", original: "draft" }],
    });
    const job = createTranscribeJob({
      assetId: "asset-partial",
      pipelineRunId: "run-partial",
      save: true,
      saveOnCompletion: false,
      sessionId: "session-partial",
    });

    await runTranscribeJob({
      audio: { duration: 12, endOffset: null, startOffset: 0 },
      audioAssetId: job.assetId,
      includeRomanization: false,
      jobId: job.jobId,
      lines: [{ id: "line-1", original: "hello" }],
      phase: "transcribe",
      pipelineRunId: "run-partial",
      save: true,
      saveOnCompletion: false,
      sessionId: job.sessionId,
      sourceLanguage,
    });

    expect(settlePhase).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: job.jobId,
        phase: "transcribe",
        pipelineRunId: "run-partial",
      }),
    );
    expect(persistGeneration).not.toHaveBeenCalled();
  });

  it("keeps and persists work after clamped settlement with write-off", async () => {
    process.env.CREDITS_ENABLED = "true";
    settlePhase.mockResolvedValue({
      balance: { amountMinor: 0 },
      balanceExhausted: true,
      clamped: true,
      debitMinor: 1,
      settled: true,
      writeOffMinor: 4,
    });
    timeLyricLinesFromAudio.mockResolvedValue({
      lines: [{ id: "line-1", original: "kept" }],
    });
    const job = createTranscribeJob({
      assetId: "asset-clamp",
      pipelineRunId: "run-clamp",
      save: true,
      saveOnCompletion: true,
      sessionId: "session-clamp",
    });

    await runTranscribeJob({
      audio: { duration: 12, endOffset: null, startOffset: 0 },
      audioAssetId: job.assetId,
      includeRomanization: false,
      jobId: job.jobId,
      lines: [{ id: "line-1", original: "hello" }],
      phase: "time",
      pipelineRunId: "run-clamp",
      save: true,
      saveOnCompletion: true,
      sessionId: job.sessionId,
      sourceLanguage,
    });

    expect(getTranscribeJob(job.jobId)).toMatchObject({
      accountingStatus: "settled",
      balanceExhausted: true,
      status: "done",
      writeOffMinor: 4,
    });
    expect(persistGeneration).toHaveBeenCalled();
  });
});
