import { NextResponse } from "next/server";

import { connectToDatabase } from "../../../../../../lib/db/mongoose.mjs";
import { PaymentOrder } from "../../../../../../lib/models/PaymentOrder.mjs";
import {
  refreshPaymentOrderFromSumUp,
  serializePaymentOrder,
} from "../../../../../../lib/payments/payment-verification.mjs";
import { SumUpApiError } from "../../../../../../lib/payments/sumup-client.mjs";

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

export async function GET(_request, context) {
  const { orderId } = await context.params;

  try {
    await connectToDatabase();

    const order = await PaymentOrder.findOne({
      publicReference: orderId,
    }).lean();

    if (!order) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }

    const result = await refreshPaymentOrderFromSumUp(order);

    return NextResponse.json({
      credited: result.credited,
      order: serializePaymentOrder(result.order),
      verificationOk: result.verification.ok,
    });
  } catch (error) {
    console.error(
      "GET /api/payments/sumup/orders/[orderId] error:",
      safeOrderErrorDetails(error),
    );

    return NextResponse.json(
      { error: "Unable to confirm payment." },
      { status: 500 },
    );
  }
}
