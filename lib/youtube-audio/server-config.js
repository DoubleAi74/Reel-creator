import os from "node:os";
import path from "node:path";

import {
  DEFAULT_YOUTUBE_AUDIO_PROVIDER_ID,
  isAutomaticYoutubeAudioProviderId,
  isYoutubeAudioProviderId,
} from "./provider-options";

const DEFAULT_TMP_DIR_NAME = "youtube-mp3-segments";
const DEFAULT_MAX_SOURCE_BYTES = 150 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_QUEUE_DEPTH = 20;
const DEFAULT_MAX_ACTIVE_PER_SESSION = 2;

const PROVIDER_HOSTS = {
  "youtube-mp36": "youtube-mp36.p.rapidapi.com",
  "youtube-mp3-2025": "youtube-mp3-2025.p.rapidapi.com",
};

export function isYoutubeAudioConfigured() {
  return Boolean(process.env.RAPIDAPI_YOUTUBE_MP3_KEY?.trim());
}

export function getYoutubeAudioConfig() {
  const rapidApiKey = process.env.RAPIDAPI_YOUTUBE_MP3_KEY;
  const tmpDir = process.env.YT_MP3_TMP_DIR
    ? path.resolve(process.env.YT_MP3_TMP_DIR)
    : path.join(os.tmpdir(), DEFAULT_TMP_DIR_NAME);
  const defaultProviderId =
    process.env.YT_AUDIO_DEFAULT_PROVIDER || DEFAULT_YOUTUBE_AUDIO_PROVIDER_ID;

  if (!rapidApiKey?.trim()) {
    const error = new Error("Missing RAPIDAPI_YOUTUBE_MP3_KEY.");
    error.errorCode = "FEATURE_DISABLED";
    throw error;
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
    maxQueueDepth: readPositiveIntegerEnv(
      "YT_AUDIO_MAX_QUEUE_DEPTH",
      DEFAULT_MAX_QUEUE_DEPTH,
    ),
    maxActivePerSession: readPositiveIntegerEnv(
      "YT_AUDIO_MAX_ACTIVE_PER_SESSION",
      DEFAULT_MAX_ACTIVE_PER_SESSION,
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
