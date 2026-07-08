export const CARD_PLACEHOLDER_CONTENT_TYPE = "text/html; charset=utf-8";

const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

function resolveCardId(cardOrId) {
  if (typeof cardOrId === "string") {
    return cardOrId;
  }

  return cardOrId?._id?.toString() ?? cardOrId?.id ?? null;
}

function assertValidCardId(cardId) {
  if (typeof cardId !== "string" || !cardId.trim()) {
    throw new Error("A non-empty card id is required to build an R2 object key.");
  }

  if (/[\s/]/.test(cardId)) {
    throw new Error("Card id must not contain whitespace or path separators.");
  }

  return cardId;
}

export function buildCardPlaceholderObjectKey(cardOrId) {
  const cardId = assertValidCardId(resolveCardId(cardOrId));

  return `cards/${cardId}/placeholder.json`;
}

export function buildCardPlaceholderHtml(cardOrId) {
  const cardId = assertValidCardId(resolveCardId(cardOrId));

  return [
    "<!doctype html>",
    "<html>",
    '  <head><meta charset="utf-8"><title>Card placeholder</title></head>',
    "  <body>",
    `    <p>Placeholder for card ${escapeHtml(cardId)}</p>`,
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

export function buildCardPlaceholderMetadata(cardOrId) {
  const cardId = assertValidCardId(resolveCardId(cardOrId));

  return {
    app: "credit-dashboard-prototype",
    cardid: cardId,
    createdby: "card-lifecycle",
    schemaversion: "1",
  };
}

export function buildCardPlaceholderObject(cardOrId) {
  return {
    body: buildCardPlaceholderHtml(cardOrId),
    contentType: CARD_PLACEHOLDER_CONTENT_TYPE,
    key: buildCardPlaceholderObjectKey(cardOrId),
    metadata: buildCardPlaceholderMetadata(cardOrId),
  };
}
