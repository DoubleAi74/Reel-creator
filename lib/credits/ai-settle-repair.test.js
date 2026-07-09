import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { connectToDatabase, disconnectFromDatabase } from "../db/mongoose.js";
import { initializeDatabaseIndexes } from "../db/bootstrap.js";
import { Balance } from "../models/Balance.js";
import { CreditLedger } from "../models/CreditLedger.js";
import { Generation } from "../models/Generation.js";
import { UsageRecord } from "../models/UsageRecord.js";
import {
  applyManualAdjustment,
  reSettleCandidate,
  runAiSettleRepair,
  scanUnresolvedAiSettlementCandidates,
} from "./ai-settle-repair.js";

const ORIGINAL_CREDITS_ENABLED = process.env.CREDITS_ENABLED;
const ORIGINAL_MONGODB_URI = process.env.MONGODB_URI;
const ORIGINAL_MONGODB_DB_NAME = process.env.MONGODB_DB_NAME;

let replSet;

function usageRecordInput(overrides = {}) {
  return {
    attemptFinal: true,
    billingUnit: "transcribe",
    callId: "job-repair-1:transcribe:1",
    charged: false,
    endpointKind: "responses",
    inputTokens: 100,
    jobId: "job-repair-1",
    model: "gpt-4o",
    outputTokens: 50,
    phase: "transcribe",
    pipelineRunId: "run-repair-1",
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
  await Generation.deleteMany({});
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

describe("ai settle repair (REP-202)", () => {
  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        storageEngine: "wiredTiger",
      },
    });
    process.env.MONGODB_URI = replSet.getUri();
    process.env.MONGODB_DB_NAME = `ai_settle_repair_${Date.now()}`;
    process.env.CREDITS_ENABLED = "false";

    await connectToDatabase();
    await initializeDatabaseIndexes();
  }, 60000);

  beforeEach(async () => {
    process.env.CREDITS_ENABLED = "false";
    await resetCollections();
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

  it("scans uncharged finalized usage and unresolved generations without writing", async () => {
    await UsageRecord.create(usageRecordInput());
    await UsageRecord.create(
      usageRecordInput({
        // Clamp write-off already settled — must not be a candidate.
        attemptFinal: true,
        callId: "job-clamp:transcribe:1",
        charged: true,
        chargedMinor: 0,
        fullCostMinor: 2,
        jobId: "job-clamp",
        writeOffMinor: 2,
      }),
    );
    await Generation.create({
      accountingStatus: "unresolved",
      finalJobId: "job-repair-1",
      jobIds: ["job-repair-1"],
      pipelineRunId: "run-repair-1",
      r2ObjectKey: "generations/repair-1/audio.mp3",
      r2Status: "pending_create",
      saved: true,
      snapshot: { lines: [] },
      sourceType: "upload",
      title: "Unresolved gen",
    });

    const ledgerCountBefore = await CreditLedger.countDocuments();
    const balanceBefore = (await Balance.findById("shared").lean()).amountMinor;

    const scan = await scanUnresolvedAiSettlementCandidates();

    expect(scan.summary.candidateCount).toBe(1);
    expect(scan.candidates[0]).toMatchObject({
      fullCostMinor: 1,
      hasLedgerEntry: false,
      idempotencyKey: "ai_debit:job-repair-1:transcribe",
      jobId: "job-repair-1",
      phase: "transcribe",
    });
    expect(scan.unresolvedGenerations).toHaveLength(1);
    expect(await CreditLedger.countDocuments()).toBe(ledgerCountBefore);
    expect((await Balance.findById("shared").lean()).amountMinor).toBe(
      balanceBefore,
    );
  });

  it("dry-run re-settle writes nothing", async () => {
    await UsageRecord.create(usageRecordInput());

    const result = await runAiSettleRepair({ apply: false });

    expect(result.summary.dryRun).toBe(true);
    expect(result.reSettleResults[0]).toMatchObject({
      applied: false,
      dryRun: true,
      jobId: "job-repair-1",
    });
    expect(await CreditLedger.countDocuments()).toBe(0);
    expect(
      await UsageRecord.findOne({ callId: "job-repair-1:transcribe:1" }).lean(),
    ).toMatchObject({
      charged: false,
    });
    expect((await Balance.findById("shared").lean()).amountMinor).toBe(500);
  });

  it("applies re-settle once and is idempotent on a second apply", async () => {
    await UsageRecord.create(usageRecordInput());
    await Generation.create({
      accountingStatus: "unresolved",
      finalJobId: "job-repair-1",
      jobIds: ["job-repair-1"],
      pipelineRunId: "run-repair-1",
      r2ObjectKey: "generations/repair-1b/audio.mp3",
      r2Status: "pending_create",
      saved: true,
      snapshot: { lines: [] },
      sourceType: "upload",
      title: "To settle",
    });

    const first = await runAiSettleRepair({ apply: true });
    const second = await runAiSettleRepair({ apply: true });

    expect(first.reSettleResults[0]).toMatchObject({
      applied: true,
      debitMinor: 1,
      settled: true,
    });
    expect(first.balanceAfterMinor).toBe(499);
    expect(await CreditLedger.countDocuments()).toBe(1);
    expect(
      await UsageRecord.findOne({ callId: "job-repair-1:transcribe:1" }).lean(),
    ).toMatchObject({
      attemptFinal: true,
      charged: true,
    });
    expect(
      await Generation.findOne({ finalJobId: "job-repair-1" }).lean(),
    ).toMatchObject({
      accountingStatus: "settled",
    });

    // Second apply: no second debit (idempotent key).
    expect(second.candidates).toHaveLength(0);
    expect(await CreditLedger.countDocuments()).toBe(1);
    expect((await Balance.findById("shared").lean()).amountMinor).toBe(499);
  });

  it("re-settles a single candidate idempotently via reSettleCandidate", async () => {
    await resetCollections(2);
    await UsageRecord.create(
      usageRecordInput({
        callId: "job-once:transcribe:1",
        jobId: "job-once",
        rawCostMicros: 1_500_000,
      }),
    );

    const candidate = (
      await scanUnresolvedAiSettlementCandidates({ jobId: "job-once" })
    ).candidates[0];

    const first = await reSettleCandidate(candidate, { apply: true });
    // Reload usage from DB for second call so replay uses stored charged rows path
    // via settlePhase idempotency (same key; no second debit).
    const second = await reSettleCandidate(
      {
        jobId: "job-once",
        phase: "transcribe",
        pipelineRunId: "run-repair-1",
        usageRecords: [
          await UsageRecord.findOne({ callId: "job-once:transcribe:1" }).lean(),
        ],
      },
      { apply: true },
    );

    expect(first).toMatchObject({
      applied: true,
      debitMinor: 2,
      settled: true,
    });
    expect(second).toMatchObject({
      applied: true,
      settled: true,
    });
    expect(await CreditLedger.countDocuments()).toBe(1);
    expect((await Balance.findById("shared").lean()).amountMinor).toBe(0);
  });

  it("applies MANUAL_ADJUSTMENT once and dry-run does not write", async () => {
    const dry = await applyManualAdjustment({
      amountMinor: -3,
      apply: false,
      reason: "operator write-off correction",
    });

    expect(dry).toMatchObject({
      applied: false,
      dryRun: true,
      amountMinor: -3,
    });
    expect(await CreditLedger.countDocuments()).toBe(0);

    const first = await applyManualAdjustment({
      amountMinor: -3,
      apply: true,
      idempotencyKey: "manual_adj:ai_repair:test-1",
      reason: "operator write-off correction",
    });
    const second = await applyManualAdjustment({
      amountMinor: -3,
      apply: true,
      idempotencyKey: "manual_adj:ai_repair:test-1",
      reason: "operator write-off correction",
    });

    expect(first).toMatchObject({
      applied: true,
      amountMinor: -3,
      balanceMinor: 497,
    });
    expect(second).toMatchObject({
      applied: false,
      amountMinor: -3,
      balanceMinor: 497,
    });
    expect(await CreditLedger.countDocuments()).toBe(1);
    expect((await Balance.findById("shared").lean()).amountMinor).toBe(497);
  });
});
