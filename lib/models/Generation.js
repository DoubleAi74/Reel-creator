import mongoose from "mongoose";

export const GENERATION_SOURCE_TYPES = ["upload", "youtube", "unknown"];
export const GENERATION_ACCOUNTING_STATUSES = ["none", "settled", "unresolved"];
export const GENERATION_R2_STATUSES = [
  "not_required",
  "pending_create",
  "created",
  "create_failed",
  "pending_delete",
  "delete_failed",
  "deleted",
  "skipped",
];

const nullableNonNegativeIntegerValidator = {
  validator(value) {
    return value == null || (Number.isInteger(value) && value >= 0);
  },
  message: "Generation money fields must be non-negative integer pence.",
};

const nullableNonNegativeNumberValidator = {
  validator(value) {
    return value == null || (Number.isFinite(value) && value >= 0);
  },
  message: "Generation duration must be a non-negative finite number.",
};

const generationSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
    },
    pipelineRunId: {
      type: String,
      required: true,
      trim: true,
    },
    jobIds: {
      type: [String],
      default: [],
    },
    finalJobId: {
      type: String,
      required: true,
      trim: true,
    },
    sourceType: {
      type: String,
      enum: GENERATION_SOURCE_TYPES,
      default: "unknown",
      required: true,
    },
    audioDurationSeconds: {
      type: Number,
      default: null,
      validate: nullableNonNegativeNumberValidator,
    },
    snapshot: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    billing: {
      phaseCostsMinor: {
        transcribe: {
          type: Number,
          default: null,
          validate: nullableNonNegativeIntegerValidator,
        },
        enrich: {
          type: Number,
          default: null,
          validate: nullableNonNegativeIntegerValidator,
        },
        time: {
          type: Number,
          default: null,
          validate: nullableNonNegativeIntegerValidator,
        },
      },
      totalCostMinor: {
        type: Number,
        default: 0,
        min: 0,
        validate: nullableNonNegativeIntegerValidator,
      },
      priceTableVersion: {
        type: String,
        default: null,
        trim: true,
      },
      ledgerKeys: {
        type: [String],
        default: [],
      },
    },
    accountingStatus: {
      type: String,
      enum: GENERATION_ACCOUNTING_STATUSES,
      default: "none",
      required: true,
    },
    saved: {
      type: Boolean,
      default: true,
      required: true,
    },
    public: {
      type: Boolean,
      default: true,
      required: true,
    },
    ownerScope: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    r2ObjectKey: {
      type: String,
      default: null,
      trim: true,
    },
    r2Status: {
      type: String,
      enum: GENERATION_R2_STATUSES,
      default: "not_required",
      required: true,
    },
    r2ErrorCode: {
      type: String,
      default: null,
      trim: true,
    },
    r2CreatedAt: {
      type: Date,
      default: null,
    },
    r2DeletedAt: {
      type: Date,
      default: null,
    },
    r2LastAttemptAt: {
      type: Date,
      default: null,
    },
    r2AttemptCount: {
      type: Number,
      default: 0,
      min: 0,
      validate: nullableNonNegativeIntegerValidator,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deleteRequestedAt: {
      type: Date,
      default: null,
    },
  },
  {
    versionKey: false,
  },
);

generationSchema.pre("validate", function syncPublicFlag() {
  if (this.isNew || this.isModified("saved")) {
    this.public = this.saved;
  }
});

generationSchema.index({ createdAt: -1 });
generationSchema.index({ deletedAt: 1, createdAt: -1 });
generationSchema.index({ pipelineRunId: 1 });
generationSchema.index({ finalJobId: 1 });
generationSchema.index(
  { r2ObjectKey: 1 },
  {
    partialFilterExpression: {
      r2ObjectKey: { $type: "string" },
    },
    unique: true,
  },
);

export const Generation =
  mongoose.models.Generation ??
  mongoose.model("Generation", generationSchema, "generations");
