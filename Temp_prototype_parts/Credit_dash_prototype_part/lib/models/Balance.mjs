import mongoose from "mongoose";

const balanceSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: "shared",
      immutable: true,
    },
    amountMinor: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "Balance amountMinor must be integer pence.",
      },
    },
    currency: {
      type: String,
      enum: ["GBP"],
      default: "GBP",
      required: true,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  {
    versionKey: false,
  },
);

balanceSchema.pre("save", function updateTimestamp(next) {
  this.updatedAt = new Date();
  next();
});

export const Balance =
  mongoose.models.Balance ??
  mongoose.model("Balance", balanceSchema, "dashboard_balances");
