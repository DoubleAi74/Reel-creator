import { NextResponse } from "next/server";

import { connectToDatabase } from "../../../../../../lib/db/mongoose.mjs";
import { PaymentOrder } from "../../../../../../lib/models/PaymentOrder.mjs";
import { serializeAdminOrder } from "../../../../../../lib/admin/serialize-admin-order.mjs";
import { refreshPaymentOrderFromSumUp } from "../../../../../../lib/payments/payment-verification.mjs";
import { SumUpApiError } from "../../../../../../lib/payments/sumup-client.mjs";

function safeError(error) {
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

export async function POST(_request, context) {
  const { orderId } = await context.params;

  try {
    await connectToDatabase();

    const order = await PaymentOrder.findOne({ publicReference: orderId }).lean();

    if (!order) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }

    const result = await refreshPaymentOrderFromSumUp(order);

    return NextResponse.json({
      credited: result.credited,
      order: serializeAdminOrder(result.order),
      verificationOk: result.verification.ok,
    });
  } catch (error) {
    console.error("POST /api/admin/orders/[orderId]/refresh error:", safeError(error));

    return NextResponse.json(
      { error: "Unable to refresh payment order." },
      { status: 500 },
    );
  }
}
