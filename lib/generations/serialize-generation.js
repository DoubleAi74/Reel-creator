import {
  formatSegmentRangeLabel,
  getSourceReferenceFromSnapshot,
} from "./source-reference.js";
import { canReadGeneration } from "./visibility.js";

function toPlainGeneration(generation) {
  if (!generation) {
    return null;
  }

  return typeof generation.toObject === "function"
    ? generation.toObject()
    : generation;
}

function getGenerationId(generation) {
  return generation?._id?.toString?.() ?? generation?.id ?? null;
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function getGenerationLyricPreview(generation) {
  const plainGeneration = toPlainGeneration(generation);
  const lines = plainGeneration?.snapshot?.project?.lines ?? plainGeneration?.snapshot?.lines;

  return (Array.isArray(lines) ? lines : [])
    .map((line) => cleanText(line?.original))
    .filter(Boolean)
    .slice(0, 2)
    .join(" / ");
}

function buildSourceCardFields(plainGeneration) {
  const source = getSourceReferenceFromSnapshot(plainGeneration?.snapshot);
  const hasStoredAudio = plainGeneration?.r2Status === "created";

  return {
    hasStoredAudio,
    segmentEndSec: source.segmentEndSec,
    segmentLabel: formatSegmentRangeLabel(source),
    segmentStartSec: source.segmentStartSec,
    sourceType: source.type,
    youtubeUrl: source.type === "youtube" ? source.youtubeUrl : null,
  };
}

export function serializePublicCard(generation) {
  const plainGeneration = toPlainGeneration(generation);
  const id = getGenerationId(plainGeneration);

  if (!plainGeneration || !id) {
    return null;
  }

  // REP-403 / D-C: never expose sourceType or non-user titles on the public card.
  if (plainGeneration.public !== true || plainGeneration.userTitled !== true) {
    return null;
  }

  const sourceFields = buildSourceCardFields(plainGeneration);

  return {
    audioDurationSeconds: plainGeneration.audioDurationSeconds ?? null,
    audioUrl: sourceFields.hasStoredAudio ? `/api/media/generations/${id}` : null,
    createdAt: plainGeneration.createdAt
      ? new Date(plainGeneration.createdAt).toISOString()
      : null,
    hasStoredAudio: sourceFields.hasStoredAudio,
    id,
    lyricPreview: getGenerationLyricPreview(plainGeneration),
    segmentEndSec: sourceFields.segmentEndSec,
    segmentLabel: sourceFields.segmentLabel,
    segmentStartSec: sourceFields.segmentStartSec,
    title: plainGeneration.title,
    youtubeUrl: sourceFields.youtubeUrl,
  };
}

export function serializeDashboardCard(generation, { sessionId = "" } = {}) {
  const plainGeneration = toPlainGeneration(generation);
  const id = getGenerationId(plainGeneration);

  if (!plainGeneration || !id || !canReadGeneration(plainGeneration, sessionId)) {
    return null;
  }

  const sourceFields = buildSourceCardFields(plainGeneration);

  return {
    audioDurationSeconds: plainGeneration.audioDurationSeconds ?? null,
    audioUrl: sourceFields.hasStoredAudio ? `/api/media/generations/${id}` : null,
    createdAt: plainGeneration.createdAt
      ? new Date(plainGeneration.createdAt).toISOString()
      : null,
    hasStoredAudio: sourceFields.hasStoredAudio,
    id,
    lyricPreview: getGenerationLyricPreview(plainGeneration),
    segmentEndSec: sourceFields.segmentEndSec,
    segmentLabel: sourceFields.segmentLabel,
    segmentStartSec: sourceFields.segmentStartSec,
    sourceType: sourceFields.sourceType,
    title: plainGeneration.title || "Untitled generation",
    youtubeUrl: sourceFields.youtubeUrl,
  };
}

export function serializeEditorPayload(generation) {
  const plainGeneration = toPlainGeneration(generation);
  const id = getGenerationId(plainGeneration);

  if (!plainGeneration || !id) {
    return null;
  }

  const sourceFields = buildSourceCardFields(plainGeneration);

  return {
    hasStoredAudio: sourceFields.hasStoredAudio,
    id,
    segmentEndSec: sourceFields.segmentEndSec,
    segmentStartSec: sourceFields.segmentStartSec,
    snapshot: plainGeneration.snapshot,
    sourceType: sourceFields.sourceType,
    title: plainGeneration.title,
    youtubeUrl: sourceFields.youtubeUrl,
  };
}
