import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

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
  runLyricTimingPipeline: vi.fn(),
  timeLyricLinesFromAudio: vi.fn(),
  transcribeAndCleanLyrics: vi.fn(),
}));

import { getAssetFilePath, readAssetMetadata, touchSession } from "../files";
import {
  enrichLyricLines,
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

function resetAiMocks() {
  runLyricTimingPipeline.mockReset();
  transcribeAndCleanLyrics.mockReset();
  enrichLyricLines.mockReset();
  timeLyricLinesFromAudio.mockReset();
}

describe("normalizeTranscribePhase", () => {
  it("keeps absent phase backward compatible and validates known phases", () => {
    expect(normalizeTranscribePhase()).toBe("full");
    expect(normalizeTranscribePhase("")).toBe("full");
    expect(normalizeTranscribePhase("TIME")).toBe("time");
    expect(normalizeTranscribePhase(" enrich ")).toBe("enrich");
    expect(() => normalizeTranscribePhase("unknown")).toThrow(
      "Unsupported lyric pipeline phase.",
    );
  });
});

describe("runTranscribeJob phase dispatch", () => {
  beforeEach(() => {
    resetAiMocks();
    readAssetMetadata.mockReset();
    readAssetMetadata.mockResolvedValue({
      kind: "audio",
      mimeType: "audio/mpeg",
      name: "song.mp3",
    });
    getAssetFilePath.mockReset();
    getAssetFilePath.mockResolvedValue("/tmp/song.mp3");
    readFile.mockReset();
    readFile.mockResolvedValue(Buffer.from("mp3"));
    touchSession.mockReset();
    touchSession.mockResolvedValue(undefined);
  });

  it.each([
    {
      expectedPhase: "full",
      fn: runLyricTimingPipeline,
      needsAudioFile: true,
      phase: undefined,
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
          lines,
          onProgress: expect.any(Function),
          sourceLanguage,
        }),
      );

      if (expectedPhase === "full" || expectedPhase === "enrich") {
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

      if (expectedPhase === "transcribe") {
        expect(fn).toHaveBeenCalledWith(
          expect.objectContaining({
            onTranscriptDelta: expect.any(Function),
          }),
        );
      }

      if (expectedPhase === "time" || expectedPhase === "full") {
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
});
