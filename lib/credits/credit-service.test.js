import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { connectToDatabase, disconnectFromDatabase } from "../db/mongoose.js";
import { initializeDatabaseIndexes } from "../db/bootstrap.js";
import { Balance } from "../models/Balance.js";
import { CreditLedger } from "../models/CreditLedger.js";
import { UsageRecord } from "../models/UsageRecord.js";
import {
  assertCanStartGeneration,
  getBalance,
  recordUsageOnly,
  settlePhase,
} from "./credit-service.js";

const ORIGINAL_CREDITS_ENABLED = process.env.CREDITS_ENABLED;
const ORIGINAL_MONGODB_URI = process.env.MONGODB_URI;
const ORIGINAL_MONGODB_DB_NAME = process.env.MONGODB_DB_NAME;
const ORIGINAL_MIN_GENERATION_BALANCE_MINOR =
  process.env.MIN_GENERATION_BALANCE_MINOR;
const ORIGINAL_OPENAI_QA_AUDIT_MODEL = process.env.OPENAI_QA_AUDIT_MODEL;

let replSet;

function usageRecordInput(overrides = {}) {
  return {
    billingUnit: "transcribe",
    callId: "job-settle-1:transcribe:1",
    charged: false,
    endpointKind: "responses",
    inputTokens: 100,
    jobId: "job-settle-1",
    model: "gpt-4o",
    outputTokens: 50,
    phase: "transcribe",
    pipelineRunId: "run-settle-1",
    priceTableVersion: "test-prices",
    rawCostMicros: 500_000,
    totalTokens: 150,
    usageType: "tokens",
    ...overrides,
  };
}

async function resetCollections(balanceMinor = 500) {
  await CreditLedger.deleteMany({});
  await UsageRecord.deleteMany({});
  await Balance.findOneAndUpdate(
    { _id: "shared" },
    {
      $set: {
        amountMinor: balanceMinor,
        currency: "GBP",
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
}

describe("credit service", () => {
  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        storageEngine: "wiredTiger",
      },
    });
    process.env.MONGODB_URI = replSet.getUri();
    process.env.MONGODB_DB_NAME = `credit_service_stage3_${Date.now()}`;
    process.env.CREDITS_ENABLED = "true";

    await connectToDatabase();
    await initializeDatabaseIndexes();
  }, 60000);

  beforeEach(async () => {
    process.env.CREDITS_ENABLED = "true";
    process.env.MIN_GENERATION_BALANCE_MINOR = "1";
    delete process.env.OPENAI_QA_AUDIT_MODEL;
    await resetCollections();
  });

  afterEach(() => {
    if (ORIGINAL_MIN_GENERATION_BALANCE_MINOR == null) {
      delete process.env.MIN_GENERATION_BALANCE_MINOR;
    } else {
      process.env.MIN_GENERATION_BALANCE_MINOR =
        ORIGINAL_MIN_GENERATION_BALANCE_MINOR;
    }

    if (ORIGINAL_OPENAI_QA_AUDIT_MODEL == null) {
      delete process.env.OPENAI_QA_AUDIT_MODEL;
    } else {
      process.env.OPENAI_QA_AUDIT_MODEL = ORIGINAL_OPENAI_QA_AUDIT_MODEL;
    }
  });

  afterAll(async () => {
    await disconnectFromDatabase();
    await replSet?.stop();

    if (ORIGINAL_CREDITS_ENABLED == null) {
      delete process.env.CREDITS_ENABLED;
    } else {
      process.env.CREDITS_ENABLED = ORIGINAL_CREDITS_ENABLED;
    }

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

  it("returns disabled shapes without touching Mongo when credits are off", async () => {
    process.env.CREDITS_ENABLED = "false";

    await expect(getBalance()).resolves.toEqual({ enabled: false });
    await expect(assertCanStartGeneration({ phase: "transcribe" })).resolves.toEqual({
      enabled: false,
    });
    await expect(
      settlePhase({
        jobId: "job-disabled",
        phase: "transcribe",
        pipelineRunId: "run-disabled",
        usageRecords: [],
      }),
    ).resolves.toMatchObject({ enabled: false, settled: false });
  });

  it("prechecks pricing and minimum balance before generation start", async () => {
    await expect(assertCanStartGeneration({ phase: "full" })).resolves.toMatchObject({
      balanceMinor: 500,
      currency: "GBP",
      enabled: true,
    });

    process.env.OPENAI_QA_AUDIT_MODEL = "missing-price-model";
    await expect(assertCanStartGeneration({ phase: "time" })).rejects.toMatchObject({
      code: "PRICING_UNAVAILABLE",
      details: { model: "missing-price-model" },
    });

    delete process.env.OPENAI_QA_AUDIT_MODEL;
    await resetCollections(0);
    await expect(assertCanStartGeneration({ phase: "time" })).rejects.toMatchObject({
      code: "INSUFFICIENT_BALANCE",
      details: {
        balanceMinor: 0,
        minimumBalanceMinor: 1,
      },
    });
  });

  it("settles a completed phase exactly once and marks usage charged", async () => {
    const usageRecord = await UsageRecord.create(usageRecordInput());

    const firstSettlement = await settlePhase({
      jobId: "job-settle-1",
      phase: "transcribe",
      pipelineRunId: "run-settle-1",
      usageRecords: [usageRecord.toObject()],
    });
    const replaySettlement = await settlePhase({
      jobId: "job-settle-1",
      phase: "transcribe",
      pipelineRunId: "run-settle-1",
      usageRecords: [usageRecord.toObject()],
    });
    const storedUsage = await UsageRecord.findOne({
      callId: usageRecord.callId,
    }).lean();

    expect(firstSettlement).toMatchObject({
      amountMinor: 1,
      applied: true,
      phase: "transcribe",
      settled: true,
    });
    expect(replaySettlement).toMatchObject({
      amountMinor: 1,
      applied: false,
      phase: "transcribe",
      settled: true,
    });
    expect(await CreditLedger.countDocuments()).toBe(1);
    expect((await Balance.findById("shared").lean()).amountMinor).toBe(499);
    expect(storedUsage).toMatchObject({
      attemptFinal: true,
      charged: true,
    });
  });

  it("flags replay divergence instead of silently accepting a different cost", async () => {
    const usageRecord = await UsageRecord.create(usageRecordInput());
    await settlePhase({
      jobId: "job-settle-1",
      phase: "transcribe",
      pipelineRunId: "run-settle-1",
      usageRecords: [usageRecord.toObject()],
    });

    await expect(
      settlePhase({
        jobId: "job-settle-1",
        phase: "transcribe",
        pipelineRunId: "run-settle-1",
        usageRecords: [
          {
            ...usageRecord.toObject(),
            rawCostMicros: 1_500_000,
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "ACCOUNTING_CONFLICT",
    });
    expect(await CreditLedger.countDocuments()).toBe(1);
    expect((await Balance.findById("shared").lean()).amountMinor).toBe(499);
  });

  it("settles zero-cost phases without a ledger entry", async () => {
    const usageRecord = await UsageRecord.create(
      usageRecordInput({
        callId: "job-zero:transcribe:1",
        jobId: "job-zero",
        rawCostMicros: 0,
      }),
    );

    await expect(
      settlePhase({
        jobId: "job-zero",
        phase: "transcribe",
        pipelineRunId: "run-zero",
        usageRecords: [usageRecord.toObject()],
      }),
    ).resolves.toMatchObject({
      amountMinor: 0,
      ledger: null,
      settled: true,
    });
    expect(await CreditLedger.countDocuments()).toBe(0);
    expect(
      await UsageRecord.findOne({ callId: "job-zero:transcribe:1" }).lean(),
    ).toMatchObject({
      attemptFinal: true,
      charged: true,
    });
  });

  it("records failed phase usage as uncharged audit data", async () => {
    const usageRecord = await UsageRecord.create(
      usageRecordInput({
        callId: "job-failed:time:1",
        jobId: "job-failed",
        phase: "time",
        billingUnit: "time",
      }),
    );

    await expect(
      recordUsageOnly({
        phase: "time",
        usageRecords: [usageRecord.toObject()],
      }),
    ).resolves.toMatchObject({
      enabled: true,
      phase: "time",
      recorded: true,
    });
    expect(await UsageRecord.findOne({ callId: "job-failed:time:1" }).lean()).toMatchObject({
      attemptFinal: false,
      charged: false,
    });
  });
});
