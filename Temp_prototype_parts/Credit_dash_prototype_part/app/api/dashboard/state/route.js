import { NextResponse } from "next/server";

import { ensureSharedBalance } from "../../../../lib/db/bootstrap.mjs";
import { connectToDatabase } from "../../../../lib/db/mongoose.mjs";
import { serializeBalance } from "../../../../lib/dashboard/serializeBalance.mjs";
import { serializeCard } from "../../../../lib/dashboard/serializeCard.mjs";
import { Card } from "../../../../lib/models/Card.mjs";

export async function GET() {
  try {
    await connectToDatabase();
    const balance = await ensureSharedBalance();
    const cards = await Card.find({
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    })
      .sort({ createdAt: -1, _id: -1 })
      .lean();

    return NextResponse.json({
      balance: serializeBalance(balance),
      cards: cards.map(serializeCard),
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to load dashboard state." },
      { status: 500 },
    );
  }
}
