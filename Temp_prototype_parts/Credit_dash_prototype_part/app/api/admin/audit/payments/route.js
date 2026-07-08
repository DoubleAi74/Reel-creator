import { NextResponse } from "next/server";

import { getPaymentAuditSummary } from "../../../../../lib/admin/payment-audit.mjs";
import { connectToDatabase } from "../../../../../lib/db/mongoose.mjs";

export async function GET() {
  await connectToDatabase();

  return NextResponse.json(await getPaymentAuditSummary());
}
