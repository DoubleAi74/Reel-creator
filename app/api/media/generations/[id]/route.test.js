process.env.CREDITS_ENABLED = "true";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { initializeDatabaseIndexes } from "../../../../../lib/db/bootstrap.js";
import {
  connectToDatabase,
  disconnectFromDatabase,
} from "../../../../../lib/db/mongoose.js";
import { Generation } from "../../../../../lib/models/Generation.js";
import { getR2Object } from "../../../../../lib/r2/r2-client.js";
import { resetR2EnvironmentForTests } from "../../../../../lib/r2/r2-env.js";
import { GET } from "./route";

vi.mock("../../../../../lib/r2/r2-client.js", () => ({
  getR2Object: vi.fn(),
  toSafeR2ErrorCode: vi.fn(() => "R2_UNKNOWN"),
}));

const ORIGINAL_MONGODB_URI = process.env.MONGODB_URI;
const ORIGINAL_MONGODB_DB_NAME = process.env.MONGODB_DB_NAME;

let replSet;

function enableR2(overrides = {}) {
  resetR2EnvironmentForTests();
  vi.stubEnv("R2_ENABLED", "true");
  vi.stubEnv("R2_ACCOUNT_ID", "test-account-id");
  vi.stubEnv("R2_ACCESS_KEY_ID", "test-access-key-id");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret-access-key");
  vi.stubEnv("R2_BUCKET_NAME", "test-bucket");

  for (const [key, value] of Object.entries(overrides)) {
    vi.stubEnv(key, value);
  }
}

async function createGeneration(overrides = {}) {
  return Generation.create({
    accountingStatus: "settled",
    billing: {
      ledgerKeys: [],
      phaseCostsMinor: {
        enrich: null,
        time: 1,
        transcribe: null,
      },
      priceTableVersion: "test-price-v1",
      totalCostMinor: 1,
    },
    finalJobId: `job-${crypto.randomUUID()}`,
    jobIds: [],
    pipelineRunId: `run-${crypto.randomUUID()}`,
    r2ObjectKey: null,
    r2Status: "created",
    saved: true,
    public: true,
    userTitled: true,
    snapshot: {
      project: {
        lines: [{ original: "hello" }],
      },
    },
    sourceType: "upload",
    title: "Media route test",
    ...overrides,
  });
}

describe("GET /api/media/generations/[id]", () => {
  beforeAll(async () => {
    process.env.CREDITS_ENABLED = "true";
    replSet = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        storageEngine: "wiredTiger",
      },
    });
    process.env.MONGODB_URI = replSet.getUri();
    process.env.MONGODB_DB_NAME = `generation_media_stage5_${Date.now()}`;

    await connectToDatabase();
    await initializeDatabaseIndexes();
  }, 60000);

  beforeEach(async () => {
    await Generation.deleteMany({});
    getR2Object.mockReset();
    enableR2();
  });

  afterEach(() => {
    resetR2EnvironmentForTests();
    vi.unstubAllEnvs();
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

  it("redirects to the public R2 URL when configured", async () => {
    const generation = await createGeneration({
      r2ObjectKey: "generations/generation-1/audio.mp3",
    });
    enableR2({
      R2_PUBLIC_BASE_URL: "https://cdn.example.test/audio",
    });

    const response = await GET(new Request("http://localhost"), {
      params: { id: generation._id.toString() },
    });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://cdn.example.test/audio/generations/generation-1/audio.mp3",
    );
    expect(getR2Object).not.toHaveBeenCalled();
  });

  it("proxies playable audio when no public R2 URL is configured", async () => {
    const generation = await createGeneration({
      r2ObjectKey: "generations/generation-2/audio.mp3",
    });
    const body = Buffer.from("ID3media");
    getR2Object.mockResolvedValue({
      body,
      contentLength: body.byteLength,
      contentType: "audio/mpeg",
      key: generation.r2ObjectKey,
    });

    const response = await GET(new Request("http://localhost"), {
      params: { id: generation._id.toString() },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("content-length")).toBe(String(body.byteLength));
    expect(Buffer.from(await response.arrayBuffer()).toString("utf8")).toBe("ID3media");
    expect(getR2Object).toHaveBeenCalledWith({ key: generation.r2ObjectKey });
  });

  it("404s generations without a created R2 object", async () => {
    const generation = await createGeneration({
      r2ObjectKey: "generations/generation-3/audio.mp3",
      r2Status: "pending_create",
    });

    const response = await GET(new Request("http://localhost"), {
      params: { id: generation._id.toString() },
    });

    expect(response.status).toBe(404);
    expect(getR2Object).not.toHaveBeenCalled();
  });
});
