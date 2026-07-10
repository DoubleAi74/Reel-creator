import {
  logDiagnostic,
  sanitizeDiagnosticValue,
  summarizeUrl,
} from "../diagnostics.js";
import { extractRapidApiQuotaHeaders } from "../rapidapi-quota.js";

const DEFAULT_TIMEOUT_MS = 25_000;

export class YoutubeAudioProviderError extends Error {
  constructor(
    message,
    { errorCode = "INTERNAL_ERROR", status, cause, quotaHeaders = {} } = {},
  ) {
    super(message);
    this.name = "YoutubeAudioProviderError";
    this.errorCode = errorCode;
    this.status = status;
    this.cause = cause;
    this.quotaHeaders = quotaHeaders;
  }
}

export function rapidApiHeaders(config, host, extraHeaders = {}) {
  return {
    ...extraHeaders,
    "X-RapidAPI-Key": config.rapidApiKey,
    "X-RapidAPI-Host": host,
  };
}

export function rapidApiJsonHeaders(config, host, extraHeaders = {}) {
  return rapidApiHeaders(config, host, {
    "Content-Type": "application/json",
    ...extraHeaders,
  });
}

export async function rapidApiFetchJson(url, init, options = {}) {
  const { body } = await rapidApiFetchJsonWithMeta(url, init, options);
  return body;
}

export async function rapidApiFetchJsonWithMeta(url, init, options = {}) {
  const response = await rapidApiFetch(url, init, options);
  const text = await response.text();
  const quotaHeaders = extractRapidApiQuotaHeaders(response.headers);

  try {
    return {
      body: text ? JSON.parse(text) : null,
      quotaHeaders,
    };
  } catch {
    logDiagnostic(
      "provider-json-malformed",
      {
        target: summarizeUrl(url),
        status: response.status,
        bodyPreview: text.slice(0, 500),
      },
      "warn",
    );

    throw new YoutubeAudioProviderError(
      "Provider returned a non-JSON response where JSON was expected",
      {
        errorCode: "PROVIDER_MALFORMED_RESPONSE",
        status: response.status,
        cause: text.slice(0, 500),
        quotaHeaders,
      },
    );
  }
}

export async function rapidApiFetch(url, init, options = {}) {
  let response;
  const method = init?.method || "GET";
  const host = init?.headers?.["X-RapidAPI-Host"] || init?.headers?.["x-rapidapi-host"];

  logDiagnostic("provider-request", {
    method,
    host,
    target: summarizeUrl(url),
  });

  try {
    response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal:
        init?.signal ||
        AbortSignal.timeout(options.timeoutMs || DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    logDiagnostic(
      "provider-request-failed",
      {
        method,
        host,
        target: summarizeUrl(url),
        error,
      },
      "warn",
    );

    throw new YoutubeAudioProviderError("Provider request failed", {
      errorCode: "PROVIDER_TIMEOUT",
      cause: error,
    });
  }

  if (!response.ok) {
    const body = await readErrorBody(response);
    const quotaHeaders = extractRapidApiQuotaHeaders(response.headers);

    logDiagnostic(
      "provider-response-error",
      {
        method,
        host,
        target: summarizeUrl(url),
        status: response.status,
        contentType: response.headers.get("content-type") || null,
        contentLength: response.headers.get("content-length") || null,
        quotaHeaders,
        body: sanitizeDiagnosticValue(body),
      },
      "warn",
    );

    throw new YoutubeAudioProviderError(
      `Provider returned HTTP ${response.status}`,
      {
        errorCode: mapProviderHttpStatus(response.status),
        status: response.status,
        cause: body,
        quotaHeaders,
      },
    );
  }

  logDiagnostic("provider-response-ok", {
    method,
    host,
    target: summarizeUrl(url),
    status: response.status,
    contentType: response.headers.get("content-type") || null,
    contentLength: response.headers.get("content-length") || null,
    quotaHeaders: extractRapidApiQuotaHeaders(response.headers),
  });

  return response;
}

export { extractRapidApiQuotaHeaders };

export function mapProviderHttpStatus(status) {
  if (status === 401 || status === 403) {
    return "PROVIDER_AUTH_FAILED";
  }

  if (status === 408 || status === 504) {
    return "PROVIDER_TIMEOUT";
  }

  if (status === 429) {
    return "PROVIDER_RATE_LIMITED";
  }

  if (status === 400 || status === 404 || status === 422) {
    return "PROVIDER_REJECTED";
  }

  if (status >= 500) {
    return "CONVERSION_FAILED";
  }

  return "INTERNAL_ERROR";
}

async function readErrorBody(response) {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { unparsedBody: text.slice(0, 500) };
  }
}
