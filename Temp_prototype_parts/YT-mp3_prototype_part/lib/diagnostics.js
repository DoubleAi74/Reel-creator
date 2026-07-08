const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
const ESCAPED_URL_PATTERN = /https?:\\\/\\\/[^\s"'<>]+/gi;
const SENSITIVE_KEY_PATTERN =
  /(key|token|secret|signature|authorization|cookie|set-cookie|x-rapidapi-key|url|link|href|sig)/i;

export function diagnosticsEnabled() {
  return process.env.YT_AUDIO_DEBUG === "1" || process.env.NODE_ENV !== "production";
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

export function sanitizeDiagnosticValue(value, keyName = "") {
  if (value instanceof Error) {
    return sanitizeError(value);
  }

  if (typeof value === "string") {
    if (SENSITIVE_KEY_PATTERN.test(keyName)) {
      return redactString(value);
    }

    return redactString(value);
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
    return {
      malformed: true,
    };
  }
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

  if (!tokenish) {
    return segment;
  }

  return `[redacted]${extension}`;
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

function redactString(value) {
  return String(value)
    .replace(ESCAPED_URL_PATTERN, (match) =>
      buildRedactedUrlLabel(match.replaceAll("\\/", "/")),
    )
    .replace(URL_PATTERN, (match) => buildRedactedUrlLabel(match));
}

function buildRedactedUrlLabel(value) {
  const summary = summarizeUrl(value);

  if (summary.host) {
    return `REDACTED_URL(${summary.host}${summary.path || ""})`;
  }

  return "REDACTED_URL";
}
