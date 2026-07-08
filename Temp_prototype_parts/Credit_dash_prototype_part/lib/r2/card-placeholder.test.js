import { describe, expect, it } from "vitest";

import {
  CARD_PLACEHOLDER_CONTENT_TYPE,
  buildCardPlaceholderHtml,
  buildCardPlaceholderMetadata,
  buildCardPlaceholderObject,
  buildCardPlaceholderObjectKey,
} from "./card-placeholder.mjs";

const cardId = "665f1c2b8f1b2a0012345678";

describe("card placeholder builder", () => {
  it("builds the requested deterministic object key", () => {
    expect(buildCardPlaceholderObjectKey(cardId)).toBe(
      `cards/${cardId}/placeholder.json`,
    );
  });

  it("accepts a card document and uses its _id", () => {
    const card = { _id: { toString: () => cardId } };

    expect(buildCardPlaceholderObjectKey(card)).toBe(
      `cards/${cardId}/placeholder.json`,
    );
  });

  it("rejects missing, empty, and unsafe card ids", () => {
    expect(() => buildCardPlaceholderObjectKey()).toThrow("card id");
    expect(() => buildCardPlaceholderObjectKey("")).toThrow("card id");
    expect(() => buildCardPlaceholderObjectKey("  ")).toThrow("card id");
    expect(() => buildCardPlaceholderObjectKey("a/b")).toThrow(
      "path separators",
    );
    expect(() => buildCardPlaceholderObjectKey("a b")).toThrow(
      "path separators",
    );
    expect(() => buildCardPlaceholderObjectKey(42)).toThrow("card id");
  });

  it("builds simple HTML containing the card id and nothing sensitive", () => {
    const html = buildCardPlaceholderHtml(cardId);

    expect(html).toContain("<!doctype html>");
    expect(html).toContain(`Placeholder for card ${cardId}`);
    expect(html).not.toMatch(/sk_|secret|password|authorization/i);
  });

  it("escapes card id characters in the HTML defensively", () => {
    const html = buildCardPlaceholderHtml("<img>");

    expect(html).toContain("&lt;img&gt;");
    expect(html).not.toContain("<img>");
  });

  it("uses the HTML content type despite the .json key", () => {
    expect(CARD_PLACEHOLDER_CONTENT_TYPE).toBe("text/html; charset=utf-8");
  });

  it("builds safe string metadata including the card id", () => {
    expect(buildCardPlaceholderMetadata(cardId)).toEqual({
      app: "credit-dashboard-prototype",
      cardid: cardId,
      createdby: "card-lifecycle",
      schemaversion: "1",
    });
  });

  it("composes key, body, content type, and metadata in one object", () => {
    const placeholderObject = buildCardPlaceholderObject(cardId);

    expect(placeholderObject.key).toBe(`cards/${cardId}/placeholder.json`);
    expect(placeholderObject.contentType).toBe(CARD_PLACEHOLDER_CONTENT_TYPE);
    expect(placeholderObject.body).toContain(cardId);
    expect(placeholderObject.metadata.cardid).toBe(cardId);
  });
});
