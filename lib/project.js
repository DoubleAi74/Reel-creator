import { parseProjectJson, validateProjectInput } from "./validate";
import { applyStylePreset } from "./style-presets";
import { normalizeLineQuality } from "./lyric-quality";
import { normalizeLyricLeadInMs } from "./timing";

const DEFAULT_META = {
  title: "",
  artist: "",
};

export const DEFAULT_STYLE = {
  preset: "clean",
  font: "noto-world",
  originalSize: 64,
  romanizationSize: 40,
  translationSize: 44,
  color: "#FFFFFF",
  romanizationColor: "#C9D4E0",
  translationColor: "#D0D0D0",
  verticalPosition: 0.78,
  shadow: {
    enabled: true,
    blur: 8,
    color: "#000000",
    opacity: 0.6,
  },
  outline: {
    enabled: false,
    width: 2,
    color: "#000000",
  },
  animation: {
    type: "fade-slide",
    durationMs: 350,
    slidePx: 40,
  },
};

export const DEFAULT_BACKGROUND = {
  type: "gradient",
  color: "#101018",
  gradient: {
    from: "#1a1a2e",
    to: "#0f0c29",
    angle: 160,
  },
  assetName: null,
  scrim: {
    enabled: true,
    color: "#000000",
    opacity: 0.4,
  },
};

export const DEFAULT_TIMING = {
  lyricLeadInMs: normalizeLyricLeadInMs(undefined),
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeOptionalText(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeLineWords(words) {
  return (Array.isArray(words) ? words : [])
    .map((word) => {
      const rawText = typeof word?.text === "string" ? word.text : word?.word;

      if (typeof rawText !== "string" || !rawText.trim()) {
        return null;
      }

      const text = rawText.trim();
      const gloss = normalizeOptionalText(word?.gloss);
      const roman = normalizeOptionalText(word?.roman);
      const startNumber = word?.start == null ? Number.NaN : Number(word.start);
      const endNumber = word?.end == null ? Number.NaN : Number(word.end);

      // Words may carry only display data (text/gloss/roman) with no timing yet
      // (generation), only timing (Whisper), or both (merged). Backfill the
      // missing half so the schema stays a single { text, start, end, gloss, roman }.
      if (!Number.isFinite(startNumber) || !Number.isFinite(endNumber)) {
        return { end: null, gloss, roman, start: null, text };
      }

      const normalizedStart = Math.max(0, startNumber);

      return {
        end: Math.max(normalizedStart, endNumber),
        gloss,
        roman,
        start: normalizedStart,
        text,
      };
    })
    .filter(Boolean);
}

export function createLine(line = {}) {
  return {
    confidence: line.confidence ?? "",
    end: typeof line.end === "number" ? line.end : null,
    id: line.id ?? crypto.randomUUID(),
    matchRatio: typeof line.matchRatio === "number" ? line.matchRatio : 0,
    original: line.original ?? "",
    quality: normalizeLineQuality(line.quality),
    romanization: line.romanization ?? "",
    start: typeof line.start === "number" ? line.start : null,
    timingSource: line.timingSource ?? "",
    translation: line.translation ?? "",
    words: normalizeLineWords(line.words),
  };
}

export function sortLinesByStart(lines = []) {
  return [...lines].sort((left, right) => {
    const leftStart =
      typeof left.start === "number" ? left.start : Number.POSITIVE_INFINITY;
    const rightStart =
      typeof right.start === "number" ? right.start : Number.POSITIVE_INFINITY;

    if (leftStart !== rightStart) {
      return leftStart - rightStart;
    }

    return left.original.localeCompare(right.original);
  });
}

export function createDefaultProject(overrides = {}) {
  return {
    version: 1,
    meta: {
      ...clone(DEFAULT_META),
      ...(overrides.meta ?? {}),
    },
    audio: {
      name: "",
      duration: 0,
      startOffset: 0,
      endOffset: null,
      ...(overrides.audio ?? {}),
    },
    lines: (overrides.lines ?? []).map(createLine),
    timing: {
      ...clone(DEFAULT_TIMING),
      lyricLeadInMs: normalizeLyricLeadInMs(
        overrides.timing?.lyricLeadInMs,
        DEFAULT_TIMING.lyricLeadInMs,
      ),
    },
    style: {
      ...clone(DEFAULT_STYLE),
      ...(overrides.style ?? {}),
      shadow: {
        ...clone(DEFAULT_STYLE.shadow),
        ...(overrides.style?.shadow ?? {}),
      },
      outline: {
        ...clone(DEFAULT_STYLE.outline),
        ...(overrides.style?.outline ?? {}),
      },
      animation: {
        ...clone(DEFAULT_STYLE.animation),
        ...(overrides.style?.animation ?? {}),
      },
    },
    background: {
      ...clone(DEFAULT_BACKGROUND),
      ...(overrides.background ?? {}),
      gradient: {
        ...clone(DEFAULT_BACKGROUND.gradient),
        ...(overrides.background?.gradient ?? {}),
      },
      scrim: {
        ...clone(DEFAULT_BACKGROUND.scrim),
        ...(overrides.background?.scrim ?? {}),
      },
    },
  };
}

export function toProjectJsonValue(project) {
  const normalizedProject = createDefaultProject(project);

  return {
    audio: {
      duration: normalizedProject.audio.duration,
      endOffset: normalizedProject.audio.endOffset,
      name: normalizedProject.audio.name,
      startOffset: normalizedProject.audio.startOffset,
    },
    background: {
      assetName: normalizedProject.background.assetName,
      color: normalizedProject.background.color,
      gradient: {
        angle: normalizedProject.background.gradient.angle,
        from: normalizedProject.background.gradient.from,
        to: normalizedProject.background.gradient.to,
      },
      scrim: {
        color: normalizedProject.background.scrim.color,
        enabled: normalizedProject.background.scrim.enabled,
        opacity: normalizedProject.background.scrim.opacity,
      },
      type: normalizedProject.background.type,
    },
    lines: normalizedProject.lines.map((line) => ({
      id: line.id,
      original: line.original,
      ...(line.quality ? { quality: line.quality } : {}),
      romanization: line.romanization,
      start: line.start,
      translation: line.translation,
      words: line.words,
    })),
    meta: {
      artist: normalizedProject.meta.artist,
      title: normalizedProject.meta.title,
    },
    timing: {
      lyricLeadInMs: normalizedProject.timing.lyricLeadInMs,
    },
    style: {
      animation: {
        durationMs: normalizedProject.style.animation.durationMs,
        slidePx: normalizedProject.style.animation.slidePx,
        type: normalizedProject.style.animation.type,
      },
      color: normalizedProject.style.color,
      font: normalizedProject.style.font,
      originalSize: normalizedProject.style.originalSize,
      outline: {
        color: normalizedProject.style.outline.color,
        enabled: normalizedProject.style.outline.enabled,
        width: normalizedProject.style.outline.width,
      },
      preset: normalizedProject.style.preset,
      romanizationColor: normalizedProject.style.romanizationColor,
      romanizationSize: normalizedProject.style.romanizationSize,
      shadow: {
        blur: normalizedProject.style.shadow.blur,
        color: normalizedProject.style.shadow.color,
        enabled: normalizedProject.style.shadow.enabled,
        opacity: normalizedProject.style.shadow.opacity,
      },
      translationColor: normalizedProject.style.translationColor,
      translationSize: normalizedProject.style.translationSize,
      verticalPosition: normalizedProject.style.verticalPosition,
    },
    version: 1,
  };
}

export function exportProjectJson(project, spacing = 2) {
  return JSON.stringify(toProjectJsonValue(project), null, spacing);
}

export function importProjectValue(value) {
  return createDefaultProject(validateProjectInput(value));
}

export function importProjectJson(jsonText) {
  return importProjectValue(parseProjectJson(jsonText));
}

export function createSampleProject() {
  const project = createDefaultProject({
    meta: {
      title: "Aaj Se Teri",
      artist: "Arijit Singh",
    },
    audio: {
      name: "aaj-se-teri.mp3",
      duration: 194,
      startOffset: 0,
      endOffset: 194,
    },
    lines: [
      {
        id: "line-001",
        original: "आज से तेरी सारी गलियां मेरी हो गई",
        translation: "From today, all your streets have become mine.",
        start: 9.4,
      },
      {
        id: "line-002",
        original: "आज से मेरा घर तेरा हो गया",
        translation: "From today, my home has become yours.",
        start: 12.3,
      },
      {
        id: "line-003",
        original: "आज से मेरी सारी खुशियां तेरी हो गई",
        translation: "From today, all my happiness has become yours.",
        start: 18.7,
      },
      {
        id: "line-004",
        original: "आज से तेरा ग़म मेरा हो गया",
        translation: "From today, your sorrow has become mine.",
        start: 24.1,
      },
      {
        id: "line-005",
        original: "ओ तेरे काँधे का जो तिल है",
        translation: "Oh, the mole on your shoulder.",
        start: 30.3,
      },
      {
        id: "line-006",
        original: "ओ तेरे सीने में जो दिल है",
        translation: "Oh, the heart that rests in your chest.",
        start: 36.8,
      },
      {
        id: "line-007",
        original: "वो मेरी धड़कन में शामिल है",
        translation: "It now lives inside my heartbeat.",
        start: 43.5,
      },
      {
        id: "line-008",
        original: "तेरे होने से ही सब हासिल है",
        translation: "With you here, everything finally lands.",
        start: 50.4,
      },
    ],
    background: {
      type: "gradient",
      color: "#101018",
      gradient: {
        from: "#1a1a2e",
        to: "#0f0c29",
        angle: 160,
      },
    },
  });

  project.style = applyStylePreset(project.style, "clean");

  return project;
}
