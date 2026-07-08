import mongoose from "mongoose";
import { NextResponse } from "next/server";

import { connectToDatabase } from "../../../../../../lib/db/mongoose.mjs";
import {
  applyLedgeredBalanceChange,
  isInsufficientBalanceError,
} from "../../../../../../lib/ledger/balance-ledger.mjs";
import { PaymentOrder } from "../../../../../../lib/models/PaymentOrder.mjs";
import { RefundRecord } from "../../../../../../lib/models/RefundRecord.mjs";
import { minorToMajorUnit } from "../../../../../../lib/money";
import { refundTransaction } from "../../../../../../lib/payments/sumup-refunds.mjs";
import { SumUpApiError } from "../../../../../../lib/payments/sumup-client.mjs";

async function getSucceededRefundTotal(paymentOrderId) {
  const [result] = await RefundRecord.aggregate([
    {
      $match: {
        paymentOrderId,
        status: "SUCCEEDED",
      },
    },
    {
      $group: {
        _id: "$paymentOrderId",
        amountMinor: { $sum: "$amountMinor" },
      },
    },
  ]);

  return result?.amountMinor ?? 0;
}

function parseRefundAmount(body, remainingMinor) {
  if (body?.amountMinor === undefined || body?.amountMinor === null) {
    return remainingMinor;
  }

  if (!Number.isInteger(body.amountMinor)) {
    return null;
  }

  return body.amountMinor;
}

function safeRefundErrorCode(error) {
  if (isInsufficientBalanceError(error)) {
    return "INSUFFICIENT_BALANCE_FOR_REFUND_ADJUSTMENT";
  }

  if (error instanceof SumUpApiError) {
    return `SUMUP_HTTP_${error.status}`;
  }

  return error?.name ?? "UNKNOWN_ERROR";
}

export async function POST(request, context) {
  const { orderId } = await context.params;
  let body = {};

  try {
    body = await request.json();
  } catch {
    body = {};
  }

  try {
    await connectToDatabase();

    const order = await PaymentOrder.findOne({ publicReference: orderId }).lean();

    if (!order) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }

    if (order.status !== "PAID" || !order.balanceCredited) {
      return NextResponse.json(
        { error: "Only credited PAID orders can be refunded here." },
        { status: 409 },
      );
    }

    if (!order.sumupTransactionId) {
      return NextResponse.json(
        { error: "Order has no SumUp transaction id." },
        { status: 409 },
      );
    }

    const alreadyRefundedMinor = await getSucceededRefundTotal(order._id);
    const remainingMinor = order.amountMinor - alreadyRefundedMinor;
    const amountMinor = parseRefundAmount(body, remainingMinor);

    if (!Number.isInteger(amountMinor) || amountMinor < 1 || amountMinor > remainingMinor) {
      return NextResponse.json(
        { error: "Refund amount is out of range." },
        { status: 400 },
      );
    }

    const idempotencyKey = `refund:${order._id.toString()}:${alreadyRefundedMinor}:${amountMinor}`;
    let refundRecord = await RefundRecord.findOne({ idempotencyKey }).lean();

    if (refundRecord) {
      return NextResponse.json({
        refund: {
          amountMinor: refundRecord.amountMinor,
          requiresManualReview: refundRecord.requiresManualReview,
          safeErrorCode: refundRecord.safeErrorCode,
          status: refundRecord.status,
        },
      });
    }

    refundRecord = await RefundRecord.create({
      amountMinor,
      currency: order.currency,
      idempotencyKey,
      paymentOrderId: order._id,
      status: "REQUESTED",
      sumupTransactionId: order.sumupTransactionId,
    });

    try {
      await refundTransaction({
        amountMajor: minorToMajorUnit(amountMinor),
        transactionId: order.sumupTransactionId,
      });
    } catch (error) {
      refundRecord = await RefundRecord.findByIdAndUpdate(
        refundRecord._id,
        {
          $set: {
            safeErrorCode: safeRefundErrorCode(error),
            status: "FAILED",
          },
        },
        { returnDocument: "after" },
      ).lean();

      return NextResponse.json(
        {
          error: "SumUp refund failed.",
          refund: {
            amountMinor: refundRecord.amountMinor,
            requiresManualReview: refundRecord.requiresManualReview,
            safeErrorCode: refundRecord.safeErrorCode,
            status: refundRecord.status,
          },
        },
        { status: 502 },
      );
    }

    const session = await mongoose.startSession();
    let adjustmentErrorCode = null;

    try {
      await session.withTransaction(async () => {
        await applyLedgeredBalanceChange({
          amountMinor: -amountMinor,
          currency: order.currency,
          idempotencyKey: `refund_adjustment:${refundRecord._id.toString()}`,
          metadata: {
            originalOrderReference: order.publicReference,
          },
          paymentOrderId: order._id,
          reason: "SumUp refund credit adjustment",
          session,
          type: "REFUND_ADJUSTMENT",
        });
      });
    } catch (error) {
      adjustmentErrorCode = safeRefundErrorCode(error);
    } finally {
      await session.endSession();
    }

    refundRecord = await RefundRecord.findByIdAndUpdate(
      refundRecord._id,
      {
        $set: {
          requiresManualReview: Boolean(adjustmentErrorCode),
          safeErrorCode: adjustmentErrorCode,
          status: "SUCCEEDED",
        },
      },
      { returnDocument: "after" },
    ).lean();

    return NextResponse.json({
      refund: {
        amountMinor: refundRecord.amountMinor,
        requiresManualReview: refundRecord.requiresManualReview,
        safeErrorCode: refundRecord.safeErrorCode,
        status: refundRecord.status,
      },
    });
  } catch (error) {
    console.error("POST /api/admin/orders/[orderId]/refund error:", {
      kind: safeRefundErrorCode(error),
    });

    return NextResponse.json(
      { error: "Unable to refund payment order." },
      { status: 500 },
    );
  }
}
