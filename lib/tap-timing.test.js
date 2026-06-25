import { describe, expect, it } from "vitest";

import {
  getNextTapTimingLineId,
  getTapTimingLineProgress,
  getTapTimingStartLineId,
} from "./tap-timing";

describe("tap timing helpers", () => {
  const lines = [
    { id: "line-1", original: "first", start: 1 },
    { id: "line-2", original: "second", start: null },
    { id: "line-3", original: "third", start: 3 },
  ];

  describe("getTapTimingStartLineId", () => {
    it("starts from the selected line when it still exists", () => {
      expect(getTapTimingStartLineId(lines, "line-3")).toBe("line-3");
    });

    it("falls back to the first untimed line", () => {
      expect(getTapTimingStartLineId(lines, "missing")).toBe("line-2");
    });

    it("starts at the first line when every line is timed", () => {
      expect(
        getTapTimingStartLineId([
          { id: "line-1", start: 1 },
          { id: "line-2", start: 2 },
        ]),
      ).toBe("line-1");
    });
  });

  describe("getNextTapTimingLineId", () => {
    it("advances to the next line", () => {
      expect(getNextTapTimingLineId(lines, "line-1")).toBe("line-2");
    });

    it("returns null after the final line", () => {
      expect(getNextTapTimingLineId(lines, "line-3")).toBeNull();
    });
  });

  describe("getTapTimingLineProgress", () => {
    it("reports one-based progress for the cursor line", () => {
      expect(getTapTimingLineProgress(lines, "line-2")).toEqual({
        current: 2,
        total: 3,
      });
    });

    it("reports zero progress when the cursor is missing", () => {
      expect(getTapTimingLineProgress(lines, "missing")).toEqual({
        current: 0,
        total: 3,
      });
    });
  });
});
