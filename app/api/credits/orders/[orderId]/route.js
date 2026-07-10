import { NextResponse } from "next/server";

import { isCreditsEnabled } from "../../../../../lib/credits/flags.js";
import {
  checkOrderRateLimit,
  getRequestIp,
} from "../../../../../lib/credits/rate-limit.js";
import { connectToDatabase } from "../../../../../lib/db/mongoose.js";
import { PaymentOrder } from "../../../../../lib/models/PaymentOrder.js";
import {
  refreshPaymentOrderFromSumUp,
  serializePaymentOrder,
} from "../../../../../lib/payments/payment-verification.js";
import { SumUpApiError } from "../../../../../lib/payments/sumup-client.js";

export const runtime = "nodejs";

const TERMINAL_ORDER_STATUSES = new Set([
  "PAID",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
]);

function safeOrderErrorDetails(error) {
  if (error instanceof SumUpApiError) {
    return {
      kind: "sumup_api",
      status: error.status,
    };
  }

  return {
    kind: error?.name ?? "unknown_error",
  };
}

export async function GET(request, context) {
  if (!isCreditsEnabled()) {
    return NextResponse.json({ enabled: false, error: "credits_disabled" }, { status: 404 });
  }

  const rateLimit = checkOrderRateLimit({
    ip: getRequestIp(request),
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfter: rateLimit.retryAfter },
      { status: 429 },
    );
  }

  const { orderId } = await context.params;

  try {
    await connectToDatabase();

    const order = await PaymentOrder.findOne({
      publicReference: orderId,
    }).lean();

    if (!order) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }

    // REP-405: skip SumUp re-query for terminal orders (return stored state).
    if (TERMINAL_ORDER_STATUSES.has(order.status) || order.balanceCredited === true) {
      return NextResponse.json({
        credited: order.balanceCredited === true,
        order: serializePaymentOrder(order),
        verificationOk: order.status === "PAID" || order.balanceCredited === true,
      });
    }

    const result = await refreshPaymentOrderFromSumUp(order);

    return NextResponse.json({
      credited: result.credited,
      order: serializePaymentOrder(result.order),
      verificationOk: result.verification.ok,
    });
  } catch (error) {
    console.error(
      "GET /api/credits/orders/[orderId] error:",
      safeOrderErrorDetails(error),
    );

    return NextResponse.json(
      { error: "Unable to confirm payment." },
      { status: 500 },
    );
  }
}
