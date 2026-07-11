import { describe, expect, it } from "vitest";

import {
  buildSessionVideoObjectKey,
  extensionForVideoContentType,
  normalizeExtension,
} from "./session-asset-lifecycle.js";

describe("session asset R2 keys", () => {
  it("builds a stable session video key", () => {
    expect(
      buildSessionVideoObjectKey({
        assetId: "asset-1",
        extension: ".mp4",
        sessionId: "session-1",
      }),
    ).toBe("session-assets/session-1/video/asset-1.mp4");
  });

  it("rejects unsafe ids", () => {
    expect(() =>
      buildSessionVideoObjectKey({
        assetId: "../x",
        extension: ".mp4",
        sessionId: "session-1",
      }),
    ).toThrow(/Invalid/);
  });

  it("maps content types to extensions", () => {
    expect(extensionForVideoContentType("video/quicktime", "a.mov")).toBe(".mov");
    expect(extensionForVideoContentType("video/webm", "a.webm")).toBe(".webm");
    expect(extensionForVideoContentType("video/mp4", "a.mp4")).toBe(".mp4");
    expect(normalizeExtension("MOV")).toBe(".mov");
  });
});
