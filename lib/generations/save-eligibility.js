/**
 * When a project can be saved to the dashboard and how to mint stable ids
 * after reload (when pipeline job ids are gone).
 */

function asTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function createEmptyGenerationSave() {
  return {
    assetId: "",
    finalJobId: "",
    generationId: null,
    message: "",
    pipelineRunId: "",
    status: "idle", // idle | ready | saving | saved | error
  };
}

/**
 * Save is allowed when credits layer is on and the editor has lyrics + audio.
 * Timings are optional (generate-only is still saveable).
 */
export function canSaveProjectToDashboard({
  assetId = "",
  hasPlayableAudio = false,
  lines = [],
} = {}) {
  const hasLines =
    Array.isArray(lines) &&
    lines.some((line) => asTrimmedString(line?.original));
  const hasAsset = Boolean(asTrimmedString(assetId));

  return hasLines && (hasAsset || hasPlayableAudio === true);
}

/**
 * Stable ids so reloads and retries map to one generation per audio asset
 * (until the user runs a new AI pipeline, which supplies real job ids).
 */
export function buildStableSaveIds({ assetId = "" } = {}) {
  const safeAssetId = asTrimmedString(assetId) || "no-asset";

  return {
    finalJobId: `client-save-final:${safeAssetId}`,
    pipelineRunId: `client-save-run:${safeAssetId}`,
  };
}

export function normalizeGenerationSave(value) {
  if (!value || typeof value !== "object") {
    return createEmptyGenerationSave();
  }

  const status = asTrimmedString(value.status) || "idle";
  const allowed = new Set(["idle", "ready", "saving", "saved", "error"]);

  return {
    assetId: asTrimmedString(value.assetId),
    finalJobId: asTrimmedString(value.finalJobId),
    generationId:
      typeof value.generationId === "string" && value.generationId.trim()
        ? value.generationId.trim()
        : null,
    message: typeof value.message === "string" ? value.message : "",
    pipelineRunId: asTrimmedString(value.pipelineRunId),
    status: allowed.has(status) ? status : "idle",
  };
}

/**
 * Ensure a generationSave object is ready to open the save modal when the
 * project is saveable. Reuses existing job ids when present.
 */
export function ensureReadyGenerationSave({
  assetId = "",
  current = null,
  hasPlayableAudio = false,
  lines = [],
} = {}) {
  if (
    !canSaveProjectToDashboard({
      assetId,
      hasPlayableAudio,
      lines,
    })
  ) {
    return createEmptyGenerationSave();
  }

  const normalized = normalizeGenerationSave(current);

  if (normalized.status === "saving" || normalized.status === "saved") {
    return {
      ...normalized,
      assetId: asTrimmedString(assetId) || normalized.assetId,
    };
  }

  const stable = buildStableSaveIds({ assetId });
  const finalJobId = normalized.finalJobId || stable.finalJobId;
  const pipelineRunId = normalized.pipelineRunId || stable.pipelineRunId;

  return {
    assetId: asTrimmedString(assetId) || normalized.assetId,
    finalJobId,
    generationId: normalized.generationId,
    message:
      normalized.status === "error" && normalized.message
        ? normalized.message
        : "",
    pipelineRunId,
    status: normalized.status === "error" ? "error" : "ready",
  };
}
