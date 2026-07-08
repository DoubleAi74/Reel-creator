import { getYoutubeAudioProviderHost } from "../server-config.js";
import { rapidApiHeaders } from "./rapidapi-client.js";

export const youtubeInfoDownloadProvider = {
  id: "youtube-info-download-api",
  name: "Info Download API",
  async prepare(input, config) {
    const host = getYoutubeAudioProviderHost(this.id, config);
    const url = new URL(`https://${host}/ajax/download.php`);
    url.searchParams.set("format", input.preferredFormat || "m4a");
    url.searchParams.set("add_info", "0");
    url.searchParams.set("url", input.url);
    url.searchParams.set("audio_quality", "128");
    url.searchParams.set("allow_extended_duration", "false");
    url.searchParams.set("no_merge", "false");
    url.searchParams.set("audio_language", "en");

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
        endpoint: "/ajax/download.php",
        format: input.preferredFormat || "m4a",
      },
    };
  },
};
