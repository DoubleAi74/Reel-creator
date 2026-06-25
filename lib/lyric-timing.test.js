import { describe, expect, it } from "vitest";

import {
  alignLyricLinesToWordTimings,
  summarizeLyricTimingMatches,
  tokenizeForTiming,
} from "./lyric-timing";

describe("lyric timing alignment", () => {
  it("tokenizes punctuation without dropping combining marks", () => {
    expect(tokenizeForTiming("आज से, मेरा घर!")).toEqual([
      "आज",
      "से",
      "मेरा",
      "घर",
    ]);
  });

  it("aligns line starts and ends from timed words", () => {
    const words = [
      { word: "आज", start: 9.4, end: 9.6 },
      { word: "से", start: 9.6, end: 9.75 },
      { word: "तेरी", start: 9.75, end: 10.1 },
      { word: "गलियां", start: 10.1, end: 10.6 },
      { word: "मेरी", start: 10.6, end: 10.9 },
      { word: "हो", start: 10.9, end: 11.1 },
      { word: "गई", start: 11.1, end: 11.35 },
      { word: "आज", start: 12.3, end: 12.5 },
      { word: "से", start: 12.5, end: 12.65 },
      { word: "मेरा", start: 12.65, end: 13.0 },
      { word: "घर", start: 13.0, end: 13.25 },
    ];

    expect(
      alignLyricLinesToWordTimings(
        [
          { id: "line-1", original: "आज से तेरी गलियां मेरी हो गई" },
          { id: "line-2", original: "आज से मेरा घर" },
        ],
        words,
      ),
    ).toMatchObject([
      {
        confidence: "high",
        end: 11.35,
        id: "line-1",
        start: 9.4,
        timingSource: "word-match",
      },
      {
        confidence: "high",
        end: 13.25,
        id: "line-2",
        start: 12.3,
        timingSource: "word-match",
      },
    ]);
  });

  it("matches repeated lines in chronological order", () => {
    const words = [
      { word: "hello", start: 1, end: 1.2 },
      { word: "world", start: 1.2, end: 1.5 },
      { word: "hello", start: 9, end: 9.2 },
      { word: "world", start: 9.2, end: 9.5 },
    ];

    expect(
      alignLyricLinesToWordTimings(
        [
          { id: "first", original: "hello world" },
          { id: "second", original: "hello world" },
        ],
        words,
      ).map((match) => match.start),
    ).toEqual([1, 9]);
  });

  it("ignores zero-duration phantom words that would make the first line late", () => {
    const matches = alignLyricLinesToWordTimings(
      [
        { id: "line-1", original: "आज से तेरी सारी गलियां मेरी हो गई" },
        { id: "line-2", original: "आज से मेरा घर तेरा हो गया" },
      ],
      [
        { word: "आज", start: 41.4, end: 42.8 },
        { word: "से", start: 42.8, end: 43.18 },
        { word: "तेरी", start: 43.18, end: 44.26 },
        { word: "आज", start: 44.98, end: 44.99 },
        { word: "से", start: 44.99, end: 44.99 },
        { word: "तेरी", start: 44.99, end: 45.0 },
        { word: "गलियां", start: 45.16, end: 46.18 },
        { word: "मेरी", start: 46.18, end: 46.64 },
        { word: "हो", start: 46.64, end: 47.32 },
        { word: "गई", start: 47.32, end: 47.52 },
        { word: "आज", start: 47.52, end: 48.76 },
        { word: "से", start: 48.76, end: 49.3 },
        { word: "मेरा", start: 49.3, end: 50.58 },
        { word: "घर", start: 50.58, end: 51.18 },
        { word: "तेरा", start: 51.18, end: 51.94 },
        { word: "हो", start: 51.94, end: 52.54 },
        { word: "गया", start: 52.54, end: 53.44 },
      ],
      { duration: 60 },
    );

    expect(matches[0]).toMatchObject({
      confidence: "medium",
      matchRatio: 0.875,
      start: 41.4,
      timingSource: "word-match",
    });
    expect(matches[0].words.slice(0, 3)).toEqual([
      { end: 42.8, start: 41.4, text: "आज" },
      { end: 43.18, start: 42.8, text: "से" },
      { end: 44.26, start: 43.18, text: "तेरी" },
    ]);
    expect(matches[1]).toMatchObject({
      confidence: "high",
      start: 47.52,
    });
  });

  it("does not invent timings when no anchors exist", () => {
    const matches = alignLyricLinesToWordTimings(
      [{ id: "line-1", original: "completely different lyric" }],
      [
        { word: "hello", start: 1, end: 1.2 },
        { word: "world", start: 1.2, end: 1.5 },
      ],
    );

    expect(matches[0]).toMatchObject({
      confidence: "none",
      start: null,
      timingSource: "none",
    });
  });

  it("exposes per-word timings from matched token pairs", () => {
    const matches = alignLyricLinesToWordTimings(
      [{ id: "line-1", original: "hello, world!" }],
      [
        { word: "hello", start: 1, end: 1.4 },
        { word: "world", start: 1.4, end: 1.9 },
      ],
    );

    expect(matches[0].words).toEqual([
      { end: 1.4, start: 1, text: "hello," },
      { end: 1.9, start: 1.4, text: "world!" },
    ]);
  });

  it("accepts short lines with one miss so the global pass can place them", () => {
    const matches = alignLyricLinesToWordTimings(
      [
        { id: "line-1", original: "alpha beta" },
        { id: "line-2", original: "one two three" },
        { id: "line-3", original: "omega" },
      ],
      [
        { word: "alpha", start: 1, end: 1.2 },
        { word: "beta", start: 1.2, end: 1.5 },
        { word: "one", start: 5, end: 5.2 },
        { word: "three", start: 5.8, end: 6.1 },
        { word: "omega", start: 9, end: 9.3 },
      ],
      { duration: 12 },
    );

    expect(matches[1]).toMatchObject({
      confidence: "low",
      id: "line-2",
      matchRatio: 2 / 3,
      start: 5,
      timingSource: "word-match",
    });
  });

  it("interpolates unmatched lines between direct word matches", () => {
    const matches = alignLyricLinesToWordTimings(
      [
        { id: "line-1", original: "alpha" },
        { id: "line-2", original: "missing lyric" },
        { id: "line-3", original: "omega" },
      ],
      [
        { word: "alpha", start: 2, end: 2.5 },
        { word: "omega", start: 8, end: 8.5 },
      ],
      { duration: 12 },
    );

    expect(matches).toMatchObject([
      { confidence: "high", start: 2 },
      { confidence: "estimated", timingSource: "interpolated" },
      { confidence: "high", start: 8 },
    ]);
    expect(matches[1].start).toBeGreaterThan(2);
    expect(matches[1].start).toBeLessThan(8);
  });

  it("uses weighted interpolation for missing runs", () => {
    const matches = alignLyricLinesToWordTimings(
      [
        { id: "line-1", original: "alpha" },
        { id: "line-2", original: "short" },
        { id: "line-3", original: "this missing line is much longer" },
        { id: "line-4", original: "omega" },
      ],
      [
        { word: "alpha", start: 0, end: 0.4 },
        { word: "omega", start: 10, end: 10.4 },
      ],
      { duration: 12 },
    );

    expect(matches[1]).toMatchObject({
      confidence: "estimated",
      timingSource: "interpolated",
    });
    expect(matches[2]).toMatchObject({
      confidence: "estimated",
      timingSource: "interpolated",
    });
    expect(matches[2].start - matches[1].start).toBeGreaterThan(
      matches[1].start - matches[0].start,
    );
  });

  it("skips a tempting far match to preserve nearby later lines", () => {
    const matches = alignLyricLinesToWordTimings(
      [
        { id: "line-1", original: "start line" },
        { id: "line-2", original: "far repeat only" },
        { id: "line-3", original: "near chorus" },
        { id: "line-4", original: "after chorus" },
      ],
      [
        { word: "start", start: 1, end: 1.2 },
        { word: "line", start: 1.2, end: 1.5 },
        { word: "near", start: 5, end: 5.2 },
        { word: "chorus", start: 5.2, end: 5.5 },
        { word: "after", start: 8, end: 8.2 },
        { word: "chorus", start: 8.2, end: 8.5 },
        { word: "far", start: 20, end: 20.2 },
        { word: "repeat", start: 20.2, end: 20.5 },
        { word: "only", start: 20.5, end: 20.8 },
      ],
      { duration: 24 },
    );

    expect(matches).toMatchObject([
      { confidence: "high", id: "line-1", start: 1 },
      { confidence: "estimated", id: "line-2" },
      { confidence: "high", id: "line-3", start: 5 },
      { confidence: "high", id: "line-4", start: 8 },
    ]);
  });

  it("matches common short Devanagari spelling variants", () => {
    const matches = alignLyricLinesToWordTimings(
      [{ id: "line-1", original: "मेरे खाबों का अमबर" }],
      [
        { word: "मेरे", start: 10, end: 10.2 },
        { word: "खाबों", start: 10.2, end: 10.6 },
        { word: "का", start: 10.6, end: 10.8 },
        { word: "अंबर", start: 10.8, end: 11.4 },
      ],
    );

    expect(matches[0]).toMatchObject({
      confidence: "high",
      matchRatio: 1,
      start: 10,
    });
  });

  it("places repeated Hindi chorus lines at distinct occurrences", () => {
    const matches = alignLyricLinesToWordTimings(
      [
        { id: "line-1", original: "आज से तेरा हो गया" },
        { id: "line-2", original: "तेरे सीने में जो दिल है" },
        { id: "line-3", original: "आज से तेरा हो गया" },
        { id: "line-4", original: "तेरे सीने में जो दिल है" },
      ],
      [
        { word: "आज", start: 10, end: 10.2 },
        { word: "से", start: 10.2, end: 10.4 },
        { word: "तेरा", start: 10.4, end: 10.8 },
        { word: "हो", start: 10.8, end: 11 },
        { word: "गया", start: 11, end: 11.3 },
        { word: "तेरे", start: 15, end: 15.3 },
        { word: "सीने", start: 15.3, end: 15.8 },
        { word: "में", start: 15.8, end: 16 },
        { word: "जो", start: 16, end: 16.2 },
        { word: "दिल", start: 16.2, end: 16.6 },
        { word: "है", start: 16.6, end: 17 },
        { word: "आज", start: 30, end: 30.2 },
        { word: "से", start: 30.2, end: 30.4 },
        { word: "तेरा", start: 30.4, end: 30.8 },
        { word: "हो", start: 30.8, end: 31 },
        { word: "गया", start: 31, end: 31.3 },
        { word: "तेरे", start: 35, end: 35.3 },
        { word: "सीने", start: 35.3, end: 35.8 },
        { word: "में", start: 35.8, end: 36 },
        { word: "जो", start: 36, end: 36.2 },
        { word: "दिल", start: 36.2, end: 36.6 },
        { word: "है", start: 36.6, end: 37 },
      ],
    );

    expect(matches.map((match) => match.start)).toEqual([10, 15, 30, 35]);
  });

  it("summarizes high, medium, low, estimated, and unmatched lines", () => {
    expect(
      summarizeLyricTimingMatches([
        { confidence: "high" },
        { confidence: "medium", timingSource: "repeat-template" },
        { confidence: "low", start: 5 },
        { confidence: "estimated" },
        { confidence: "none" },
      ]),
    ).toEqual({
      estimatedCount: 1,
      highConfidenceCount: 1,
      lineCount: 5,
      lowConfidenceCount: 1,
      matchedCount: 2,
      mediumConfidenceCount: 1,
      repeatTemplateCount: 1,
      timedCount: 4,
      unmatchedCount: 1,
      wordMatchedCount: 2,
    });
  });
});
