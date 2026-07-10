import mongoose from "mongoose";
import { NextResponse } from "next/server";

import { connectToDatabase } from "../../../../../lib/db/mongoose.mjs";
import { Card } from "../../../../../lib/models/Card.mjs";
import { deleteCardPlaceholderObject } from "../../../../../lib/r2/card-r2-lifecycle.mjs";

const R2_STATUSES_WITHOUT_OBJECT = ["not_required", "skipped", "deleted"];

export async function DELETE(_request, context) {
  const { id } = await context.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Card not found." }, { status: 404 });
  }

  try {
    await connectToDatabase();
    const card = await Card.findById(id).lean();

    if (!card) {
      return NextResponse.json({ error: "Card not found." }, { status: 404 });
    }

    const now = new Date();
    const softDeleteFields = {
      deletedAt: card.deletedAt ?? now,
      deleteRequestedAt: card.deleteRequestedAt ?? now,
    };

    if (
      card.r2ObjectKey &&
      !R2_STATUSES_WITHOUT_OBJECT.includes(card.r2Status)
    ) {
      softDeleteFields.r2Status = "pending_delete";
    }

    await Card.updateOne({ _id: id }, { $set: softDeleteFields });

    const r2Result = await deleteCardPlaceholderObject({
      card: { ...card, ...softDeleteFields },
    });

    if (!r2Result.ok) {
      return new NextResponse(null, { status: 202 });
    }

    await Card.deleteOne({ _id: id });

    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json(
      { error: "Unable to remove card." },
      { status: 500 },
    );
  }
}
