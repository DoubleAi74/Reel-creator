// Pure (DOM-free) encode/decode for the editor autosave envelope so a reload or
// in-app navigation can restore the whole project, the uploaded audio asset
// descriptor, and the active transcription pointer together. The serialized
// project goes through the canonical project serializer/validator, so only the
// durable project schema is ever persisted — transient UI state (playback time,
// selection, busy flags, notices, modals, blob URLs) is excluded structurally.

import { importProjectValue, toProjectJsonValue } from "./project";

// Bumped independently of the project schema version. A mismatch makes any
// previously stored envelope obsolete and it is discarded on decode.
export const AUTOSAVE_VERSION = 1;

export const AUTOSAVE_STORAGE_KEY = "reel-creator:autosave:v1";
export const WAVEFORM_PEAKS_CACHE_CONFIG = Object.freeze({
  channels: 1,
  maxLength: 1000,
  precision: 100,
  version: 1,
});

const WAVEFORM_PEAKS_MAX_JSON_CHARS = 24_000;
const AUTOSAVE_MAX_WITH_WAVEFORM_PEAKS_CHARS = 2_000_000;

function normalizePeakDuration(durationSec) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return null;
  }

  return Math.round(durationSec * 1000) / 1000;
}

function durationsMatch(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return true;
  }

  return Math.abs(left - right) < 0.05;
}

export function getValidatedWaveformPeaksCache(
  waveformPeaks,
  { assetId = "", durationSec = null } = {},
) {
  if (!waveformPeaks || typeof waveformPeaks !== "object") {
    return null;
  }

  const expectedAssetId = typeof assetId === "string" ? assetId.trim() : "";
  const cacheAssetId =
    typeof waveformPeaks.assetId === "string"
      ? waveformPeaks.assetId.trim()
      : "";

  if (!cacheAssetId || (expectedAssetId && cacheAssetId !== expectedAssetId)) {
    return null;
  }

  if (
    waveformPeaks.version !== WAVEFORM_PEAKS_CACHE_CONFIG.version ||
    waveformPeaks.channels !== WAVEFORM_PEAKS_CACHE_CONFIG.channels ||
    waveformPeaks.maxLength !== WAVEFORM_PEAKS_CACHE_CONFIG.maxLength ||
    waveformPeaks.precision !== WAVEFORM_PEAKS_CACHE_CONFIG.precision
  ) {
    return null;
  }

  const cacheDurationSec = normalizePeakDuration(waveformPeaks.durationSec);
  const expectedDurationSec = normalizePeakDuration(durationSec);

  if (
    cacheDurationSec == null ||
    !durationsMatch(cacheDurationSec, expectedDurationSec)
  ) {
    return null;
  }

  if (
    !Array.isArray(waveformPeaks.data) ||
    waveformPeaks.data.length !== WAVEFORM_PEAKS_CACHE_CONFIG.maxLength
  ) {
    return null;
  }

  const rawData = waveformPeaks.data.map((value) => {
    const nextValue = Number(value);

    if (!Number.isFinite(nextValue) || Math.abs(nextValue) > 2) {
      return null;
    }

    return nextValue;
  });

  if (rawData.some((value) => value == null)) {
    return null;
  }

  const maxAbs = rawData.reduce(
    (currentMax, value) => Math.max(currentMax, Math.abs(value)),
    0,
  );
  const normalizer = maxAbs > 1 ? maxAbs : 1;
  const data = rawData.map(
    (value) =>
      Math.round((value / normalizer) * WAVEFORM_PEAKS_CACHE_CONFIG.precision) /
      WAVEFORM_PEAKS_CACHE_CONFIG.precision,
  );

  const cache = {
    assetId: cacheAssetId,
    channels: WAVEFORM_PEAKS_CACHE_CONFIG.channels,
    data,
    durationSec: cacheDurationSec,
    maxLength: WAVEFORM_PEAKS_CACHE_CONFIG.maxLength,
    precision: WAVEFORM_PEAKS_CACHE_CONFIG.precision,
    version: WAVEFORM_PEAKS_CACHE_CONFIG.version,
  };

  if (JSON.stringify(cache).length > WAVEFORM_PEAKS_MAX_JSON_CHARS) {
    return null;
  }

  return cache;
}

export function createWaveformPeaksCache({ assetId, durationSec, peaks }) {
  const channelData = Array.isArray(peaks?.[0]) ? peaks[0] : null;

  if (!channelData) {
    return null;
  }

  return getValidatedWaveformPeaksCache(
    {
      assetId,
      channels: WAVEFORM_PEAKS_CACHE_CONFIG.channels,
      data: channelData,
      durationSec,
      maxLength: WAVEFORM_PEAKS_CACHE_CONFIG.maxLength,
      precision: WAVEFORM_PEAKS_CACHE_CONFIG.precision,
      version: WAVEFORM_PEAKS_CACHE_CONFIG.version,
    },
    { assetId, durationSec },
  );
}

export function getWaveformPeaksForWaveSurfer(waveformPeaks, expected = {}) {
  const cache = getValidatedWaveformPeaksCache(waveformPeaks, expected);

  if (!cache) {
    return null;
  }

  return {
    duration: cache.durationSec,
    peaks: [cache.data],
  };
}

function normalizeAudioAsset(audioAsset) {
  if (!audioAsset || typeof audioAsset !== "object") {
    return null;
  }

  const assetId =
    typeof audioAsset.assetId === "string" ? audioAsset.assetId.trim() : "";

  if (!assetId) {
    return null;
  }

  const durationSec = Number.isFinite(audioAsset.durationSec)
    ? audioAsset.durationSec
    : null;
  const waveformPeaks = getValidatedWaveformPeaksCache(
    audioAsset.waveformPeaks,
    { assetId, durationSec },
  );

  return {
    assetId,
    durationSec,
    name: typeof audioAsset.name === "string" ? audioAsset.name : "",
    sizeBytes: Number.isFinite(audioAsset.sizeBytes)
      ? audioAsset.sizeBytes
      : null,
    ...(waveformPeaks ? { waveformPeaks } : {}),
  };
}

function normalizeTranscription(transcription) {
  if (!transcription || typeof transcription !== "object") {
    return null;
  }

  const jobId =
    typeof transcription.jobId === "string" ? transcription.jobId.trim() : "";

  if (!jobId) {
    return null;
  }

  const appliedJobId =
    typeof transcription.appliedJobId === "string"
      ? transcription.appliedJobId.trim()
      : "";

  // Which client apply path the job feeds: full transcription ("lyrics") vs.
  // aligning existing lines ("timing"). Needed so a recovered job is applied
  // through the correct path.
  const mode = transcription.mode === "timing" ? "timing" : "lyrics";

  return {
    appliedJobId: appliedJobId || null,
    jobId,
    mode,
  };
}

// Build the JSON string written to storage. `project` is the live editor project
// state; it is run through the canonical serializer so the persisted shape
// matches an exported project file exactly.
export function encodeAutosave({ audioAsset, project, transcription }) {
  const normalizedAudioAsset = normalizeAudioAsset(audioAsset);
  const envelope = {
    audioAsset: normalizedAudioAsset,
    project: toProjectJsonValue(project),
    savedAt: new Date().toISOString(),
    transcription: normalizeTranscription(transcription),
    v: AUTOSAVE_VERSION,
  };

  const encoded = JSON.stringify(envelope);

  if (
    normalizedAudioAsset?.waveformPeaks &&
    encoded.length > AUTOSAVE_MAX_WITH_WAVEFORM_PEAKS_CHARS
  ) {
    envelope.audioAsset = { ...normalizedAudioAsset };
    delete envelope.audioAsset.waveformPeaks;
    return JSON.stringify(envelope);
  }

  return encoded;
}

// Parse + validate a stored envelope. Returns a normalized
// { project, audioAsset, transcription, savedAt } on success, or null when the
// data is missing, malformed, a different autosave version, or fails project
// validation — letting callers fail gracefully to a blank project.
export function decodeAutosave(raw) {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }

  let envelope;

  try {
    envelope = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!envelope || typeof envelope !== "object") {
    return null;
  }

  if (envelope.v !== AUTOSAVE_VERSION) {
    return null;
  }

  let project;

  try {
    // Validates against the project schema and normalizes to a full project.
    project = importProjectValue(envelope.project);
  } catch {
    return null;
  }

  return {
    audioAsset: normalizeAudioAsset(envelope.audioAsset),
    project,
    savedAt: typeof envelope.savedAt === "string" ? envelope.savedAt : null,
    transcription: normalizeTranscription(envelope.transcription),
  };
}
