import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  readAssetMetadata,
  storeAudioAssetFromPath,
  storeUploadedAsset,
} from "./files";

const ORIGINAL_TMP_DIR = process.env.TMP_DIR;

function getMetadataPath(rootDir, sessionId, assetId) {
  return path.join(rootDir, sessionId, `${assetId}.json`);
}

describe("asset sourceType metadata", () => {
  let tempRootDir = "";

  beforeEach(() => {
    tempRootDir = path.join(
      os.tmpdir(),
      `reel-creator-source-type-test-${crypto.randomUUID()}`,
    );
    process.env.TMP_DIR = tempRootDir;
  });

  afterEach(async () => {
    await rm(tempRootDir, { force: true, recursive: true });

    if (ORIGINAL_TMP_DIR === undefined) {
      delete process.env.TMP_DIR;
    } else {
      process.env.TMP_DIR = ORIGINAL_TMP_DIR;
    }
  });

  it("stamps uploads as upload", async () => {
    const sessionId = crypto.randomUUID();
    const asset = await storeUploadedAsset({
      file: new File([Buffer.from("ID3upload-source")], "fixture.mp3", {
        type: "audio/mpeg",
      }),
      kind: "audio",
      sessionId,
    });

    expect(asset.sourceType).toBe("upload");
    await expect(readAssetMetadata(sessionId, asset.assetId)).resolves.toMatchObject({
      sourceType: "upload",
    });
  });

  it("stamps trusted server-side audio path ingestion as youtube by default", async () => {
    const sessionId = crypto.randomUUID();
    const trustedRootDir = path.join(tempRootDir, "yt-results");
    const sourcePath = path.join(trustedRootDir, "job.mp3");
    await mkdir(trustedRootDir, { recursive: true });
    await writeFile(sourcePath, Buffer.from("ID3youtube-source"));

    const asset = await storeAudioAssetFromPath({
      durationSec: 3,
      name: "clip",
      sessionId,
      sourcePath,
      trustedRootDir,
    });

    expect(asset.sourceType).toBe("youtube");
    await expect(readAssetMetadata(sessionId, asset.assetId)).resolves.toMatchObject({
      sourceType: "youtube",
    });
  });

  it("normalizes legacy metadata without sourceType to unknown on read", async () => {
    const sessionId = crypto.randomUUID();
    const asset = await storeUploadedAsset({
      file: new File([Buffer.from("ID3legacy-source")], "fixture.mp3", {
        type: "audio/mpeg",
      }),
      kind: "audio",
      sessionId,
    });
    const metadataPath = getMetadataPath(tempRootDir, sessionId, asset.assetId);
    const legacyMetadata = JSON.parse(await readFile(metadataPath, "utf8"));
    delete legacyMetadata.sourceType;
    await writeFile(metadataPath, JSON.stringify(legacyMetadata, null, 2), "utf8");

    await expect(readAssetMetadata(sessionId, asset.assetId)).resolves.toMatchObject({
      sourceType: "unknown",
    });
  });
});
