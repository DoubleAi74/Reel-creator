function asTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeFiniteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

export function normalizeGenerationSourceType(value) {
  return value === "upload" || value === "youtube" ? value : "unknown";
}

/**
 * YouTube URL + original-video segment bounds (not MP3 section offsets).
 * Stored on generation snapshots so cards can reopen without R2 audio.
 */
export function normalizeSourceReference(value = {}) {
  const type = normalizeGenerationSourceType(value?.type ?? value?.sourceType);
  const youtubeUrl = asTrimmedString(value?.youtubeUrl ?? value?.sourceUrl) || null;
  const segmentStartSec = normalizeFiniteNumber(
    value?.segmentStartSec ?? value?.startTime ?? value?.startSec,
  );
  const segmentEndSec = normalizeFiniteNumber(
    value?.segmentEndSec ?? value?.endTime ?? value?.endSec,
  );

  if (type === "youtube" || youtubeUrl) {
    return {
      segmentEndSec,
      segmentStartSec,
      type: "youtube",
      youtubeUrl,
    };
  }

  if (type === "upload") {
    return {
      segmentEndSec: null,
      segmentStartSec: null,
      type: "upload",
      youtubeUrl: null,
    };
  }

  return {
    segmentEndSec: null,
    segmentStartSec: null,
    type: "unknown",
    youtubeUrl: null,
  };
}

export function mergeSourceReferenceIntoSnapshot(snapshot, sourceReference) {
  const base =
    snapshot && typeof snapshot === "object" ? structuredClone(snapshot) : { project: null };
  const normalized = normalizeSourceReference(sourceReference);

  return {
    ...base,
    source: normalized,
  };
}

export function getSourceReferenceFromSnapshot(snapshot) {
  return normalizeSourceReference(snapshot?.source ?? {});
}

export function formatSegmentRangeLabel(source) {
  const start = source?.segmentStartSec;
  const end = source?.segmentEndSec;

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }

  const format = (seconds) => {
    const total = Math.max(0, Math.floor(seconds));
    const mins = Math.floor(total / 60);
    const secs = total % 60;

    return `${mins}:${String(secs).padStart(2, "0")}`;
  };

  return `${format(start)} – ${format(end)}`;
}
