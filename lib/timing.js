export const MAX_SECTION_DURATION_SECONDS = 360;
export const DEFAULT_LYRIC_LEAD_IN_MS = 80;
export const MAX_LYRIC_LEAD_IN_MS = 150;
export const MIN_LYRIC_LEAD_IN_MS = 0;

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeLyricLeadInMs(
  value,
  fallback = DEFAULT_LYRIC_LEAD_IN_MS,
) {
  const number = Number(value);
  const safeFallback = Number.isFinite(fallback)
    ? fallback
    : DEFAULT_LYRIC_LEAD_IN_MS;
  const nextValue = Number.isFinite(number) ? number : safeFallback;

  return Math.round(
    clampNumber(nextValue, MIN_LYRIC_LEAD_IN_MS, MAX_LYRIC_LEAD_IN_MS),
  );
}

export function getSectionBounds(audio = {}) {
  const duration =
    Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
  const startOffset = clampNumber(audio.startOffset ?? 0, 0, duration);
  const rawEndOffset =
    Number.isFinite(audio.endOffset) && audio.endOffset !== null
      ? audio.endOffset
      : duration;
  const endOffset = clampNumber(rawEndOffset, startOffset, duration);

  return {
    duration,
    endOffset,
    sectionDuration: Math.max(0, endOffset - startOffset),
    startOffset,
  };
}

export function normalizeAudioSection(audio = {}) {
  const bounds = getSectionBounds(audio);

  return {
    ...audio,
    duration: bounds.duration,
    endOffset: audio.endOffset == null ? null : bounds.endOffset,
    startOffset: bounds.startOffset,
  };
}

export function getSectionDuration(audio = {}) {
  return getSectionBounds(audio).sectionDuration;
}

export function getSectionDurationInFrames(audio = {}, fps = 30) {
  if (!Number.isFinite(fps) || fps <= 0) {
    return 1;
  }

  return Math.max(1, Math.round(getSectionDuration(audio) * fps));
}

export function isSectionWithinLimit(
  audio = {},
  maxDurationSeconds = MAX_SECTION_DURATION_SECONDS,
) {
  return getSectionDuration(audio) <= maxDurationSeconds;
}

export function clampTimeToSection(timeInSeconds, audio = {}) {
  const { endOffset, startOffset } = getSectionBounds(audio);

  if (!Number.isFinite(timeInSeconds)) {
    return startOffset;
  }

  return clampNumber(timeInSeconds, startOffset, endOffset);
}

export function getSectionFrameFromTime(
  timeInSeconds,
  audio = {},
  fps = 30,
  durationInFrames = getSectionDurationInFrames(audio, fps),
) {
  if (!Number.isFinite(fps) || fps <= 0) {
    return 0;
  }

  const { startOffset } = getSectionBounds(audio);
  const clampedTime = clampTimeToSection(timeInSeconds, audio);
  const rawFrame = Math.floor((clampedTime - startOffset) * fps);

  return clampNumber(rawFrame, 0, Math.max(0, durationInFrames - 1));
}

export function getFrameDriftMilliseconds(expectedFrame, actualFrame, fps = 30) {
  if (
    !Number.isFinite(expectedFrame) ||
    !Number.isFinite(actualFrame) ||
    !Number.isFinite(fps) ||
    fps <= 0
  ) {
    return 0;
  }

  return (Math.abs(actualFrame - expectedFrame) / fps) * 1000;
}

export function clampLineStartsToSection(lines = [], audio = {}) {
  let clampedCount = 0;
  const nextLines = lines.map((line) => {
    if (!Number.isFinite(line?.start)) {
      return line;
    }

    const clampedStart = clampTimeToSection(line.start, audio);

    if (Math.abs(clampedStart - line.start) < 0.0001) {
      return line;
    }

    clampedCount += 1;

    return {
      ...line,
      start: clampedStart,
    };
  });

  return {
    clampedCount,
    lines: nextLines,
  };
}

export function getTimedLines(lines = []) {
  return lines
    .filter((line) => Number.isFinite(line?.start) && line.start >= 0)
    .map((line, index) => ({ index, line }))
    .sort((left, right) => {
      if (left.line.start !== right.line.start) {
        return left.line.start - right.line.start;
      }

      return left.index - right.index;
    })
    .map(({ line }) => line);
}

export function getLineDisplayStart(
  line,
  audio = {},
  lyricLeadInMs = MIN_LYRIC_LEAD_IN_MS,
) {
  if (!line || !Number.isFinite(line.start)) {
    return null;
  }

  const leadInSeconds = normalizeLyricLeadInMs(
    lyricLeadInMs,
    MIN_LYRIC_LEAD_IN_MS,
  ) / 1000;

  return clampTimeToSection(line.start - leadInSeconds, audio);
}

export function findActiveLine(
  lines = [],
  currentTimeInSeconds,
  audio = {},
  { lyricLeadInMs = MIN_LYRIC_LEAD_IN_MS } = {},
) {
  const timedLines = getTimedLines(lines);

  if (!timedLines.length) {
    return null;
  }

  const { endOffset, startOffset } = getSectionBounds(audio);
  const currentTime = clampTimeToSection(currentTimeInSeconds, audio);
  let activeLine = null;

  for (const line of timedLines) {
    if (line.start < startOffset) {
      continue;
    }

    if (line.start > endOffset) {
      break;
    }

    const displayStart = getLineDisplayStart(line, audio, lyricLeadInMs);

    if (displayStart !== null && displayStart <= currentTime) {
      activeLine = line;
      continue;
    }

    break;
  }

  return activeLine;
}

export function getLineStartFrame(
  line,
  audio = {},
  fps = 30,
  { lyricLeadInMs = MIN_LYRIC_LEAD_IN_MS } = {},
) {
  if (!line || !Number.isFinite(line.start) || !Number.isFinite(fps) || fps <= 0) {
    return 0;
  }

  const { startOffset } = getSectionBounds(audio);
  const displayStart = getLineDisplayStart(line, audio, lyricLeadInMs);

  return Math.max(0, Math.ceil(((displayStart ?? line.start) - startOffset) * fps));
}
