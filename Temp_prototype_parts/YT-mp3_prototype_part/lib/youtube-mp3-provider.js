import { z } from "zod";
import { getYoutubeMp3Config } from "./server-config.js";

const PROVIDER_TIMEOUT_MS = 20_000;

const startResponseSchema = z
  .object({
    id: z.string().min(1),
  })
  .passthrough();

const statusResponseSchema = z
  .object({
    id: z.string().min(1).optional(),
    status: z.string().min(1).optional().nullable(),
    downloadUrl: z.string().min(1).optional().nullable(),
  })
  .passthrough();

export class YoutubeMp3ProviderError extends Error {
  constructor(message, { errorCode = "INTERNAL_ERROR", status, cause } = {}) {
    super(message);
    this.name = "YoutubeMp3ProviderError";
    this.errorCode = errorCode;
    this.status = status;
    this.cause = cause;
  }
}

export function buildDownloadRequestUrl(input, config = getYoutubeMp3Config()) {
  const url = new URL(`${config.apiBaseUrl}/download`);
  url.searchParams.set("url", input.url);
  url.searchParams.set("format", "mp3");
  url.searchParams.set("startTime", String(input.startTime));
  url.searchParams.set("endTime", String(input.endTime));

  if (input.quality !== undefined) {
    url.searchParams.set("quality", String(input.quality));
  }

  return url;
}

export async function startYoutubeMp3Conversion(input, options = {}) {
  const config = options.config || getYoutubeMp3Config();
  const response = await providerFetch(
    buildDownloadRequestUrl(input, config),
    {
      method: "POST",
      headers: rapidApiHeaders(config),
      signal: AbortSignal.timeout(options.timeoutMs || PROVIDER_TIMEOUT_MS),
    },
  );

  return normalizeStartResponse(response);
}

export async function getYoutubeMp3ConversionStatus(providerJobId, options = {}) {
  const config = options.config || getYoutubeMp3Config();
  const response = await providerFetch(
    `${config.apiBaseUrl}/status/${encodeURIComponent(providerJobId)}`,
    {
      method: "GET",
      headers: rapidApiHeaders(config),
      signal: AbortSignal.timeout(options.timeoutMs || PROVIDER_TIMEOUT_MS),
    },
  );

  return normalizeStatusResponse(response);
}

export function normalizeStartResponse(raw) {
  const parsed = startResponseSchema.safeParse(raw);

  if (!parsed.success) {
    throw new YoutubeMp3ProviderError(
      "Provider /download response did not include an id field",
      {
        errorCode: "PROVIDER_MALFORMED_RESPONSE",
        cause: parsed.error,
      },
    );
  }

  return {
    providerJobId: parsed.data.id,
    raw,
  };
}

export function normalizeStatusResponse(raw) {
  const parsed = statusResponseSchema.safeParse(raw);

  if (!parsed.success) {
    throw new YoutubeMp3ProviderError(
      "Provider /status response did not match the confirmed schema",
      {
        errorCode: "PROVIDER_MALFORMED_RESPONSE",
        cause: parsed.error,
      },
    );
  }

  const statusValue = (parsed.data.status || "").trim();
  const normalizedStatus = statusValue.toLowerCase();
  const downloadUrl = parsed.data.downloadUrl || undefined;

  if (
    ["failed", "error", "conversion_error", "cancelled", "canceled"].includes(
      normalizedStatus,
    )
  ) {
    return {
      state: "failed",
      providerStatus: statusValue,
      raw,
    };
  }

  if (downloadUrl) {
    return {
      state: "complete",
      downloadUrl,
      providerStatus: statusValue || null,
      raw,
    };
  }

  if (["done", "completed", "complete", "success", "finished"].includes(normalizedStatus)) {
    return {
      state: "complete",
      downloadUrl: undefined,
      providerStatus: statusValue,
      raw,
    };
  }

  if (["queued", "pending", "waiting", "created"].includes(normalizedStatus)) {
    return {
      state: "queued",
      providerStatus: statusValue,
      raw,
    };
  }

  if (["processing", "running", "converting", "downloading"].includes(normalizedStatus)) {
    return {
      state: "processing",
      providerStatus: statusValue,
      raw,
    };
  }

  return {
    state: "unknown",
    providerStatus: statusValue || null,
    raw,
  };
}

async function providerFetch(url, init) {
  let response;

  try {
    response = await fetch(url, {
      ...init,
      cache: "no-store",
    });
  } catch (error) {
    throw new YoutubeMp3ProviderError("YouTube MP3 provider request failed", {
      errorCode: "PROVIDER_TIMEOUT",
      cause: error,
    });
  }

  const body = await readProviderBody(response);

  if (!response.ok) {
    throw new YoutubeMp3ProviderError(
      `YouTube MP3 provider returned HTTP ${response.status}`,
      {
        errorCode: mapProviderHttpStatus(response.status),
        status: response.status,
        cause: body,
      },
    );
  }

  return body;
}

async function readProviderBody(response) {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return {
      unparsedBody: text,
    };
  }
}

function rapidApiHeaders(config) {
  return {
    "X-RapidAPI-Key": config.rapidApiKey,
    "X-RapidAPI-Host": config.rapidApiHost,
  };
}

function mapProviderHttpStatus(status) {
  if (status === 401 || status === 403) {
    return "PROVIDER_AUTH_FAILED";
  }

  if (status === 429) {
    return "PROVIDER_RATE_LIMITED";
  }

  if (status === 408 || status === 504) {
    return "PROVIDER_TIMEOUT";
  }

  if (status >= 500) {
    return "CONVERSION_FAILED";
  }

  if (status === 400 || status === 422) {
    return "PROVIDER_REJECTED";
  }

  return "INTERNAL_ERROR";
}
