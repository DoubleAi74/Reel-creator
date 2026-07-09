// Defaults aligned with `.env.example` / CREDITS_SETUP (REP-801): 20 req / 3600s.
const DEFAULT_RATE_LIMIT_MAX = 20;
const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 3600;
const DEFAULT_CHECKOUT_RATE_MAX = 20;
const DEFAULT_CHECKOUT_RATE_WINDOW_SECONDS = 600;
const DEFAULT_UNLOCK_RATE_MAX = 20;
const DEFAULT_UNLOCK_RATE_WINDOW_SECONDS = 300;
const DEFAULT_ORDER_RATE_MAX = 60;
const DEFAULT_ORDER_RATE_WINDOW_SECONDS = 60;
// Bound in-memory map growth (REP-804): sweep expired keys periodically.
const RATE_LIMIT_EVICT_INTERVAL_MS = 60_000;

function getRateLimitStore() {
  if (!globalThis.__reelCreatorGenerationRateLimits) {
    globalThis.__reelCreatorGenerationRateLimits = new Map();
  }

  return globalThis.__reelCreatorGenerationRateLimits;
}

function getRateLimitMeta() {
  if (!globalThis.__reelCreatorRateLimitMeta) {
    globalThis.__reelCreatorRateLimitMeta = { lastEvictAt: 0 };
  }

  return globalThis.__reelCreatorRateLimitMeta;
}

/** REP-804: drop expired windows so the per-process map cannot grow without bound. */
export function evictExpiredRateLimitKeys(now = Date.now()) {
  const store = getRateLimitStore();
  let removed = 0;

  for (const [key, entry] of store.entries()) {
    if (!entry || now >= entry.resetAt) {
      store.delete(key);
      removed += 1;
    }
  }

  getRateLimitMeta().lastEvictAt = now;
  return removed;
}

function maybeEvictExpiredKeys(now = Date.now()) {
  const meta = getRateLimitMeta();

  if (now - meta.lastEvictAt < RATE_LIMIT_EVICT_INTERVAL_MS) {
    return;
  }

  evictExpiredRateLimitKeys(now);
}

function parsePositiveIntegerEnv(name, fallback) {
  const rawValue = process.env[name];

  if (rawValue == null || rawValue === "") {
    return fallback;
  }

  const parsedValue = Number(rawValue);

  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

export function getGenerationRateLimitConfig() {
  return {
    max: parsePositiveIntegerEnv("GEN_RATE_MAX", DEFAULT_RATE_LIMIT_MAX),
    windowMs:
      parsePositiveIntegerEnv(
        "GEN_RATE_WINDOW_SECONDS",
        DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
      ) * 1000,
  };
}

export function getCheckoutRateLimitConfig() {
  return {
    max: parsePositiveIntegerEnv("CHECKOUT_RATE_MAX", DEFAULT_CHECKOUT_RATE_MAX),
    windowMs:
      parsePositiveIntegerEnv(
        "CHECKOUT_RATE_WINDOW_SECONDS",
        DEFAULT_CHECKOUT_RATE_WINDOW_SECONDS,
      ) * 1000,
  };
}

export function getUnlockRateLimitConfig() {
  return {
    max: parsePositiveIntegerEnv("UNLOCK_RATE_MAX", DEFAULT_UNLOCK_RATE_MAX),
    windowMs:
      parsePositiveIntegerEnv(
        "UNLOCK_RATE_WINDOW_SECONDS",
        DEFAULT_UNLOCK_RATE_WINDOW_SECONDS,
      ) * 1000,
  };
}

export function getOrderRateLimitConfig() {
  return {
    max: parsePositiveIntegerEnv("ORDER_RATE_MAX", DEFAULT_ORDER_RATE_MAX),
    windowMs:
      parsePositiveIntegerEnv(
        "ORDER_RATE_WINDOW_SECONDS",
        DEFAULT_ORDER_RATE_WINDOW_SECONDS,
      ) * 1000,
  };
}

export function buildGenerationRateLimitKeys({ ip = "", sessionId = "" } = {}) {
  return [
    sessionId ? `session:${sessionId}` : null,
    ip ? `ip:${ip}` : null,
  ].filter(Boolean);
}

function buildNamespacedKeys(namespace, { ip = "", sessionId = "" } = {}) {
  return [
    sessionId ? `${namespace}:session:${sessionId}` : null,
    ip ? `${namespace}:ip:${ip}` : null,
  ].filter(Boolean);
}

export function checkRateLimit({
  config,
  ip = "",
  keys = null,
  now = Date.now(),
  sessionId = "",
  namespace = "gen",
} = {}) {
  maybeEvictExpiredKeys(now);

  const resolvedKeys =
    keys ??
    (namespace === "gen"
      ? buildGenerationRateLimitKeys({ ip, sessionId })
      : buildNamespacedKeys(namespace, { ip, sessionId }));

  const resolvedConfig = config ?? getGenerationRateLimitConfig();

  if (resolvedKeys.length === 0) {
    return {
      allowed: true,
      remaining: resolvedConfig.max,
      retryAfter: 0,
    };
  }

  const store = getRateLimitStore();
  let retryAfter = 0;

  for (const key of resolvedKeys) {
    const current = store.get(key);

    if (!current || now >= current.resetAt) {
      continue;
    }

    if (current.count >= resolvedConfig.max) {
      retryAfter = Math.max(
        retryAfter,
        Math.ceil((current.resetAt - now) / 1000),
      );
    }
  }

  if (retryAfter > 0) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter,
    };
  }

  let remaining = resolvedConfig.max;

  for (const key of resolvedKeys) {
    const current = store.get(key);
    const next =
      !current || now >= current.resetAt
        ? { count: 1, resetAt: now + resolvedConfig.windowMs }
        : { ...current, count: current.count + 1 };

    store.set(key, next);
    remaining = Math.min(remaining, Math.max(0, resolvedConfig.max - next.count));
  }

  return {
    allowed: true,
    remaining,
    retryAfter: 0,
  };
}

export function checkGenerationRateLimit({
  ip = "",
  now = Date.now(),
  sessionId = "",
} = {}) {
  return checkRateLimit({
    config: getGenerationRateLimitConfig(),
    ip,
    namespace: "gen",
    now,
    sessionId,
  });
}

export function checkCheckoutRateLimit({
  ip = "",
  now = Date.now(),
  sessionId = "",
} = {}) {
  return checkRateLimit({
    config: getCheckoutRateLimitConfig(),
    ip,
    namespace: "checkout",
    now,
    sessionId,
  });
}

export function checkUnlockRateLimit({ ip = "", now = Date.now() } = {}) {
  return checkRateLimit({
    config: getUnlockRateLimitConfig(),
    ip,
    namespace: "unlock",
    now,
  });
}

export function checkOrderRateLimit({ ip = "", now = Date.now() } = {}) {
  return checkRateLimit({
    config: getOrderRateLimitConfig(),
    ip,
    namespace: "order",
    now,
  });
}

export function resetGenerationRateLimitForTests() {
  getRateLimitStore().clear();
  getRateLimitMeta().lastEvictAt = 0;
}

export function getRateLimitStoreSizeForTests() {
  return getRateLimitStore().size;
}

export function getRequestIp(request) {
  const forwardedFor = request?.headers?.get?.("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  return request?.headers?.get?.("x-real-ip")?.trim() ?? "";
}
