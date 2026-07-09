import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { initializeDatabaseIndexes } from "../db/bootstrap.js";
import { connectToDatabase, disconnectFromDatabase } from "../db/mongoose.js";
import { storeUploadedAsset } from "../files";
import { CreditLedger } from "../models/CreditLedger.js";
import { Generation } from "../models/Generation.js";
import { UsageRecord } from "../models/UsageRecord.js";
import { putGenerationAudioObject } from "../r2/audio-r2-lifecycle.js";
import {
  buildGenerationSnapshot,
  persistGeneration,
} from "./persist-generation.js";

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

async function clearCollections() {
  await CreditLedger.deleteMany({});
  await Generation.deleteMany({});
  await UsageRecord.deleteMany({});
}

function ledgerEntry(overrides = {}) {
  return {
    amountMinor: -2,
    balanceAfterMinor: 498,
    idempotencyKey: "ai_debit:job-transcribe:transcribe",
    metadata: {
      jobId: "job-transcribe",
      phase: "transcribe",
      pipelineRunId: "run-persist",
      priceTableVersion: "test-price-v1",
      rawCostMicros: 2_000_000,
    },
    reason: "AI transcribe phase",
    type: "AI_TRANSCRIBE",
    ...overrides,
  };
}

function usageRecord(overrides = {}) {
  return {
    billingUnit: "enrich",
    callId: "job-enrich:enrich:1",
    charged: true,
    endpointKind: "responses",
    inputTokens: 0,
    jobId: "job-enrich",
    model: "gpt-5.4-mini",
    outputTokens: 0,
    phase: "enrich",
    pipelineRunId: "run-persist",
    priceTableVersion: "test-price-v1",
    rawCostMicros: 0,
    totalTokens: 0,
    usageType: "tokens",
    ...overrides,
  };
}

async function createAudioAsset(sessionId = "session-persist") {
  return storeUploadedAsset({
    file: new File([Buffer.from("ID3persist-source")], "saved-song.mp3", {
      type: "audio/mpeg",
    }),
    kind: "audio",
    sessionId,
  });
}

describe("persistGeneration", () => {
  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        storageEngine: "wiredTiger",
      },
    });
    process.env.MONGODB_URI = replSet.getUri();
    process.env.MONGODB_DB_NAME = `generation_stage5_${Date.now()}`;

    await connectToDatabase();
    await initializeDatabaseIndexes();
  }, 60000);

  beforeEach(async () => {
    tempRootDir = path.join(
      os.tmpdir(),
      `reel-creator-generation-test-${crypto.randomUUID()}`,
    );
    process.env.TMP_DIR = tempRootDir;
    await clearCollections();
    putGenerationAudioObject.mockClear();
  });

  afterEach(async () => {
    await rm(tempRootDir, { force: true, recursive: true });
  });

  afterAll(async () => {
    await disconnectFromDatabase();
    await replSet?.stop();

    if (ORIGINAL_MONGODB_URI == null) {
      delete process.env.MONGODB_URI;
    } else {
      process.env.MONGODB_URI = ORIGINAL_MONGODB_URI;
    }

    if (ORIGINAL_MONGODB_DB_NAME == null) {
      delete process.env.MONGODB_DB_NAME;
    } else {
      process.env.MONGODB_DB_NAME = ORIGINAL_MONGODB_DB_NAME;
    }

    if (ORIGINAL_TMP_DIR == null) {
      delete process.env.TMP_DIR;
    } else {
      process.env.TMP_DIR = ORIGINAL_TMP_DIR;
    }
  });

  it("builds a project snapshot from the final AI result", () => {
    const snapshot = buildGenerationSnapshot({
      assetMetadata: {
        durationSec: 12,
        name: "clip.mp3",
      },
      audio: {
        duration: 12,
        endOffset: null,
        startOffset: 0,
      },
      result: {
        lines: [
          {
            id: "line-1",
            original: "hello",
            start: 1,
            translation: "hola",
          },
        ],
      },
      sourceLanguage: {
        id: "auto",
      },
    });

    expect(snapshot.project.audio).toMatchObject({
      duration: 12,
      name: "clip.mp3",
    });
    expect(snapshot.project.lines[0]).toMatchObject({
      original: "hello",
      start: 1,
      translation: "hola",
    });
    expect(snapshot.sourceLanguage).toBe("auto");
  });

  it("creates the Generation in a transaction, links settled ledgers, then promotes audio", async () => {
    await CreditLedger.create([
      ledgerEntry(),
      ledgerEntry({
        amountMinor: -3,
        idempotencyKey: "ai_debit:job-time:time",
        metadata: {
          jobId: "job-time",
          phase: "time",
          pipelineRunId: "run-persist",
          priceTableVersion: "test-price-v1",
          rawCostMicros: 3_000_000,
        },
        reason: "AI time phase",
        type: "AI_TIMING",
      }),
    ]);
    await UsageRecord.create(usageRecord());
    const sessionId = "session-persist";
    const asset = await createAudioAsset(sessionId);
    const snapshot = {
      project: {
        lines: [{ original: "hello" }],
        meta: { title: "Saved title" },
      },
    };

    const result = await persistGeneration({
      assetId: asset.assetId,
      finalJobId: "job-time",
      pipelineRunId: "run-persist",
      save: true,
      sessionId,
      snapshot,
    });

    const storedGeneration = await Generation.findById(result.generation._id).lean();
    expect(result.saved).toBe(true);
    expect(storedGeneration).toMatchObject({
      accountingStatus: "settled",
      billing: {
        ledgerKeys: [
          "ai_debit:job-transcribe:transcribe",
          "ai_debit:job-time:time",
        ],
        phaseCostsMinor: {
          enrich: 0,
          time: 3,
          transcribe: 2,
        },
        priceTableVersion: "test-price-v1",
        totalCostMinor: 5,
      },
      finalJobId: "job-time",
      pipelineRunId: "run-persist",
      r2Status: "pending_create",
      sourceType: "upload",
      title: "Saved title",
    });
    expect(storedGeneration.jobIds.sort()).toEqual([
      "job-enrich",
      "job-time",
      "job-transcribe",
    ]);
    expect(storedGeneration.r2ObjectKey).toBe(
      `generations/${storedGeneration._id.toString()}/audio.mp3`,
    );
    expect(putGenerationAudioObject).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: "audio/mpeg",
        filePath: expect.stringContaining(asset.assetId),
        generation: expect.objectContaining({
          r2ObjectKey: storedGeneration.r2ObjectKey,
        }),
      }),
    );

    const ledgers = await CreditLedger.find({}).lean();
    expect(ledgers.map((ledger) => ledger.generationId?.toString()).sort()).toEqual([
      storedGeneration._id.toString(),
      storedGeneration._id.toString(),
    ]);
  });

  it("skips all persistence and R2 work when save is false", async () => {
    await expect(
      persistGeneration({
        finalJobId: "job-skip",
        pipelineRunId: "run-skip",
        save: false,
      }),
    ).resolves.toEqual({
      generation: null,
      promoted: false,
      saved: false,
    });

    expect(await Generation.countDocuments()).toBe(0);
    expect(putGenerationAudioObject).not.toHaveBeenCalled();
  });
});
