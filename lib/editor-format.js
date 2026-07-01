// Pure formatting/display helpers and constants shared by the editor shell and
// its extracted tab/region components. Moved verbatim out of editor-shell.js —
// no logic changes. Only the helpers actually referenced by extracted files live
// here; shell-only helpers stay in editor-shell.js.
import { getSectionBounds } from "@/lib/timing";

export const SECTIONS = [
  { id: "audio", label: "Audio" },
  { id: "lyrics", label: "Lyrics" },
  { id: "style", label: "Style" },
];

export const SOURCE_LANGUAGE_OPTIONS = [
  { id: "auto", label: "Auto-detect" },
  { id: "hi", label: "Hindi" },
  { id: "es", label: "Spanish" },
  { id: "fr", label: "French" },
  { id: "ja", label: "Japanese" },
  { id: "ko", label: "Korean" },
  { id: "ar", label: "Arabic" },
  { id: "zh", label: "Chinese" },
  { id: "other", label: "Other" },
];

export function formatTime(totalSeconds) {
  const wholeSeconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const seconds = wholeSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatPreciseTime(totalSeconds) {
  if (!Number.isFinite(totalSeconds)) {
    return "";
  }

  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds - minutes * 60;

  return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(2).padStart(5, "0")}`;
}

export function formatBytes(sizeBytes) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "0 B";
  }

  if (sizeBytes < 1024 * 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`;
  }

  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatSectionRelativeTime(totalSeconds, audio = {}) {
  if (!Number.isFinite(totalSeconds)) {
    return "";
  }

  const { startOffset } = getSectionBounds(audio);

  return formatPreciseTime(Math.max(0, totalSeconds - startOffset));
}

export function isBackgroundMediaType(backgroundType) {
  return backgroundType === "image" || backgroundType === "video";
}

export function getLineSummary(line) {
  if (!line) {
    return "";
  }

  return line.translation
    ? `${line.original} — ${line.translation}`
    : line.original;
}
