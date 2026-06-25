import { describe, expect, it } from "vitest";

import {
  EXPORT_POLL_INTERVAL_MS,
  EXPORT_POLL_MAX_INTERVAL_MS,
  getExportReadiness,
  getRenderPollDelayMs,
  getRenderProgressPercent,
  getRenderStatusLabel,
} from "./export-flow";

describe("export flow helpers", () => {
  it("requires an uploaded audio asset before export", () => {
    expect(
      getExportReadiness({
        audioAssetId: "",
        backgroundAssetId: "",
        backgroundDurationSec: null,
        backgroundType: "gradient",
        sectionWithinLimit: true,
      }),
    ).toEqual({
      canExport: false,
      reason: "Upload an MP3 in this session before exporting.",
    });
  });

  it("blocks export when the selected section is too long", () => {
    expect(
      getExportReadiness({
        audioAssetId: "audio-123",
        backgroundAssetId: "",
        backgroundDurationSec: null,
        backgroundType: "gradient",
        sectionWithinLimit: false,
      }),
    ).toEqual({
      canExport: false,
      reason: "Trim the selected section to 6:00 or shorter before exporting.",
    });
  });

  it("requires an uploaded image asset when the image mode is selected", () => {
    expect(
      getExportReadiness({
        audioAssetId: "audio-123",
        backgroundAssetId: "",
        backgroundDurationSec: null,
        backgroundType: "image",
        sectionWithinLimit: true,
      }),
    ).toEqual({
      canExport: false,
      reason: "Upload a background image in this session before exporting.",
    });
  });

  it("requires an uploaded video asset when the video mode is selected", () => {
    expect(
      getExportReadiness({
        audioAssetId: "audio-123",
        backgroundAssetId: "",
        backgroundDurationSec: null,
        backgroundType: "video",
        sectionWithinLimit: true,
      }),
    ).toEqual({
      canExport: false,
      reason: "Upload a background video in this session before exporting.",
    });
  });

  it("allows export when audio is uploaded and the section is valid", () => {
    expect(
      getExportReadiness({
        audioAssetId: "audio-123",
        backgroundAssetId: "image-123",
        backgroundDurationSec: null,
        backgroundType: "image",
        sectionWithinLimit: true,
      }),
    ).toEqual({
      canExport: true,
      reason: "",
    });
  });

  it("allows export for uploaded video backgrounds", () => {
    expect(
      getExportReadiness({
        audioAssetId: "audio-123",
        backgroundAssetId: "video-123",
        backgroundDurationSec: 1.2,
        backgroundType: "video",
        sectionWithinLimit: true,
      }),
    ).toEqual({
      canExport: true,
      reason: "",
    });
  });

  it("allows export for solid and gradient backgrounds without a background asset", () => {
    expect(
      getExportReadiness({
        audioAssetId: "audio-123",
        backgroundAssetId: "",
        backgroundDurationSec: null,
        backgroundType: "gradient",
        sectionWithinLimit: true,
      }),
    ).toEqual({
      canExport: true,
      reason: "",
    });
  });

  it("blocks video export when the uploaded clip has no readable duration metadata", () => {
    expect(
      getExportReadiness({
        audioAssetId: "audio-123",
        backgroundAssetId: "video-123",
        backgroundDurationSec: null,
        backgroundType: "video",
        sectionWithinLimit: true,
      }),
    ).toEqual({
      canExport: false,
      reason:
        "This background video could not be read. Re-upload a short MP4 or WebM clip before exporting.",
    });
  });

  it("backs polling off after reconnect failures and caps the delay", () => {
    expect(getRenderPollDelayMs()).toBe(EXPORT_POLL_INTERVAL_MS);
    expect(getRenderPollDelayMs(1)).toBe(EXPORT_POLL_INTERVAL_MS * 2);
    expect(getRenderPollDelayMs(99)).toBe(EXPORT_POLL_MAX_INTERVAL_MS);
  });

  it("keeps queued and rendering progress visibly moving", () => {
    expect(getRenderProgressPercent("queued", 0)).toBe(2);
    expect(getRenderProgressPercent("rendering", 0.01)).toBe(5);
    expect(getRenderProgressPercent("done", 0.42)).toBe(100);
  });

  it("returns readable status labels for the modal", () => {
    expect(getRenderStatusLabel("queued")).toBe("Queued");
    expect(getRenderStatusLabel("rendering")).toBe("Rendering");
    expect(getRenderStatusLabel("done")).toBe("Ready");
    expect(getRenderStatusLabel("error")).toBe("Needs attention");
    expect(getRenderStatusLabel()).toBe("Preparing");
  });
});
