export function formatHms(totalSeconds, rounding = "floor") {
  const rounded =
    rounding === "ceil" ? Math.ceil(totalSeconds || 0) : Math.floor(totalSeconds || 0);
  const safeSeconds = Math.max(0, rounded);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  return [hours, minutes, seconds]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":");
}

export function findUrl(value, pathParts = []) {
  return findMediaUrl(value, pathParts);
}

export function findMediaUrl(value, pathParts = []) {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const result = findMediaUrl(value[index], [...pathParts, String(index)]);

      if (result) {
        return result;
      }
    }

    return null;
  }

  const preferredKeys = [
    "downloadUrl",
    "download_url",
    "downloadLink",
    "download_link",
    "download",
    "mediaUrl",
    "media_url",
    "audioUrl",
    "audio_url",
    "link",
    "url",
    "href",
  ];

  for (const key of preferredKeys) {
    const candidate = value[key];

    if (looksLikeFinalMediaUrl(candidate, key)) {
      return {
        path: [...pathParts, key].join("."),
        value: candidate,
      };
    }
  }

  for (const [key, entry] of Object.entries(value)) {
    if (looksLikeFinalMediaUrl(entry, key)) {
      return {
        path: [...pathParts, key].join("."),
        value: entry,
      };
    }
  }

  for (const [key, entry] of Object.entries(value)) {
    const result = findMediaUrl(entry, [...pathParts, key]);

    if (result) {
      return result;
    }
  }

  return null;
}

export function findProgressUrl(value, pathParts = []) {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const result = findProgressUrl(value[index], [...pathParts, String(index)]);

      if (result) {
        return result;
      }
    }

    return null;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (looksLikeProgressUrl(entry, key)) {
      return {
        path: [...pathParts, key].join("."),
        value: entry,
      };
    }
  }

  for (const [key, entry] of Object.entries(value)) {
    const result = findProgressUrl(entry, [...pathParts, key]);

    if (result) {
      return result;
    }
  }

  return null;
}

export function looksLikeExternalMediaUrl(value) {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value)) {
    return false;
  }

  try {
    const url = new URL(value);
    return !/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(url.hostname);
  } catch {
    return false;
  }
}

export function looksLikeFinalMediaUrl(value, keyName = "") {
  if (!looksLikeExternalMediaUrl(value)) {
    return false;
  }

  if (looksLikeImageUrl(value) || looksLikeProgressUrl(value, keyName)) {
    return false;
  }

  const key = String(keyName).toLowerCase();
  const url = new URL(value);
  const pathname = url.pathname.toLowerCase();

  return (
    /\.(mp3|m4a|aac|wav|ogg|opus|webm)(\b|$)/i.test(pathname) ||
    key.includes("download") ||
    key.includes("audio") ||
    key.includes("media") ||
    key === "link"
  );
}

export function looksLikeProgressUrl(value, keyName = "") {
  if (!looksLikeExternalMediaUrl(value)) {
    return false;
  }

  const key = String(keyName).toLowerCase();
  const url = new URL(value);
  const pathname = url.pathname.toLowerCase();

  return (
    key.includes("progress") ||
    key.includes("status") ||
    key.includes("task") ||
    pathname.includes("progress") ||
    pathname.includes("status") ||
    pathname.includes("sse")
  );
}

export function looksLikeImageUrl(value) {
  if (!looksLikeExternalMediaUrl(value)) {
    return false;
  }

  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();

  return (
    host.includes("ytimg.com") ||
    /\.(jpg|jpeg|png|gif|webp|avif)(\b|$)/i.test(pathname) ||
    pathname.includes("thumbnail") ||
    pathname.includes("hqdefault")
  );
}

export function sanitizeProviderBody(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeProviderBody);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        const lowered = key.toLowerCase();
        const redact =
          lowered.includes("url") ||
          lowered.includes("link") ||
          lowered.includes("href") ||
          lowered.includes("token") ||
          lowered.includes("signature");

        if (redact && typeof entry === "string" && entry.trim()) {
          return [key, "REDACTED"];
        }

        if (looksLikeExternalMediaUrl(entry)) {
          return [key, "REDACTED"];
        }

        return [key, sanitizeProviderBody(entry)];
      }),
    );
  }

  return value;
}
