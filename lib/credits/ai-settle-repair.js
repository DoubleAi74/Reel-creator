import mongoose from "mongoose";

import { roundMicrosToPenceHalfUp } from "../ai/openai-pricing.js";
import { ensureSharedBalance, initializeDatabaseIndexes } from "../db/bootstrap.js";
import {
  assertTransactionsSupported,
  connectToDatabase,
} from "../db/mongoose.js";
import {
  applyLedgeredBalanceChange,
  isLedgerReplayDivergenceError,
} from "../ledger/balance-ledger.js";
import { Balance } from "../models/Balance.js";
import { CreditLedger } from "../models/CreditLedger.js";
import { Generation } from "../models/Generation.js";
import { UsageRecord } from "../models/UsageRecord.js";
import { BILLING_PHASES, normalizeBillingPhase } from "./billing-phases.js";
import { settlePhase } from "./credit-service.js";

/**
 * REP-202 — Remediation for transient-error unresolved AI accounting.
 *
 * After REP-201, insufficient balance clamps (no unresolved). Residual
 * unresolved / uncharged-finalized usage comes from settlement/DB errors.
 * This module is dry-run by default; --apply reuses settlePhase idempotency
 * keys (`ai_debit:{jobId}:{phase}`). Fully written-off clamp rows
 * (charged:true + writeOffMinor) are not candidates.
 */

function usagePhaseKey(jobId, phase) {
  return `${jobId}:${phase}`;
}

function summarizePhaseUsage(records) {
  const rawCostMicros = records.reduce(
    (sum, record) =>
      sum + (Number.isSafeInteger(record.rawCostMicros) ? record.rawCostMicros : 0),
    0,
  );

  return {
    callIds: records.map((record) => record.callId),
    fullCostMinor: roundMicrosToPenceHalfUp(rawCostMicros),
    models: [...new Set(records.map((record) => record.model).filter(Boolean))],
    pipelineRunId: records.find((record) => record.pipelineRunId)?.pipelineRunId ?? null,
    rawCostMicros,
    recordCount: records.length,
  };
}

export async function scanUnresolvedAiSettlementCandidates({
  jobId = null,
  limit = 500,
  phase = null,
} = {}) {
  await connectToDatabase();
  await initializeDatabaseIndexes();

  const usageFilter = {
    attemptFinal: true,
    charged: false,
    rawCostMicros: { $gt: 0 },
  };

  if (jobId) {
    usageFilter.jobId = jobId;
  }

  if (phase) {
    usageFilter.phase = normalizeBillingPhase(phase);
  }

  const usageRecords = await UsageRecord.find(usageFilter)
    .sort({ createdAt: 1, _id: 1 })
    .limit(Math.max(1, limit) * 20)
    .lean();

  const grouped = new Map();

  for (const record of usageRecords) {
    const key = usagePhaseKey(record.jobId, record.phase);
    const existing = grouped.get(key);

    if (existing) {
      existing.usageRecords.push(record);
    } else {
      grouped.set(key, {
        jobId: record.jobId,
        phase: record.phase,
        usageRecords: [record],
      });
    }
  }

  const candidates = [];

  for (const group of grouped.values()) {
    const summary = summarizePhaseUsage(group.usageRecords);
    const idempotencyKey = `ai_debit:${group.jobId}:${group.phase}`;
    const existingLedger = await CreditLedger.findOne({ idempotencyKey }).lean();

    candidates.push({
      existingLedger: existingLedger
        ? {
            amountMinor: existingLedger.amountMinor,
            balanceAfterMinor: existingLedger.balanceAfterMinor,
            idempotencyKey: existingLedger.idempotencyKey,
            metadata: existingLedger.metadata ?? {},
          }
        : null,
      fullCostMinor: summary.fullCostMinor,
      hasLedgerEntry: Boolean(existingLedger),
      idempotencyKey,
      jobId: group.jobId,
      kind: "usage_phase",
      phase: group.phase,
      pipelineRunId: summary.pipelineRunId,
      rawCostMicros: summary.rawCostMicros,
      recordCount: summary.recordCount,
      usageRecords: group.usageRecords,
    });

    if (candidates.length >= limit) {
      break;
    }
  }

  const generationFilter = { accountingStatus: "unresolved" };

  if (jobId) {
    generationFilter.jobIds = jobId;
  }

  const unresolvedGenerations = await Generation.find(generationFilter)
    .sort({ createdAt: 1, _id: 1 })
    .limit(limit)
    .select({
      _id: 1,
      accountingStatus: 1,
      finalJobId: 1,
      jobIds: 1,
      pipelineRunId: 1,
      title: 1,
    })
    .lean();

  return {
    candidates,
    summary: {
      candidateCount: candidates.length,
      unresolvedGenerationCount: unresolvedGenerations.length,
      unchargedFinalizedUsageCount: usageRecords.length,
    },
    unresolvedGenerations: unresolvedGenerations.map((generation) => ({
      generationId: String(generation._id),
      accountingStatus: generation.accountingStatus,
      finalJobId: generation.finalJobId,
      jobIds: generation.jobIds ?? [],
      pipelineRunId: generation.pipelineRunId,
      title: generation.title,
    })),
  };
}

async function withCreditsForced(callback) {
  const previous = process.env.CREDITS_ENABLED;
  process.env.CREDITS_ENABLED = "true";

  try {
    return await callback();
  } finally {
    if (previous == null) {
      delete process.env.CREDITS_ENABLED;
    } else {
      process.env.CREDITS_ENABLED = previous;
    }
  }
}

export async function reSettleCandidate(candidate, { apply = false } = {}) {
  if (!candidate?.jobId || !candidate?.phase) {
    throw new Error("reSettleCandidate requires jobId and phase.");
  }

  const usageRecords =
    Array.isArray(candidate.usageRecords) && candidate.usageRecords.length > 0
      ? candidate.usageRecords
      : await UsageRecord.find({
          attemptFinal: true,
          charged: false,
          jobId: candidate.jobId,
          phase: candidate.phase,
        }).lean();

  const pipelineRunId =
    candidate.pipelineRunId ??
    usageRecords.find((record) => record.pipelineRunId)?.pipelineRunId ??
    candidate.jobId;

  if (!apply) {
    return {
      applied: false,
      dryRun: true,
      jobId: candidate.jobId,
      phase: candidate.phase,
      pipelineRunId,
      recordCount: usageRecords.length,
    };
  }

  if (usageRecords.length === 0) {
    return {
      applied: false,
      dryRun: false,
      jobId: candidate.jobId,
      phase: candidate.phase,
      reason: "no_uncharged_usage",
      settled: false,
    };
  }

  const settlement = await withCreditsForced(() =>
    settlePhase({
      jobId: candidate.jobId,
      phase: candidate.phase,
      pipelineRunId,
      usageRecords,
    }),
  );

  // Clear durable generation unresolved flag when related usage is now charged.
  const stillUncharged = await UsageRecord.countDocuments({
    attemptFinal: true,
    charged: false,
    jobId: candidate.jobId,
    rawCostMicros: { $gt: 0 },
  });

  let generationsUpdated = 0;

  if (stillUncharged === 0) {
    const updateResult = await Generation.updateMany(
      {
        accountingStatus: "unresolved",
        $or: [
          { jobIds: candidate.jobId },
          { finalJobId: candidate.jobId },
          ...(pipelineRunId ? [{ pipelineRunId }] : []),
        ],
      },
      {
        $set: {
          accountingStatus: "settled",
        },
      },
    );
    generationsUpdated = updateResult.modifiedCount ?? 0;
  }

  return {
    applied: settlement?.applied === true || settlement?.settled === true,
    debitMinor: settlement?.debitMinor ?? 0,
    dryRun: false,
    generationsUpdated,
    jobId: candidate.jobId,
    phase: candidate.phase,
    pipelineRunId,
    settled: settlement?.settled === true,
    writeOffMinor: settlement?.writeOffMinor ?? 0,
  };
}

export async function applyManualAdjustment({
  amountMinor,
  apply = false,
  idempotencyKey = null,
  metadata = {},
  reason,
} = {}) {
  if (!Number.isInteger(amountMinor) || amountMinor === 0) {
    throw new Error("amountMinor must be a non-zero integer pence value.");
  }

  if (!reason || typeof reason !== "string" || !reason.trim()) {
    throw new Error("reason is required for MANUAL_ADJUSTMENT.");
  }

  const key =
    typeof idempotencyKey === "string" && idempotencyKey.trim()
      ? idempotencyKey.trim()
      : `manual_adj:ai_repair:${amountMinor}:${reason.trim().slice(0, 40)}`;

  if (!apply) {
    const balance = await Balance.findById("shared").lean();

    return {
      applied: false,
      dryRun: true,
      amountMinor,
      balanceMinor: balance?.amountMinor ?? null,
      idempotencyKey: key,
      reason: reason.trim(),
    };
  }

  await connectToDatabase();
  await initializeDatabaseIndexes();
  await assertTransactionsSupported();
  await ensureSharedBalance();

  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      result = await applyLedgeredBalanceChange({
        amountMinor,
        idempotencyKey: key,
        metadata: {
          ...metadata,
          repairTool: "ai-settle-repair",
        },
        reason: reason.trim(),
        session,
        type: "MANUAL_ADJUSTMENT",
      });
    });

    return {
      applied: result.applied,
      amountMinor,
      balanceMinor: result.balance?.amountMinor ?? null,
      dryRun: false,
      idempotencyKey: key,
      ledger: result.ledger
        ? {
            amountMinor: result.ledger.amountMinor,
            balanceAfterMinor: result.ledger.balanceAfterMinor,
            idempotencyKey: result.ledger.idempotencyKey,
          }
        : null,
      reason: reason.trim(),
    };
  } catch (error) {
    if (isLedgerReplayDivergenceError(error)) {
      throw new Error(
        `MANUAL_ADJUSTMENT replay divergence for key ${key}: ${error.message}`,
      );
    }

    throw error;
  } finally {
    await session.endSession();
  }
}

export async function runAiSettleRepair({
  apply = false,
  jobId = null,
  limit = 500,
  manualAdjustment = null,
  phase = null,
} = {}) {
  await connectToDatabase();
  await initializeDatabaseIndexes();
  await assertTransactionsSupported();
  await ensureSharedBalance();

  const balanceBefore = await Balance.findById("shared").lean();
  const scan = await scanUnresolvedAiSettlementCandidates({
    jobId,
    limit,
    phase,
  });

  const reSettleResults = [];

  for (const candidate of scan.candidates) {
    reSettleResults.push(await reSettleCandidate(candidate, { apply }));
  }

  let manualResult = null;

  if (manualAdjustment) {
    manualResult = await applyManualAdjustment({
      ...manualAdjustment,
      apply,
    });
  }

  const balanceAfter = await Balance.findById("shared").lean();

  return {
    apply,
    balanceAfterMinor: balanceAfter?.amountMinor ?? null,
    balanceBeforeMinor: balanceBefore?.amountMinor ?? null,
    candidates: scan.candidates.map((candidate) => ({
      fullCostMinor: candidate.fullCostMinor,
      hasLedgerEntry: candidate.hasLedgerEntry,
      idempotencyKey: candidate.idempotencyKey,
      jobId: candidate.jobId,
      phase: candidate.phase,
      pipelineRunId: candidate.pipelineRunId,
      rawCostMicros: candidate.rawCostMicros,
      recordCount: candidate.recordCount,
    })),
    manualAdjustment: manualResult,
    reSettleResults,
    summary: {
      ...scan.summary,
      appliedCount: reSettleResults.filter((result) => result.applied).length,
      dryRun: !apply,
    },
    unresolvedGenerations: scan.unresolvedGenerations,
  };
}

export { BILLING_PHASES };
