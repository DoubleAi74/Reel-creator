import { mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getYoutubeAudioResultDir,
  storeFinalMp3,
  sweepStaleYoutubeAudioResults,
} from "./storage";

describe("youtube audio result storage", () => {
  let tempDir = "";
  let config;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `yt-storage-${crypto.randomUUID()}`);
    config = { tmpDir: tempDir };
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("stores the final mp3 under the bounded result directory", async () => {
    const sourcePath = path.join(tempDir, "source.mp3");
    await writeFile(sourcePath, Buffer.from("ID3result"));

    const result = await storeFinalMp3(sourcePath, "job-1", { config });

    expect(result).toMatchObject({
      storedAssetPath: path.join(getYoutubeAudioResultDir(config), "job-1.mp3"),
      storedAssetContentType: "audio/mpeg",
    });
    await expect(readFile(result.storedAssetPath, "utf8")).resolves.toBe("ID3result");
  });

  it("sweeps stale unreferenced result files", async () => {
    const resultDir = getYoutubeAudioResultDir(config);
    await mkdir(resultDir, { recursive: true });
    const stalePath = path.join(resultDir, "stale.mp3");
    const freshPath = path.join(resultDir, "fresh.mp3");
    await writeFile(stalePath, Buffer.from("ID3stale"));
    await writeFile(freshPath, Buffer.from("ID3fresh"));

    const now = Date.now();
    const staleDate = new Date(now - 10_000);
    await utimes(stalePath, staleDate, staleDate);

    const removed = await sweepStaleYoutubeAudioResults({
      now,
      maxAgeMs: 1000,
      config,
    });

    expect(removed).toEqual([stalePath]);
    await expect(stat(stalePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(freshPath)).resolves.toBeTruthy();
  });
});
