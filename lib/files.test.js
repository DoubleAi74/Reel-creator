import { rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  findSessionIdForAsset,
  getAssetTtlMs,
  removeSessionAssets,
  storeUploadedAsset,
  sweepExpiredSessions,
  touchSession,
} from "./files";

const ORIGINAL_TMP_DIR = process.env.TMP_DIR;
const ORIGINAL_ASSET_TTL_HOURS = process.env.ASSET_TTL_HOURS;

function getSessionDir(rootDir, sessionId) {
  return path.join(rootDir, sessionId);
}

function getSessionMetadataPath(rootDir, sessionId) {
  return path.join(getSessionDir(rootDir, sessionId), ".session.json");
}

describe("session asset storage", () => {
  let tempRootDir = "";

  beforeEach(() => {
    tempRootDir = path.join(
      os.tmpdir(),
      `reel-creator-files-test-${crypto.randomUUID()}`,
    );
    process.env.TMP_DIR = tempRootDir;
    process.env.ASSET_TTL_HOURS = "2";
  });

  afterEach(async () => {
    await rm(tempRootDir, {
      force: true,
      recursive: true,
    });

    if (ORIGINAL_TMP_DIR === undefined) {
      delete process.env.TMP_DIR;
    } else {
      process.env.TMP_DIR = ORIGINAL_TMP_DIR;
    }

    if (ORIGINAL_ASSET_TTL_HOURS === undefined) {
      delete process.env.ASSET_TTL_HOURS;
    } else {
      process.env.ASSET_TTL_HOURS = ORIGINAL_ASSET_TTL_HOURS;
    }
  });

  it("removes a session directory during explicit cleanup", async () => {
    const sessionId = crypto.randomUUID();

    await storeUploadedAsset({
      file: new File([Buffer.from("ID3cleanup-fixture")], "fixture.mp3", {
        type: "audio/mpeg",
      }),
      kind: "audio",
      sessionId,
    });

    await removeSessionAssets(sessionId);

    await expect(stat(getSessionDir(tempRootDir, sessionId))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("finds the owning session for an uploaded asset id", async () => {
    const sessionId = crypto.randomUUID();
    const asset = await storeUploadedAsset({
      file: new File([Buffer.from("ID3lookup-fixture")], "fixture.mp3", {
        type: "audio/mpeg",
      }),
      kind: "audio",
      sessionId,
    });

    await expect(findSessionIdForAsset(asset.assetId)).resolves.toBe(sessionId);
    await expect(findSessionIdForAsset("missing-asset")).resolves.toBeNull();
    await expect(findSessionIdForAsset("../fixture")).resolves.toBeNull();
  });

  it("sweeps only expired session directories and keeps active ones", async () => {
    const activeSessionId = crypto.randomUUID();
    const expiredSessionId = crypto.randomUUID();
    const now = Date.now();
    const expiredIso = new Date(now - getAssetTtlMs() - 60_000).toISOString();

    await touchSession(activeSessionId);
    await touchSession(expiredSessionId);
    await writeFile(
      getSessionMetadataPath(tempRootDir, expiredSessionId),
      JSON.stringify(
        {
          createdAt: expiredIso,
          sessionId: expiredSessionId,
          updatedAt: expiredIso,
        },
        null,
        2,
      ),
      "utf8",
    );

    const removedSessionIds = await sweepExpiredSessions({
      excludeSessionIds: [activeSessionId],
      now,
    });

    expect(removedSessionIds).toEqual([expiredSessionId]);
    await expect(stat(getSessionDir(tempRootDir, activeSessionId))).resolves.toBeTruthy();
    await expect(stat(getSessionDir(tempRootDir, expiredSessionId))).rejects.toMatchObject(
      {
        code: "ENOENT",
      },
    );
  });
});
