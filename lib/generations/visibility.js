import { SESSION_COOKIE_NAME } from "../files.js";

function asTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseCookieHeader(cookieHeader) {
  const cookies = new Map();

  for (const part of asTrimmedString(cookieHeader).split(";")) {
    const [rawName, ...rawValueParts] = part.split("=");
    const name = asTrimmedString(rawName);

    if (!name) {
      continue;
    }

    const rawValue = rawValueParts.join("=");
    let value = rawValue;

    try {
      value = decodeURIComponent(rawValue);
    } catch {
      // Keep the raw cookie value if it is not URI encoded.
    }

    cookies.set(name, value);
  }

  return cookies;
}

export function getSessionIdFromRequest(request) {
  return asTrimmedString(
    parseCookieHeader(request?.headers?.get?.("cookie")).get(
      SESSION_COOKIE_NAME,
    ),
  );
}

export function buildSessionOwnerScope(sessionId) {
  const ownerSessionId = asTrimmedString(sessionId);

  return ownerSessionId ? { sessionId: ownerSessionId, type: "session" } : null;
}

export function isPublicGeneration(generation) {
  return generation?.public === true && generation?.userTitled === true;
}

export function isGenerationOwnedBySession(generation, sessionId) {
  const ownerSessionId = asTrimmedString(sessionId);

  return (
    Boolean(ownerSessionId) &&
    generation?.ownerScope?.type === "session" &&
    generation.ownerScope.sessionId === ownerSessionId
  );
}

export function buildGenerationVisibilityFilter(sessionId) {
  const visibility = [{ public: true, userTitled: true }];
  const ownerSessionId = asTrimmedString(sessionId);

  if (ownerSessionId) {
    visibility.push({
      "ownerScope.sessionId": ownerSessionId,
      "ownerScope.type": "session",
    });
  }

  return { $or: visibility };
}

export function canReadGeneration(generation, sessionId) {
  return (
    isPublicGeneration(generation) ||
    isGenerationOwnedBySession(generation, sessionId)
  );
}
