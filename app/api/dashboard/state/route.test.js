import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { initializeDatabaseIndexes } from "../../../../lib/db/bootstrap.js";
import { connectToDatabase, disconnectFromDatabase } from "../../../../lib/db/mongoose.js";
import { Generation } from "../../../../lib/models/Generation.js";
import { GET } from "./route";

const ORIGINAL_MONGODB_URI = process.env.MONGODB_URI;
const ORIGINAL_MONGODB_DB_NAME = process.env.MONGODB_DB_NAME;

let replSet;

async function createGeneration(overrides = {}) {
  return Generation.create({
    accountingStatus: "settled",
    audioDurationSeconds: 12,
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
    finalJobId: `job-${crypto.randomUUID()}`,
    jobIds: ["job-secret"],
    pipelineRunId: `run-${crypto.randomUUID()}`,
    r2ObjectKey: `generations/${crypto.randomUUID()}/audio.mp3`,
    r2Status: "created",
    saved: true,
    public: true,
    userTitled: true,
    snapshot: {
      project: {
        lines: [{ original: "hello", translation: "hola" }],
      },
    },
    sourceType: "upload",
    title: "Dashboard test",
    ...overrides,
  });
}

describe("GET /api/dashboard/state", () => {
  beforeAll(async () => {
    process.env.CREDITS_ENABLED = "true";
    replSet = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        storageEngine: "wiredTiger",
      },
    });
    process.env.MONGODB_URI = replSet.getUri();
    process.env.MONGODB_DB_NAME = `dashboard_state_stage7_${Date.now()}`;

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

  it("returns public cards without internal accounting or storage identifiers", async () => {
    const generation = await createGeneration();
    await createGeneration({
      r2ObjectKey: "generations/hidden/audio.mp3",
      r2Status: "pending_create",
      title: "Hidden pending",
    });

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.generations).toHaveLength(1);
    expect(payload.generations[0]).toMatchObject({
      audioDurationSeconds: 12,
      audioUrl: `/api/media/generations/${generation._id.toString()}`,
      hasStoredAudio: true,
      id: generation._id.toString(),
      lyricPreview: "hello",
      title: "Dashboard test",
    });
    expect(JSON.stringify(payload)).not.toContain("pipelineRunId");
    expect(JSON.stringify(payload)).not.toContain("ledgerKeys");
    expect(JSON.stringify(payload)).not.toContain("r2ObjectKey");
    expect(JSON.stringify(payload)).not.toContain("job-secret");
  });

  it("returns untitled private cards saved by the current session", async () => {
    const ownedGeneration = await createGeneration({
      ownerScope: {
        sessionId: "session-dashboard",
        type: "session",
      },
      public: false,
      title: "Untitled generation",
      userTitled: false,
    });
    await createGeneration({
      ownerScope: {
        sessionId: "other-session",
        type: "session",
      },
      public: false,
      title: "Other private generation",
      userTitled: false,
    });

    const response = await GET(
      new Request("http://localhost/api/dashboard/state", {
        headers: {
          cookie: "reel-creator-session=session-dashboard",
        },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.generations).toHaveLength(1);
    expect(payload.generations[0]).toMatchObject({
      audioUrl: `/api/media/generations/${ownedGeneration._id.toString()}`,
      id: ownedGeneration._id.toString(),
      title: "Untitled generation",
    });
    expect(JSON.stringify(payload)).not.toContain("other-session");
    expect(JSON.stringify(payload)).not.toContain("ownerScope");
    expect(JSON.stringify(payload)).not.toContain("pipelineRunId");
    expect(JSON.stringify(payload)).not.toContain("r2ObjectKey");
  });
});
