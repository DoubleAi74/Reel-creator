import { describe, expect, it } from "vitest";

import { buildScrollLines, prepareBoardLines } from "./word-board";
import {
  FOLLOW_LINE_GRACE_SECONDS,
  FOLLOW_WORD_GAP_HOLD_SECONDS,
  hasFollowAudioTiming,
  resolveFollowAudioState,
} from "./word-board-follow";

function boardLines(rawLines) {
  return buildScrollLines(prepareBoardLines(rawLines));
}

describe("word board follow audio resolver", () => {
  it("exports timing constants", () => {
    expect(FOLLOW_LINE_GRACE_SECONDS).toBe(0.1);
    expect(FOLLOW_WORD_GAP_HOLD_SECONDS).toBe(1);
  });

  it("disables follow when no usable word timing data exists", () => {
    const lines = boardLines([
      {
        id: "l1",
        original: "one two",
        start: 1,
        words: [{ text: "one" }, { text: "two" }],
      },
    ]);

    expect(hasFollowAudioTiming(lines)).toBe(false);
    expect(resolveFollowAudioState(lines, 1.2)).toEqual({
      activeDisplayLineId: null,
      activeSourceLineId: null,
      available: false,
      currentWordKeys: [],
      passedWordKeys: [],
    });
  });

  it("keeps everything normal before the first lyric", () => {
    const lines = boardLines([
      {
        id: "l1",
        original: "one",
        start: 1,
        words: [{ text: "one", start: 1, end: 1.4 }],
      },
    ]);

    expect(resolveFollowAudioState(lines, 0.9)).toMatchObject({
      activeDisplayLineId: null,
      activeSourceLineId: null,
      currentWordKeys: [],
      passedWordKeys: [],
    });
  });

  it("activates a line before its first word without a current word", () => {
    const lines = boardLines([
      {
        id: "l1",
        original: "one",
        start: 1,
        words: [{ text: "one", start: 1.4, end: 1.8 }],
      },
    ]);

    expect(resolveFollowAudioState(lines, 1.1)).toMatchObject({
      activeDisplayLineId: "scroll-0",
      activeSourceLineId: "l1",
      currentWordKeys: [],
      passedWordKeys: [],
    });
  });

  it("marks the word inside its timed range as current", () => {
    const lines = boardLines([
      {
        id: "l1",
        original: "one two",
        start: 1,
        words: [
          { text: "one", start: 1, end: 1.4 },
          { text: "two", start: 1.6, end: 2 },
        ],
      },
    ]);

    expect(resolveFollowAudioState(lines, 1.7).currentWordKeys).toEqual(["l1:1"]);
  });

  it("marks passed words across earlier lines", () => {
    const lines = boardLines([
      {
        id: "l1",
        original: "one two",
        start: 1,
        words: [
          { text: "one", start: 1, end: 1.4 },
          { text: "two", start: 1.6, end: 2 },
        ],
      },
      {
        id: "l2",
        original: "three four",
        start: 3,
        words: [
          { text: "three", start: 3.1, end: 3.4 },
          { text: "four", start: 3.6, end: 4 },
        ],
      },
    ]);

    expect(resolveFollowAudioState(lines, 3.7)).toMatchObject({
      activeSourceLineId: "l2",
      currentWordKeys: ["l2:1"],
      passedWordKeys: ["l1:0", "l1:1", "l2:0"],
    });
  });

  it("marks all timed words passed after the final lyric", () => {
    const lines = boardLines([
      {
        id: "l1",
        original: "one",
        start: 1,
        words: [{ text: "one", start: 1, end: 1.4 }],
      },
      {
        id: "l2",
        original: "two",
        start: 3,
        words: [{ text: "two", start: 3.2, end: 3.6 }],
      },
    ]);

    expect(resolveFollowAudioState(lines, 4)).toMatchObject({
      activeDisplayLineId: null,
      activeSourceLineId: null,
      currentWordKeys: [],
      passedWordKeys: ["l1:0", "l2:0"],
    });
  });

  it("marks overlapping words as current together", () => {
    const lines = boardLines([
      {
        id: "l1",
        original: "one two",
        start: 1,
        words: [
          { text: "one", start: 1, end: 1.8 },
          { text: "two", start: 1.4, end: 2 },
        ],
      },
    ]);

    expect(resolveFollowAudioState(lines, 1.5).currentWordKeys).toEqual([
      "l1:0",
      "l1:1",
    ]);
  });

  it("keeps the previous word current through a gap of 1000ms or less", () => {
    const lines = boardLines([
      {
        id: "l1",
        original: "one two",
        start: 1,
        words: [
          { text: "one", start: 1, end: 1.2 },
          { text: "two", start: 2.2, end: 2.6 },
        ],
      },
    ]);

    expect(resolveFollowAudioState(lines, 1.8).currentWordKeys).toEqual(["l1:0"]);
  });

  it("shows no current word during a gap longer than 1000ms", () => {
    const lines = boardLines([
      {
        id: "l1",
        original: "one two",
        start: 1,
        words: [
          { text: "one", start: 1, end: 1.2 },
          { text: "two", start: 2.31, end: 2.7 },
        ],
      },
    ]);

    expect(resolveFollowAudioState(lines, 1.8)).toMatchObject({
      activeSourceLineId: "l1",
      currentWordKeys: [],
    });
  });

  it("applies 100ms line grace after previous lines and before next lines", () => {
    const lines = boardLines([
      {
        id: "l1",
        original: "one",
        start: 1,
        words: [{ text: "one", start: 1, end: 1.5 }],
      },
      {
        id: "l2",
        original: "two",
        start: 5,
        words: [{ text: "two", start: 5, end: 5.4 }],
      },
    ]);

    expect(resolveFollowAudioState(lines, 1.59).activeSourceLineId).toBe("l1");
    expect(resolveFollowAudioState(lines, 1.62).activeSourceLineId).toBeNull();
    expect(resolveFollowAudioState(lines, 4.92).activeSourceLineId).toBe("l2");
    expect(resolveFollowAudioState(lines, 4.85).activeSourceLineId).toBeNull();
  });

  // A line must light up when its own words are sung, even when the previous
  // line's word timings overlap into it (common with compressed auto-timing).
  // Previously the line's window was clamped to the previous line's last word
  // end, so the whole line stayed dark until then — highlighting only after the
  // playhead had already moved through it.
  it("activates a line as soon as its words are sung, despite an overlapping previous line", () => {
    const lines = boardLines([
      {
        id: "l1",
        original: "a1 a2",
        start: 1,
        // a2 runs long (until 4), overlapping into l2's span.
        words: [
          { text: "a1", start: 1, end: 2 },
          { text: "a2", start: 2, end: 4 },
        ],
      },
      {
        id: "l2",
        original: "b1 b2",
        start: 2.5,
        words: [
          { text: "b1", start: 2.5, end: 3 },
          { text: "b2", start: 3, end: 3.5 },
        ],
      },
    ]);

    // While l2's first word is being sung (2.6s), l2 is active — not l1 — and its
    // word is the current one.
    expect(resolveFollowAudioState(lines, 2.6)).toMatchObject({
      activeSourceLineId: "l2",
      currentWordKeys: ["l2:0"],
    });
    // l1 is still active just before l2's first word starts.
    expect(resolveFollowAudioState(lines, 2.3).activeSourceLineId).toBe("l1");
  });

  // Word timing is authoritative. Auto-timed `line.start` values are frequently
  // compressed and land before the words are actually sung, so a word may be
  // sung at or after the NEXT line's nominal start. Such a word must still be
  // followed (highlighted current, then shaded passed) rather than dropped.
  it("follows a word sung after the next line's nominal start", () => {
    const lines = boardLines([
      {
        id: "l1",
        original: "a b c",
        start: 1,
        words: [
          { text: "a", start: 1, end: 1.3 },
          { text: "b", start: 1.4, end: 1.7 },
          // Sung well after l2's compressed line.start of 1.5; previously dropped.
          { text: "c", start: 1.9, end: 2.6 },
        ],
      },
      {
        id: "l2",
        original: "d e",
        start: 1.5,
        words: [
          { text: "d", start: 2.7, end: 3 },
          { text: "e", start: 3.1, end: 3.4 },
        ],
      },
    ]);

    // The clipped word is now current while it is actually sung.
    expect(resolveFollowAudioState(lines, 2).currentWordKeys).toEqual(["l1:2"]);
    // And it shades passed once the playhead moves on, with no stray tile left.
    expect(resolveFollowAudioState(lines, 3)).toMatchObject({
      activeSourceLineId: "l2",
      currentWordKeys: ["l2:0"],
      passedWordKeys: ["l1:0", "l1:1", "l1:2"],
    });
  });

  // The whole-line regression: every word of a line is sung after the next
  // line's nominal start, so the entire line used to vanish from follow mode.
  it("follows a line whose words are all sung past the next line start", () => {
    const lines = boardLines([
      {
        id: "l1",
        original: "mera ghar",
        start: 43.43,
        words: [
          { text: "mera", start: 45.13, end: 46.37 },
          { text: "ghar", start: 46.37, end: 46.97 },
        ],
      },
      {
        id: "l2",
        original: "tera",
        start: 44.98,
        words: [{ text: "tera", start: 47, end: 48 }],
      },
    ]);

    // The line highlights and follows while it is actually being sung.
    expect(resolveFollowAudioState(lines, 46)).toMatchObject({
      activeSourceLineId: "l1",
      currentWordKeys: ["l1:0"],
    });
    // Its words shade passed once the next line is sung.
    expect(resolveFollowAudioState(lines, 47.5)).toMatchObject({
      activeSourceLineId: "l2",
      currentWordKeys: ["l2:0"],
      passedWordKeys: ["l1:0", "l1:1"],
    });
  });

  // Nothing at or after the current word may shade, even when a later word has
  // out-of-order timing that places its start before the playhead.
  it("never shades a tile ahead of the current word, even with disordered timing", () => {
    const lines = boardLines([
      {
        id: "l1",
        original: "a b c",
        start: 1,
        words: [
          { text: "a", start: 1, end: 1.4 },
          { text: "b", start: 3, end: 3.4 },
          // c appears after b but is timed earlier (disorder). It is ahead of
          // the current word in reading order, so it must NOT shade.
          { text: "c", start: 1.6, end: 2 },
        ],
      },
    ]);

    // At 3.2, b is current; only a (behind it) is passed. c stays normal.
    expect(resolveFollowAudioState(lines, 3.2)).toMatchObject({
      currentWordKeys: ["l1:1"],
      passedWordKeys: ["l1:0"],
    });
  });

  // Real-data regression (tilak line): the last word's timing is an out-of-order
  // duplicate copied from an earlier word, carrying a start far before the
  // playhead. It must not drag the passed region past the current word — the
  // words between the current word and that stray duplicate stay normal.
  it("does not shade words after the current word when a later word has stale duplicate timing", () => {
    const lines = boardLines([
      {
        id: "t",
        original: "tere mathe ke kumkum ko main tilak laga ke ghungunga",
        start: 130.36,
        words: [
          { text: "tere", start: 130.36, end: 131.76 },
          { text: "mathe", start: 131.76, end: 132.78 },
          { text: "ke", start: 139.98, end: 141.06 },
          { text: "kumkum", start: null, end: null },
          { text: "ko", start: 142.68, end: 142.9 },
          { text: "main", start: 142.9, end: 143.44 },
          { text: "tilak", start: 143.44, end: 143.92 },
          { text: "laga", start: 143.92, end: 144.64 },
          // Stale duplicate of the 3rd word's timing, out of order at line end.
          { text: "ke", start: 139.98, end: 141.06 },
          { text: "ghungunga", start: 144.9, end: 146 },
        ],
      },
    ]);

    const state = resolveFollowAudioState(lines, 143.2);
    expect(state.currentWordKeys).toEqual(["t:5"]);
    // Everything before "main" shades (incl. untimed "kumkum")...
    expect(state.passedWordKeys).toEqual(["t:0", "t:1", "t:2", "t:3", "t:4"]);
    // ...and nothing from "tilak" onward does.
    expect(state.passedWordKeys).not.toContain("t:6");
    expect(state.passedWordKeys).not.toContain("t:7");
    expect(state.passedWordKeys).not.toContain("t:8");
  });

  // Same stale-duplicate line: while the real "ke" (t:2) is sung at ~140s, ONLY
  // it is current. The duplicate "ke" (t:8) shares its timing but sits after
  // not-yet-sung words, so it is unreachable and must not also light as current.
  it("marks only the in-order word current when a duplicate shares its timing", () => {
    const lines = boardLines([
      {
        id: "t",
        original: "tere mathe ke kumkum ko main tilak laga ke ghungunga",
        start: 130.36,
        words: [
          { text: "tere", start: 130.36, end: 131.76 },
          { text: "mathe", start: 131.76, end: 132.78 },
          { text: "ke", start: 139.98, end: 141.06 },
          { text: "kumkum", start: null, end: null },
          { text: "ko", start: 142.68, end: 142.9 },
          { text: "main", start: 142.9, end: 143.44 },
          { text: "tilak", start: 143.44, end: 143.92 },
          { text: "laga", start: 143.92, end: 144.64 },
          { text: "ke", start: 139.98, end: 141.06 },
          { text: "ghungunga", start: 144.9, end: 146 },
        ],
      },
    ]);

    // Only the reachable "ke" is current — not both.
    expect(resolveFollowAudioState(lines, 140).currentWordKeys).toEqual(["t:2"]);

    // In the gap after it (no current word), the stale duplicate must not drag
    // the passed region forward: only words up to the real "ke" shade, and the
    // future words (ko/main/tilak/laga/duplicate ke) do NOT flash passed.
    const gap = resolveFollowAudioState(lines, 141.5);
    expect(gap.currentWordKeys).toEqual([]);
    expect(gap.passedWordKeys).toEqual(["t:0", "t:1", "t:2"]);
  });

  it("leaves a trailing untimed word normal when nothing is sung after it", () => {
    const lines = boardLines([
      {
        id: "l1",
        original: "one two",
        start: 1,
        words: [
          { text: "one", start: 1, end: 1.4 },
          { text: "two" },
        ],
      },
    ]);

    // "two" is untimed and nothing is sung after it, so it stays normal.
    expect(resolveFollowAudioState(lines, 2).passedWordKeys).toEqual(["l1:0"]);
  });

  // Real-data regression: lines often end with an untimed word (e.g. trailing
  // "गई"), or carry an untimed word between sung words. Once the playhead has
  // moved past such a word it must shade passed, never linger as a stray tile.
  it("shades untimed words behind the playhead as passed", () => {
    const lines = boardLines([
      {
        id: "l1",
        original: "aaj se teri ho gai",
        start: 59.42,
        words: [
          { text: "aaj", start: 59.42, end: 60.82 },
          { text: "se", start: 60.82, end: 61.24 },
          { text: "ho", start: 61.24, end: 65.3 },
          // Trailing untimed word, as produced by the auto-timer.
          { text: "gai", start: null, end: null },
        ],
      },
      {
        id: "l2",
        original: "aaj se mera ho gaya",
        start: 65.96,
        words: [
          { text: "aaj", start: 65.96, end: 66.82 },
          { text: "se", start: 66.82, end: 67.34 },
        ],
      },
    ]);

    // While l2's first word is current, l1 is fully behind the playhead —
    // including its untimed trailing "gai", which must shade passed (not stay
    // cream). l2:0 is the current word, so it is not in the passed set.
    const state = resolveFollowAudioState(lines, 66.5);
    expect(state.currentWordKeys).toEqual(["l2:0"]);
    expect(state.passedWordKeys).toContain("l1:3");
    expect(state.passedWordKeys).toEqual(["l1:0", "l1:1", "l1:2", "l1:3"]);
  });

  // An untimed word sitting between two sung words shades passed as soon as a
  // later word becomes current (the "skipped tile" case).
  it("shades an untimed word between sung words once a later word is current", () => {
    const lines = boardLines([
      {
        id: "l1",
        original: "aaj se tera gham mera",
        start: 77.84,
        words: [
          { text: "aaj", start: 77.84, end: 78.88 },
          { text: "se", start: 78.88, end: 79.36 },
          { text: "tera", start: 79.36, end: 80.8 },
          // Untimed, sandwiched between sung words.
          { text: "gham", start: null, end: null },
          { text: "mera", start: 81.06, end: 82.04 },
        ],
      },
    ]);

    const state = resolveFollowAudioState(lines, 81.5);
    expect(state.currentWordKeys).toEqual(["l1:4"]);
    expect(state.passedWordKeys).toContain("l1:3");
  });
});
