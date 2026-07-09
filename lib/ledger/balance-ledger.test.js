import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  ensureSharedBalance,
  getInitialBalanceMinor,
  initializeDatabaseIndexes,
} from "../db/bootstrap.js";
import {
  assertTransactionsSupported,
  connectToDatabase,
  disconnectFromDatabase,
  hasMongoUri,
} from "../db/mongoose.js";
import { Balance } from "../models/Balance.js";
import { CreditLedger } from "../models/CreditLedger.js";
import { Generation } from "../models/Generation.js";
import { PaymentOrder } from "../models/PaymentOrder.js";
import { RefundRecord } from "../models/RefundRecord.js";
import { UsageRecord } from "../models/UsageRecord.js";
import { WebhookEvent } from "../models/WebhookEvent.js";
import {
  LedgerError,
  applyLedgeredBalanceChange,
  isInsufficientBalanceError,
  isLedgerReplayDivergenceError,
  validateLedgerChangeInput,
} from "./balance-ledger.js";

const ORIGINAL_MONGODB_URI = process.env.MONGODB_URI;
const ORIGINAL_MONGODB_DB_NAME = process.env.MONGODB_DB_NAME;
const ORIGINAL_INITIAL_BALANCE_MINOR = process.env.INITIAL_BALANCE_MINOR;

const MODELS = [
  Balance,
  CreditLedger,
  Generation,
  PaymentOrder,
  RefundRecord,
  UsageRecord,
  WebhookEvent,
];

let replSet;

async function clearCollections() {
  for (const model of MODELS) {
    await model.deleteMany({});
  }
}

async function resetSharedBalance(amountMinor = 500) {
  await Balance.findOneAndUpdate(
    { _id: "shared" },
    {
      $set: {
        amountMinor,
        currency: "GBP",
        updatedAt: new Date(),
      },
    },
    {
      upsert: true,
    },
  );
}

async function runInTransaction(callback, attempts = 5) {
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const session = await mongoose.startSession();

    try {
      let result;
      await session.withTransaction(async () => {
        result = await callback(session);
      });
      return result;
    } catch (error) {
      lastError = error;

      if (!error?.hasErrorLabel?.("TransientTransactionError")) {
        throw error;
      }
    } finally {
      await session.endSession();
    }
  }

  throw lastError;
}

function ledgerInput(overrides = {}) {
  return {
    amountMinor: -125,
    idempotencyKey: "ai_debit:job-1:transcribe",
    metadata: {
      callIds: ["job-1:transcribe:1"],
      phase: "transcribe",
      pipelineRunId: "run-1",
      rawCostMicros: 125_000_000,
    },
    reason: "AI transcribe phase",
    type: "AI_TRANSCRIBE",
    ...overrides,
  };
}

function usageRecordInput(overrides = {}) {
  return {
    billingUnit: "transcribe",
    callId: "job-1:transcribe:1",
    charged: false,
    endpointKind: "responses",
    inputTokens: 10,
    jobId: "job-1",
    model: "gpt-5.4",
    outputTokens: 20,
    phase: "transcribe",
    pipelineRunId: "run-1",
    priceTableVersion: "test-v1",
    rawCostMicros: 125_000_000,
    totalTokens: 30,
    usageType: "tokens",
    ...overrides,
  };
}

describe("Stage 1 credit database foundation", () => {
  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        storageEngine: "wiredTiger",
      },
    });
    process.env.MONGODB_URI = replSet.getUri();
    process.env.MONGODB_DB_NAME = `credit_stage1_${Date.now()}`;

    await connectToDatabase();
    await initializeDatabaseIndexes();
  }, 60000);

  beforeEach(async () => {
    await clearCollections();
    delete process.env.INITIAL_BALANCE_MINOR;
    await ensureSharedBalance();
  });

  afterEach(() => {
    if (ORIGINAL_INITIAL_BALANCE_MINOR == null) {
      delete process.env.INITIAL_BALANCE_MINOR;
    } else {
      process.env.INITIAL_BALANCE_MINOR = ORIGINAL_INITIAL_BALANCE_MINOR;
    }
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

  it("connects to the configured MongoDB URI and verifies transaction support", async () => {
    expect(hasMongoUri()).toBe(true);
    const firstConnection = await connectToDatabase();
    const secondConnection = await connectToDatabase();

    expect(secondConnection).toBe(firstConnection);
    await expect(assertTransactionsSupported()).resolves.toBe(true);
  });

  it("seeds the shared balance from INITIAL_BALANCE_MINOR", async () => {
    await Balance.deleteMany({});
    process.env.INITIAL_BALANCE_MINOR = "777";

    const balance = await ensureSharedBalance();

    expect(getInitialBalanceMinor()).toBe(777);
    expect(balance).toMatchObject({
      _id: "shared",
      amountMinor: 777,
      currency: "GBP",
    });
    expect(() => {
      process.env.INITIAL_BALANCE_MINOR = "12.5";
      getInitialBalanceMinor();
    }).toThrow("INITIAL_BALANCE_MINOR");
  });

  it("builds the unique indexes needed for idempotency", async () => {
    const ledgerIndexes = await CreditLedger.collection.indexes();
    const usageIndexes = await UsageRecord.collection.indexes();
    const generationIndexes = await Generation.collection.indexes();

    expect(
      ledgerIndexes.some((index) => index.name === "idempotencyKey_1" && index.unique),
    ).toBe(true);
    expect(
      usageIndexes.some((index) => index.name === "callId_1" && index.unique),
    ).toBe(true);
    expect(
      generationIndexes.some((index) => index.name === "r2ObjectKey_1" && index.unique),
    ).toBe(true);
  });

  it("validates ledger input before touching the database", () => {
    const validInput = {
      ...ledgerInput(),
      session: {},
    };

    expect(() => validateLedgerChangeInput(validInput)).not.toThrow();
    expect(() =>
      validateLedgerChangeInput({ ...validInput, amountMinor: 1.5 }),
    ).toThrow(LedgerError);
    expect(() => validateLedgerChangeInput({ ...validInput, amountMinor: 0 })).toThrow(
      "non-zero integer pence",
    );
    expect(() => validateLedgerChangeInput({ ...validInput, currency: "EUR" })).toThrow(
      "Only GBP",
    );
    expect(() => validateLedgerChangeInput({ ...validInput, type: "OTHER" })).toThrow(
      "Unsupported ledger entry type",
    );
    expect(() => validateLedgerChangeInput({ ...validInput, session: null })).toThrow(
      "session is required",
    );
    expect(() =>
      validateLedgerChangeInput({ ...validInput, idempotencyKey: "" }),
    ).toThrow("idempotencyKey");
    expect(() => validateLedgerChangeInput({ ...validInput, reason: "" })).toThrow(
      "reason",
    );
  });

  it("applies a ledger entry once and treats exact replay as idempotent", async () => {
    const firstResult = await runInTransaction((session) =>
      applyLedgeredBalanceChange(ledgerInput({ session })),
    );
    const replayResult = await runInTransaction((session) =>
      applyLedgeredBalanceChange(ledgerInput({ session })),
    );
    const balance = await Balance.findById("shared").lean();

    expect(firstResult.applied).toBe(true);
    expect(firstResult.balance.amountMinor).toBe(375);
    expect(replayResult.applied).toBe(false);
    expect(replayResult.ledger.idempotencyKey).toBe("ai_debit:job-1:transcribe");
    expect(balance.amountMinor).toBe(375);
    expect(await CreditLedger.countDocuments()).toBe(1);
  });

  it("rejects replay divergence for the same idempotency key", async () => {
    await runInTransaction((session) => applyLedgeredBalanceChange(ledgerInput({ session })));

    let thrown;
    try {
      await runInTransaction((session) =>
        applyLedgeredBalanceChange(
          ledgerInput({
            amountMinor: -126,
            session,
          }),
        ),
      );
    } catch (error) {
      thrown = error;
    }

    expect(isLedgerReplayDivergenceError(thrown)).toBe(true);
    expect((await Balance.findById("shared").lean()).amountMinor).toBe(375);
    expect(await CreditLedger.countDocuments()).toBe(1);
  });

  it("keeps the balance non-negative and rolls back failed debit ledgers", async () => {
    await resetSharedBalance(2);

    let thrown;
    try {
      await runInTransaction((session) =>
        applyLedgeredBalanceChange(
          ledgerInput({
            amountMinor: -3,
            idempotencyKey: "ai_debit:job-low:transcribe",
            session,
          }),
        ),
      );
    } catch (error) {
      thrown = error;
    }

    expect(isInsufficientBalanceError(thrown)).toBe(true);
    expect((await Balance.findById("shared").lean()).amountMinor).toBe(2);
    expect(await CreditLedger.countDocuments()).toBe(0);
  });

  it("clamps AI debits to available balance and records writeOffMinor", async () => {
    await resetSharedBalance(2);

    const firstResult = await runInTransaction((session) =>
      applyLedgeredBalanceChange(
        ledgerInput({
          amountMinor: -5,
          idempotencyKey: "ai_debit:job-clamp:transcribe",
          metadata: {
            callIds: ["job-clamp:transcribe:1"],
            phase: "transcribe",
            pipelineRunId: "run-clamp",
            rawCostMicros: 5_000_000,
          },
          mode: "clamp",
          session,
        }),
      ),
    );
    const replayResult = await runInTransaction((session) =>
      applyLedgeredBalanceChange(
        ledgerInput({
          amountMinor: -5,
          idempotencyKey: "ai_debit:job-clamp:transcribe",
          metadata: {
            callIds: ["job-clamp:transcribe:1"],
            phase: "transcribe",
            pipelineRunId: "run-clamp",
            rawCostMicros: 5_000_000,
          },
          mode: "clamp",
          session,
        }),
      ),
    );
    const balance = await Balance.findById("shared").lean();
    const ledger = await CreditLedger.findOne({
      idempotencyKey: "ai_debit:job-clamp:transcribe",
    }).lean();

    expect(firstResult).toMatchObject({
      applied: true,
      clamped: true,
      debitMinor: 2,
      fullCostMinor: 5,
      writeOffMinor: 3,
    });
    expect(firstResult.balance.amountMinor).toBe(0);
    expect(replayResult).toMatchObject({
      applied: false,
      clamped: true,
      debitMinor: 2,
      fullCostMinor: 5,
      writeOffMinor: 3,
    });
    expect(balance.amountMinor).toBe(0);
    expect(await CreditLedger.countDocuments()).toBe(1);
    expect(ledger).toMatchObject({
      amountMinor: -2,
      balanceAfterMinor: 0,
      metadata: {
        fullCostMinor: 5,
        settlementMode: "clamp",
        writeOffMinor: 3,
      },
    });
  });

  it("fully writes off a clamp debit when balance is already zero", async () => {
    await resetSharedBalance(0);

    const result = await runInTransaction((session) =>
      applyLedgeredBalanceChange(
        ledgerInput({
          amountMinor: -4,
          idempotencyKey: "ai_debit:job-zero-balance:enrich",
          metadata: {
            callIds: ["job-zero-balance:enrich:1"],
            phase: "enrich",
            pipelineRunId: "run-zero-balance",
            rawCostMicros: 4_000_000,
          },
          mode: "clamp",
          reason: "AI enrich phase",
          session,
          type: "AI_ENRICH",
        }),
      ),
    );

    expect(result).toMatchObject({
      applied: true,
      clamped: true,
      debitMinor: 0,
      fullCostMinor: 4,
      ledger: null,
      writeOffMinor: 4,
    });
    expect(result.balance.amountMinor).toBe(0);
    expect(await CreditLedger.countDocuments()).toBe(0);
  });

  it("keeps reject semantics for non-clamp debits (top-up path unchanged)", async () => {
    await resetSharedBalance(1);

    let thrown;
    try {
      await runInTransaction((session) =>
        applyLedgeredBalanceChange(
          ledgerInput({
            amountMinor: -3,
            idempotencyKey: "manual:reject-overdraw",
            mode: "reject",
            reason: "Manual debit",
            session,
            type: "MANUAL_ADJUSTMENT",
          }),
        ),
      );
    } catch (error) {
      thrown = error;
    }

    expect(isInsufficientBalanceError(thrown)).toBe(true);
    expect((await Balance.findById("shared").lean()).amountMinor).toBe(1);
    expect(await CreditLedger.countDocuments()).toBe(0);
  });

  it("allows only one concurrent debit when both would overdraw the shared balance", async () => {
    await resetSharedBalance(5);

    async function attemptDebit(key) {
      try {
        const result = await runInTransaction((session) =>
          applyLedgeredBalanceChange(
            ledgerInput({
              amountMinor: -3,
              idempotencyKey: key,
              metadata: {
                callIds: [`${key}:call`],
                phase: "transcribe",
                pipelineRunId: "run-concurrent",
                rawCostMicros: 3_000_000,
              },
              session,
            }),
          ),
        );

        return {
          ok: true,
          result,
        };
      } catch (error) {
        return {
          error,
          ok: false,
        };
      }
    }

    const results = await Promise.all([
      attemptDebit("ai_debit:job-concurrent-a:transcribe"),
      attemptDebit("ai_debit:job-concurrent-b:transcribe"),
    ]);
    const successes = results.filter((result) => result.ok);
    const failures = results.filter((result) => !result.ok);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(isInsufficientBalanceError(failures[0].error)).toBe(true);
    expect((await Balance.findById("shared").lean()).amountMinor).toBe(2);
    expect(await CreditLedger.countDocuments()).toBe(1);
  });

  it("enforces Generation and UsageRecord contracts", async () => {
    const generation = await Generation.create({
      accountingStatus: "settled",
      billing: {
        ledgerKeys: ["ai_debit:job-1:transcribe"],
        phaseCostsMinor: {
          enrich: null,
          time: null,
          transcribe: 125,
        },
        priceTableVersion: "test-v1",
        totalCostMinor: 125,
      },
      finalJobId: "job-1",
      jobIds: ["job-1"],
      pipelineRunId: "run-1",
      r2ObjectKey: "generations/generation-1/audio.mp3",
      r2Status: "pending_create",
      saved: true,
      snapshot: {
        lines: [],
        project: {},
        sourceLanguage: "auto",
        timings: [],
        translations: [],
      },
      sourceType: "upload",
      title: "Stage 1 test",
    });

    expect(generation.public).toBe(true);

    await UsageRecord.create(usageRecordInput());
    await expect(UsageRecord.create(usageRecordInput())).rejects.toMatchObject({
      code: 11000,
    });
    await expect(
      Generation.create({
        finalJobId: "job-2",
        jobIds: ["job-2"],
        pipelineRunId: "run-2",
        r2ObjectKey: "generations/generation-1/audio.mp3",
        r2Status: "pending_create",
        saved: true,
        snapshot: { lines: [] },
        sourceType: "youtube",
        title: "Duplicate R2 key",
      }),
    ).rejects.toMatchObject({
      code: 11000,
    });
  });
});
