import {
  DEFAULT_YOUTUBE_AUDIO_PROVIDER_ID,
  YOUTUBE_AUDIO_PROVIDER_OPTIONS,
  getYoutubeAudioProviderOption,
} from "../provider-options.js";
import { getYoutubeAudioConfig } from "../server-config.js";
import { youtubeInfoDownloadProvider } from "./youtube-info-download-api.js";
import { youtubeMp32025Provider } from "./youtube-mp3-2025.js";
import { youtubeMp36Provider } from "./youtube-mp36.js";
import { YoutubeAudioProviderError } from "./rapidapi-client.js";

const providers = new Map(
  [youtubeMp36Provider, youtubeInfoDownloadProvider, youtubeMp32025Provider].map(
    (provider) => [provider.id, provider],
  ),
);

export { YoutubeAudioProviderError };

export function listYoutubeAudioProviders() {
  return YOUTUBE_AUDIO_PROVIDER_OPTIONS;
}

export function getYoutubeAudioProvider(providerId) {
  const resolvedProviderId = providerId || DEFAULT_YOUTUBE_AUDIO_PROVIDER_ID;
  return providers.get(resolvedProviderId) || null;
}

export function getYoutubeAudioProviderDisplayName(providerId) {
  return getYoutubeAudioProviderOption(providerId)?.name || providerId;
}

export async function prepareYoutubeAudioMedia(input, options = {}) {
  const config = options.config || getYoutubeAudioConfig();
  const providerId = input.providerId || config.defaultProviderId;
  const provider = getYoutubeAudioProvider(providerId);

  if (!provider) {
    throw new YoutubeAudioProviderError(`Unknown provider: ${providerId}`, {
      errorCode: "INVALID_PROVIDER",
    });
  }

  return provider.prepare(input, config);
}
