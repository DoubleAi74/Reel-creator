/**
 * REP-701 — Standalone guarded-invariant suite.
 * Asserts money-model edges and route protections that must not regress.
 */
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { initializeDatabaseIndexes } from "../db/bootstrap.js";
import { connectToDatabase, disconnectFromDatabase } from "../db/mongoose.js";
import { Balance } from "../models/Balance.js";
import { CreditLedger } from "../models/CreditLedger.js";
import { Generation } from "../models/Generation.js";
import { PaymentOrder } from "../models/PaymentOrder.js";
import { UsageRecord } from "../models/UsageRecord.js";
import {
  assertCanStartGeneration,
  settlePhase,
} from "./credit-service.js";
import {
  applyLedgeredBalanceChange,
  isInsufficientBalanceError,
} from "../ledger/balance-ledger.js";
import mongoose from "mongoose";

const ORIGINAL_ENV = { ...process.env };

let replSet;

async function runInTransaction(callback) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await callback(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function resetBalance(amountMinor = 500) {
  await CreditLedger.deleteMany({});
  await UsageRecord.deleteMany({});
  await Generation.deleteMany({});
  await PaymentOrder.deleteMany({});
  await Balance.findOneAndUpdate(
    { _id: "shared" },
    {
      $set: {
        amountMinor,
        currency: "GBP",
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
}

describe("REP-701 guarded invariants", () => {
  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
    });
    process.env.MONGODB_URI = replSet.getUri();
    process.env.MONGODB_DB_NAME = `guarded_invariants_${Date.now()}`;
    process.env.CREDITS_ENABLED = "true";
    await connectToDatabase();
    await initializeDatabaseIndexes();
  }, 60000);

  beforeEach(async () => {
    process.env.CREDITS_ENABLED = "true";
    await resetBalance(500);
  });

  afterAll(async () => {
    await disconnectFromDatabase();
    await replSet?.stop();
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("clamps AI debit cost>balance to 0 with writeOffMinor (never negative)", async () => {
    await resetBalance(2);
    const usage = await UsageRecord.create({
      attemptFinal: true,
      billingUnit: "transcribe",
      callId: "job-h1:transcribe:1",
      charged: false,
      endpointKind: "responses",
      inputTokens: 1,
      jobId: "job-h1",
      model: "gpt-4o",
      outputTokens: 1,
      phase: "transcribe",
      pipelineRunId: "run-h1",
      priceTableVersion: "test",
      // 5 pence after half-up from 4_500_000 micros
      rawCostMicros: 4_500_000,
      totalTokens: 2,
      usageType: "tokens",
    });

    const settlement = await settlePhase({
      jobId: "job-h1",
      phase: "transcribe",
      pipelineRunId: "run-h1",
      usageRecords: [usage.toObject()],
    });

    expect(settlement).toMatchObject({
      clamped: true,
      debitMinor: 2,
      fullCostMinor: 5,
      settled: true,
      writeOffMinor: 3,
    });
    expect((await Balance.findById("shared").lean()).amountMinor).toBe(0);
    expect(await CreditLedger.countDocuments()).toBe(1);
    expect(
      await UsageRecord.findOne({ callId: "job-h1:transcribe:1" }).lean(),
    ).toMatchObject({
      charged: true,
      writeOffMinor: 3,
    });
  });

  it("block-boundary: enrich exempt after zero balance; time start rejects", async () => {
    await resetBalance(1);
    const usage = await UsageRecord.create({
      attemptFinal: true,
      billingUnit: "transcribe",
      callId: "job-block:transcribe:1",
      charged: false,
      endpointKind: "responses",
      inputTokens: 1,
      jobId: "job-block",
      model: "gpt-4o",
      outputTokens: 1,
      phase: "transcribe",
      pipelineRunId: "run-block",
      priceTableVersion: "test",
      rawCostMicros: 1_500_000,
      totalTokens: 2,
      usageType: "tokens",
    });
    await settlePhase({
      jobId: "job-block",
      phase: "transcribe",
      pipelineRunId: "run-block",
      usageRecords: [usage.toObject()],
    });
    expect((await Balance.findById("shared").lean()).amountMinor).toBe(0);

    await expect(assertCanStartGeneration({ phase: "enrich" })).resolves.toMatchObject({
      gateExempt: true,
    });
    await expect(assertCanStartGeneration({ phase: "time" })).rejects.toMatchObject({
      code: "INSUFFICIENT_BALANCE",
    });
    await expect(assertCanStartGeneration({ phase: "transcribe" })).rejects.toMatchObject({
      code: "INSUFFICIENT_BALANCE",
    });
  });

  it("non-AI reject mode still rejects overdraw (top-up/other debits unchanged)", async () => {
    await resetBalance(1);
    let thrown;
    try {
      await runInTransaction((session) =>
        applyLedgeredBalanceChange({
          amountMinor: -5,
          idempotencyKey: "manual:overdraw",
          mode: "reject",
          reason: "manual",
          session,
          type: "MANUAL_ADJUSTMENT",
        }),
      );
    } catch (error) {
      thrown = error;
    }
    expect(isInsufficientBalanceError(thrown)).toBe(true);
    expect((await Balance.findById("shared").lean()).amountMinor).toBe(1);
    expect(await CreditLedger.countDocuments()).toBe(0);
  });
});
