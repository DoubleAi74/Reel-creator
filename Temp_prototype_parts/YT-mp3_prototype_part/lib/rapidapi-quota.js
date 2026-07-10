const QUOTA_HEADER_NAMES = new Set([
  "x-ratelimit-requests-limit",
  "x-ratelimit-requests-remaining",
  "x-ratelimit-requests-reset",
  "x-ratelimit-request-limit",
  "x-ratelimit-request-remaining",
  "x-ratelimit-request-reset",
  "x-ratelimit-units-limit",
  "x-ratelimit-units-remaining",
  "x-ratelimit-units-reset",
  "x-ratelimit-rapid-free-plans-hard-limit-limit",
  "x-ratelimit-rapid-free-plans-hard-limit-remaining",
  "x-ratelimit-rapid-free-plans-hard-limit-reset",
]);

export function extractRapidApiQuotaHeaders(headers) {
  const quotaHeaders = {};

  if (!headers) {
    return quotaHeaders;
  }

  for (const [key, value] of headerEntries(headers)) {
    const lowered = key.toLowerCase();

    if (QUOTA_HEADER_NAMES.has(lowered)) {
      quotaHeaders[lowered] = String(value);
    }
  }

  return quotaHeaders;
}

export function mergeRapidApiQuotaHeaders(...quotaHeaderSets) {
  return quotaHeaderSets.reduce(
    (merged, headers) => ({
      ...merged,
      ...extractRapidApiQuotaHeaders(headers),
    }),
    {},
  );
}

export function normalizeRapidApiQuotaHeaders(headers) {
  const quotaHeaders = extractRapidApiQuotaHeaders(headers);

  if (Object.keys(quotaHeaders).length === 0) {
    return null;
  }

  return {
    requests:
      quotaGroup(quotaHeaders, "x-ratelimit-requests") ||
      quotaGroup(quotaHeaders, "x-ratelimit-request"),
    units: quotaGroup(quotaHeaders, "x-ratelimit-units"),
    hardLimit: quotaGroup(
      quotaHeaders,
      "x-ratelimit-rapid-free-plans-hard-limit",
    ),
    reportedAt: new Date().toISOString(),
  };
}

function quotaGroup(headers, prefix) {
  const limit = integerOrNull(headers[`${prefix}-limit`]);
  const remaining = integerOrNull(headers[`${prefix}-remaining`]);
  const resetSeconds = integerOrNull(headers[`${prefix}-reset`]);

  if (limit === null && remaining === null && resetSeconds === null) {
    return null;
  }

  return {
    limit,
    remaining,
    resetSeconds,
  };
}

function integerOrNull(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function headerEntries(headers) {
  if (typeof headers.entries === "function") {
    return headers.entries();
  }

  return Object.entries(headers);
}
