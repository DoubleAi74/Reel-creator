import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const DEFAULT_RAPIDAPI_YOUTUBE_MP3_HOST = "youtube-to-mp315.p.rapidapi.com";
const YOUTUBE_AUDIO_PROVIDER_IDS = [
  "youtube-mp36",
  "youtube-info-download-api",
  "youtube-mp3-2025",
];

function validateRapidApiConfig() {
  const key = process.env.RAPIDAPI_YOUTUBE_MP3_KEY;

  if (!key || !key.trim()) {
    throw new Error("Missing RAPIDAPI_YOUTUBE_MP3_KEY in .env.local");
  }

  const host =
    process.env.RAPIDAPI_YOUTUBE_MP3_HOST ||
    DEFAULT_RAPIDAPI_YOUTUBE_MP3_HOST;

  if (!host.trim()) {
    throw new Error("Missing RAPIDAPI_YOUTUBE_MP3_HOST");
  }

  const defaultProvider = process.env.YT_AUDIO_DEFAULT_PROVIDER;

  if (defaultProvider && !YOUTUBE_AUDIO_PROVIDER_IDS.includes(defaultProvider)) {
    throw new Error(`Unknown YT_AUDIO_DEFAULT_PROVIDER: ${defaultProvider}`);
  }
}

validateRapidApiConfig();

const nextConfig = {};

export default nextConfig;
