import mongoose from "mongoose";

export const CREDIT_LEDGER_TYPES = [
  "TOP_UP",
  "CARD_CREATE",
  "REFUND_ADJUSTMENT",
  "MANUAL_ADJUSTMENT",
];

const integerPenceValidator = {
  validator: Number.isInteger,
  message: "Ledger money fields must be integer pence.",
};

const creditLedgerSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: CREDIT_LEDGER_TYPES,
      required: true,
    },
    amountMinor: {
      type: Number,
      required: true,
      validate: [
        integerPenceValidator,
        {
          validator(value) {
            return value !== 0;
          },
          message: "Ledger amountMinor cannot be zero.",
        },
      ],
    },
    balanceAfterMinor: {
      type: Number,
      required: true,
      min: 0,
      validate: integerPenceValidator,
    },
    currency: {
      type: String,
      enum: ["GBP"],
      default: "GBP",
      required: true,
    },
    paymentOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "PaymentOrder",
    },
    cardId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "Card",
    },
    idempotencyKey: {
      type: String,
      required: true,
      trim: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
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

creditLedgerSchema.index({ idempotencyKey: 1 }, { unique: true });
creditLedgerSchema.index({ createdAt: -1 });
creditLedgerSchema.index({ type: 1, createdAt: -1 });
creditLedgerSchema.index({ paymentOrderId: 1 });
creditLedgerSchema.index({ cardId: 1 });

export const CreditLedger =
  mongoose.models.CreditLedger ??
  mongoose.model("CreditLedger", creditLedgerSchema, "credit_ledger");
