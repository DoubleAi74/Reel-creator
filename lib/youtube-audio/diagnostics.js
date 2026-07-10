const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
const ESCAPED_URL_PATTERN = /https?:\\\/\\\/[^\s"'<>]+/gi;
const SENSITIVE_KEY_PATTERN =
  /(key|token|secret|signature|authorization|cookie|set-cookie|x-rapidapi-key|url|link|href|sig)/i;

export function diagnosticsEnabled() {
  const flag = String(process.env.YT_AUDIO_DEBUG ?? "")
    .trim()
    .toLowerCase();

  if (flag === "0" || flag === "false" || flag === "off") {
    return false;
  }

  // Explicit on, non-production, or any Vercel deploy (so production logs work
  // without hunting for NODE_ENV quirks while debugging convert failures).
  return (
    flag === "1" ||
    flag === "true" ||
    flag === "on" ||
    flag === "verbose" ||
    process.env.NODE_ENV !== "production" ||
    process.env.VERCEL === "1"
  );
}

export function logDiagnostic(event, data = {}, level = "info") {
  if (!diagnosticsEnabled()) {
    return;
  }

  const payload = sanitizeDiagnosticValue(data);
  const line = `[yt-audio] ${event} ${JSON.stringify(payload)}`;

  if (level === "warn") {
    console.warn(line);
    return;
  }

  if (level === "error") {
    console.error(line);
    return;
  }

  console.info(line);
}

/**
 * Always-on convert breadcrumbs (safe fields only). Use for Vercel log inspection
 * even when full diagnostics are off. Does not log URLs, keys, or bodies.
 */
export function logConvertTrace(event, data = {}, level = "info") {
  const payload = sanitizeDiagnosticValue({
    ...data,
    t: new Date().toISOString(),
    vercel: process.env.VERCEL === "1",
    syncEnv: process.env.YT_AUDIO_SYNC ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
  });
  const line = `[yt-audio:convert] ${event} ${JSON.stringify(payload)}`;

  if (level === "warn") {
    console.warn(line);
    return;
  }

  if (level === "error") {
    console.error(line);
    return;
  }

  console.info(line);
}

export function sanitizeDiagnosticValue(value, keyName = "") {
  if (value instanceof Error) {
    return sanitizeError(value);
  }

  if (typeof value === "string") {
    return SENSITIVE_KEY_PATTERN.test(keyName) ? redactString(value) : redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeDiagnosticValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
          return [key, redactString(String(entry || ""))];
        }

        return [key, sanitizeDiagnosticValue(entry, key)];
      }),
    );
  }

  return value;
}

export function summarizeUrl(value) {
  try {
    const url = new URL(String(value));
    return {
      protocol: url.protocol,
      host: url.hostname,
      path: sanitizePathname(url.pathname),
      hasQuery: Boolean(url.search),
    };
  } catch {
    return { malformed: true };
  }
}

export function sanitizeError(error) {
  if (!(error instanceof Error)) {
    return sanitizeDiagnosticValue(error);
  }

  return {
    name: error.name,
    message: redactString(error.message),
    errorCode: error.errorCode,
    status: error.status,
    cause: sanitizeDiagnosticValue(error.cause),
  };
}

function sanitizePathname(pathname) {
  return pathname
    .split("/")
    .map((segment) => sanitizePathSegment(segment))
    .join("/");
}

function sanitizePathSegment(segment) {
  if (!segment) {
    return segment;
  }

  const extensionMatch = segment.match(/(\.[a-z0-9]{2,5})$/i);
  const extension = extensionMatch?.[1] || "";
  const withoutExtension = extension ? segment.slice(0, -extension.length) : segment;
  const tokenish =
    withoutExtension.length > 24 ||
    /^[A-Za-z0-9_-]{16,}$/.test(withoutExtension) ||
    /^[A-Fa-f0-9]{12,}$/.test(withoutExtension);

  return tokenish ? `[redacted]${extension}` : segment;
}

function redactString(value) {
  return String(value)
    .replace(ESCAPED_URL_PATTERN, (match) =>
      buildRedactedUrlLabel(match.replaceAll("\\/", "/")),
    )
    .replace(URL_PATTERN, (match) => buildRedactedUrlLabel(match));
}

function buildRedactedUrlLabel(value) {
  const summary = summarizeUrl(value);

  return summary.host
    ? `REDACTED_URL(${summary.host}${summary.path || ""})`
    : "REDACTED_URL";
}
