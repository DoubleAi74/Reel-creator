import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AudioMediaFetchError, fetchMediaToFile } from "./media-fetcher";

describe("youtube audio media fetcher", () => {
  let tempDir = "";
  let originalFetch;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `yt-media-fetcher-${crypto.randomUUID()}`);
    await mkdir(tempDir, { recursive: true });
    originalFetch = global.fetch;
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes a validated media response to disk", async () => {
    global.fetch = vi.fn(async () =>
      new Response(Buffer.from("fixture-audio"), {
        status: 200,
        headers: {
          "content-type": "audio/mpeg",
          "content-length": "13",
        },
      }),
    );
    const outputPath = path.join(tempDir, "audio.mp3");

    await expect(
      fetchMediaToFile(
        { mediaUrl: "https://example.com/audio.mp3" },
        { outputPath, maxBytes: 100 },
      ),
    ).resolves.toMatchObject({
      filePath: outputPath,
      contentLength: 13,
      sourceHost: "example.com",
    });
    await expect(readFile(outputPath, "utf8")).resolves.toBe("fixture-audio");
  });

  it("blocks private IPs before issuing a fetch", async () => {
    global.fetch = vi.fn();

    await expect(
      fetchMediaToFile(
        { mediaUrl: "http://127.0.0.1/audio.mp3" },
        { outputPath: path.join(tempDir, "audio.mp3"), maxBytes: 100 },
      ),
    ).rejects.toBeInstanceOf(AudioMediaFetchError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("validates redirect targets before following them", async () => {
    global.fetch = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: {
          location: "http://127.0.0.1/audio.mp3",
        },
      }),
    );

    await expect(
      fetchMediaToFile(
        { mediaUrl: "https://example.com/redirect" },
        { outputPath: path.join(tempDir, "audio.mp3"), maxBytes: 100 },
      ),
    ).rejects.toMatchObject({
      errorCode: "PROVIDER_MALFORMED_RESPONSE",
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("validates nested JSON media URLs through the same guard", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ downloadUrl: "http://127.0.0.1/audio.mp3" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    await expect(
      fetchMediaToFile(
        { mediaUrl: "https://example.com/result.json" },
        { outputPath: path.join(tempDir, "audio.mp3"), maxBytes: 100 },
      ),
    ).rejects.toMatchObject({
      errorCode: "PROVIDER_MALFORMED_RESPONSE",
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
