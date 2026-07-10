import mongoose from "mongoose";

export const USAGE_RECORD_PHASES = ["transcribe", "enrich", "time"];
export const USAGE_RECORD_BILLING_UNITS = ["transcribe", "enrich", "time"];
export const USAGE_RECORD_ENDPOINT_KINDS = ["responses", "audio"];
export const USAGE_RECORD_TYPES = ["tokens", "duration", "none"];

const nullableNonNegativeIntegerValidator = {
  validator(value) {
    return value == null || (Number.isInteger(value) && value >= 0);
  },
  message: "Usage fields must be non-negative integers.",
};

const nullableNonNegativeNumberValidator = {
  validator(value) {
    return value == null || (Number.isFinite(value) && value >= 0);
  },
  message: "Usage audioSeconds must be a non-negative finite number.",
};

const usageRecordSchema = new mongoose.Schema(
  {
    callId: {
      type: String,
      required: true,
      trim: true,
    },
    jobId: {
      type: String,
      required: true,
      trim: true,
    },
    pipelineRunId: {
      type: String,
      required: true,
      trim: true,
    },
    phase: {
      type: String,
      enum: USAGE_RECORD_PHASES,
      required: true,
    },
    billingUnit: {
      type: String,
      enum: USAGE_RECORD_BILLING_UNITS,
      required: true,
    },
    model: {
      type: String,
      required: true,
      trim: true,
    },
    endpointKind: {
      type: String,
      enum: USAGE_RECORD_ENDPOINT_KINDS,
      required: true,
    },
    usageType: {
      type: String,
      enum: USAGE_RECORD_TYPES,
      required: true,
    },
    inputTokens: {
      type: Number,
      default: null,
      validate: nullableNonNegativeIntegerValidator,
    },
    outputTokens: {
      type: Number,
      default: null,
      validate: nullableNonNegativeIntegerValidator,
    },
    totalTokens: {
      type: Number,
      default: null,
      validate: nullableNonNegativeIntegerValidator,
    },
    audioSeconds: {
      type: Number,
      default: null,
      validate: nullableNonNegativeNumberValidator,
    },
    rawCostMicros: {
      type: Number,
      required: true,
      min: 0,
      validate: nullableNonNegativeIntegerValidator,
    },
    priceTableVersion: {
      type: String,
      required: true,
      trim: true,
    },
    attemptFinal: {
      type: Boolean,
      default: false,
      required: true,
    },
    charged: {
      type: Boolean,
      default: false,
      required: true,
    },
    // Actual pence debited at settlement (may be less than fullCostMinor when clamped).
    chargedMinor: {
      type: Number,
      default: null,
      validate: nullableNonNegativeIntegerValidator,
    },
    // Full computed phase cost in pence (pre-clamp).
    fullCostMinor: {
      type: Number,
      default: null,
      validate: nullableNonNegativeIntegerValidator,
    },
    // Unrecovered remainder when settlement clamped to available balance (REP-201).
    writeOffMinor: {
      type: Number,
      default: null,
      validate: nullableNonNegativeIntegerValidator,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
    },
  },
  {
    versionKey: false,
  },
);

usageRecordSchema.index({ callId: 1 }, { unique: true });
usageRecordSchema.index({ jobId: 1, phase: 1 });
usageRecordSchema.index({ pipelineRunId: 1, phase: 1 });

export const UsageRecord =
  mongoose.models.UsageRecord ??
  mongoose.model("UsageRecord", usageRecordSchema, "usage_records");
