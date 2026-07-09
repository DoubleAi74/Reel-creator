process.env.CREDITS_ENABLED = "true";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { initializeDatabaseIndexes } from "../../../../../lib/db/bootstrap.js";
import {
  connectToDatabase,
  disconnectFromDatabase,
} from "../../../../../lib/db/mongoose.js";
import { Generation } from "../../../../../lib/models/Generation.js";
import { GET } from "./route";

const ORIGINAL_MONGODB_URI = process.env.MONGODB_URI;
const ORIGINAL_MONGODB_DB_NAME = process.env.MONGODB_DB_NAME;

let replSet;

async function createGeneration(overrides = {}) {
  return Generation.create({
    accountingStatus: "settled",
    billing: {
      ledgerKeys: ["ai_debit:job:time"],
      phaseCostsMinor: {
        enrich: null,
        time: 1,
        transcribe: null,
      },
      priceTableVersion: "test-price-v1",
      totalCostMinor: 1,
    },
    finalJobId: "job-editor",
    jobIds: ["job-secret"],
    pipelineRunId: "run-secret",
    r2ObjectKey: "generations/secret/audio.mp3",
    r2Status: "created",
    saved: true,
    public: true,
    userTitled: true,
    snapshot: {
      project: {
        audio: {
          duration: 12,
          endOffset: null,
          name: "saved.mp3",
          startOffset: 0,
        },
        lines: [{ original: "hello", translation: "hola" }],
        meta: {
          artist: "",
          title: "Saved reel",
        },
        version: 1,
      },
    },
    sourceType: "upload",
    title: "Saved reel",
    ...overrides,
  });
}

describe("GET /api/dashboard/generations/[id]", () => {
  beforeAll(async () => {
    process.env.CREDITS_ENABLED = "true";
    replSet = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        storageEngine: "wiredTiger",
      },
    });
    process.env.MONGODB_URI = replSet.getUri();
    process.env.MONGODB_DB_NAME = `dashboard_generation_stage7_${Date.now()}`;

    await connectToDatabase();
    await initializeDatabaseIndexes();
  }, 60000);

  beforeEach(async () => {
    await Generation.deleteMany({});
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
  });

  it("returns only the editor payload for saved public generations", async () => {
    const generation = await createGeneration();

    const response = await GET(new Request("http://localhost"), {
      params: { id: generation._id.toString() },
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      generation: {
        id: generation._id.toString(),
        snapshot: generation.snapshot,
        title: "Saved reel",
      },
    });
    expect(JSON.stringify(payload)).not.toContain("run-secret");
    expect(JSON.stringify(payload)).not.toContain("r2ObjectKey");
    expect(JSON.stringify(payload)).not.toContain("ledgerKeys");
  });

  it("404s private, deleted, or invalid generations", async () => {
    const privateGeneration = await createGeneration({ public: false });
    await Generation.updateOne(
      { _id: privateGeneration._id },
      { $set: { public: false } },
    );

    const invalidResponse = await GET(new Request("http://localhost"), {
      params: { id: "not-an-id" },
    });
    const privateResponse = await GET(new Request("http://localhost"), {
      params: { id: privateGeneration._id.toString() },
    });

    expect(invalidResponse.status).toBe(404);
    expect(privateResponse.status).toBe(404);
  });
});
