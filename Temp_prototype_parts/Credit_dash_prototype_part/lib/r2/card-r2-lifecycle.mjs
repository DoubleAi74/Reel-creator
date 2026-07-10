import { Card } from "../models/Card.mjs";
import {
  buildCardPlaceholderHtml,
  buildCardPlaceholderMetadata,
  buildCardPlaceholderObjectKey,
  CARD_PLACEHOLDER_CONTENT_TYPE,
} from "./card-placeholder.mjs";
import { deleteR2Object, putR2Object, toSafeR2ErrorCode } from "./r2-client.mjs";
import { isR2Enabled } from "./r2-env.mjs";

const R2_STATUSES_WITHOUT_OBJECT = new Set([
  "not_required",
  "skipped",
  "deleted",
]);

function resolveCardId(card) {
  return card?._id?.toString() ?? card?.id ?? null;
}

async function markCard(cardId, fields, { countAttempt = false } = {}) {
  const update = { $set: fields };

  if (countAttempt) {
    update.$inc = { r2AttemptCount: 1 };
  }

  try {
    await Card.updateOne({ _id: cardId }, update);
  } catch {
    console.error("R2 card status update failed:", {
      cardId,
      kind: "MONGO_UPDATE_FAILED",
    });
  }
}

export async function createCardPlaceholderObject({ card }) {
  const cardId = resolveCardId(card);
  const key = card?.r2ObjectKey ?? buildCardPlaceholderObjectKey(cardId);
  const now = new Date();

  if (card?.deletedAt) {
    return { key, ok: true, skipped: true };
  }

  if (!isR2Enabled()) {
    await markCard(cardId, {
      r2LastAttemptAt: now,
      r2Status: "skipped",
    });

    return { key, ok: true, skipped: true };
  }

  try {
    await putR2Object({
      body: buildCardPlaceholderHtml(cardId),
      contentType: CARD_PLACEHOLDER_CONTENT_TYPE,
      key,
      metadata: buildCardPlaceholderMetadata(cardId),
    });

    await markCard(
      cardId,
      {
        r2CreatedAt: now,
        r2ErrorCode: null,
        r2LastAttemptAt: now,
        r2ObjectKey: key,
        r2Status: "created",
      },
      { countAttempt: true },
    );

    return { key, ok: true };
  } catch (error) {
    const errorCode = toSafeR2ErrorCode(error);

    console.error("R2 card placeholder create failed:", {
      cardId,
      key,
      kind: errorCode,
    });

    await markCard(
      cardId,
      {
        r2ErrorCode: errorCode,
        r2LastAttemptAt: now,
        r2Status: "create_failed",
      },
      { countAttempt: true },
    );

    return { errorCode, key, ok: false };
  }
}

export async function deleteCardPlaceholderObject({ card }) {
  const cardId = resolveCardId(card);
  const key = card?.r2ObjectKey ?? null;
  const now = new Date();

  if (!key || R2_STATUSES_WITHOUT_OBJECT.has(card?.r2Status)) {
    return { key, ok: true, skipped: true };
  }

  if (!isR2Enabled()) {
    const errorCode = "R2_DISABLED";

    console.error("R2 card placeholder delete failed:", {
      cardId,
      key,
      kind: errorCode,
    });

    await markCard(
      cardId,
      {
        r2ErrorCode: errorCode,
        r2LastAttemptAt: now,
        r2Status: "delete_failed",
      },
      { countAttempt: true },
    );

    return { errorCode, key, ok: false };
  }

  try {
    const result = await deleteR2Object({ key });

    await markCard(
      cardId,
      {
        r2DeletedAt: now,
        r2ErrorCode: null,
        r2LastAttemptAt: now,
        r2Status: "deleted",
      },
      { countAttempt: true },
    );

    return { alreadyMissing: result.alreadyMissing === true, key, ok: true };
  } catch (error) {
    const errorCode = toSafeR2ErrorCode(error);

    console.error("R2 card placeholder delete failed:", {
      cardId,
      key,
      kind: errorCode,
    });

    await markCard(
      cardId,
      {
        r2ErrorCode: errorCode,
        r2LastAttemptAt: now,
        r2Status: "delete_failed",
      },
      { countAttempt: true },
    );

    return { errorCode, key, ok: false };
  }
}
