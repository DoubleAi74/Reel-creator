export const LYRIC_PIPELINE_PHASES = ["transcribe", "enrich", "time"];

export const LYRIC_PIPELINE_PRESETS = {
  all: "all",
  custom: "custom",
  firstOne: "first-one",
  firstTwo: "first-two",
};

const PRESET_SELECTIONS = {
  [LYRIC_PIPELINE_PRESETS.all]: {
    enrich: true,
    time: true,
    transcribe: true,
  },
  [LYRIC_PIPELINE_PRESETS.firstTwo]: {
    enrich: true,
    time: false,
    transcribe: true,
  },
  [LYRIC_PIPELINE_PRESETS.firstOne]: {
    enrich: false,
    time: false,
    transcribe: true,
  },
};

function cloneSelection(selection) {
  return {
    enrich: Boolean(selection?.enrich),
    time: Boolean(selection?.time),
    transcribe: Boolean(selection?.transcribe),
  };
}

export function getLyricPipelineSelectionForPreset(preset) {
  return cloneSelection(
    PRESET_SELECTIONS[preset] ?? PRESET_SELECTIONS[LYRIC_PIPELINE_PRESETS.all],
  );
}

export function getLyricPipelineCanRun({ hasAudio = false, lines = [] } = {}) {
  const hasOriginalLines = (Array.isArray(lines) ? lines : []).some(
    (line) => typeof line?.original === "string" && line.original.trim(),
  );

  return {
    enrich: hasOriginalLines,
    time: hasOriginalLines,
    transcribe: Boolean(hasAudio),
  };
}

export function getSelectedLyricPipelinePhases(selection, canRun) {
  const selected = cloneSelection(selection);
  const available = cloneSelection(canRun);
  const sourceLinesWillExist = available.enrich || (selected.transcribe && available.transcribe);

  return LYRIC_PIPELINE_PHASES.filter(
    (phase) =>
      selected[phase] &&
      (phase === "transcribe" ? available.transcribe : sourceLinesWillExist),
  );
}

export function hasLyricPipelineDownstreamData(lines = []) {
  return (Array.isArray(lines) ? lines : []).some(
    (line) =>
      (typeof line?.translation === "string" && line.translation.trim()) ||
      Number.isFinite(line?.start),
  );
}
