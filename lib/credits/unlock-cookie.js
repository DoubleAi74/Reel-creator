import { createHmac, timingSafeEqual } from "node:crypto";

export const GENERATION_UNLOCK_COOKIE = "rc_gen_unlock";
export const DEFAULT_UNLOCK_TTL_SECONDS = 12 * 60 * 60;

export function getGenerationUnlockTtlSeconds() {
  const rawValue = process.env.GENERATION_UNLOCK_TTL_SECONDS;

  if (rawValue == null || rawValue === "") {
    return DEFAULT_UNLOCK_TTL_SECONDS;
  }

  const parsedValue = Number(rawValue);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error("GENERATION_UNLOCK_TTL_SECONDS must be a positive integer.");
  }

  return parsedValue;
}

function getUnlockSecret() {
  const secret = process.env.GENERATION_UNLOCK_SECRET?.trim();

  if (!secret) {
    throw new Error("GENERATION_UNLOCK_SECRET is required when credits are enabled.");
  }

  return secret;
}

function getGenerationPassword() {
  const password = process.env.GENERATION_PASSWORD ?? "";

  if (!password) {
    throw new Error("GENERATION_PASSWORD is required when credits are enabled.");
  }

  return password;
}

function timingSafeEqualStrings(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    timingSafeEqual(leftBuffer, leftBuffer);
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function signUnlockPayload(payload) {
  return createHmac("sha256", getUnlockSecret()).update(payload).digest("base64url");
}

export function verifyGenerationPassword(password) {
  return timingSafeEqualStrings(password ?? "", getGenerationPassword());
}

export function createGenerationUnlockCookieValue({ now = Date.now() } = {}) {
  const expiresAt = now + getGenerationUnlockTtlSeconds() * 1000;
  const payload = String(expiresAt);
  const signature = signUnlockPayload(payload);

  return `${payload}.${signature}`;
}

export function isGenerationUnlockCookieValid(value, { now = Date.now() } = {}) {
  if (typeof value !== "string" || !value.includes(".")) {
    return false;
  }

  const [expiresAtRaw, signature] = value.split(".");
  const expiresAt = Number(expiresAtRaw);

  if (!Number.isFinite(expiresAt) || expiresAt <= now || !signature) {
    return false;
  }

  const expectedSignature = signUnlockPayload(expiresAtRaw);

  return timingSafeEqualStrings(signature, expectedSignature);
}

function shouldSetSecureUnlockCookie() {
  if (process.env.NODE_ENV === "production") {
    return true;
  }

  const baseUrl = String(process.env.APP_BASE_URL ?? "").trim().toLowerCase();

  return baseUrl.startsWith("https://");
}

export function buildGenerationUnlockSetCookie(value) {
  const parts = [
    `${GENERATION_UNLOCK_COOKIE}=${value}`,
    "Path=/",
    `Max-Age=${getGenerationUnlockTtlSeconds()}`,
    "HttpOnly",
    "SameSite=Lax",
  ];

  // REP-401: Secure in production / https base URL; keep localhost usable.
  if (shouldSetSecureUnlockCookie()) {
    parts.push("Secure");
  }

  return parts.join("; ");
}
