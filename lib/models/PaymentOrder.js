import mongoose from "mongoose";

export const PAYMENT_ORDER_STATUSES = [
  "PAYMENT_PENDING",
  "PAID",
  "PAYMENT_FAILED",
  "PAYMENT_EXPIRED",
  "CANCELLED",
];

const paymentOrderSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: PAYMENT_ORDER_STATUSES,
      default: "PAYMENT_PENDING",
      required: true,
    },
    amountMinor: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "Payment amountMinor must be integer pence.",
      },
    },
    currency: {
      type: String,
      enum: ["GBP"],
      default: "GBP",
      required: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    publicReference: {
      type: String,
      required: true,
      trim: true,
    },
    sumupCheckoutReference: {
      type: String,
      required: true,
      trim: true,
    },
    sumupCheckoutId: {
      type: String,
      trim: true,
    },
    sumupHostedCheckoutUrl: {
      type: String,
      trim: true,
    },
    sumupCheckoutStatus: {
      type: String,
      trim: true,
    },
    sumupTransactionId: {
      type: String,
      trim: true,
    },
    balanceCredited: {
      type: Boolean,
      default: false,
      required: true,
    },
    paidAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

paymentOrderSchema.index({ sumupCheckoutReference: 1 }, { unique: true });
paymentOrderSchema.index({ publicReference: 1 }, { unique: true });
paymentOrderSchema.index(
  { sumupCheckoutId: 1 },
  {
    partialFilterExpression: {
      sumupCheckoutId: { $type: "string" },
    },
    unique: true,
  },
);
paymentOrderSchema.index(
  { sumupTransactionId: 1 },
  {
    partialFilterExpression: {
      sumupTransactionId: { $type: "string" },
    },
    unique: true,
  },
);
paymentOrderSchema.index({ status: 1, createdAt: -1 });

export const PaymentOrder =
  mongoose.models.PaymentOrder ??
  mongoose.model("PaymentOrder", paymentOrderSchema, "payment_orders");
