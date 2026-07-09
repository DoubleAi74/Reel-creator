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

export function serializePublicCard(generation) {
  const plainGeneration = toPlainGeneration(generation);
  const id = getGenerationId(plainGeneration);

  if (!plainGeneration || !id) {
    return null;
  }

  return {
    audioDurationSeconds: plainGeneration.audioDurationSeconds ?? null,
    audioUrl: `/api/media/generations/${id}`,
    createdAt: plainGeneration.createdAt
      ? new Date(plainGeneration.createdAt).toISOString()
      : null,
    id,
    lyricPreview: getGenerationLyricPreview(plainGeneration),
    sourceType: plainGeneration.sourceType ?? "unknown",
    title: plainGeneration.title,
  };
}

export function serializeEditorPayload(generation) {
  const plainGeneration = toPlainGeneration(generation);
  const id = getGenerationId(plainGeneration);

  if (!plainGeneration || !id) {
    return null;
  }

  return {
    id,
    snapshot: plainGeneration.snapshot,
    title: plainGeneration.title,
  };
}
