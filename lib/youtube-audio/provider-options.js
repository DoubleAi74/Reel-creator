export const AUTO_YOUTUBE_AUDIO_PROVIDER_ID = "auto";
export const PRIMARY_YOUTUBE_AUDIO_PROVIDER_ID = "youtube-mp36";
export const FALLBACK_YOUTUBE_AUDIO_PROVIDER_ID = "youtube-mp3-2025";
export const DEFAULT_YOUTUBE_AUDIO_PROVIDER_ID = AUTO_YOUTUBE_AUDIO_PROVIDER_ID;

export const YOUTUBE_AUDIO_FALLBACK_PROVIDER_IDS = [
  PRIMARY_YOUTUBE_AUDIO_PROVIDER_ID,
  FALLBACK_YOUTUBE_AUDIO_PROVIDER_ID,
];

export const YOUTUBE_AUDIO_PROVIDER_OPTIONS = [
  {
    id: AUTO_YOUTUBE_AUDIO_PROVIDER_ID,
    name: "Automatic fallback",
    shortName: "Automatic",
    trimMode: "auto",
    automatic: true,
  },
  {
    id: PRIMARY_YOUTUBE_AUDIO_PROVIDER_ID,
    name: "YouTube MP3 / ytjar",
    shortName: "ytjar",
    trimMode: "provider",
  },
  {
    id: FALLBACK_YOUTUBE_AUDIO_PROVIDER_ID,
    name: "YouTube MP3 2025",
    shortName: "MP3 2025",
    trimMode: "local",
  },
];

export const YOUTUBE_AUDIO_PROVIDER_IDS = YOUTUBE_AUDIO_PROVIDER_OPTIONS.map(
  (provider) => provider.id,
);

export function getYoutubeAudioProviderOption(providerId) {
  return (
    YOUTUBE_AUDIO_PROVIDER_OPTIONS.find((provider) => provider.id === providerId) ||
    null
  );
}

export function isYoutubeAudioProviderId(providerId) {
  return Boolean(getYoutubeAudioProviderOption(providerId));
}

export function isAutomaticYoutubeAudioProviderId(providerId) {
  return providerId === AUTO_YOUTUBE_AUDIO_PROVIDER_ID;
}
