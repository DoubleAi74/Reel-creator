export const LYRIC_PIPELINE_PHASES = ["generate", "time"];

export const LYRIC_PIPELINE_PRESETS = {
  both: "both",
  generateOnly: "generate-only",
  timeOnly: "time-only",
};

const PRESET_SELECTIONS = {
  [LYRIC_PIPELINE_PRESETS.both]: {
    generate: true,
    time: true,
  },
  [LYRIC_PIPELINE_PRESETS.generateOnly]: {
    generate: true,
    time: false,
  },
  [LYRIC_PIPELINE_PRESETS.timeOnly]: {
    generate: false,
    time: true,
  },
};

function cloneSelection(selection) {
  return {
    generate: Boolean(selection?.generate),
    time: Boolean(selection?.time),
  };
}

export function getLyricPipelineSelectionForPreset(preset) {
  return cloneSelection(
    PRESET_SELECTIONS[preset] ?? PRESET_SELECTIONS[LYRIC_PIPELINE_PRESETS.both],
  );
}

export function getLyricPipelineCanRun({ hasAudio = false, lines = [] } = {}) {
  const hasOriginalLines = (Array.isArray(lines) ? lines : []).some(
    (line) => typeof line?.original === "string" && line.original.trim(),
  );

  return {
    generate: Boolean(hasAudio),
    time: hasOriginalLines,
  };
}

export function getSelectedLyricPipelinePhases(selection, canRun) {
  const selected = cloneSelection(selection);
  const available = cloneSelection(canRun);
  const sourceLinesWillExist =
    available.time || (selected.generate && available.generate);

  return LYRIC_PIPELINE_PHASES.filter(
    (phase) =>
      selected[phase] &&
      (phase === "generate" ? available.generate : sourceLinesWillExist),
  );
}

export function hasLyricPipelineDownstreamData(lines = []) {
  return (Array.isArray(lines) ? lines : []).some(
    (line) =>
      (typeof line?.translation === "string" && line.translation.trim()) ||
      (typeof line?.romanization === "string" && line.romanization.trim()) ||
      (Array.isArray(line?.words) &&
        line.words.some(
          (word) =>
            (typeof word?.gloss === "string" && word.gloss.trim()) ||
            (typeof word?.roman === "string" && word.roman.trim()),
        )) ||
      Number.isFinite(line?.start),
  );
}
