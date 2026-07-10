import mongoose from "mongoose";

export const CARD_R2_STATUSES = [
  "not_required",
  "pending_create",
  "created",
  "create_failed",
  "pending_delete",
  "delete_failed",
  "deleted",
  "skipped",
];

const cardSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    number: {
      type: Number,
      required: true,
      min: 0,
    },
    colour: {
      type: String,
      required: true,
      trim: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
    },
    r2ObjectKey: {
      type: String,
      default: null,
      trim: true,
    },
    r2Status: {
      type: String,
      enum: CARD_R2_STATUSES,
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

cardSchema.index({ createdAt: -1 });
cardSchema.index({ deletedAt: 1, createdAt: -1 });
cardSchema.index({ r2Status: 1, r2LastAttemptAt: 1 });
cardSchema.index(
  { r2ObjectKey: 1 },
  {
    unique: true,
    partialFilterExpression: { r2ObjectKey: { $type: "string" } },
  },
);

export const Card =
  mongoose.models.Card ?? mongoose.model("Card", cardSchema, "dashboard_cards");
