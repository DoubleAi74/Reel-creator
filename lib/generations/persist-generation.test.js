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
import { GenerationCounter } from "../models/GenerationCounter.js";
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
  await GenerationCounter.deleteMany({});
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

  it("merges timing-only AI results onto source lyric lines for saved snapshots", () => {
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
      lines: [
        {
          id: "line-1",
          original: "आज से",
          translation: "From today.",
          words: [
            { gloss: "today", roman: "aaj", text: "आज" },
            { gloss: "from", roman: "se", text: "से" },
          ],
        },
      ],
      result: {
        lines: [
          {
            id: "line-1",
            start: 1,
            words: [
              { end: 1.4, start: 1, text: "आज" },
              { end: 1.8, start: 1.4, text: "से" },
            ],
          },
        ],
      },
    });

    expect(snapshot.project.lines[0]).toMatchObject({
      original: "आज से",
      start: 1,
      translation: "From today.",
    });
    expect(snapshot.project.lines[0].words).toEqual([
      { end: 1.4, gloss: "today", roman: "aaj", start: 1, text: "आज" },
      { end: 1.8, gloss: "from", roman: "se", start: 1.4, text: "से" },
    ]);
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
      storeAudio: true,
      title: "Saved title",
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
      ownerScope: {
        sessionId,
        type: "session",
      },
      pipelineRunId: "run-persist",
      public: true,
      r2Status: "pending_create",
      sourceType: "upload",
      title: "Saved title",
      userTitled: true,
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
        // REP-502 may promote from a staged temp copy rather than the session path.
        filePath: expect.any(String),
        generation: expect.objectContaining({
          r2ObjectKey: storedGeneration.r2ObjectKey,
        }),
      }),
    );
    expect(putGenerationAudioObject.mock.calls[0][0].filePath.length).toBeGreaterThan(0);

    const ledgers = await CreditLedger.find({}).lean();
    expect(ledgers.map((ledger) => ledger.generationId?.toString()).sort()).toEqual([
      storedGeneration._id.toString(),
      storedGeneration._id.toString(),
    ]);
  });

  it("assigns stable numbered titles to untitled saved generations", async () => {
    const first = await persistGeneration({
      finalJobId: "job-default-1",
      pipelineRunId: "run-default-1",
      save: true,
    });
    const titled = await persistGeneration({
      finalJobId: "job-explicit",
      pipelineRunId: "run-explicit",
      save: true,
      title: "Named generation",
    });
    const second = await persistGeneration({
      finalJobId: "job-default-2",
      pipelineRunId: "run-default-2",
      save: true,
    });

    const [firstGeneration, titledGeneration, secondGeneration] = await Promise.all([
      Generation.findById(first.generation._id).lean(),
      Generation.findById(titled.generation._id).lean(),
      Generation.findById(second.generation._id).lean(),
    ]);

    expect(firstGeneration).toMatchObject({
      public: false,
      r2Status: "not_required",
      title: "Generation 1",
      userTitled: false,
    });
    expect(titledGeneration).toMatchObject({
      public: true,
      r2Status: "not_required",
      title: "Named generation",
      userTitled: true,
    });
    expect(secondGeneration).toMatchObject({
      public: false,
      r2Status: "not_required",
      title: "Generation 2",
      userTitled: false,
    });
    expect(putGenerationAudioObject).not.toHaveBeenCalled();
  });

  it("stores YouTube source reference without uploading MP3 by default", async () => {
    const result = await persistGeneration({
      finalJobId: "job-yt-ref",
      pipelineRunId: "run-yt-ref",
      save: true,
      sourceReference: {
        segmentEndSec: 120,
        segmentStartSec: 45,
        type: "youtube",
        youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      },
      title: "YT ref",
    });

    const stored = await Generation.findById(result.generation._id).lean();

    expect(result.audioStored).toBe(false);
    expect(result.promoted).toBe(true);
    expect(putGenerationAudioObject).not.toHaveBeenCalled();
    expect(stored).toMatchObject({
      r2ObjectKey: null,
      r2Status: "not_required",
      sourceType: "youtube",
      snapshot: {
        source: {
          segmentEndSec: 120,
          segmentStartSec: 45,
          type: "youtube",
          youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        },
      },
    });
  });

  it("skips all persistence and R2 work when save is false", async () => {
    await expect(
      persistGeneration({
        finalJobId: "job-skip",
        pipelineRunId: "run-skip",
        save: false,
      }),
    ).resolves.toEqual({
      alreadyExisted: false,
      generation: null,
      promoted: false,
      saved: false,
    });

    expect(await Generation.countDocuments()).toBe(0);
    expect(putGenerationAudioObject).not.toHaveBeenCalled();
  });
});
