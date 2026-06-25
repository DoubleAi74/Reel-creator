import { describe, expect, it } from "vitest";

import {
  clampLineStartsToSection,
  clampTimeToSection,
  DEFAULT_LYRIC_LEAD_IN_MS,
  findActiveLine,
  getFrameDriftMilliseconds,
  getLineDisplayStart,
  getLineStartFrame,
  getSectionDurationInFrames,
  getSectionFrameFromTime,
  getSectionBounds,
  getSectionDuration,
  getTimedLines,
  isSectionWithinLimit,
  MAX_LYRIC_LEAD_IN_MS,
  MAX_SECTION_DURATION_SECONDS,
  MIN_LYRIC_LEAD_IN_MS,
  normalizeAudioSection,
  normalizeLyricLeadInMs,
} from "./timing";

describe("timing helpers", () => {
  describe("getSectionBounds", () => {
    it("clamps offsets inside the track duration", () => {
      expect(
        getSectionBounds({
          duration: 190,
          endOffset: 300,
          startOffset: 12,
        }),
      ).toEqual({
        duration: 190,
        endOffset: 190,
        sectionDuration: 178,
        startOffset: 12,
      });
    });

    it("keeps the end offset from falling before the start offset", () => {
      expect(
        getSectionBounds({
          duration: 120,
          endOffset: 20,
          startOffset: 45,
        }),
      ).toEqual({
        duration: 120,
        endOffset: 45,
        sectionDuration: 0,
        startOffset: 45,
      });
    });
  });

  describe("normalizeAudioSection", () => {
    it("preserves an open end while clamping the start inside the track", () => {
      expect(
        normalizeAudioSection({
          duration: 120,
          endOffset: null,
          startOffset: 150,
        }),
      ).toEqual({
        duration: 120,
        endOffset: null,
        startOffset: 120,
      });
    });
  });

  describe("clampTimeToSection", () => {
    const audio = {
      duration: 180,
      endOffset: 42,
      startOffset: 10,
    };

    it("clamps times below the section start", () => {
      expect(clampTimeToSection(2, audio)).toBe(10);
    });

    it("clamps times above the section end", () => {
      expect(clampTimeToSection(96, audio)).toBe(42);
    });
  });

  describe("clampLineStartsToSection", () => {
    it("pulls timed lines back inside the current section and counts the changes", () => {
      expect(
        clampLineStartsToSection(
          [
            { id: "line-1", original: "early", start: 4 },
            { id: "line-2", original: "inside", start: 18.5 },
            { id: "line-3", original: "late", start: 35 },
            { id: "line-4", original: "untimed", start: null },
          ],
          {
            duration: 90,
            endOffset: 30,
            startOffset: 10,
          },
        ),
      ).toEqual({
        clampedCount: 2,
        lines: [
          { id: "line-1", original: "early", start: 10 },
          { id: "line-2", original: "inside", start: 18.5 },
          { id: "line-3", original: "late", start: 30 },
          { id: "line-4", original: "untimed", start: null },
        ],
      });
    });
  });

  describe("getSectionDuration and limit guard", () => {
    it("returns the active section length", () => {
      expect(
        getSectionDuration({
          duration: 240,
          endOffset: 98.5,
          startOffset: 12.25,
        }),
      ).toBe(86.25);
    });

    it("accepts sections up to the configured six-minute cap", () => {
      expect(
        isSectionWithinLimit({
          duration: 420,
          endOffset: 360,
          startOffset: 0,
        }),
      ).toBe(true);

      expect(
        isSectionWithinLimit({
          duration: 420,
          endOffset: MAX_SECTION_DURATION_SECONDS + 1,
          startOffset: 0,
        }),
      ).toBe(false);
    });
  });

  describe("section frame helpers", () => {
    const audio = {
      duration: 90,
      endOffset: 30,
      startOffset: 10,
    };

    it("converts section duration to preview frames", () => {
      expect(getSectionDurationInFrames(audio, 30)).toBe(600);
    });

    it("maps times onto section-relative preview frames and clamps to the section", () => {
      expect(getSectionFrameFromTime(10, audio, 30)).toBe(0);
      expect(getSectionFrameFromTime(18.5, audio, 30)).toBe(255);
      expect(getSectionFrameFromTime(18.533, audio, 30)).toBe(255);
      expect(getSectionFrameFromTime(18.566, audio, 30)).toBe(256);
      expect(getSectionFrameFromTime(45, audio, 30)).toBe(599);
    });
  });

  describe("getFrameDriftMilliseconds", () => {
    it("reports frame drift in milliseconds", () => {
      expect(getFrameDriftMilliseconds(90, 91, 30)).toBeCloseTo(33.33, 1);
      expect(getFrameDriftMilliseconds(120, 120, 30)).toBe(0);
    });
  });

  describe("lyric lead-in helpers", () => {
    const audio = {
      duration: 90,
      endOffset: 30,
      startOffset: 10,
    };

    it("normalizes lyric lead-in milliseconds to the supported range", () => {
      expect(normalizeLyricLeadInMs(undefined)).toBe(DEFAULT_LYRIC_LEAD_IN_MS);
      expect(normalizeLyricLeadInMs(-20)).toBe(MIN_LYRIC_LEAD_IN_MS);
      expect(normalizeLyricLeadInMs(999)).toBe(MAX_LYRIC_LEAD_IN_MS);
      expect(normalizeLyricLeadInMs(82.4)).toBe(82);
    });

    it("computes display starts without changing stored line starts", () => {
      const line = { id: "line-1", start: 12 };

      expect(getLineDisplayStart(line, audio, 80)).toBeCloseTo(11.92);
      expect(line.start).toBe(12);
    });

    it("clamps display starts to the active section start", () => {
      expect(getLineDisplayStart({ id: "line-1", start: 10.05 }, audio, 80)).toBe(
        10,
      );
    });
  });

  describe("getTimedLines", () => {
    it("filters untimed lines and sorts by start time", () => {
      const lines = [
        { id: "line-1", original: "later", start: 20 },
        { id: "line-2", original: "untimed", start: null },
        { id: "line-3", original: "earlier", start: 5 },
      ];

      expect(getTimedLines(lines).map((line) => line.id)).toEqual([
        "line-3",
        "line-1",
      ]);
    });
  });

  describe("findActiveLine", () => {
    const lines = [
      { id: "pre-roll", original: "ignored", start: 4 },
      { id: "line-1", original: "first", start: 12 },
      { id: "line-2", original: "second", start: 18.5 },
      { id: "line-3", original: "outro", start: 33 },
    ];
    const audio = {
      duration: 90,
      endOffset: 30,
      startOffset: 10,
    };

    it("returns null before the first in-section line starts", () => {
      expect(findActiveLine(lines, 11.5, audio)).toBeNull();
    });

    it("can apply a display-only lyric lead-in", () => {
      expect(
        findActiveLine(lines, 11.91, audio, { lyricLeadInMs: 80 }),
      ).toBeNull();
      expect(findActiveLine(lines, 11.92, audio, { lyricLeadInMs: 80 })?.id).toBe(
        "line-1",
      );
      expect(lines[1].start).toBe(12);
    });

    it("returns the greatest line start that is still inside the section", () => {
      expect(findActiveLine(lines, 18.6, audio)?.id).toBe("line-2");
      expect(findActiveLine(lines, 29.9, audio)?.id).toBe("line-2");
    });

    it("ignores lines outside the section window", () => {
      expect(findActiveLine(lines, 40, audio)?.id).toBe("line-2");
    });
  });

  describe("getLineStartFrame", () => {
    it("maps section-relative start times to frames", () => {
      expect(
        getLineStartFrame(
          { id: "line-1", start: 18.5 },
          {
            duration: 90,
            endOffset: 30,
            startOffset: 10,
          },
          30,
        ),
      ).toBe(255);
    });

    it("maps display lead-in starts to frames when requested", () => {
      expect(
        getLineStartFrame(
          { id: "line-1", start: 18.5 },
          {
            duration: 90,
            endOffset: 30,
            startOffset: 10,
          },
          30,
          { lyricLeadInMs: 100 },
        ),
      ).toBe(252);
    });

    it("activates mid-frame starts on the next frame boundary", () => {
      expect(
        getLineStartFrame(
          { id: "line-1", start: 18.51 },
          {
            duration: 90,
            endOffset: 30,
            startOffset: 10,
          },
          30,
        ),
      ).toBe(256);

      expect(
        getLineStartFrame(
          { id: "line-2", start: 18.01 },
          {
            duration: 90,
            endOffset: 30,
            startOffset: 10,
          },
          30,
        ),
      ).toBe(241);
    });
  });
});
