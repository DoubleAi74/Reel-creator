const DEFAULT_RATE_LIMIT_MAX = 10;
const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60;

function getRateLimitStore() {
  if (!globalThis.__reelCreatorGenerationRateLimits) {
    globalThis.__reelCreatorGenerationRateLimits = new Map();
  }

  return globalThis.__reelCreatorGenerationRateLimits;
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

export function buildGenerationRateLimitKeys({ ip = "", sessionId = "" } = {}) {
  return [
    sessionId ? `session:${sessionId}` : null,
    ip ? `ip:${ip}` : null,
  ].filter(Boolean);
}

export function checkGenerationRateLimit({
  ip = "",
  now = Date.now(),
  sessionId = "",
} = {}) {
  const keys = buildGenerationRateLimitKeys({ ip, sessionId });

  if (keys.length === 0) {
    return {
      allowed: true,
      remaining: getGenerationRateLimitConfig().max,
      retryAfter: 0,
    };
  }

  const config = getGenerationRateLimitConfig();
  const store = getRateLimitStore();
  let retryAfter = 0;

  for (const key of keys) {
    const current = store.get(key);

    if (!current || now >= current.resetAt) {
      continue;
    }

    if (current.count >= config.max) {
      retryAfter = Math.max(retryAfter, Math.ceil((current.resetAt - now) / 1000));
    }
  }

  if (retryAfter > 0) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter,
    };
  }

  let remaining = config.max;

  for (const key of keys) {
    const current = store.get(key);
    const next =
      !current || now >= current.resetAt
        ? { count: 1, resetAt: now + config.windowMs }
        : { ...current, count: current.count + 1 };

    store.set(key, next);
    remaining = Math.min(remaining, Math.max(0, config.max - next.count));
  }

  return {
    allowed: true,
    remaining,
    retryAfter: 0,
  };
}

export function resetGenerationRateLimitForTests() {
  getRateLimitStore().clear();
}
