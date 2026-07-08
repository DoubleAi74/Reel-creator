import { extractYouTubeVideoId } from "../youtube-url.js";
import { getYoutubeAudioProviderHost } from "../server-config.js";
import { logDiagnostic } from "../diagnostics.js";
import {
  YoutubeAudioProviderError,
  rapidApiFetchJsonWithMeta,
  rapidApiHeaders,
} from "./rapidapi-client.js";
import { formatHms, sanitizeProviderBody } from "./provider-utils.js";

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
        errorCode: status && status !== "ok" ? "PROVIDER_REJECTED" : "PROVIDER_MALFORMED_RESPONSE",
        cause: sanitizeProviderBody(body),
      });
    }

    if (status && status !== "ok" && status !== "success") {
      throw new YoutubeAudioProviderError("Provider rejected the conversion", {
        errorCode: "PROVIDER_REJECTED",
        cause: sanitizeProviderBody(body),
      });
    }

    return {
      providerId: this.id,
      providerName: this.name,
      title: typeof body.title === "string" ? body.title : null,
      sourceDurationSeconds: numberOrNull(body.duration),
      mediaUrl: link,
      mediaHeaders: {},
      mediaFormat: "mp3",
      trimMode: "provider",
      quotaHeaders,
      raw: sanitizeProviderBody(body),
    };
  },
};

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
