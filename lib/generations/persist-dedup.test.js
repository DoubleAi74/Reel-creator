/**
 * REP-701 / REP-501 — concurrent persistGeneration for the same finalJobId
 * yields a single Generation document.
 */
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { initializeDatabaseIndexes } from "../db/bootstrap.js";
import { connectToDatabase, disconnectFromDatabase } from "../db/mongoose.js";
import { storeUploadedAsset } from "../files";
import { Generation } from "../models/Generation.js";
import { putGenerationAudioObject } from "../r2/audio-r2-lifecycle.js";
import { persistGeneration } from "./persist-generation.js";

vi.mock("../r2/audio-r2-lifecycle.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    putGenerationAudioObject: vi.fn(async ({ generation }) => ({
      key: generation.r2ObjectKey,
      ok: true,
    })),
  };
});

const ORIGINAL_MONGODB_URI = process.env.MONGODB_URI;
const ORIGINAL_MONGODB_DB_NAME = process.env.MONGODB_DB_NAME;
const ORIGINAL_TMP_DIR = process.env.TMP_DIR;

let replSet;
let tempRootDir = "";

describe("REP-501 concurrent finalJobId dedup", () => {
  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
    });
    process.env.MONGODB_URI = replSet.getUri();
    process.env.MONGODB_DB_NAME = `persist_dedup_${Date.now()}`;
    await connectToDatabase();
    await initializeDatabaseIndexes();
  }, 60000);

  beforeEach(async () => {
    tempRootDir = path.join(
      os.tmpdir(),
      `reel-creator-dedup-${crypto.randomUUID()}`,
    );
    process.env.TMP_DIR = tempRootDir;
    await Generation.deleteMany({});
    putGenerationAudioObject.mockClear();
  });

  afterEach(async () => {
    await rm(tempRootDir, { force: true, recursive: true });
  });

  afterAll(async () => {
    await disconnectFromDatabase();
    await replSet?.stop();
    if (ORIGINAL_MONGODB_URI == null) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = ORIGINAL_MONGODB_URI;
    if (ORIGINAL_MONGODB_DB_NAME == null) delete process.env.MONGODB_DB_NAME;
    else process.env.MONGODB_DB_NAME = ORIGINAL_MONGODB_DB_NAME;
    if (ORIGINAL_TMP_DIR == null) delete process.env.TMP_DIR;
    else process.env.TMP_DIR = ORIGINAL_TMP_DIR;
  });

  it("concurrent persist for the same finalJobId yields one document", async () => {
    const sessionId = "session-dedup";
    const asset = await storeUploadedAsset({
      file: new File([Buffer.from("ID3dedup-source")], "dedup.mp3", {
        type: "audio/mpeg",
      }),
      kind: "audio",
      sessionId,
    });

    const payload = {
      assetId: asset.assetId,
      finalJobId: "job-dedup-shared",
      pipelineRunId: "run-dedup-shared",
      save: true,
      sessionId,
      snapshot: { project: { lines: [{ original: "hi" }] } },
      title: "Dedup card",
    };

    const [first, second] = await Promise.all([
      persistGeneration(payload),
      persistGeneration(payload),
    ]);

    expect(first.saved).toBe(true);
    expect(second.saved).toBe(true);
    expect(String(first.generation._id)).toBe(String(second.generation._id));
    expect(await Generation.countDocuments({ finalJobId: "job-dedup-shared" })).toBe(
      1,
    );
  });
});
