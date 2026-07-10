import { logDiagnostic } from "../diagnostics";
import { getYoutubeAudioProviderHost } from "../server-config";
import { extractYouTubeVideoId } from "../youtube-url";
import {
  YoutubeAudioProviderError,
  rapidApiFetchJsonWithMeta,
  rapidApiHeaders,
} from "./rapidapi-client";
import { formatHms, sanitizeProviderBody } from "./provider-utils";

const MAX_ATTEMPTS = 30;
const POLL_DELAY_MS = 2500;

export const youtubeMp36Provider = {
  id: "youtube-mp36",
  name: "YouTube MP3 / ytjar",
  async prepare(input, config) {
    const videoId = extractYouTubeVideoId(input.url);

    if (!videoId) {
      throw new YoutubeAudioProviderError("Invalid YouTube video URL", {
        errorCode: "INVALID_INPUT",
      });
    }

    const host = getYoutubeAudioProviderHost(this.id, config);
    const url = new URL(`https://${host}/dl`);
    url.searchParams.set("id", videoId);
    url.searchParams.set("cut", "1");
    url.searchParams.set("sStart", formatHms(input.startTime, "floor"));
    url.searchParams.set("sEnd", formatHms(input.endTime, "ceil"));

    const { body, quotaHeaders } = await waitForMp36Result(url, config, host);

    if (!body || typeof body !== "object") {
      throw new YoutubeAudioProviderError("Provider response was empty", {
        errorCode: "PROVIDER_MALFORMED_RESPONSE",
      });
    }

    const status = String(body.status || "").toLowerCase();
    const link = typeof body.link === "string" ? body.link.trim() : "";

    if (!link) {
      throw new YoutubeAudioProviderError("Provider response did not include a link", {
        errorCode:
          status && status !== "ok" ? "PROVIDER_REJECTED" : "PROVIDER_MALFORMED_RESPONSE",
        cause: sanitizeProviderBody(body),
        quotaHeaders,
      });
    }

    if (status && status !== "ok" && status !== "success") {
      throw new YoutubeAudioProviderError("Provider rejected the conversion", {
        errorCode: "PROVIDER_REJECTED",
        cause: sanitizeProviderBody(body),
        quotaHeaders,
      });
    }

    return {
      providerId: this.id,
      providerName: this.name,
      title: typeof body.title === "string" ? body.title : null,
      sourceDurationSeconds: numberOrNull(body.duration),
      mediaUrl: link,
      // ytjar CDN 404s "unusual" downloads without RapidAPI username in User-Agent.
      mediaHeaders: buildMp36MediaHeaders(config),
      mediaFormat: "mp3",
      trimMode: "provider",
      quotaHeaders,
      raw: sanitizeProviderBody(body),
    };
  },
};

/**
 * Media CDN whitelist: append RapidAPI account username to User-Agent.
 * Without this, many Vercel egress IPs get HTTP 404 on the returned link.
 * @see https://rapidapi.com/ytjar/api/youtube-mp36 (whitelist / 404 tutorial)
 */
export function buildMp36MediaHeaders(config = {}) {
  const username = String(config.rapidApiUsername || "").trim();
  const baseUa =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

  return {
    "User-Agent": username ? `${baseUa} ${username}` : baseUa,
    Accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.8",
  };
}

async function waitForMp36Result(url, config, host) {
  let lastBody = null;
  let lastQuotaHeaders = {};

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { body, quotaHeaders } = await rapidApiFetchJsonWithMeta(url, {
      method: "GET",
      headers: rapidApiHeaders(config, host, {
        "Content-Type": "application/json",
      }),
    });

    lastBody = body;
    lastQuotaHeaders = quotaHeaders;

    const status = String(body?.status || "").toLowerCase();
    const msg = String(body?.msg || "").toLowerCase();
    const link = typeof body?.link === "string" ? body.link.trim() : "";
    const progress = Number(body?.progress);

    logDiagnostic("youtube-mp36-status", {
      attempt,
      status,
      msg,
      progress: Number.isFinite(progress) ? progress : null,
      hasLink: Boolean(link),
      quotaHeaders,
    });

    if (link && ["ok", "success", "done", "complete", "completed"].includes(status)) {
      return { body, quotaHeaders };
    }

    if (link && !status && msg === "success") {
      return { body, quotaHeaders };
    }

    if (isTerminalFailure(status, msg)) {
      break;
    }

    if (attempt < MAX_ATTEMPTS) {
      await delay(POLL_DELAY_MS);
    }
  }

  return {
    body: lastBody,
    quotaHeaders: lastQuotaHeaders,
  };
}

function isTerminalFailure(status, msg) {
  return (
    ["error", "failed", "failure", "rejected"].includes(status) ||
    msg.includes("error") ||
    msg.includes("failed")
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function numberOrNull(value) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? number : null;
}
