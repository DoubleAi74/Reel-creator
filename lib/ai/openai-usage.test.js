import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { connectToDatabase, disconnectFromDatabase } from "../db/mongoose.js";
import { UsageRecord } from "../models/UsageRecord.js";
import {
  createUsageCollector,
  extractOpenAiUsage,
  recordOpenAiCallUsage,
} from "./openai-usage.js";

const ORIGINAL_MONGODB_URI = process.env.MONGODB_URI;
const ORIGINAL_MONGODB_DB_NAME = process.env.MONGODB_DB_NAME;

let replSet;

describe("OpenAI usage collector", () => {
  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        storageEngine: "wiredTiger",
      },
    });
    process.env.MONGODB_URI = replSet.getUri();
    process.env.MONGODB_DB_NAME = `usage_stage2_${Date.now()}`;

    await connectToDatabase();
    await UsageRecord.init();
  }, 60000);

  beforeEach(async () => {
    await UsageRecord.deleteMany({});
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

  it("extracts Responses token usage and audio fallback usage", () => {
    expect(
      extractOpenAiUsage({
        data: {
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            total_tokens: 30,
          },
        },
        endpointKind: "responses",
      }),
    ).toMatchObject({
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      usageType: "tokens",
    });
    expect(
      extractOpenAiUsage({
        data: {},
        endpointKind: "audio",
        fallbackAudioSeconds: 12.5,
      }),
    ).toMatchObject({
      audioSeconds: 12.5,
      usageType: "none",
    });
    expect(
      extractOpenAiUsage({
        data: {
          usage: {
            seconds: 8,
            type: "duration",
          },
        },
        endpointKind: "audio",
      }),
    ).toMatchObject({
      audioSeconds: 8,
      usageType: "duration",
    });
  });

  it("persists usage records idempotently by callId", async () => {
    const collector = createUsageCollector({
      jobId: "job-usage-1",
      pipelineRunId: "run-usage-1",
    });

    const callId = collector.nextCallId("transcribe");
    const firstRecord = await collector.record({
      billingUnit: "transcribe",
      callId,
      endpointKind: "responses",
      inputTokens: 10,
      model: "gpt-4o",
      outputTokens: 5,
      phase: "transcribe",
      priceTableVersion: "test-prices",
      rawCostMicros: 100,
      totalTokens: 15,
      usageType: "tokens",
    });
    const updatedRecord = await collector.record({
      billingUnit: "transcribe",
      callId,
      endpointKind: "responses",
      inputTokens: 20,
      model: "gpt-4o",
      outputTokens: 10,
      phase: "transcribe",
      priceTableVersion: "test-prices",
      rawCostMicros: 200,
      totalTokens: 30,
      usageType: "tokens",
    });

    expect(firstRecord.rawCostMicros).toBe(100);
    expect(updatedRecord.rawCostMicros).toBe(200);
    expect(await UsageRecord.countDocuments()).toBe(1);
    expect(collector.phaseTotalsMicros()).toEqual({ transcribe: 200 });

    await collector.markPhaseComplete("transcribe");
    const finalized = collector.finalizedUsageForPhase("transcribe");
    const storedRecord = await UsageRecord.findOne({ callId }).lean();

    expect(finalized).toHaveLength(1);
    expect(finalized[0].attemptFinal).toBe(true);
    expect(storedRecord).toMatchObject({
      attemptFinal: true,
      charged: false,
      rawCostMicros: 200,
    });
  });

  it("records priced OpenAI call usage through the helper", async () => {
    const collector = createUsageCollector({
      jobId: "job-usage-2",
      pipelineRunId: "run-usage-2",
    });

    const responsesRecord = await recordOpenAiCallUsage({
      collector,
      data: {
        usage: {
          input_tokens: 1_000_000,
          output_tokens: 1_000_000,
          total_tokens: 2_000_000,
        },
      },
      endpointKind: "responses",
      model: "gpt-5.4-mini",
      phase: "enrich",
    });
    const audioRecord = await recordOpenAiCallUsage({
      collector,
      data: {
        duration: 10,
      },
      endpointKind: "audio",
      model: "whisper-1",
      phase: "time",
    });

    expect(responsesRecord).toMatchObject({
      callId: "job-usage-2:enrich:1",
      phase: "enrich",
      rawCostMicros: 525_000_000,
      usageType: "tokens",
    });
    expect(audioRecord).toMatchObject({
      audioSeconds: 10,
      callId: "job-usage-2:time:1",
      rawCostMicros: 100_000,
      usageType: "none",
    });
    expect(await UsageRecord.countDocuments()).toBe(2);
  });
});
