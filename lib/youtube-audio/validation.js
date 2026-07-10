import { DEFAULT_YOUTUBE_AUDIO_PROVIDER_ID } from "./provider-options";
import { extractYouTubeVideoId } from "./youtube-url";

export const MIN_SEGMENT_SECONDS = 1;
export const MAX_SEGMENT_SECONDS = 6 * 60;

export function parseYoutubeAudioSegmentRequest(value) {
  const issues = [];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return failed("INVALID_INPUT", [{ path: [], message: "Request body must be an object" }]);
  }

  const url = typeof value.url === "string" ? value.url.trim() : "";
  const startTime = Number(value.startTime);
  const endTime = Number(value.endTime);

  if (!url || !extractYouTubeVideoId(url)) {
    issues.push({ path: ["url"], message: "Enter a valid YouTube link" });
  }

  if (!Number.isFinite(startTime) || startTime < 0) {
    issues.push({ path: ["startTime"], message: "startTime must be a non-negative number" });
  }

  if (!Number.isFinite(endTime) || endTime <= 0) {
    issues.push({ path: ["endTime"], message: "endTime must be a positive number" });
  }

  if (Number.isFinite(startTime) && Number.isFinite(endTime)) {
    if (endTime <= startTime) {
      issues.push({ path: ["endTime"], message: "endTime must be greater than startTime" });
    }

    const duration = endTime - startTime;

    if (duration < MIN_SEGMENT_SECONDS) {
      issues.push({ path: ["endTime"], message: "Requested segment is shorter than 1 second" });
    }

    if (duration > MAX_SEGMENT_SECONDS) {
      issues.push({
        path: ["endTime"],
        message: "Requested segment exceeds the 6-minute application limit",
      });
    }
  }

  if (issues.length > 0) {
    const segmentTooLong = issues.some((issue) => issue.message.includes("6-minute"));
    return failed(segmentTooLong ? "SEGMENT_TOO_LONG" : "INVALID_INPUT", issues);
  }

  return {
    success: true,
    data: {
      url,
      startTime,
      endTime,
      providerId: DEFAULT_YOUTUBE_AUDIO_PROVIDER_ID,
    },
  };
}

function failed(errorCode, issues) {
  return {
    success: false,
    errorCode,
    error: { issues },
  };
}
