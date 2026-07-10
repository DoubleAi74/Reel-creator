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
    expect(getLyricPipelineSelectionForPreset(LYRIC_PIPELINE_PRESETS.both)).toEqual({
      generate: true,
      time: true,
    });
    expect(
      getLyricPipelineSelectionForPreset(LYRIC_PIPELINE_PRESETS.generateOnly),
    ).toEqual({
      generate: true,
      time: false,
    });
    expect(
      getLyricPipelineSelectionForPreset(LYRIC_PIPELINE_PRESETS.timeOnly),
    ).toEqual({
      generate: false,
      time: true,
    });
  });

  it("derives part availability from audio and source lyric text", () => {
    expect(getLyricPipelineCanRun({ hasAudio: false, lines: [] })).toEqual({
      generate: false,
      time: false,
    });
    expect(
      getLyricPipelineCanRun({
        hasAudio: true,
        lines: [{ original: "  " }],
      }),
    ).toEqual({
      generate: true,
      time: false,
    });
    expect(
      getLyricPipelineCanRun({
        hasAudio: false,
        lines: [{ original: "hello" }],
      }),
    ).toEqual({
      generate: false,
      time: true,
    });
  });

  it("returns selected phases in pipeline order while respecting availability", () => {
    expect(
      getSelectedLyricPipelinePhases(
        { generate: true, time: true },
        { generate: true, time: false },
      ),
    ).toEqual(["generate", "time"]);
    expect(
      getSelectedLyricPipelinePhases(
        { generate: false, time: true },
        { generate: false, time: true },
      ),
    ).toEqual(["time"]);
    expect(
      getSelectedLyricPipelinePhases(
        { generate: false, time: true },
        { generate: false, time: false },
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
