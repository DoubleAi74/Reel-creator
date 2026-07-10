import mongoose from "mongoose";

import { assertTransactionsSupported, connectToDatabase } from "../db/mongoose.js";
import { ensureSharedBalance, initializeDatabaseIndexes } from "../db/bootstrap.js";
import {
  LedgerError,
  applyLedgeredBalanceChange,
  isInsufficientBalanceError,
  isLedgerReplayDivergenceError,
} from "../ledger/balance-ledger.js";
import { Balance } from "../models/Balance.js";
import { UsageRecord } from "../models/UsageRecord.js";
import { getLiveOpenAiModelsByBillingPhase } from "../ai/openai-lyrics.js";
import { hasPrice, roundMicrosToPenceHalfUp } from "../ai/openai-pricing.js";
import { getLedgerTypeForBillingPhase, normalizeBillingPhase } from "./billing-phases.js";
import { getMinimumGenerationBalanceMinor, isCreditsEnabled } from "./flags.js";

export class CreditServiceError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "CreditServiceError";
    this.code = code;
    this.details = details;
  }
}

/** Precheck model list — single source derived from live pipeline models (REP-206). */
export function getConfiguredOpenAiModelsByPhase() {
  return getLiveOpenAiModelsByBillingPhase();
}

export function getRequiredModelsForPhase(phase) {
  const modelsByPhase = getConfiguredOpenAiModelsByPhase();

  if (phase === "full") {
    return [...new Set(Object.values(modelsByPhase).flat())];
  }

  if (phase === "generate") {
    return [
      ...new Set([
        ...(modelsByPhase.transcribe ?? []),
        ...(modelsByPhase.enrich ?? []),
      ]),
    ];
  }

  return [...new Set(modelsByPhase[normalizeBillingPhase(phase)])];
}

export function assertModelsPricedForPhase(phase) {
  for (const model of getRequiredModelsForPhase(phase)) {
    if (!hasPrice(model)) {
      throw new CreditServiceError(
        `OpenAI pricing is unavailable for model ${model}.`,
        "PRICING_UNAVAILABLE",
        { model },
      );
    }
  }
}

export async function getBalance() {
  if (!isCreditsEnabled()) {
    return {
      enabled: false,
    };
  }

  await initializeDatabaseIndexes();
  await assertTransactionsSupported();

  const balance = await ensureSharedBalance();

  return {
    balanceMinor: balance.amountMinor,
    currency: balance.currency,
    enabled: true,
  };
}

/**
 * Block-boundary balance gate (REP-201 / D-A):
 * - Block A = transcribe + enrich; Block B = time
 * - Gate before Block A (`generate` / `transcribe` / `full`) and before Block B (`time`)
 * - Do NOT gate `enrich` — authorised continuation of Block A
 */
export function isBlockBoundaryPhase(phase) {
  if (phase === "full" || phase === "generate") {
    return true;
  }

  const billingPhase = normalizeBillingPhase(phase);
  return billingPhase === "transcribe" || billingPhase === "time";
}

export async function assertCanStartGeneration({ phase }) {
  if (!isCreditsEnabled()) {
    return {
      enabled: false,
    };
  }

  assertModelsPricedForPhase(phase);
  await initializeDatabaseIndexes();
  await assertTransactionsSupported();

  const balance = await ensureSharedBalance();

  // Enrich is exempt from the balance floor (block-boundary gating).
  if (!isBlockBoundaryPhase(phase)) {
    return {
      balanceMinor: balance.amountMinor,
      currency: balance.currency,
      enabled: true,
      gateExempt: true,
    };
  }

  const minimumBalanceMinor = getMinimumGenerationBalanceMinor();

  if (balance.amountMinor < minimumBalanceMinor) {
    throw new CreditServiceError("Insufficient credit balance.", "INSUFFICIENT_BALANCE", {
      balanceMinor: balance.amountMinor,
      minimumBalanceMinor,
    });
  }

  return {
    balanceMinor: balance.amountMinor,
    currency: balance.currency,
    enabled: true,
  };
}

function normalizeUsageRecords(usageRecords) {
  return (Array.isArray(usageRecords) ? usageRecords : []).filter(
    (record) => record && typeof record.callId === "string",
  );
}

function summarizeUsageRecords(usageRecords) {
  const records = normalizeUsageRecords(usageRecords);
  const models = [...new Set(records.map((record) => record.model).filter(Boolean))];
  const callIds = records.map((record) => record.callId);
  const rawCostMicros = records.reduce(
    (sum, record) => sum + (Number.isSafeInteger(record.rawCostMicros) ? record.rawCostMicros : 0),
    0,
  );
  const priceTableVersions = [
    ...new Set(records.map((record) => record.priceTableVersion).filter(Boolean)),
  ];

  return {
    callIds,
    models,
    priceTableVersion: priceTableVersions[0] ?? null,
    rawCostMicros,
    recordCount: records.length,
  };
}

async function runTransaction(callback) {
  await connectToDatabase();
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

export async function settlePhase({ jobId, phase, pipelineRunId, usageRecords }) {
  if (!isCreditsEnabled()) {
    return {
      enabled: false,
      phase,
      settled: false,
    };
  }

  const billingPhase = normalizeBillingPhase(phase);
  const usageSummary = summarizeUsageRecords(usageRecords);
  const amountMinor = roundMicrosToPenceHalfUp(usageSummary.rawCostMicros);

  await initializeDatabaseIndexes();
  await assertTransactionsSupported();

  if (amountMinor === 0) {
    if (usageSummary.callIds.length > 0) {
      await UsageRecord.updateMany(
        { callId: { $in: usageSummary.callIds } },
        {
          $set: {
            attemptFinal: true,
            charged: true,
            chargedMinor: 0,
            fullCostMinor: 0,
            writeOffMinor: 0,
          },
        },
      );
    }

    return {
      amountMinor,
      balanceExhausted: false,
      clamped: false,
      debitMinor: 0,
      enabled: true,
      fullCostMinor: 0,
      ledger: null,
      phase: billingPhase,
      rawCostMicros: usageSummary.rawCostMicros,
      settled: true,
      writeOffMinor: 0,
    };
  }

  try {
    // AI settlement uses clamp-to-zero (REP-201 / D-A). Top-ups and other
    // debits keep reject-on-insufficient via applyLedgeredBalanceChange default.
    return await runTransaction(async (session) => {
      const ledgerResult = await applyLedgeredBalanceChange({
        amountMinor: -amountMinor,
        idempotencyKey: `ai_debit:${jobId}:${billingPhase}`,
        metadata: {
          callIds: usageSummary.callIds,
          jobId,
          models: usageSummary.models,
          phase: billingPhase,
          pipelineRunId,
          priceTableVersion: usageSummary.priceTableVersion,
          rawCostMicros: usageSummary.rawCostMicros,
          usageSummary,
        },
        mode: "clamp",
        reason: `AI ${billingPhase} phase`,
        session,
        type: getLedgerTypeForBillingPhase(billingPhase),
      });

      const debitMinor = ledgerResult.debitMinor ?? 0;
      const writeOffMinor = ledgerResult.writeOffMinor ?? 0;
      const balanceMinor = ledgerResult.balance?.amountMinor ?? 0;

      if (usageSummary.callIds.length > 0) {
        await UsageRecord.updateMany(
          { callId: { $in: usageSummary.callIds } },
          {
            $set: {
              attemptFinal: true,
              charged: true,
              chargedMinor: debitMinor,
              fullCostMinor: amountMinor,
              writeOffMinor,
            },
          },
          { session },
        );
      }

      return {
        amountMinor,
        applied: ledgerResult.applied,
        balance: ledgerResult.balance,
        balanceExhausted: balanceMinor <= 0 || writeOffMinor > 0,
        clamped: writeOffMinor > 0,
        debitMinor,
        enabled: true,
        fullCostMinor: amountMinor,
        ledger: ledgerResult.ledger,
        phase: billingPhase,
        rawCostMicros: usageSummary.rawCostMicros,
        settled: true,
        writeOffMinor,
      };
    });
  } catch (error) {
    // Clamp mode must not surface insufficient-balance (never-negative is a floor).
    // Retain mapping only as defence-in-depth if a non-clamp path throws it.
    if (isInsufficientBalanceError(error)) {
      throw new CreditServiceError(
        "Insufficient balance while settling completed AI work.",
        "INSUFFICIENT_BALANCE",
        { amountMinor, phase: billingPhase },
      );
    }

    if (isLedgerReplayDivergenceError(error)) {
      throw new CreditServiceError(
        "Accounting conflict while replaying a phase debit.",
        "ACCOUNTING_CONFLICT",
        { amountMinor, phase: billingPhase },
      );
    }

    if (error instanceof LedgerError) {
      throw new CreditServiceError(error.message, error.code, {
        amountMinor,
        phase: billingPhase,
      });
    }

    throw error;
  }
}

export async function recordUsageOnly({ phase, usageRecords }) {
  if (!isCreditsEnabled()) {
    return {
      enabled: false,
      phase,
      recorded: false,
    };
  }

  const billingPhase = normalizeBillingPhase(phase);
  const usageSummary = summarizeUsageRecords(usageRecords);

  if (usageSummary.callIds.length > 0) {
    await connectToDatabase();
    await UsageRecord.updateMany(
      { callId: { $in: usageSummary.callIds } },
      {
        $set: {
          attemptFinal: false,
          charged: false,
        },
      },
    );
  }

  return {
    enabled: true,
    phase: billingPhase,
    rawCostMicros: usageSummary.rawCostMicros,
    recorded: true,
  };
}

export function isCreditServiceError(error) {
  return error instanceof CreditServiceError;
}
