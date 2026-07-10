import { NextResponse } from "next/server";

import { serializeBalance } from "../../../../lib/dashboard/serializeBalance.mjs";
import { connectToDatabase } from "../../../../lib/db/mongoose.mjs";
import { Balance } from "../../../../lib/models/Balance.mjs";
import { clampMinor } from "../../../../lib/money";

export async function POST(request) {
  if (process.env["ENABLE_TEST_CONTROLS"] !== "true") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!Number.isInteger(body.amountMinor)) {
    return NextResponse.json(
      { error: "amountMinor must be integer pence." },
      { status: 400 },
    );
  }

  const amountMinor = clampMinor(body.amountMinor, 0, 100000);

  try {
    await connectToDatabase();
    const balance = await Balance.findOneAndUpdate(
      { _id: "shared" },
      {
        $set: {
          amountMinor,
          currency: "GBP",
          updatedAt: new Date(),
        },
      },
      {
        returnDocument: "after",
        upsert: true,
      },
    ).lean();

    return NextResponse.json({ balance: serializeBalance(balance) });
  } catch {
    return NextResponse.json(
      { error: "Unable to set balance." },
      { status: 500 },
    );
  }
}
