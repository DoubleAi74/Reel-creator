import { describe, expect, it } from "vitest";

import { applyGptQualityVerdicts, auditLyricTimingResult } from "./lyric-quality";

function audit(overrides = {}) {
  return auditLyricTimingResult({
    audio: { duration: 20, endOffset: null, startOffset: 0 },
    canonicalSource: "user",
    gapFillSummary: {
      pass2: { errorCount: 0 },
      pass3: { errorCount: 0 },
    },
    lines: [],
    matches: [],
    ...overrides,
  });
}

describe("lyric quality auditing", () => {
  it("marks a high-confidence direct match as ok", () => {
    const result = audit({
      lines: [{ original: "hello world" }],
      matches: [
        {
          confidence: "high",
          end: 2,
          matchRatio: 1,
          matchedWordCount: 2,
          start: 1,
          timingSource: "word-match",
          words: [
            { end: 1.4, start: 1, text: "hello" },
            { end: 2, start: 1.4, text: "world" },
          ],
        },
      ],
    });

    expect(result.qualities[0]).toMatchObject({
      riskLevel: "ok",
      textEvidenceConfidence: "high",
      timingConfidence: "high",
    });
    expect(result.qualities[0].flags).toEqual([]);
    expect(result.qualitySummary).toMatchObject({
      highRiskLineCount: 0,
      okLineCount: 1,
      reviewLineCount: 0,
    });
  });

  it("flags an interpolated line with no matched words as unsupported", () => {
    const result = audit({
      lines: [{ original: "missing lyric" }],
      matches: [
        {
          confidence: "estimated",
          end: 5,
          matchRatio: 0,
          matchedWordCount: 0,
          start: 4,
          timingSource: "interpolated",
          words: [],
        },
      ],
    });

    expect(result.qualities[0]).toMatchObject({
      riskLevel: "review",
      textEvidenceConfidence: "none",
      timingConfidence: "low",
    });
    expect(result.qualities[0].flags.map((flag) => flag.code)).toEqual(
      expect.arrayContaining(["unsupported_text", "timing_estimated"]),
    );
  });

  it("escalates weak generated evidence more than user-supplied evidence", () => {
    const lines = [{ original: "alpha beta gamma delta" }];
    const matches = [
      {
        confidence: "low",
        end: 3,
        matchRatio: 0.5,
        matchedWordCount: 2,
        start: 1,
        timingSource: "word-match",
        words: [
          { end: 1.4, start: 1, text: "alpha" },
          { end: 3, start: 2.5, text: "delta" },
        ],
      },
    ];
    const userResult = audit({ canonicalSource: "user", lines, matches });
    const generatedResult = audit({
      canonicalSource: "generated",
      lines,
      matches,
    });

    expect(userResult.qualities[0].riskLevel).toBe("review");
    expect(generatedResult.qualities[0].riskLevel).toBe("high");
    expect(generatedResult.qualities[0].flags.map((flag) => flag.code)).toEqual(
      expect.arrayContaining([
        "generated_not_high_evidence",
        "weak_text_evidence",
      ]),
    );
  });

  it("flags out-of-order line starts as high risk", () => {
    const result = audit({
      lines: [{ original: "first line" }, { original: "second line" }],
      matches: [
        {
          confidence: "high",
          end: 5.5,
          matchRatio: 1,
          matchedWordCount: 2,
          start: 5,
          timingSource: "word-match",
          words: [{ end: 5.5, start: 5, text: "first" }],
        },
        {
          confidence: "high",
          end: 5.2,
          matchRatio: 1,
          matchedWordCount: 2,
          start: 4.8,
          timingSource: "word-match",
          words: [{ end: 5.2, start: 4.8, text: "second" }],
        },
      ],
    });

    expect(result.qualities[1].riskLevel).toBe("high");
    expect(result.qualities[1].flags.map((flag) => flag.code)).toContain(
      "timing_out_of_order",
    );
  });

  it("flags suspicious duration and crowded neighboring starts without changing timing", () => {
    const result = audit({
      lines: [
        { original: "alpha beta gamma delta" },
        { original: "next lyric" },
      ],
      matches: [
        {
          confidence: "high",
          end: 1.1,
          matchRatio: 1,
          matchedWordCount: 4,
          start: 1,
          timingSource: "word-match",
          words: [{ end: 1.1, start: 1, text: "alpha" }],
        },
        {
          confidence: "high",
          end: 1.7,
          matchRatio: 1,
          matchedWordCount: 2,
          start: 1.3,
          timingSource: "word-match",
          words: [{ end: 1.7, start: 1.3, text: "next" }],
        },
      ],
    });

    expect(result.qualities[0].metrics).toMatchObject({
      durationSec: 0.10000000000000009,
      gapAfterSec: 0.30000000000000004,
    });
    expect(result.qualities[0].flags.map((flag) => flag.code)).toEqual(
      expect.arrayContaining(["crowded_neighbor", "suspicious_short_duration"]),
    );
    expect(result.qualities[0].riskLevel).toBe("review");
  });

  it("flags zero-duration matched word anchors as high-risk timing evidence", () => {
    const result = audit({
      lines: [{ original: "आज से तेरी गलियां" }],
      matches: [
        {
          confidence: "medium",
          end: 47,
          matchRatio: 1,
          matchedWordCount: 4,
          start: 44.98,
          timingSource: "word-match",
          words: [
            { end: 44.98, start: 44.98, text: "आज" },
            { end: 45.1, start: 45, text: "से" },
            { end: 46, start: 45.4, text: "तेरी" },
            { end: 47, start: 46.2, text: "गलियां" },
          ],
        },
      ],
    });

    expect(result.qualities[0].riskLevel).toBe("high");
    expect(result.qualities[0].flags).toEqual(
      expect.arrayContaining([
        {
          code: "zero_duration_word_anchor",
          message:
            "Matched word evidence contains zero-duration or implausibly tiny timestamp anchors.",
          severity: "high",
        },
      ]),
    );
  });

  it("flags repeat-template timing internally without making it high risk", () => {
    const result = audit({
      lines: [{ original: "repeat me" }],
      matches: [
        {
          confidence: "medium",
          end: 8,
          matchRatio: 1,
          matchedWordCount: 2,
          start: 7,
          timingSource: "repeat-template",
          words: [
            { end: 7.4, start: 7, text: "repeat" },
            { end: 8, start: 7.4, text: "me" },
          ],
        },
      ],
    });

    expect(result.qualities[0]).toMatchObject({
      riskLevel: "ok",
      timingConfidence: "medium",
    });
    expect(result.qualities[0].flags).toEqual([
      {
        code: "repeat_template_timing",
        message: "Timing was copied from a matching repeated lyric pattern.",
        severity: "info",
      },
    ]);
  });

  it("flags repeated lyric copies that are timed implausibly close together", () => {
    const result = audit({
      lines: [
        { original: "same repeated lyric phrase" },
        { original: "small bridge" },
        { original: "same repeated lyric phrase" },
      ],
      matches: [
        {
          confidence: "high",
          end: 10.9,
          matchRatio: 1,
          matchedWordCount: 4,
          start: 10,
          timingSource: "word-match",
          words: [],
        },
        {
          confidence: "high",
          end: 11.9,
          matchRatio: 1,
          matchedWordCount: 2,
          start: 11.5,
          timingSource: "word-match",
          words: [],
        },
        {
          confidence: "high",
          end: 12.6,
          matchRatio: 1,
          matchedWordCount: 4,
          start: 12.2,
          timingSource: "word-match",
          words: [],
        },
      ],
    });

    expect(result.qualities[2].riskLevel).toBe("high");
    expect(result.qualities[2].flags.map((flag) => flag.code)).toContain(
      "repeated_line_too_close",
    );
  });

  it("preserves summary-only deterministic flags when GPT verdicts are merged", () => {
    const deterministicAudit = audit({
      canonicalSource: "generated",
      gapFillSummary: {
        pass2: { errorCount: 1 },
        pass3: { errorCount: 0 },
      },
      lines: [{ original: "hello world" }],
      matches: [
        {
          confidence: "high",
          end: 2,
          matchRatio: 1,
          matchedWordCount: 2,
          start: 1,
          timingSource: "word-match",
          words: [],
        },
      ],
    });

    const result = applyGptQualityVerdicts(deterministicAudit, [
      { line_number: 1, verdict: "supported" },
    ]);

    expect(result.qualitySummary).toMatchObject({
      auditStatus: "passed",
      flagsByCode: {
        gap_fill_error: 1,
      },
      generatedLineCount: 1,
    });
  });
});
