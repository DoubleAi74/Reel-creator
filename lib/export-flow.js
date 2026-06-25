import { MAX_SECTION_DURATION_SECONDS } from "./timing";

export const EXPORT_POLL_INTERVAL_MS = 1500;
export const EXPORT_POLL_MAX_INTERVAL_MS = 8000;

function clampProgress(progress) {
  if (!Number.isFinite(progress)) {
    return 0;
  }

  return Math.min(1, Math.max(0, progress));
}

export function getExportReadiness({
  audioAssetId,
  backgroundAssetId,
  backgroundDurationSec,
  backgroundType,
  sectionWithinLimit,
  transparent = false,
}) {
  if (!audioAssetId) {
    return {
      canExport: false,
      reason: "Upload an MP3 in this session before exporting.",
    };
  }

  if (!sectionWithinLimit) {
    return {
      canExport: false,
      reason: `Trim the selected section to ${Math.floor(
        MAX_SECTION_DURATION_SECONDS / 60,
      )}:00 or shorter before exporting.`,
    };
  }

  // The transparent text-only layer ignores the background entirely, so the
  // background upload requirements below do not apply.
  if (transparent) {
    return {
      canExport: true,
      reason: "",
    };
  }

  if (backgroundType === "image" && !backgroundAssetId) {
    return {
      canExport: false,
      reason: "Upload a background image in this session before exporting.",
    };
  }

  if (backgroundType === "video" && !backgroundAssetId) {
    return {
      canExport: false,
      reason: "Upload a background video in this session before exporting.",
    };
  }

  if (
    backgroundType === "video" &&
    !(Number.isFinite(backgroundDurationSec) && backgroundDurationSec > 0)
  ) {
    return {
      canExport: false,
      reason:
        "This background video could not be read. Re-upload a short MP4 or WebM clip before exporting.",
    };
  }

  return {
    canExport: true,
    reason: "",
  };
}

export function getRenderPollDelayMs(failureCount = 0) {
  const safeFailureCount =
    Number.isFinite(failureCount) && failureCount > 0 ? Math.floor(failureCount) : 0;

  return Math.min(
    EXPORT_POLL_INTERVAL_MS * 2 ** safeFailureCount,
    EXPORT_POLL_MAX_INTERVAL_MS,
  );
}

export function getRenderProgressPercent(status, progress) {
  const normalizedPercent = Math.round(clampProgress(progress) * 100);

  if (status === "done") {
    return 100;
  }

  if (status === "rendering") {
    return Math.max(5, normalizedPercent);
  }

  if (status === "queued") {
    return Math.max(2, normalizedPercent);
  }

  return normalizedPercent;
}

export function getRenderStatusLabel(status) {
  if (status === "done") {
    return "Ready";
  }

  if (status === "error") {
    return "Needs attention";
  }

  if (status === "rendering") {
    return "Rendering";
  }

  if (status === "queued") {
    return "Queued";
  }

  return "Preparing";
}
