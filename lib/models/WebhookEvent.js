import mongoose from "mongoose";

export const WEBHOOK_EVENT_STATUSES = [
  "IGNORED",
  "MATCHED",
  "VERIFIED_PAID",
  "ERROR",
];

const webhookEventSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: ["sumup"],
      default: "sumup",
      required: true,
    },
    checkoutId: {
      type: String,
      default: null,
      trim: true,
    },
    checkoutReference: {
      type: String,
      default: null,
      trim: true,
    },
    paymentOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "PaymentOrder",
    },
    eventType: {
      type: String,
      default: null,
      trim: true,
    },
    processingStatus: {
      type: String,
      enum: WEBHOOK_EVENT_STATUSES,
      default: "IGNORED",
      required: true,
    },
    safeErrorCode: {
      type: String,
      default: null,
      trim: true,
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

webhookEventSchema.index({ createdAt: -1 });
webhookEventSchema.index({ processingStatus: 1, createdAt: -1 });
webhookEventSchema.index({ checkoutId: 1 });
webhookEventSchema.index({ checkoutReference: 1 });
webhookEventSchema.index({ paymentOrderId: 1 });

export const WebhookEvent =
  mongoose.models.WebhookEvent ??
  mongoose.model("WebhookEvent", webhookEventSchema, "webhook_events");
