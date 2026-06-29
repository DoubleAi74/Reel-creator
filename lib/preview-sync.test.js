import { describe, expect, it } from "vitest";

import { shouldReportPreviewFrames } from "./preview-sync";

// Guards the second half of the scrub-while-playing fix: the preview only
// subscribes to (and reports) per-frame events when a consumer is wired up. The
// editor shell deliberately passes no callback, so preview frame updates cannot
// drive per-frame shell-state updates that re-render the whole editor.
describe("shouldReportPreviewFrames", () => {
  it("reports only when a callback consumer is provided", () => {
    expect(shouldReportPreviewFrames(() => {})).toBe(true);
  });

  it("does not report when the shell omits the callback", () => {
    expect(shouldReportPreviewFrames(undefined)).toBe(false);
    expect(shouldReportPreviewFrames(null)).toBe(false);
  });

  it("does not report for non-function values", () => {
    expect(shouldReportPreviewFrames(0)).toBe(false);
    expect(shouldReportPreviewFrames("frame")).toBe(false);
  });
});
