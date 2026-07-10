import { NextResponse } from "next/server";

import { connectToDatabase } from "../../../../lib/db/mongoose.mjs";
import {
  PAYMENT_ORDER_STATUSES,
  PaymentOrder,
} from "../../../../lib/models/PaymentOrder.mjs";
import { serializeAdminOrder } from "../../../../lib/admin/serialize-admin-order.mjs";

function parseLimit(value) {
  const parsedValue = Number.parseInt(value ?? "50", 10);

  if (!Number.isInteger(parsedValue)) {
    return 50;
  }

  return Math.min(Math.max(parsedValue, 1), 100);
}

export async function GET(request) {
  await connectToDatabase();

  const url = new URL(request.url);
  const filter = {};
  const status = url.searchParams.get("status");
  const credited = url.searchParams.get("credited");

  if (PAYMENT_ORDER_STATUSES.includes(status)) {
    filter.status = status;
  }

  if (credited === "true") {
    filter.balanceCredited = true;
  }

  if (credited === "false") {
    filter.balanceCredited = false;
  }

  const orders = await PaymentOrder.find(filter)
    .sort({ createdAt: -1 })
    .limit(parseLimit(url.searchParams.get("limit")))
    .lean();

  return NextResponse.json({
    orders: orders.map(serializeAdminOrder),
  });
}
