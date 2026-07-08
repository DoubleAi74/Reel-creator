import os from "node:os";
import path from "node:path";
import {
  DEFAULT_YOUTUBE_AUDIO_PROVIDER_ID,
  isAutomaticYoutubeAudioProviderId,
  isYoutubeAudioProviderId,
} from "./provider-options.js";

const DEFAULT_RAPIDAPI_YOUTUBE_MP3_HOST = "youtube-to-mp315.p.rapidapi.com";
const DEFAULT_TMP_DIR_NAME = "youtube-mp3-segments";
const PROVIDER_HOSTS = {
  "youtube-mp36": "youtube-mp36.p.rapidapi.com",
  "youtube-info-download-api": "youtube-info-download-api.p.rapidapi.com",
  "youtube-mp3-2025": "youtube-mp3-2025.p.rapidapi.com",
};

const DEFAULT_MAX_SOURCE_BYTES = 150 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 50 * 1024 * 1024;

export function getYoutubeMp3Config() {
  const rapidApiKey = process.env.RAPIDAPI_YOUTUBE_MP3_KEY;
  const rapidApiHost =
    process.env.RAPIDAPI_YOUTUBE_MP3_HOST ||
    DEFAULT_RAPIDAPI_YOUTUBE_MP3_HOST;
  const tmpDir = process.env.YT_MP3_TMP_DIR
    ? path.resolve(process.env.YT_MP3_TMP_DIR)
    : path.join(os.tmpdir(), DEFAULT_TMP_DIR_NAME);

  if (!rapidApiKey || !rapidApiKey.trim()) {
    throw new Error("Missing RAPIDAPI_YOUTUBE_MP3_KEY in .env.local");
  }

  if (!rapidApiHost.trim()) {
    throw new Error("Missing RAPIDAPI_YOUTUBE_MP3_HOST");
  }

  return {
    rapidApiKey,
    rapidApiHost,
    apiBaseUrl: `https://${rapidApiHost}`,
    tmpDir,
  };
}

export function getYoutubeAudioConfig() {
  const rapidApiKey = process.env.RAPIDAPI_YOUTUBE_MP3_KEY;
  const tmpDir = process.env.YT_MP3_TMP_DIR
    ? path.resolve(process.env.YT_MP3_TMP_DIR)
    : path.join(os.tmpdir(), DEFAULT_TMP_DIR_NAME);
  const defaultProviderId =
    process.env.YT_AUDIO_DEFAULT_PROVIDER || DEFAULT_YOUTUBE_AUDIO_PROVIDER_ID;

  if (!rapidApiKey || !rapidApiKey.trim()) {
    throw new Error("Missing RAPIDAPI_YOUTUBE_MP3_KEY in .env.local");
  }

  if (
    !isYoutubeAudioProviderId(defaultProviderId) &&
    !isAutomaticYoutubeAudioProviderId(defaultProviderId)
  ) {
    throw new Error(`Unknown YT_AUDIO_DEFAULT_PROVIDER: ${defaultProviderId}`);
  }

  return {
    rapidApiKey,
    tmpDir,
    defaultProviderId,
    providerHosts: { ...PROVIDER_HOSTS },
    maxSourceBytes: readPositiveIntegerEnv(
      "YT_AUDIO_MAX_SOURCE_BYTES",
      DEFAULT_MAX_SOURCE_BYTES,
    ),
    maxOutputBytes: readPositiveIntegerEnv(
      "YT_AUDIO_MAX_OUTPUT_BYTES",
      DEFAULT_MAX_OUTPUT_BYTES,
    ),
  };
}

export function getYoutubeAudioProviderHost(providerId, config = getYoutubeAudioConfig()) {
  const host = config.providerHosts[providerId];

  if (!host) {
    throw new Error(`Unknown YouTube audio provider: ${providerId}`);
  }

  return host;
}

function readPositiveIntegerEnv(name, fallback) {
  const raw = process.env[name];

  if (!raw) {
    return fallback;
  }

  const value = Number(raw);

  return Number.isInteger(value) && value > 0 ? value : fallback;
}
