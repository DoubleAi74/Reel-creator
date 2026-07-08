import mongoose from "mongoose";

export const REFUND_RECORD_STATUSES = ["REQUESTED", "SUCCEEDED", "FAILED"];

const refundRecordSchema = new mongoose.Schema(
  {
    paymentOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "PaymentOrder",
    },
    amountMinor: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "Refund amountMinor must be integer pence.",
      },
    },
    currency: {
      type: String,
      enum: ["GBP"],
      default: "GBP",
      required: true,
    },
    status: {
      type: String,
      enum: REFUND_RECORD_STATUSES,
      default: "REQUESTED",
      required: true,
    },
    sumupTransactionId: {
      type: String,
      required: true,
      trim: true,
    },
    idempotencyKey: {
      type: String,
      required: true,
      trim: true,
    },
    safeErrorCode: {
      type: String,
      default: null,
      trim: true,
    },
    requiresManualReview: {
      type: Boolean,
      default: false,
      required: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

refundRecordSchema.index({ idempotencyKey: 1 }, { unique: true });
refundRecordSchema.index({ paymentOrderId: 1, createdAt: -1 });

export const RefundRecord =
  mongoose.models.RefundRecord ??
  mongoose.model("RefundRecord", refundRecordSchema, "refund_records");
