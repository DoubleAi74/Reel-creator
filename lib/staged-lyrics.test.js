import { describe, expect, it } from "vitest";

import {
  LYRIC_PIPELINE_PRESETS,
  getLyricPipelineCanRun,
  getLyricPipelineSelectionForPreset,
  getSelectedLyricPipelinePhases,
  hasLyricPipelineDownstreamData,
} from "./staged-lyrics";

describe("staged lyric pipeline helpers", () => {
  it("maps presets to phase selections", () => {
    expect(getLyricPipelineSelectionForPreset(LYRIC_PIPELINE_PRESETS.all)).toEqual({
      enrich: true,
      time: true,
      transcribe: true,
    });
    expect(
      getLyricPipelineSelectionForPreset(LYRIC_PIPELINE_PRESETS.firstTwo),
    ).toEqual({
      enrich: true,
      time: false,
      transcribe: true,
    });
    expect(
      getLyricPipelineSelectionForPreset(LYRIC_PIPELINE_PRESETS.firstOne),
    ).toEqual({
      enrich: false,
      time: false,
      transcribe: true,
    });
  });

  it("derives part availability from audio and source lyric text", () => {
    expect(getLyricPipelineCanRun({ hasAudio: false, lines: [] })).toEqual({
      enrich: false,
      time: false,
      transcribe: false,
    });
    expect(
      getLyricPipelineCanRun({
        hasAudio: true,
        lines: [{ original: "  " }],
      }),
    ).toEqual({
      enrich: false,
      time: false,
      transcribe: true,
    });
    expect(
      getLyricPipelineCanRun({
        hasAudio: false,
        lines: [{ original: "hello" }],
      }),
    ).toEqual({
      enrich: true,
      time: true,
      transcribe: false,
    });
  });

  it("returns selected phases in pipeline order while respecting availability", () => {
    expect(
      getSelectedLyricPipelinePhases(
        { enrich: true, time: true, transcribe: true },
        { enrich: false, time: false, transcribe: true },
      ),
    ).toEqual(["transcribe", "enrich", "time"]);
    expect(
      getSelectedLyricPipelinePhases(
        { enrich: false, time: true, transcribe: true },
        { enrich: false, time: false, transcribe: true },
      ),
    ).toEqual(["transcribe", "time"]);
    expect(
      getSelectedLyricPipelinePhases(
        { enrich: true, time: false, transcribe: false },
        { enrich: false, time: false, transcribe: true },
      ),
    ).toEqual([]);
  });

  it("detects downstream lyric data that a Part 1 rebuild would clear", () => {
    expect(hasLyricPipelineDownstreamData([])).toBe(false);
    expect(
      hasLyricPipelineDownstreamData([
        { original: "hello", translation: "   ", start: null },
      ]),
    ).toBe(false);
    expect(
      hasLyricPipelineDownstreamData([
        { original: "hello", translation: "Hello there.", start: null },
      ]),
    ).toBe(true);
    expect(
      hasLyricPipelineDownstreamData([
        { original: "hello", translation: "", start: 12.4 },
      ]),
    ).toBe(true);
  });
});
