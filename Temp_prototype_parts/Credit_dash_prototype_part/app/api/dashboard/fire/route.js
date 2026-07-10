import mongoose from "mongoose";
import { NextResponse } from "next/server";

import { createRandomCardData } from "../../../../lib/dashboard/randomCard.mjs";
import { serializeBalance } from "../../../../lib/dashboard/serializeBalance.mjs";
import { serializeCard } from "../../../../lib/dashboard/serializeCard.mjs";
import { ensureSharedBalance } from "../../../../lib/db/bootstrap.mjs";
import { connectToDatabase } from "../../../../lib/db/mongoose.mjs";
import {
  applyLedgeredBalanceChange,
  isInsufficientBalanceError,
} from "../../../../lib/ledger/balance-ledger.mjs";
import { Balance } from "../../../../lib/models/Balance.mjs";
import { Card } from "../../../../lib/models/Card.mjs";
import { FIRE_COST_MINOR } from "../../../../lib/money";
import { buildCardPlaceholderObjectKey } from "../../../../lib/r2/card-placeholder.mjs";
import { createCardPlaceholderObject } from "../../../../lib/r2/card-r2-lifecycle.mjs";

export async function POST() {
  await connectToDatabase();
  await ensureSharedBalance();

  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const cardId = new mongoose.Types.ObjectId();
      const [card] = await Card.create(
        [
          {
            _id: cardId,
            ...createRandomCardData(),
            r2ObjectKey: buildCardPlaceholderObjectKey(cardId.toString()),
            r2Status: "pending_create",
          },
        ],
        { session },
      );
      const ledgerResult = await applyLedgeredBalanceChange({
        amountMinor: -FIRE_COST_MINOR,
        cardId: card._id,
        idempotencyKey: `card_create:${card._id.toString()}`,
        reason: "Dashboard card creation",
        session,
        type: "CARD_CREATE",
      });

      result = {
        ok: true,
        balance: serializeBalance(ledgerResult.balance),
        card: serializeCard(card),
        cardDocument: card,
      };
    });
  } catch (error) {
    if (isInsufficientBalanceError(error)) {
      const currentBalance = await Balance.findById("shared").lean();

      return NextResponse.json(
        {
          error: "Balance too low.",
          balance: serializeBalance(currentBalance),
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "Unable to fire card." },
      { status: 500 },
    );
  } finally {
    await session.endSession();
  }

  await createCardPlaceholderObject({ card: result.cardDocument });

  return NextResponse.json({
    balance: result.balance,
    card: result.card,
  });
}
