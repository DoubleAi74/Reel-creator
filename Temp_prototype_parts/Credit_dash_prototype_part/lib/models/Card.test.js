import { describe, expect, it } from "vitest";

import { CARD_R2_STATUSES, Card } from "./Card.mjs";

function buildValidCard(overrides = {}) {
  return new Card({
    colour: "#f97316",
    number: 214,
    title: "Aurora credit",
    ...overrides,
  });
}

describe("Card model R2 fields", () => {
  it("defaults R2 lifecycle fields for backward compatibility", () => {
    const card = buildValidCard();

    expect(card.validateSync()).toBe(undefined);
    expect(card.r2ObjectKey).toBe(null);
    expect(card.r2Status).toBe("not_required");
    expect(card.r2ErrorCode).toBe(null);
    expect(card.r2CreatedAt).toBe(null);
    expect(card.r2DeletedAt).toBe(null);
    expect(card.r2LastAttemptAt).toBe(null);
    expect(card.r2AttemptCount).toBe(0);
    expect(card.deletedAt).toBe(null);
    expect(card.deleteRequestedAt).toBe(null);
  });

  it("accepts every documented R2 status and rejects unknown ones", () => {
    for (const status of CARD_R2_STATUSES) {
      expect(buildValidCard({ r2Status: status }).validateSync()).toBe(
        undefined,
      );
    }

    const invalidCard = buildValidCard({ r2Status: "exploded" });
    expect(invalidCard.validateSync()?.errors?.r2Status).toBeTruthy();
  });

  it("keeps the r2ObjectKey unique index partial so null keys never collide", () => {
    const objectKeyIndex = Card.schema
      .indexes()
      .find(([fields]) => fields.r2ObjectKey === 1);

    expect(objectKeyIndex).toBeTruthy();
    expect(objectKeyIndex[1].unique).toBe(true);
    expect(objectKeyIndex[1].partialFilterExpression).toEqual({
      r2ObjectKey: { $type: "string" },
    });
  });

  it("indexes soft-delete and R2 retry lookups", () => {
    const indexKeys = Card.schema.indexes().map(([fields]) => fields);

    expect(indexKeys).toContainEqual({ createdAt: -1, deletedAt: 1 });
    expect(indexKeys).toContainEqual({ r2LastAttemptAt: 1, r2Status: 1 });
  });
});
