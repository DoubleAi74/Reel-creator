import mongoose from "mongoose";

import { PaymentOrder } from "../models/PaymentOrder.mjs";

export const TOP_UP_DESCRIPTION = "Credit dashboard top-up";

function makeOrderReference(orderId) {
  return `order_${orderId.toString()}`;
}

function parseOptionalDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

export async function createPendingPaymentOrder({ amountMinor, currency = "GBP" }) {
  const _id = new mongoose.Types.ObjectId();
  const publicReference = makeOrderReference(_id);

  return PaymentOrder.create({
    _id,
    amountMinor,
    currency,
    description: TOP_UP_DESCRIPTION,
    publicReference,
    sumupCheckoutReference: publicReference,
  });
}

export async function findReusablePendingPaymentOrder({
  amountMinor,
  currency = "GBP",
  now = new Date(),
}) {
  const reuseWindowStart = new Date(now.getTime() - 10 * 60 * 1000);

  return PaymentOrder.findOne({
    amountMinor,
    currency,
    createdAt: { $gte: reuseWindowStart },
    status: "PAYMENT_PENDING",
    sumupCheckoutId: { $type: "string" },
    sumupHostedCheckoutUrl: { $type: "string" },
    $or: [
      {
        expiresAt: null,
      },
      {
        expiresAt: { $gt: now },
      },
    ],
  })
    .sort({ createdAt: -1 })
    .lean();
}

export async function attachHostedCheckoutToOrder({ order, checkout }) {
  const updatedOrder = await PaymentOrder.findByIdAndUpdate(
    order._id,
    {
      $set: {
        expiresAt: parseOptionalDate(checkout.valid_until),
        sumupCheckoutId: checkout.id,
        sumupCheckoutStatus: checkout.status,
        sumupHostedCheckoutUrl: checkout.hosted_checkout_url,
      },
    },
    {
      returnDocument: "after",
    },
  ).lean();

  if (!updatedOrder) {
    throw new Error("Payment order disappeared before checkout persistence.");
  }

  return updatedOrder;
}
