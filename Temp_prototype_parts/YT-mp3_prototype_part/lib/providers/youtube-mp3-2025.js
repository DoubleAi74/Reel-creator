import { extractYouTubeVideoId } from "../youtube-url.js";
import { getYoutubeAudioProviderHost } from "../server-config.js";
import { YoutubeAudioProviderError, rapidApiHeaders } from "./rapidapi-client.js";

export const youtubeMp32025Provider = {
  id: "youtube-mp3-2025",
  name: "YouTube MP3 2025",
  async prepare(input, config) {
    const videoId = extractYouTubeVideoId(input.url);

    if (!videoId) {
      throw new YoutubeAudioProviderError("Invalid YouTube video URL", {
        errorCode: "INVALID_INPUT",
      });
    }

    const host = getYoutubeAudioProviderHost(this.id, config);
    const url = new URL(`https://${host}/v1/social/youtube/audio`);
    url.searchParams.set("id", videoId);
    url.searchParams.set("quality", "128kbps");
    url.searchParams.set("ext", input.preferredFormat || "m4a");

    return {
      providerId: this.id,
      providerName: this.name,
      title: null,
      sourceDurationSeconds: null,
      mediaUrl: url.toString(),
      mediaHeaders: rapidApiHeaders(config, host, {
        "Content-Type": "application/json",
      }),
      mediaFormat: input.preferredFormat || "m4a",
      trimMode: "local",
      raw: {
        endpoint: "/v1/social/youtube/audio",
        format: input.preferredFormat || "m4a",
      },
    };
  },
};
