import dns from "node:dns/promises";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  logDiagnostic,
  sanitizeDiagnosticValue,
  summarizeUrl,
} from "./diagnostics";
import {
  findMediaUrl,
  findProgressUrl,
  looksLikeImageUrl,
} from "./providers/provider-utils";
import {
  extractRapidApiQuotaHeaders,
  mapProviderHttpStatus,
} from "./providers/rapidapi-client";

const DEFAULT_MEDIA_TIMEOUT_MS = 45_000;
const DEFAULT_MEDIA_DOWNLOAD_RETRIES = 2;
const MAX_JSON_BODY_BYTES = 1024 * 1024;
const MAX_REDIRECT_DEPTH = 3;
const MAX_JSON_INDIRECTION_DEPTH = 3;
const MAX_PROGRESS_ATTEMPTS = 40;
const PROGRESS_DELAY_MS = 2500;
const TRANSIENT_MEDIA_ERROR_CODES = new Set(["PROVIDER_TIMEOUT"]);
const TEXT_BODY_TYPES = [
  "application/json",
  "text/json",
  "text/plain",
  "text/event-stream",
];
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class AudioMediaFetchError extends Error {
  constructor(
    message,
    { errorCode = "CONVERSION_FAILED", status, cause, quotaHeaders = {} } = {},
  ) {
    super(message);
    this.name = "AudioMediaFetchError";
    this.errorCode = errorCode;
    this.status = status;
    this.cause = cause;
    this.quotaHeaders = quotaHeaders;
  }
}

export async function fetchMediaToFile(media, options) {
  const outputPath = options.outputPath;
  await mkdir(path.dirname(outputPath), { recursive: true });

  return fetchMediaUrl(
    {
      url: media.mediaUrl,
      headers: media.mediaHeaders || {},
    },
    {
      outputPath,
      maxBytes: options.maxBytes,
      timeoutMs: options.timeoutMs || DEFAULT_MEDIA_TIMEOUT_MS,
      depth: 0,
      progressAttempt: 0,
      redirectDepth: 0,
    },
  );
}

function getMediaDownloadRetries() {
  const rawValue = process.env.YT_MEDIA_DOWNLOAD_RETRIES;

  if (rawValue == null || rawValue === "") {
    return DEFAULT_MEDIA_DOWNLOAD_RETRIES;
  }

  const parsedValue = Number.parseInt(rawValue, 10);

  return Number.isInteger(parsedValue) && parsedValue >= 0
    ? parsedValue
    : DEFAULT_MEDIA_DOWNLOAD_RETRIES;
}

export function isTransientMediaFetchError(error) {
  if (!(error instanceof AudioMediaFetchError)) {
    return false;
  }

  return TRANSIENT_MEDIA_ERROR_CODES.has(error.errorCode);
}

/**
 * Retry transient media downloads (timeouts / network aborts).
 * Permanent SSRF / malformed / rejected errors are not retried.
 */
export async function fetchMediaToFileWithRetry(media, options = {}, context = {}) {
  const maxRetries = getMediaDownloadRetries();
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fetchMediaToFile(media, options);
    } catch (error) {
      lastError = error;

      if (!isTransientMediaFetchError(error) || attempt >= maxRetries) {
        throw error;
      }

      logDiagnostic(
        "media-download-retry",
        {
          jobId: context.jobId || null,
          attempt: attempt + 1,
          maxRetries,
          errorCode: error.errorCode,
          message: error.message,
        },
        "warn",
      );

      await delay(500 * (attempt + 1));
    }
  }

  throw lastError;
}

async function fetchMediaUrl(media, options) {
  const url = await validateFetchUrl(media.url);
  let response;

  logDiagnostic("media-request", {
    target: summarizeUrl(url),
    depth: options.depth,
    redirectDepth: options.redirectDepth,
    hasHeaders: Boolean(media.headers && Object.keys(media.headers).length > 0),
  });

  try {
    // REP-404: pin the validated DNS result for the connection (TOCTOU rebinding).
    response = await fetchWithPinnedAddress(url, {
      method: "GET",
      headers: media.headers || {},
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error) {
    logDiagnostic(
      "media-request-failed",
      {
        target: summarizeUrl(url),
        depth: options.depth,
        redirectDepth: options.redirectDepth,
        error,
      },
      "warn",
    );

    throw new AudioMediaFetchError("Media URL could not be fetched", {
      errorCode: "PROVIDER_TIMEOUT",
      cause: error,
    });
  }

  if (REDIRECT_STATUSES.has(response.status)) {
    return followValidatedRedirect(media, options, url, response);
  }

  if (!response.ok) {
    const bodyPreview = await readSafeErrorPreview(response);

    logDiagnostic(
      "media-response-error",
      {
        target: summarizeUrl(url),
        depth: options.depth,
        status: response.status,
        contentType: response.headers.get("content-type") || null,
        contentLength: response.headers.get("content-length") || null,
        quotaHeaders: extractRapidApiQuotaHeaders(response.headers),
        bodyPreview,
      },
      "warn",
    );

    throw new AudioMediaFetchError(`Media URL returned HTTP ${response.status}`, {
      errorCode:
        response.status === 410 ? "RESULT_EXPIRED" : mapProviderHttpStatus(response.status),
      status: response.status,
      quotaHeaders: extractRapidApiQuotaHeaders(response.headers),
    });
  }

  const contentType = response.headers.get("content-type") || "";
  const responseQuotaHeaders = extractRapidApiQuotaHeaders(response.headers);

  logDiagnostic("media-response-ok", {
    target: summarizeUrl(url),
    depth: options.depth,
    status: response.status,
    contentType,
    contentLength: response.headers.get("content-length") || null,
    quotaHeaders: responseQuotaHeaders,
  });

  if (isJsonLikeContentType(contentType)) {
    if (options.depth >= MAX_JSON_INDIRECTION_DEPTH) {
      throw new AudioMediaFetchError("Media JSON indirection is too deep", {
        errorCode: "PROVIDER_MALFORMED_RESPONSE",
        quotaHeaders: responseQuotaHeaders,
      });
    }

    const body = await readLimitedText(response, MAX_JSON_BODY_BYTES);
    const nested = findNestedMediaIntent(body);

    if (!nested) {
      if (isProbablyProcessing(body) && options.progressAttempt < MAX_PROGRESS_ATTEMPTS) {
        logDiagnostic("media-progress-wait", {
          target: summarizeUrl(url),
          attempt: options.progressAttempt + 1,
          bodyPreview: sanitizeDiagnosticValue(body.slice(0, 500)),
        });

        await delay(PROGRESS_DELAY_MS);
        return fetchMediaUrl(media, {
          ...options,
          progressAttempt: options.progressAttempt + 1,
          redirectDepth: 0,
        });
      }

      logDiagnostic(
        "media-json-without-url",
        {
          target: summarizeUrl(url),
          bodyPreview: sanitizeDiagnosticValue(body.slice(0, 500)),
        },
        "warn",
      );

      throw new AudioMediaFetchError("Provider response did not include usable media", {
        errorCode: "PROVIDER_MALFORMED_RESPONSE",
        cause: body.slice(0, 500),
        quotaHeaders: responseQuotaHeaders,
      });
    }

    logDiagnostic("media-json-nested-url", {
      target: summarizeUrl(url),
      nestedTarget: summarizeUrl(nested.url),
      nestedKind: nested.kind,
    });

    const nestedResult = await fetchMediaUrl(
      {
        url: nested.url,
        headers: {},
      },
      {
        ...options,
        depth: options.depth + 1,
        progressAttempt:
          nested.kind === "progress" ? options.progressAttempt + 1 : 0,
        redirectDepth: 0,
      },
    );

    return {
      ...nestedResult,
      quotaHeaders: {
        ...extractRapidApiQuotaHeaders(response.headers),
        ...nestedResult.quotaHeaders,
      },
    };
  }

  if (looksLikeHtml(contentType)) {
    logDiagnostic(
      "media-html-response",
      {
        target: summarizeUrl(url),
        contentType,
      },
      "warn",
    );

    throw new AudioMediaFetchError("Provider media URL returned HTML", {
      errorCode: "PROVIDER_MALFORMED_RESPONSE",
      quotaHeaders: responseQuotaHeaders,
    });
  }

  if (looksLikeImageUrl(url.toString()) || contentType.startsWith("image/")) {
    logDiagnostic(
      "media-image-response",
      {
        target: summarizeUrl(url),
        contentType,
      },
      "warn",
    );

    throw new AudioMediaFetchError("Provider returned an image instead of audio", {
      errorCode: "PROVIDER_MALFORMED_RESPONSE",
      quotaHeaders: responseQuotaHeaders,
    });
  }

  const declaredLength = Number(response.headers.get("content-length") || "0");

  if (declaredLength > options.maxBytes) {
    logDiagnostic(
      "media-too-large-declared",
      {
        target: summarizeUrl(url),
        declaredLength,
        maxBytes: options.maxBytes,
      },
      "warn",
    );

    throw new AudioMediaFetchError("Provider media exceeds the maximum size", {
      errorCode: "PROVIDER_REJECTED",
      quotaHeaders: responseQuotaHeaders,
    });
  }

  if (!response.body) {
    throw new AudioMediaFetchError("Provider media response was empty", {
      errorCode: "PROVIDER_MALFORMED_RESPONSE",
      quotaHeaders: responseQuotaHeaders,
    });
  }

  const counter = createByteLimitTransform(options.maxBytes);

  await pipeline(
    Readable.fromWeb(response.body),
    counter,
    createWriteStream(options.outputPath, { flags: "w" }),
  );

  logDiagnostic("media-file-written", {
    target: summarizeUrl(url),
    bytes: counter.bytes,
    contentType,
  });

  return {
    filePath: options.outputPath,
    contentType,
    contentLength: counter.bytes,
    sourceHost: url.hostname,
    quotaHeaders: responseQuotaHeaders,
  };
}

async function followValidatedRedirect(media, options, baseUrl, response) {
  const location = response.headers.get("location");
  const quotaHeaders = extractRapidApiQuotaHeaders(response.headers);

  if (!location) {
    throw new AudioMediaFetchError("Provider redirect did not include a location", {
      errorCode: "PROVIDER_MALFORMED_RESPONSE",
      status: response.status,
      quotaHeaders,
    });
  }

  if (options.redirectDepth >= MAX_REDIRECT_DEPTH) {
    throw new AudioMediaFetchError("Provider media URL redirected too many times", {
      errorCode: "PROVIDER_MALFORMED_RESPONSE",
      status: response.status,
      quotaHeaders,
    });
  }

  const nextUrl = await resolveAndValidateRedirectUrl(location, baseUrl);

  logDiagnostic("media-redirect", {
    from: summarizeUrl(baseUrl),
    to: summarizeUrl(nextUrl),
    status: response.status,
    redirectDepth: options.redirectDepth + 1,
  });

  const redirected = await fetchMediaUrl(
    {
      url: nextUrl.toString(),
      headers: shouldPreserveHeadersForRedirect(baseUrl, nextUrl) ? media.headers : {},
    },
    {
      ...options,
      redirectDepth: options.redirectDepth + 1,
    },
  );

  return {
    ...redirected,
    quotaHeaders: {
      ...quotaHeaders,
      ...redirected.quotaHeaders,
    },
  };
}

async function readSafeErrorPreview(response) {
  const contentType = response.headers.get("content-type") || "";

  if (!isJsonLikeContentType(contentType) && !looksLikeHtml(contentType)) {
    return null;
  }

  try {
    const text = await response.text();
    return sanitizeDiagnosticValue(text.slice(0, 500));
  } catch {
    return null;
  }
}

async function validateFetchUrl(value) {
  let url;

  try {
    url = new URL(value);
  } catch {
    throw new AudioMediaFetchError("Provider media URL is malformed", {
      errorCode: "PROVIDER_MALFORMED_RESPONSE",
    });
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new AudioMediaFetchError("Provider media URL protocol is not allowed", {
      errorCode: "PROVIDER_MALFORMED_RESPONSE",
    });
  }

  if (url.username || url.password) {
    throw new AudioMediaFetchError("Provider media URL credentials are not allowed", {
      errorCode: "PROVIDER_MALFORMED_RESPONSE",
    });
  }

  await rejectLocalNetworkHost(url.hostname);

  return url;
}

async function resolveAndValidateRedirectUrl(location, baseUrl) {
  let redirectUrl;

  try {
    redirectUrl = new URL(location, baseUrl);
  } catch (error) {
    throw new AudioMediaFetchError("Provider redirect location is malformed", {
      errorCode: "PROVIDER_MALFORMED_RESPONSE",
      cause: error,
    });
  }

  return validateFetchUrl(redirectUrl.toString());
}

async function rejectLocalNetworkHost(hostname) {
  await resolveValidatedPublicAddress(hostname);
}

async function resolveValidatedPublicAddress(hostname) {
  if (isBlockedHostname(hostname)) {
    throw new AudioMediaFetchError("Provider media URL host is not allowed", {
      errorCode: "PROVIDER_MALFORMED_RESPONSE",
    });
  }

  const directIpVersion = net.isIP(hostname);

  if (directIpVersion) {
    if (isPrivateIp(hostname, directIpVersion)) {
      throw new AudioMediaFetchError("Provider media URL IP is not allowed", {
        errorCode: "PROVIDER_MALFORMED_RESPONSE",
      });
    }

    return {
      address: hostname,
      family: directIpVersion,
    };
  }

  let records;

  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new AudioMediaFetchError("Provider media URL host could not be resolved", {
      errorCode: "PROVIDER_MALFORMED_RESPONSE",
    });
  }

  if (
    records.some((record) => isPrivateIp(record.address, net.isIP(record.address)))
  ) {
    throw new AudioMediaFetchError("Provider media URL resolves to a private IP", {
      errorCode: "PROVIDER_MALFORMED_RESPONSE",
    });
  }

  const first = records[0];

  if (!first?.address) {
    throw new AudioMediaFetchError("Provider media URL host could not be resolved", {
      errorCode: "PROVIDER_MALFORMED_RESPONSE",
    });
  }

  return {
    address: first.address,
    family: first.family || net.isIP(first.address) || 4,
  };
}

async function fetchWithPinnedAddress(url, init = {}) {
  const hostname = url.hostname;
  const pinned = await resolveValidatedPublicAddress(hostname);

  // IP literals need no custom lookup.
  if (net.isIP(hostname)) {
    return fetch(url, init);
  }

  try {
    const undici = await import("undici");
    const Agent = undici.Agent;
    const undiciFetch = undici.fetch;
    const agent = new Agent({
      connect: {
        lookup(host, _options, callback) {
          if (host === hostname) {
            callback(null, pinned.address, pinned.family);
            return;
          }

          callback(new Error("Unexpected host during pinned media fetch."));
        },
        servername: hostname,
      },
    });

    try {
      return await undiciFetch(url, {
        ...init,
        dispatcher: agent,
      });
    } finally {
      await agent.close().catch(() => {});
    }
  } catch (error) {
    // Fall back to global fetch if undici is unavailable in the runtime.
    if (error instanceof AudioMediaFetchError) {
      throw error;
    }

    return fetch(url, init);
  }
}

function isBlockedHostname(hostname) {
  const normalized = hostname.toLowerCase();

  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "0.0.0.0" ||
    normalized === "::"
  );
}

function isPrivateIp(address, version) {
  if (version === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;

    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0
    );
  }

  if (version === 6) {
    const normalized = address.toLowerCase();

    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:") ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:192.168.")
    );
  }

  return true;
}

function shouldPreserveHeadersForRedirect(fromUrl, toUrl) {
  return fromUrl.protocol === toUrl.protocol && fromUrl.hostname === toUrl.hostname;
}

function createByteLimitTransform(maxBytes) {
  let bytes = 0;

  const transform = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;

      if (bytes > maxBytes) {
        callback(
          new AudioMediaFetchError("Provider media exceeds the maximum size", {
            errorCode: "PROVIDER_REJECTED",
          }),
        );
        return;
      }

      callback(null, chunk);
    },
  });

  Object.defineProperty(transform, "bytes", {
    get() {
      return bytes;
    },
  });

  return transform;
}

async function readLimitedText(response, maxBytes) {
  const reader = Readable.fromWeb(response.body);
  const chunks = [];
  let bytes = 0;

  for await (const chunk of reader) {
    bytes += chunk.length;

    if (bytes > maxBytes) {
      throw new AudioMediaFetchError("Provider JSON response is too large", {
        errorCode: "PROVIDER_MALFORMED_RESPONSE",
      });
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function findNestedMediaIntent(body) {
  let parsed;

  try {
    parsed = JSON.parse(body);
  } catch {
    return findUrlIntentInText(body);
  }

  const mediaUrl = findMediaUrl(parsed)?.value;

  if (mediaUrl) {
    return {
      kind: "media",
      url: mediaUrl,
    };
  }

  const progressUrl = findProgressUrl(parsed)?.value;

  if (progressUrl) {
    return {
      kind: "progress",
      url: progressUrl,
    };
  }

  return null;
}

function findUrlIntentInText(body) {
  const matches = body.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  const mediaMatch = matches.find((value) => {
    try {
      return (
        !looksLikeImageUrl(value) &&
        /\.(mp3|m4a|aac|wav|ogg|opus|webm)(\b|$)/i.test(new URL(value).pathname)
      );
    } catch {
      return false;
    }
  });

  if (mediaMatch) {
    return {
      kind: "media",
      url: mediaMatch,
    };
  }

  const progressMatch = matches.find((value) => /progress|status|sse/i.test(value));
  return progressMatch
    ? {
        kind: "progress",
        url: progressMatch,
      }
    : null;
}

function isProbablyProcessing(body) {
  const lowered = body.toLowerCase();

  return (
    lowered.includes("processing") ||
    lowered.includes("progress") ||
    lowered.includes("in process") ||
    lowered.includes("converting") ||
    lowered.includes("pending")
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isJsonLikeContentType(contentType) {
  const lowered = contentType.toLowerCase();
  return TEXT_BODY_TYPES.some((type) => lowered.includes(type));
}

function looksLikeHtml(contentType) {
  return contentType.toLowerCase().includes("text/html");
}
