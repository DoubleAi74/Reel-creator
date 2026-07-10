export function extractYouTubeVideoId(input) {
  if (!input || typeof input !== "string") {
    return null;
  }

  let url;

  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");

  if (hostname === "youtu.be") {
    return cleanVideoId(url.pathname.split("/").filter(Boolean)[0]);
  }

  const isYoutubeHost =
    hostname === "youtube.com" || hostname.endsWith(".youtube.com");

  if (!isYoutubeHost) {
    return null;
  }

  const watchId = cleanVideoId(url.searchParams.get("v"));

  if (watchId) {
    return watchId;
  }

  const [section, id] = url.pathname.split("/").filter(Boolean);

  if (["embed", "shorts", "live"].includes(section)) {
    return cleanVideoId(id);
  }

  return null;
}

export function isValidYouTubeUrl(input) {
  return Boolean(extractYouTubeVideoId(input));
}

function cleanVideoId(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}
