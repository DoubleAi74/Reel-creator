/**
 * Browser-side in-flight YouTube convert job tracker.
 * Used so mobile clients can resume polling after iOS background/freeze.
 */

export const YT_AUDIO_INFLIGHT_STORAGE_KEY = "reel-creator:yt-audio-inflight";
/** Keep under server JOB_TTL_MS (1h). */
export const YT_AUDIO_INFLIGHT_MAX_AGE_MS = 55 * 60 * 1000;

function getSessionStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function saveInflightYoutubeAudioJob({
  jobId,
  sourceUrl,
  startedAt = Date.now(),
} = {}) {
  const storage = getSessionStorage();

  if (!storage || !jobId || typeof jobId !== "string") {
    return false;
  }

  try {
    storage.setItem(
      YT_AUDIO_INFLIGHT_STORAGE_KEY,
      JSON.stringify({
        jobId: jobId.trim(),
        sourceUrl: typeof sourceUrl === "string" ? sourceUrl.trim() : "",
        startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export function loadInflightYoutubeAudioJob({ now = Date.now() } = {}) {
  const storage = getSessionStorage();

  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(YT_AUDIO_INFLIGHT_STORAGE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    const jobId =
      typeof parsed?.jobId === "string" ? parsed.jobId.trim() : "";
    const sourceUrl =
      typeof parsed?.sourceUrl === "string" ? parsed.sourceUrl.trim() : "";
    const startedAt = Number(parsed?.startedAt);

    if (!jobId || !Number.isFinite(startedAt)) {
      clearInflightYoutubeAudioJob();
      return null;
    }

    if (now - startedAt > YT_AUDIO_INFLIGHT_MAX_AGE_MS) {
      clearInflightYoutubeAudioJob();
      return null;
    }

    return {
      jobId,
      sourceUrl,
      startedAt,
    };
  } catch {
    clearInflightYoutubeAudioJob();
    return null;
  }
}

export function clearInflightYoutubeAudioJob() {
  const storage = getSessionStorage();

  if (!storage) {
    return;
  }

  try {
    storage.removeItem(YT_AUDIO_INFLIGHT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function inflightMatchesSourceUrl(inflight, sourceUrl) {
  if (!inflight?.jobId) {
    return false;
  }

  const expected =
    typeof sourceUrl === "string" ? sourceUrl.trim() : "";
  const stored =
    typeof inflight.sourceUrl === "string" ? inflight.sourceUrl.trim() : "";

  if (!expected || !stored) {
    return false;
  }

  return expected === stored;
}
