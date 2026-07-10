import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { initializeDatabaseIndexes } from "../../../../../lib/db/bootstrap.js";
import {
  connectToDatabase,
  disconnectFromDatabase,
} from "../../../../../lib/db/mongoose.js";
import { Generation } from "../../../../../lib/models/Generation.js";
import { createGenerationUnlockCookieValue } from "../../../../../lib/credits/unlock-cookie.js";
import { deleteGenerationAudioObject } from "../../../../../lib/r2/audio-r2-lifecycle.js";
import { DELETE, GET, PATCH } from "./route";

process.env.CREDITS_ENABLED = "true";

vi.mock("../../../../../lib/r2/audio-r2-lifecycle.js", () => ({
  deleteGenerationAudioObject: vi.fn(async () => ({ ok: true })),
}));

const ORIGINAL_MONGODB_URI = process.env.MONGODB_URI;
const ORIGINAL_MONGODB_DB_NAME = process.env.MONGODB_DB_NAME;
const ORIGINAL_GENERATION_UNLOCK_SECRET = process.env.GENERATION_UNLOCK_SECRET;

let replSet;

function unlockedRequest(url = "http://localhost", init = {}) {
  const headers = {
    ...(init.headers ?? {}),
  };

  if (!headers.cookie) {
    headers.cookie = `rc_gen_unlock=${createGenerationUnlockCookieValue()}`;
  }

  return new Request(url, {
    ...init,
    headers,
  });
}

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
    finalJobId: `job-${crypto.randomUUID()}`,
    jobIds: ["job-secret"],
    pipelineRunId: "run-secret",
    r2ObjectKey: `generations/${crypto.randomUUID()}/audio.mp3`,
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
    process.env.GENERATION_UNLOCK_SECRET = "dashboard-route-test-secret";
    await Generation.deleteMany({});
    deleteGenerationAudioObject.mockClear();
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

    if (ORIGINAL_GENERATION_UNLOCK_SECRET == null) {
      delete process.env.GENERATION_UNLOCK_SECRET;
    } else {
      process.env.GENERATION_UNLOCK_SECRET = ORIGINAL_GENERATION_UNLOCK_SECRET;
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

  it("returns private saved generations owned by the current session", async () => {
    const generation = await createGeneration({
      ownerScope: {
        sessionId: "session-editor",
        type: "session",
      },
      public: false,
      title: "Untitled generation",
      userTitled: false,
    });

    const ownedResponse = await GET(
      new Request("http://localhost", {
        headers: {
          cookie: "reel-creator-session=session-editor",
        },
      }),
      {
        params: { id: generation._id.toString() },
      },
    );
    const ownedPayload = await ownedResponse.json();
    const otherSessionResponse = await GET(
      new Request("http://localhost", {
        headers: {
          cookie: "reel-creator-session=other-session",
        },
      }),
      {
        params: { id: generation._id.toString() },
      },
    );

    expect(ownedResponse.status).toBe(200);
    expect(ownedPayload.generation).toMatchObject({
      id: generation._id.toString(),
      title: "Untitled generation",
    });
    expect(JSON.stringify(ownedPayload)).not.toContain("ownerScope");
    expect(JSON.stringify(ownedPayload)).not.toContain("r2ObjectKey");
    expect(otherSessionResponse.status).toBe(404);
  });

  it("requires a valid unlock cookie before editing titles", async () => {
    const generation = await createGeneration();

    const response = await PATCH(
      new Request("http://localhost", {
        body: JSON.stringify({ title: "Renamed" }),
        method: "PATCH",
      }),
      {
        params: { id: generation._id.toString() },
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "locked" });
  });

  it("rejects blank and overlong titles", async () => {
    const generation = await createGeneration();

    const blankResponse = await PATCH(
      unlockedRequest("http://localhost", {
        body: JSON.stringify({ title: "   " }),
        method: "PATCH",
      }),
      {
        params: { id: generation._id.toString() },
      },
    );
    const longResponse = await PATCH(
      unlockedRequest("http://localhost", {
        body: JSON.stringify({ title: "x".repeat(181) }),
        method: "PATCH",
      }),
      {
        params: { id: generation._id.toString() },
      },
    );

    expect(blankResponse.status).toBe(400);
    expect(longResponse.status).toBe(400);
  });

  it("does not edit generations outside the current visible dashboard scope", async () => {
    const generation = await createGeneration({
      ownerScope: {
        sessionId: "session-owner",
        type: "session",
      },
      public: false,
      title: "Generation 1",
      userTitled: false,
    });

    const response = await PATCH(
      unlockedRequest("http://localhost", {
        body: JSON.stringify({ title: "Should not save" }),
        headers: {
          cookie: `reel-creator-session=other-session; rc_gen_unlock=${createGenerationUnlockCookieValue()}`,
        },
        method: "PATCH",
      }),
      {
        params: { id: generation._id.toString() },
      },
    );

    expect(response.status).toBe(404);
    await expect(Generation.findById(generation._id).lean()).resolves.toMatchObject({
      title: "Generation 1",
    });
  });

  it("updates title, publishes the generation, and syncs snapshot meta title", async () => {
    const generation = await createGeneration({
      ownerScope: {
        sessionId: "session-editor",
        type: "session",
      },
      public: false,
      title: "Generation 1",
      userTitled: false,
    });

    const response = await PATCH(
      unlockedRequest("http://localhost", {
        body: JSON.stringify({ title: "Shared song" }),
        headers: {
          cookie: `reel-creator-session=session-editor; rc_gen_unlock=${createGenerationUnlockCookieValue()}`,
        },
        method: "PATCH",
      }),
      {
        params: { id: generation._id.toString() },
      },
    );
    const payload = await response.json();
    const storedGeneration = await Generation.findById(generation._id).lean();

    expect(response.status).toBe(200);
    expect(payload.generation).toMatchObject({
      id: generation._id.toString(),
      title: "Shared song",
    });
    expect(storedGeneration).toMatchObject({
      public: true,
      title: "Shared song",
      userTitled: true,
    });
    expect(storedGeneration.snapshot.project.meta.title).toBe("Shared song");
  });

  it("requires a valid unlock cookie before deleting generations", async () => {
    const generation = await createGeneration();

    const response = await DELETE(new Request("http://localhost"), {
      params: { id: generation._id.toString() },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "locked" });
  });

  it("does not delete generations outside the current visible dashboard scope", async () => {
    const generation = await createGeneration({
      ownerScope: {
        sessionId: "delete-owner",
        type: "session",
      },
      public: false,
      title: "Generation 1",
      userTitled: false,
    });

    const response = await DELETE(
      unlockedRequest("http://localhost", {
        headers: {
          cookie: `reel-creator-session=other-session; rc_gen_unlock=${createGenerationUnlockCookieValue()}`,
        },
      }),
      {
        params: { id: generation._id.toString() },
      },
    );

    expect(response.status).toBe(404);
    await expect(Generation.findById(generation._id).lean()).resolves.toMatchObject({
      deletedAt: null,
      saved: true,
    });
    expect(deleteGenerationAudioObject).not.toHaveBeenCalled();
  });

  it("soft deletes visible generations and requests audio cleanup", async () => {
    const generation = await createGeneration();

    const response = await DELETE(unlockedRequest(), {
      params: { id: generation._id.toString() },
    });
    const payload = await response.json();
    const storedGeneration = await Generation.findById(generation._id).lean();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      deleted: true,
      id: generation._id.toString(),
    });
    expect(storedGeneration).toMatchObject({
      public: false,
      saved: false,
    });
    expect(storedGeneration.deletedAt).toBeInstanceOf(Date);
    expect(storedGeneration.deleteRequestedAt).toBeInstanceOf(Date);
    expect(deleteGenerationAudioObject).toHaveBeenCalledWith({
      generation: expect.objectContaining({
        r2ObjectKey: generation.r2ObjectKey,
      }),
    });
  });
});
