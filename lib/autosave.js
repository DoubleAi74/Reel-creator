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

function normalizeAudioAsset(audioAsset) {
  if (!audioAsset || typeof audioAsset !== "object") {
    return null;
  }

  const assetId =
    typeof audioAsset.assetId === "string" ? audioAsset.assetId.trim() : "";

  if (!assetId) {
    return null;
  }

  return {
    assetId,
    durationSec: Number.isFinite(audioAsset.durationSec)
      ? audioAsset.durationSec
      : null,
    name: typeof audioAsset.name === "string" ? audioAsset.name : "",
    sizeBytes: Number.isFinite(audioAsset.sizeBytes)
      ? audioAsset.sizeBytes
      : null,
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
  const envelope = {
    audioAsset: normalizeAudioAsset(audioAsset),
    project: toProjectJsonValue(project),
    savedAt: new Date().toISOString(),
    transcription: normalizeTranscription(transcription),
    v: AUTOSAVE_VERSION,
  };

  return JSON.stringify(envelope);
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
