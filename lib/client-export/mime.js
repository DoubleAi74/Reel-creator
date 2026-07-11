/**
 * Pick a MediaRecorder MIME type supported in this browser.
 * Chrome/Edge: WebM. Safari may support mp4 in newer versions.
 */
export function pickClientExportMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }

  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4;codecs=h264,aac",
    "video/mp4",
  ];

  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }

  return "";
}

export function extensionForMimeType(mimeType) {
  const type = String(mimeType || "").toLowerCase();

  if (type.includes("mp4")) {
    return "mp4";
  }

  return "webm";
}

export function formatLabelForMimeType(mimeType) {
  return extensionForMimeType(mimeType).toUpperCase();
}

export function isClientExportSupported() {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getDisplayMedia) &&
    pickClientExportMimeType() !== null
  );
}

/** Shown when tab capture export is unavailable (typically mobile). */
export const MOBILE_EXPORT_UNAVAILABLE_MESSAGE =
  "This is a prototype — export isn’t available on mobile yet (it will be later). For now, expand the preview and use your phone’s built-in screen recorder, then crop the video in your Photos/settings.";
