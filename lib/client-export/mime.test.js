import { afterEach, describe, expect, it, vi } from "vitest";

import {
  extensionForMimeType,
  formatLabelForMimeType,
  isClientExportSupported,
  pickClientExportMimeType,
} from "./mime.js";

describe("client-export mime helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("picks a supported webm mime type", () => {
    vi.stubGlobal("MediaRecorder", {
      isTypeSupported: (type) => String(type).includes("webm"),
    });

    expect(pickClientExportMimeType()).toContain("webm");
  });

  it("maps mime types to extensions and labels", () => {
    expect(extensionForMimeType("video/webm;codecs=vp9")).toBe("webm");
    expect(extensionForMimeType("video/mp4")).toBe("mp4");
    expect(formatLabelForMimeType("video/webm")).toBe("WEBM");
  });

  it("reports support when MediaRecorder and getDisplayMedia exist", () => {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("MediaRecorder", {
      isTypeSupported: () => true,
    });
    vi.stubGlobal("navigator", {
      mediaDevices: { getDisplayMedia: vi.fn() },
    });

    expect(isClientExportSupported()).toBe(true);
  });
});
