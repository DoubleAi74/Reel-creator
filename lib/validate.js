import {
  MAX_SECTION_DURATION_SECONDS,
  normalizeLyricLeadInMs,
} from "./timing";
import { normalizeLineQuality } from "./lyric-quality";

const BACKGROUND_TYPES = new Set(["solid", "gradient", "image", "video"]);

export class ProjectValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProjectValidationError";
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readObject(value, path, { required = false } = {}) {
  if (value == null) {
    if (required) {
      throw new ProjectValidationError(`${path} must be an object.`);
    }

    return undefined;
  }

  if (!isRecord(value)) {
    throw new ProjectValidationError(`${path} must be an object.`);
  }

  return value;
}

function readString(value, path, { allowEmpty = true, required = false } = {}) {
  if (value == null) {
    if (required) {
      throw new ProjectValidationError(`${path} must be a string.`);
    }

    return undefined;
  }

  if (typeof value !== "string") {
    throw new ProjectValidationError(`${path} must be a string.`);
  }

  if (!allowEmpty && value.trim().length === 0) {
    throw new ProjectValidationError(`${path} cannot be empty.`);
  }

  return value;
}

function readNumber(value, path, { integer = false, min, required = false } = {}) {
  if (value == null) {
    if (required) {
      throw new ProjectValidationError(`${path} must be a number.`);
    }

    return undefined;
  }

  if (!Number.isFinite(value)) {
    throw new ProjectValidationError(`${path} must be a finite number.`);
  }

  if (integer && !Number.isInteger(value)) {
    throw new ProjectValidationError(`${path} must be an integer.`);
  }

  if (min != null && value < min) {
    throw new ProjectValidationError(`${path} must be greater than or equal to ${min}.`);
  }

  return value;
}

function readBoolean(value, path) {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new ProjectValidationError(`${path} must be true or false.`);
  }

  return value;
}

function normalizeStyle(styleInput) {
  const style = {};

  if (!styleInput) {
    return style;
  }

  const preset = readString(styleInput.preset, "style.preset");
  const font = readString(styleInput.font, "style.font");
  const originalSize = readNumber(styleInput.originalSize, "style.originalSize", {
    min: 1,
  });
  const translationSize = readNumber(
    styleInput.translationSize,
    "style.translationSize",
    { min: 1 },
  );
  const romanizationSize = readNumber(
    styleInput.romanizationSize,
    "style.romanizationSize",
    { min: 1 },
  );
  const color = readString(styleInput.color, "style.color");
  const translationColor = readString(
    styleInput.translationColor,
    "style.translationColor",
  );
  const romanizationColor = readString(
    styleInput.romanizationColor,
    "style.romanizationColor",
  );
  const verticalPosition = readNumber(
    styleInput.verticalPosition,
    "style.verticalPosition",
    { min: 0 },
  );
  const shadowInput = readObject(styleInput.shadow, "style.shadow");
  const outlineInput = readObject(styleInput.outline, "style.outline");
  const animationInput = readObject(styleInput.animation, "style.animation");

  if (preset !== undefined) {
    style.preset = preset;
  }

  if (font !== undefined) {
    style.font = font;
  }

  if (originalSize !== undefined) {
    style.originalSize = originalSize;
  }

  if (translationSize !== undefined) {
    style.translationSize = translationSize;
  }

  if (romanizationSize !== undefined) {
    style.romanizationSize = romanizationSize;
  }

  if (color !== undefined) {
    style.color = color;
  }

  if (translationColor !== undefined) {
    style.translationColor = translationColor;
  }

  if (romanizationColor !== undefined) {
    style.romanizationColor = romanizationColor;
  }

  if (verticalPosition !== undefined) {
    style.verticalPosition = verticalPosition;
  }

  if (shadowInput) {
    style.shadow = {};

    const enabled = readBoolean(shadowInput.enabled, "style.shadow.enabled");
    const blur = readNumber(shadowInput.blur, "style.shadow.blur", { min: 0 });
    const shadowColor = readString(shadowInput.color, "style.shadow.color");
    const opacity = readNumber(shadowInput.opacity, "style.shadow.opacity", {
      min: 0,
    });

    if (enabled !== undefined) {
      style.shadow.enabled = enabled;
    }

    if (blur !== undefined) {
      style.shadow.blur = blur;
    }

    if (shadowColor !== undefined) {
      style.shadow.color = shadowColor;
    }

    if (opacity !== undefined) {
      style.shadow.opacity = opacity;
    }
  }

  if (outlineInput) {
    style.outline = {};

    const enabled = readBoolean(outlineInput.enabled, "style.outline.enabled");
    const width = readNumber(outlineInput.width, "style.outline.width", { min: 0 });
    const outlineColor = readString(outlineInput.color, "style.outline.color");

    if (enabled !== undefined) {
      style.outline.enabled = enabled;
    }

    if (width !== undefined) {
      style.outline.width = width;
    }

    if (outlineColor !== undefined) {
      style.outline.color = outlineColor;
    }
  }

  if (animationInput) {
    style.animation = {};

    const type = readString(animationInput.type, "style.animation.type");
    const durationMs = readNumber(
      animationInput.durationMs,
      "style.animation.durationMs",
      { min: 0 },
    );
    const slidePx = readNumber(animationInput.slidePx, "style.animation.slidePx", {
      min: 0,
    });

    if (type !== undefined) {
      style.animation.type = type;
    }

    if (durationMs !== undefined) {
      style.animation.durationMs = durationMs;
    }

    if (slidePx !== undefined) {
      style.animation.slidePx = slidePx;
    }
  }

  return style;
}

function normalizeBackground(backgroundInput) {
  const background = {};

  if (!backgroundInput) {
    return background;
  }

  const type = readString(backgroundInput.type, "background.type");
  const color = readString(backgroundInput.color, "background.color");
  const assetName = readString(backgroundInput.assetName, "background.assetName");
  const gradientInput = readObject(backgroundInput.gradient, "background.gradient");
  const scrimInput = readObject(backgroundInput.scrim, "background.scrim");

  if (type !== undefined) {
    if (!BACKGROUND_TYPES.has(type)) {
      throw new ProjectValidationError(
        "background.type must be one of solid, gradient, image, or video.",
      );
    }

    background.type = type;
  }

  if (color !== undefined) {
    background.color = color;
  }

  if (assetName !== undefined) {
    background.assetName = assetName;
  }

  if (gradientInput) {
    background.gradient = {};

    const from = readString(gradientInput.from, "background.gradient.from");
    const to = readString(gradientInput.to, "background.gradient.to");
    const angle = readNumber(gradientInput.angle, "background.gradient.angle");

    if (from !== undefined) {
      background.gradient.from = from;
    }

    if (to !== undefined) {
      background.gradient.to = to;
    }

    if (angle !== undefined) {
      background.gradient.angle = angle;
    }
  }

  if (scrimInput) {
    background.scrim = {};

    const enabled = readBoolean(scrimInput.enabled, "background.scrim.enabled");
    const scrimColor = readString(scrimInput.color, "background.scrim.color");
    const opacity = readNumber(scrimInput.opacity, "background.scrim.opacity", {
      min: 0,
    });

    if (enabled !== undefined) {
      background.scrim.enabled = enabled;
    }

    if (scrimColor !== undefined) {
      background.scrim.color = scrimColor;
    }

    if (opacity !== undefined) {
      background.scrim.opacity = opacity;
    }
  }

  return background;
}

function normalizeOptionalWordText(value, path) {
  if (value == null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new ProjectValidationError(`${path} must be a string.`);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeLineWords(wordsInput, linePath) {
  if (!Array.isArray(wordsInput)) {
    return undefined;
  }

  return wordsInput
    .map((wordInput, wordIndex) => {
      if (!isRecord(wordInput)) {
        return null;
      }

      const text =
        typeof wordInput.text === "string"
          ? wordInput.text.trim()
          : typeof wordInput.word === "string"
            ? wordInput.word.trim()
            : "";

      if (!text) {
        return null;
      }

      const gloss = normalizeOptionalWordText(
        wordInput.gloss,
        `${linePath}.words[${wordIndex}].gloss`,
      );
      const roman = normalizeOptionalWordText(
        wordInput.roman,
        `${linePath}.words[${wordIndex}].roman`,
      );
      const start = wordInput.start == null ? Number.NaN : Number(wordInput.start);
      const end = wordInput.end == null ? Number.NaN : Number(wordInput.end);

      // Optional timing: words may arrive with display data only (generation),
      // timing only (Whisper), or both. Never require timing.
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return { end: null, gloss, roman, start: null, text };
      }

      const normalizedStart = Math.max(0, start);

      return {
        end: Math.max(normalizedStart, end),
        gloss,
        roman,
        start: normalizedStart,
        text,
      };
    })
    .filter(Boolean);
}

function getSectionLength(audio) {
  if (audio.endOffset != null) {
    return audio.endOffset - audio.startOffset;
  }

  if (audio.duration > 0) {
    return audio.duration - audio.startOffset;
  }

  return 0;
}

export function parseProjectJson(jsonText) {
  if (typeof jsonText !== "string" || jsonText.trim().length === 0) {
    throw new ProjectValidationError("Project JSON is empty.");
  }

  try {
    return JSON.parse(jsonText);
  } catch {
    throw new ProjectValidationError(
      "Project JSON could not be parsed. Check for a missing comma, quote, or bracket.",
    );
  }
}

export function validateProjectInput(input) {
  if (!isRecord(input)) {
    throw new ProjectValidationError("Project JSON must be an object.");
  }

  if (input.version != null && input.version !== 1) {
    throw new ProjectValidationError("Only project version 1 is supported right now.");
  }

  const metaInput = readObject(input.meta, "meta");
  const audioInput = readObject(input.audio, "audio");
  const linesInput = input.lines;
  const styleInput = readObject(input.style, "style");
  const backgroundInput = readObject(input.background, "background");
  const timingInput = readObject(input.timing, "timing");

  if (!Array.isArray(linesInput) || linesInput.length === 0) {
    throw new ProjectValidationError("Project JSON must include at least one lyric line.");
  }

  const meta = {
    ...(metaInput && readString(metaInput.title, "meta.title") !== undefined
      ? { title: readString(metaInput.title, "meta.title") }
      : {}),
    ...(metaInput && readString(metaInput.artist, "meta.artist") !== undefined
      ? { artist: readString(metaInput.artist, "meta.artist") }
      : {}),
  };

  const audio = {
    name: readString(audioInput?.name, "audio.name") ?? "",
    duration: readNumber(audioInput?.duration, "audio.duration", { min: 0 }) ?? 0,
    startOffset:
      readNumber(audioInput?.startOffset, "audio.startOffset", { min: 0 }) ?? 0,
    endOffset:
      audioInput?.endOffset === null
        ? null
        : readNumber(audioInput?.endOffset, "audio.endOffset", { min: 0 }) ?? null,
  };

  if (audio.duration > 0 && audio.startOffset > audio.duration) {
    throw new ProjectValidationError(
      "audio.startOffset must be less than or equal to audio.duration.",
    );
  }

  if (audio.endOffset != null && audio.endOffset < audio.startOffset) {
    throw new ProjectValidationError(
      "audio.endOffset must be greater than or equal to audio.startOffset.",
    );
  }

  if (audio.duration > 0 && audio.endOffset != null && audio.endOffset > audio.duration) {
    throw new ProjectValidationError(
      "audio.endOffset must be less than or equal to audio.duration.",
    );
  }

  const sectionLength = getSectionLength(audio);

  if (sectionLength > MAX_SECTION_DURATION_SECONDS) {
    throw new ProjectValidationError(
      `The selected audio section is ${sectionLength.toFixed(
        2,
      )} seconds long. Sections must be 360 seconds or less.`,
    );
  }

  const lineUpperBound =
    audio.endOffset != null ? audio.endOffset : audio.duration > 0 ? audio.duration : null;
  const lines = linesInput.map((lineInput, index) => {
    if (!isRecord(lineInput)) {
      throw new ProjectValidationError(`lines[${index}] must be an object.`);
    }

    const original = readString(lineInput.original, `lines[${index}].original`, {
      allowEmpty: false,
      required: true,
    });
    const translation = readString(
      lineInput.translation,
      `lines[${index}].translation`,
    );
    const romanization = readString(
      lineInput.romanization,
      `lines[${index}].romanization`,
    );
    const start = readNumber(lineInput.start, `lines[${index}].start`, { min: 0 });
    const id = readString(lineInput.id, `lines[${index}].id`);
    const words = normalizeLineWords(lineInput.words, `lines[${index}]`);
    const quality = normalizeLineQuality(lineInput.quality);

    if (start !== undefined && lineUpperBound != null && start > lineUpperBound) {
      throw new ProjectValidationError(
        `lines[${index}].start must be less than or equal to ${lineUpperBound}.`,
      );
    }

    return {
      ...(id !== undefined ? { id } : {}),
      original,
      ...(translation !== undefined ? { translation } : {}),
      ...(romanization !== undefined ? { romanization } : {}),
      ...(quality ? { quality } : {}),
      ...(start !== undefined ? { start } : {}),
      ...(words !== undefined ? { words } : {}),
    };
  });

  return {
    audio,
    background: normalizeBackground(backgroundInput),
    lines,
    meta,
    style: normalizeStyle(styleInput),
    timing: {
      lyricLeadInMs: normalizeLyricLeadInMs(timingInput?.lyricLeadInMs),
    },
    version: 1,
  };
}
