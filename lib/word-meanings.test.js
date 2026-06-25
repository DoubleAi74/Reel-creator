import { describe, expect, it } from "vitest";

import {
  applyWordMeaningsToLines,
  lineHasMeanings,
  linesMissingMeanings,
  mergeMeaningWordsWithTiming,
} from "./word-meanings";

describe("lineHasMeanings", () => {
  it("is true only when a word has a non-empty gloss", () => {
    expect(lineHasMeanings({ words: [{ text: "a", gloss: "x" }] })).toBe(true);
    expect(lineHasMeanings({ words: [{ text: "a", gloss: "  " }] })).toBe(false);
    expect(lineHasMeanings({ words: [{ text: "a" }] })).toBe(false);
    expect(lineHasMeanings({})).toBe(false);
  });
});

describe("mergeMeaningWordsWithTiming", () => {
  it("returns timing words unchanged when there are no meanings", () => {
    const timing = [{ text: "a", start: 1, end: 2 }];
    expect(mergeMeaningWordsWithTiming(timing, [])).toBe(timing);
  });

  it("attaches positional timing when counts match", () => {
    const timing = [
      { text: "aaj", start: 1, end: 1.5 },
      { text: "se", start: 1.5, end: 2 },
    ];
    const meanings = [
      { text: "आज", gloss: "today", roman: "aaj" },
      { text: "से", gloss: "from", roman: "se" },
    ];
    expect(mergeMeaningWordsWithTiming(timing, meanings)).toEqual([
      { end: 1.5, gloss: "today", roman: "aaj", start: 1, text: "आज" },
      { end: 2, gloss: "from", roman: "se", start: 1.5, text: "से" },
    ]);
  });

  it("matches timing by text when counts differ, else null timing", () => {
    const timing = [{ text: "से", start: 3, end: 4 }];
    const meanings = [
      { text: "आज", gloss: "today", roman: "aaj" },
      { text: "से", gloss: "from", roman: "se" },
    ];
    expect(mergeMeaningWordsWithTiming(timing, meanings)).toEqual([
      { end: null, gloss: "today", roman: "aaj", start: null, text: "आज" },
      { end: 4, gloss: "from", roman: "se", start: 3, text: "से" },
    ]);
  });
});

describe("applyWordMeaningsToLines", () => {
  const lines = [
    { id: "l1", original: "आज से", words: [] },
    { id: "l2", original: "घर", words: [{ text: "घर", gloss: "home" }] },
  ];
  const meanings = [
    {
      line_number: 1,
      words: [
        { text: "आज", gloss: "today", roman: "aaj" },
        { text: "से", gloss: "from", roman: "se" },
      ],
    },
    { line_number: 2, words: [{ text: "घर", gloss: "house", roman: "ghar" }] },
  ];

  it("merges meanings onto matching line numbers", () => {
    const result = applyWordMeaningsToLines(lines, meanings);
    expect(result[0].words.map((w) => w.gloss)).toEqual(["today", "from"]);
    expect(result[1].words[0].gloss).toBe("house");
  });

  it("with onlyMissing leaves already-glossed lines untouched", () => {
    const result = applyWordMeaningsToLines(lines, meanings, {
      onlyMissing: true,
    });
    expect(result[0].words.map((w) => w.gloss)).toEqual(["today", "from"]);
    // l2 already had a gloss → unchanged
    expect(result[1]).toBe(lines[1]);
  });
});

describe("linesMissingMeanings", () => {
  it("reports indices of lines without gloss", () => {
    const missing = linesMissingMeanings([
      { words: [{ text: "a", gloss: "x" }] },
      { words: [{ text: "b" }] },
      { words: [] },
    ]);
    expect(missing.map((m) => m.index)).toEqual([1, 2]);
  });
});
