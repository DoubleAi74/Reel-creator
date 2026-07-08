import { NextResponse } from "next/server";

import { createRandomCardData } from "../../../../lib/dashboard/randomCard.mjs";
import { serializeCard } from "../../../../lib/dashboard/serializeCard.mjs";
import { connectToDatabase } from "../../../../lib/db/mongoose.mjs";
import { Card } from "../../../../lib/models/Card.mjs";

export async function POST() {
  try {
    await connectToDatabase();
    const card = await Card.create(createRandomCardData());

    return NextResponse.json({ card: serializeCard(card) }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Unable to add card." },
      { status: 500 },
    );
  }
}
