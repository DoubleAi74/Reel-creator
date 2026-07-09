import { computeCallCostMicros, getPriceTableVersion } from "./openai-pricing.js";
import { connectToDatabase } from "../db/mongoose.js";
import { UsageRecord } from "../models/UsageRecord.js";
import { normalizeBillingPhase } from "../credits/billing-phases.js";

export const OPENAI_ENDPOINT_KINDS = ["responses", "audio"];
export const OPENAI_USAGE_TYPES = ["tokens", "duration", "none"];

function normalizeNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizePositiveNumber(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function extractTokenUsage(usage) {
  const inputTokens = normalizeNonNegativeInteger(
    usage?.input_tokens ??
      usage?.prompt_tokens ??
      usage?.input_token_details?.total_tokens ??
      null,
  );
  const outputTokens = normalizeNonNegativeInteger(
    usage?.output_tokens ?? usage?.completion_tokens ?? null,
  );
  const totalTokens = normalizeNonNegativeInteger(
    usage?.total_tokens ??
      (inputTokens != null || outputTokens != null
        ? (inputTokens ?? 0) + (outputTokens ?? 0)
        : null),
  );

  if (inputTokens == null && outputTokens == null && totalTokens == null) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    usageType: "tokens",
  };
}

export function extractOpenAiUsage({
  data,
  endpointKind,
  fallbackAudioSeconds = null,
}) {
  const usage = data?.usage;

  if (endpointKind === "responses") {
    return (
      extractTokenUsage(usage) ?? {
        audioSeconds: null,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        usageType: "none",
      }
    );
  }

  if (endpointKind !== "audio") {
    throw new Error(`Unsupported OpenAI endpoint kind: ${endpointKind}`);
  }

  const tokenUsage = extractTokenUsage(usage);

  if (tokenUsage) {
    return {
      ...tokenUsage,
      audioSeconds: normalizePositiveNumber(fallbackAudioSeconds ?? data?.duration),
    };
  }

  const usageSeconds = normalizePositiveNumber(
    usage?.seconds ?? usage?.duration_seconds ?? usage?.duration,
  );
  const audioSeconds = normalizePositiveNumber(
    usageSeconds ?? fallbackAudioSeconds ?? data?.duration,
  );

  if (usage?.type === "duration" || usageSeconds != null) {
    return {
      audioSeconds,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      usageType: "duration",
    };
  }

  return {
    audioSeconds,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    usageType: "none",
  };
}

function serializeUsageRecord(record) {
  if (!record) {
    return null;
  }

  if (typeof record.toObject === "function") {
    return record.toObject();
  }

  return record;
}

function normalizeRecordInput({ jobId, pipelineRunId }, input) {
  const phase = normalizeBillingPhase(input.phase);
  const billingUnit = normalizeBillingPhase(input.billingUnit ?? phase);

  if (!input.callId || typeof input.callId !== "string") {
    throw new Error("Usage callId is required.");
  }

  if (!input.model || typeof input.model !== "string") {
    throw new Error("Usage model is required.");
  }

  if (!OPENAI_ENDPOINT_KINDS.includes(input.endpointKind)) {
    throw new Error("Unsupported OpenAI endpoint kind.");
  }

  if (!OPENAI_USAGE_TYPES.includes(input.usageType)) {
    throw new Error("Unsupported OpenAI usage type.");
  }

  if (!Number.isSafeInteger(input.rawCostMicros) || input.rawCostMicros < 0) {
    throw new Error("Usage rawCostMicros must be a non-negative integer.");
  }

  return {
    audioSeconds: normalizePositiveNumber(input.audioSeconds),
    billingUnit,
    callId: input.callId,
    endpointKind: input.endpointKind,
    inputTokens: normalizeNonNegativeInteger(input.inputTokens),
    jobId,
    model: input.model.trim(),
    outputTokens: normalizeNonNegativeInteger(input.outputTokens),
    phase,
    pipelineRunId,
    priceTableVersion: input.priceTableVersion || getPriceTableVersion(),
    rawCostMicros: input.rawCostMicros,
    totalTokens: normalizeNonNegativeInteger(input.totalTokens),
    usageType: input.usageType,
  };
}

export function createUsageCollector({ jobId, pipelineRunId }) {
  if (!jobId || typeof jobId !== "string") {
    throw new Error("Usage collector jobId is required.");
  }

  if (!pipelineRunId || typeof pipelineRunId !== "string") {
    throw new Error("Usage collector pipelineRunId is required.");
  }

  const callsById = new Map();
  const completedPhases = new Set();
  const countersByPhase = new Map();
  const context = { jobId, pipelineRunId };

  return {
    context,
    finalizedUsageForPhase(phase) {
      const normalizedPhase = normalizeBillingPhase(phase);

      return [...callsById.values()].filter(
        (record) => record.phase === normalizedPhase && record.attemptFinal === true,
      );
    },
    async markPhaseComplete(phase) {
      const normalizedPhase = normalizeBillingPhase(phase);
      completedPhases.add(normalizedPhase);

      for (const [callId, record] of callsById) {
        if (record.phase === normalizedPhase) {
          callsById.set(callId, {
            ...record,
            attemptFinal: true,
          });
        }
      }

      await connectToDatabase();
      await UsageRecord.updateMany(
        {
          jobId,
          phase: normalizedPhase,
          pipelineRunId,
        },
        {
          $set: {
            attemptFinal: true,
          },
        },
      );

      return this.finalizedUsageForPhase(normalizedPhase);
    },
    nextCallId(phase) {
      const normalizedPhase = normalizeBillingPhase(phase);
      const nextCount = (countersByPhase.get(normalizedPhase) ?? 0) + 1;
      countersByPhase.set(normalizedPhase, nextCount);

      return `${jobId}:${normalizedPhase}:${nextCount}`;
    },
    phaseTotalsMicros() {
      return [...callsById.values()].reduce((totals, record) => {
        totals[record.phase] = (totals[record.phase] ?? 0) + record.rawCostMicros;
        return totals;
      }, {});
    },
    async record(input) {
      const normalizedRecord = normalizeRecordInput(context, input);
      const attemptFinal =
        input.attemptFinal === true || completedPhases.has(normalizedRecord.phase);

      await connectToDatabase();
      const persistedRecord = await UsageRecord.findOneAndUpdate(
        { callId: normalizedRecord.callId },
        {
          $set: {
            ...normalizedRecord,
            attemptFinal,
          },
          $setOnInsert: {
            charged: false,
            createdAt: new Date(),
          },
        },
        {
          returnDocument: "after",
          upsert: true,
        },
      ).lean();
      callsById.set(normalizedRecord.callId, serializeUsageRecord(persistedRecord));

      return serializeUsageRecord(persistedRecord);
    },
    serialize() {
      return {
        calls: [...callsById.values()],
        completedPhases: [...completedPhases],
        jobId,
        phaseTotalsMicros: this.phaseTotalsMicros(),
        pipelineRunId,
      };
    },
  };
}

export async function recordOpenAiCallUsage({
  collector,
  data,
  endpointKind,
  fallbackAudioSeconds = null,
  model,
  phase,
  // REP-203: only record usage for successful HTTP responses (no phantom cost).
  responseOk = true,
}) {
  if (!collector || responseOk === false) {
    return null;
  }

  const normalizedPhase = normalizeBillingPhase(phase);
  const usage = extractOpenAiUsage({
    data,
    endpointKind,
    fallbackAudioSeconds,
  });
  const rawCostMicros = computeCallCostMicros({
    audioSeconds: usage.audioSeconds,
    inputTokens: usage.inputTokens,
    model,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    usageType: usage.usageType,
  });
  const callId =
    typeof collector.nextCallId === "function"
      ? collector.nextCallId(normalizedPhase)
      : `${collector.context?.jobId ?? "job"}:${normalizedPhase}:${Date.now()}`;

  return collector.record({
    ...usage,
    billingUnit: normalizedPhase,
    callId,
    endpointKind,
    model,
    phase: normalizedPhase,
    priceTableVersion: getPriceTableVersion(),
    rawCostMicros,
  });
}
