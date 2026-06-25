import { describe, expect, it } from "vitest";

import {
  parseProjectJson,
  validateProjectInput,
} from "./validate";

describe("project validation", () => {
  it("rejects malformed JSON with a specific error", () => {
    expect(() => parseProjectJson('{"lines": [}')).toThrow(
      "Project JSON could not be parsed. Check for a missing comma, quote, or bracket.",
    );
  });

  it("rejects an empty lines array", () => {
    expect(() =>
      validateProjectInput({
        lines: [],
      }),
    ).toThrow("Project JSON must include at least one lyric line.");
  });

  it("rejects line starts that exceed the selected section", () => {
    expect(() =>
      validateProjectInput({
        audio: {
          duration: 12,
          endOffset: 8,
        },
        lines: [
          {
            original: "Too late",
            start: 9,
          },
        ],
      }),
    ).toThrow("lines[0].start must be less than or equal to 8.");
  });

  it("rejects sections longer than six minutes", () => {
    expect(() =>
      validateProjectInput({
        audio: {
          duration: 361,
          startOffset: 0,
        },
        lines: [
          {
            original: "Long section",
          },
        ],
      }),
    ).toThrow("Sections must be 360 seconds or less.");
  });

  it("accepts image backgrounds with scrim settings", () => {
    expect(
      validateProjectInput({
        background: {
          assetName: "cover-art.png",
          scrim: {
            color: "#020617",
            enabled: true,
            opacity: 0.45,
          },
          type: "image",
        },
        lines: [
          {
            original: "Image-backed line",
          },
        ],
      }),
    ).toMatchObject({
      background: {
        assetName: "cover-art.png",
        scrim: {
          color: "#020617",
          enabled: true,
          opacity: 0.45,
        },
        type: "image",
      },
    });
  });

  it("accepts video backgrounds with scrim settings", () => {
    expect(
      validateProjectInput({
        background: {
          assetName: "loop.mp4",
          scrim: {
            color: "#000000",
            enabled: true,
            opacity: 0.3,
          },
          type: "video",
        },
        lines: [
          {
            original: "Video-backed line",
          },
        ],
      }),
    ).toMatchObject({
      background: {
        assetName: "loop.mp4",
        scrim: {
          color: "#000000",
          enabled: true,
          opacity: 0.3,
        },
        type: "video",
      },
    });
  });

  it("normalizes per-line word timings and keeps untimed display words", () => {
    expect(
      validateProjectInput({
        lines: [
          {
            original: "Timed words",
            words: [
              { end: 1.4, start: 1, text: "Timed" },
              { end: -0.1, start: -0.4, text: "lead" },
              { end: 2.1, start: 2.4, text: "clamped" },
              { end: 3.2, start: 3, word: "fallback" },
              { end: 4, start: 3.8, text: "" },
              { end: Number.NaN, start: 4.1, text: "bad" },
              null,
            ],
          },
        ],
      }).lines[0].words,
    ).toEqual([
      { end: 1.4, gloss: null, roman: null, start: 1, text: "Timed" },
      { end: 0, gloss: null, roman: null, start: 0, text: "lead" },
      { end: 2.4, gloss: null, roman: null, start: 2.4, text: "clamped" },
      { end: 3.2, gloss: null, roman: null, start: 3, text: "fallback" },
      // "bad" has invalid timing but valid text → retained as an untimed display
      // word so generation gloss/roman can attach without timing.
      { end: null, gloss: null, roman: null, start: null, text: "bad" },
    ]);
  });

  it("accepts optional gloss/roman on words for both timed and untimed shapes", () => {
    expect(
      validateProjectInput({
        lines: [
          {
            original: "Gloss words",
            words: [
              { text: "आज", gloss: "today", roman: "aaj" },
              { end: 2, start: 1, text: "से", gloss: "from", roman: "se" },
              { text: "  ", gloss: "blank" },
              { text: "खाली", gloss: "   ", roman: null },
            ],
          },
        ],
      }).lines[0].words,
    ).toEqual([
      { end: null, gloss: "today", roman: "aaj", start: null, text: "आज" },
      { end: 2, gloss: "from", roman: "se", start: 1, text: "से" },
      { end: null, gloss: null, roman: null, start: null, text: "खाली" },
    ]);
  });

  it("rejects non-string gloss/roman on words", () => {
    expect(() =>
      validateProjectInput({
        lines: [{ original: "Bad gloss", words: [{ text: "x", gloss: 42 }] }],
      }),
    ).toThrow("lines[0].words[0].gloss must be a string.");
  });

  it("normalizes project lyric lead-in timing settings", () => {
    expect(
      validateProjectInput({
        lines: [
          {
            original: "Lead-in line",
          },
        ],
        timing: {
          lyricLeadInMs: 999,
        },
      }).timing,
    ).toEqual({
      lyricLeadInMs: 150,
    });
  });

  it("normalizes line quality metadata and ignores unusable entries", () => {
    expect(
      validateProjectInput({
        lines: [
          {
            original: "Quality line",
            quality: {
              extra: "ignored",
              flags: [
                {
                  code: "weak_text_evidence",
                  message: " Needs review. ",
                  severity: "review",
                  ignored: true,
                },
                {
                  code: "",
                  message: "bad",
                  severity: "high",
                },
                {
                  code: "odd",
                  message: "",
                  severity: "surprise",
                },
              ],
              metrics: {
                durationSec: 1.2,
                gapAfterSec: Number.NaN,
                matchRatio: 0.72,
                mysteryMetric: 99,
                tokenCount: 4,
              },
              riskLevel: "surprise",
              textEvidenceConfidence: "medium",
              timingConfidence: "excellent",
            },
          },
        ],
      }).lines[0].quality,
    ).toEqual({
      flags: [
        {
          code: "weak_text_evidence",
          message: "Needs review.",
          severity: "review",
        },
        {
          code: "odd",
          message: "odd",
          severity: "review",
        },
      ],
      metrics: {
        durationSec: 1.2,
        matchRatio: 0.72,
        tokenCount: 4,
      },
      riskLevel: "review",
      textEvidenceConfidence: "medium",
      timingConfidence: "none",
    });
  });
});
