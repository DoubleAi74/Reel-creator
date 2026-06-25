import { describe, expect, it } from "vitest";

import {
  buildPageLines,
  buildPageLinesByHeight,
  buildScrollLines,
  calculateLinesPerPage,
  estimateLineWidth,
  estimateWrappedLineHeight,
  fitLayoutScale,
  measureTileWidth,
  prepareBoardLines,
  resolveWordInfo,
  splitWordsIntoRows,
  tokenize,
} from "./word-board";

describe("tokenize", () => {
  it("splits on whitespace and strips punctuation", () => {
    expect(tokenize("Hello, world! (test)")).toEqual(["Hello", "world", "test"]);
  });

  it("handles nullish input", () => {
    expect(tokenize(undefined)).toEqual([]);
    expect(tokenize("")).toEqual([]);
  });
});

describe("resolveWordInfo", () => {
  it("prefers explicit gloss/roman on the word", () => {
    const info = resolveWordInfo(
      { text: "आज", gloss: "today", roman: "aaj" },
      { romanization: "x y", translation: "a b" },
      0,
    );
    expect(info).toEqual({ english: "today", original: "आज", roman: "aaj" });
  });

  it("falls back positionally to line romanization/translation", () => {
    const info = resolveWordInfo(
      { text: "से" },
      { romanization: "aaj se", translation: "today from" },
      1,
    );
    expect(info).toEqual({ english: "from", original: "से", roman: "se" });
  });

  it("falls back to the original text for roman when nothing else exists", () => {
    const info = resolveWordInfo({ text: "word" }, {}, 5);
    expect(info).toEqual({ english: "", original: "word", roman: "word" });
  });
});

describe("prepareBoardLines", () => {
  it("builds display lines from words with backrefs", () => {
    const lines = prepareBoardLines([
      {
        id: "l1",
        original: "आज से",
        romanization: "aaj se",
        translation: "today from",
        words: [
          { text: "आज", gloss: "today", roman: "aaj" },
          { text: "से", gloss: "from", roman: "se" },
        ],
      },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].number).toBe(1);
    expect(lines[0].words[0]).toMatchObject({
      id: "l1-0",
      original: "आज",
      english: "today",
      roman: "aaj",
      wordIndex: 0,
      lineId: "l1",
      lineNumber: 1,
    });
  });

  it("tokenizes original text when a line has no words[]", () => {
    const lines = prepareBoardLines([
      { id: "l1", original: "one two three", words: [] },
    ]);
    expect(lines[0].words.map((w) => w.original)).toEqual([
      "one",
      "two",
      "three",
    ]);
  });
});

describe("measureTileWidth", () => {
  it("uses the heuristic fallback when no measurer is given", () => {
    const width = measureTileWidth({ original: "ab", english: "x" });
    expect(width).toBeGreaterThanOrEqual(52);
    expect(width).toBeLessThanOrEqual(132);
  });

  it("clamps to the 52-132 range", () => {
    expect(
      measureTileWidth({ original: "veryveryverylongword", english: "alsolong" }),
    ).toBeLessThanOrEqual(132);
    expect(measureTileWidth({ original: "i", english: "" })).toBeGreaterThanOrEqual(52);
  });

  it("uses the injected measurer when supplied", () => {
    const width = measureTileWidth(
      { original: "abc", english: "def" },
      { measureText: (text) => text.length * 10 },
    );
    // max(52, 3*10+28, 3*10+24) = 58
    expect(width).toBe(58);
  });
});

describe("estimateLineWidth", () => {
  it("sums tile widths plus gaps and padding", () => {
    const line = { words: [{ original: "a" }, { original: "b" }] };
    const width = estimateLineWidth(line, { boardScale: 1, isMobile: false });
    // two tiles >= 52 each + one 5px gap + padding 36
    expect(width).toBeGreaterThan(52 * 2);
  });
});

describe("estimateWrappedLineHeight", () => {
  it("splits words into visual rows when a line is too wide", () => {
    const rows = splitWordsIntoRows(
      Array.from({ length: 8 }, () => ({ original: "word" })),
      {
        availableWidth: 260,
        boardScale: 1,
        tileScale: 1,
      },
    );
    expect(rows.length).toBeGreaterThan(1);
  });

  it("splits mobile rows too, so enlarged tiles do not overflow off the edge", () => {
    const rows = splitWordsIntoRows(
      Array.from({ length: 8 }, () => ({ original: "word" })),
      {
        availableWidth: 200,
        isMobile: true,
        tileScale: 1.28,
      },
    );
    expect(rows.length).toBeGreaterThan(1);
  });

  it("counts wrapped tile rows as taller than one ruled row", () => {
    const line = { words: [{ original: "a" }, { original: "b" }] };
    const height = estimateWrappedLineHeight(line, {
      availableWidth: 100,
      boardScale: 1,
      tileScale: 1,
    });
    expect(height).toBe(109);
  });

  it("uses the mobile row rhythm when estimating wrapped mobile lines", () => {
    const line = { words: [{ original: "a" }, { original: "b" }] };
    const height = estimateWrappedLineHeight(line, {
      availableWidth: 70,
      isMobile: true,
      tileScale: 1,
    });
    expect(height).toBeCloseTo(91.2);
  });
});

describe("fitLayoutScale", () => {
  it("returns tileScale when lines fit", () => {
    const lines = [{ words: [{ original: "a" }] }];
    expect(
      fitLayoutScale(lines, { tileScale: 1, availableWidth: 10000 }),
    ).toBe(1);
  });

  it("shrinks below tileScale when content overflows, bounded by min", () => {
    const lines = [
      { words: Array.from({ length: 30 }, () => ({ original: "word" })) },
    ];
    const scale = fitLayoutScale(lines, {
      tileScale: 1,
      availableWidth: 200,
      isMobile: false,
    });
    expect(scale).toBeLessThan(1);
    expect(scale).toBeGreaterThanOrEqual(0.62);
  });
});

describe("calculateLinesPerPage", () => {
  it("returns a small count on mobile", () => {
    expect(
      calculateLinesPerPage({ isMobile: true, showRoman: false, lineCount: 10 }),
    ).toBe(4);
    expect(
      calculateLinesPerPage({ isMobile: true, showRoman: true, lineCount: 10 }),
    ).toBe(3);
  });

  it("computes a desktop count >= 1 and capped by line count", () => {
    const count = calculateLinesPerPage({
      isMobile: false,
      showRoman: false,
      tileScale: 1,
      boardScale: 0.823,
      boardWidth: 900,
      lineCount: 8,
    });
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(8);
  });

  it("reduces the desktop count when lines wrap", () => {
    const lines = [
      {
        words: Array.from({ length: 8 }, () => ({ original: "word" })),
      },
    ];
    const unwrapped = calculateLinesPerPage({
      isMobile: false,
      showRoman: false,
      tileScale: 1,
      boardScale: 0.823,
      boardWidth: 900,
      lineCount: 8,
    });
    const wrapped = calculateLinesPerPage({
      availableWidth: 260,
      isMobile: false,
      lines,
      showRoman: false,
      tileScale: 1,
      boardScale: 0.823,
      boardWidth: 900,
      lineCount: 8,
    });
    expect(wrapped).toBeLessThan(unwrapped);
  });
});

describe("page/scroll line builders", () => {
  const lines = prepareBoardLines(
    Array.from({ length: 7 }, (_, i) => ({
      id: `l${i}`,
      original: `line ${i}`,
      words: [{ text: `w${i}` }],
    })),
  );

  it("buildPageLines clamps page and slices", () => {
    const result = buildPageLines(lines, { page: 0, linesPerPage: 3 });
    expect(result.pageCount).toBe(3);
    expect(result.lines).toHaveLength(3);
    expect(result.lines[0].number).toBe(1);

    const lastPage = buildPageLines(lines, { page: 99, linesPerPage: 3 });
    expect(lastPage.page).toBe(2);
    expect(lastPage.lines).toHaveLength(1);
    expect(lastPage.lines[0].number).toBe(7);
  });

  it("packs page-mode lines by each line's actual wrapped height", () => {
    const shortLine = (id) => ({
      id,
      original: id,
      words: [{ text: id }],
    });
    const tallLine = {
      id: "tall",
      original: "tall line",
      words: [{ text: "one" }, { text: "two" }],
    };
    const variable = buildPageLinesByHeight(
      [shortLine("a"), shortLine("b"), shortLine("c"), tallLine],
      {
        availableHeight: 180,
        availableWidth: 100,
        boardScale: 1,
        tileScale: 1,
      },
    );

    expect(variable.lines).toHaveLength(3);
    expect(variable.pageCount).toBe(2);
    expect(variable.lines.map((line) => line.original)).toEqual(["a", "b", "c"]);
  });

  it("buildScrollLines returns every line with stable ids", () => {
    const scroll = buildScrollLines(lines);
    expect(scroll).toHaveLength(7);
    expect(scroll[0].id).toBe("scroll-0");
    expect(scroll[6].number).toBe(7);
  });
});
