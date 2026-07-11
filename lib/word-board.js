// Pure, language-agnostic helpers for the Word Board.
//
// Ported and generalized from the `#wb-script` prototype in index_new.html.
// Per the integration plan (P1/P2): no hardcoded dictionary (WORD_BANK), no
// per-script tile-width table (SKETCH_TILE_WIDTHS), and no per-song hacks (the
// "drop trailing गई" sketchWords hack). Tile widths are measured from rendered
// text when a measurer is supplied, with the prototype's heuristic as fallback.
//
// Everything here is framework-free and DOM-free so it can be unit tested in
// node and reused by the browser-side `useWordBoard` hook (which injects live
// viewport metrics + a canvas text measurer).

export const FIGMA_BOARD_WIDTH = 1094;
export const FIGMA_BOARD_HEIGHT = 922;
export const FIGMA_BOARD_RATIO = FIGMA_BOARD_WIDTH / FIGMA_BOARD_HEIGHT;
export const SKETCH_IDEAL_BOARD_WIDTH = 900;
export const SKETCH_MAX_VISIBLE_LINE_COUNT = 20;
export const DEFAULT_BOARD_SCALE = SKETCH_IDEAL_BOARD_WIDTH / FIGMA_BOARD_WIDTH;

export const MOBILE_MAX_WIDTH = 1023.98;
export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`;
export const COMPACT_DESKTOP_MEDIA_QUERY =
  "(min-width: 1024px) and (max-width: 1099.98px)";

// Tile-size stepper clamp (matches the prototype controls).
export const DESKTOP_TILE_SCALE_DEFAULT = 1;
export const DESKTOP_TILE_SCALE_MIN = 0.82;
export const DESKTOP_TILE_SCALE_MAX = 1.28;
export const MOBILE_TILE_SCALE_DEFAULT = 0.82;
export const MOBILE_TILE_SCALE_MIN = 0.64;
export const MOBILE_TILE_SCALE_MAX = 1;
export const TILE_SCALE_MIN = DESKTOP_TILE_SCALE_MIN;
export const TILE_SCALE_MAX = DESKTOP_TILE_SCALE_MAX;
export const TILE_SCALE_STEP = 0.06;

export const DESKTOP_LYRIC_LINE_STEP = 60;
export const DESKTOP_LYRIC_LINE_STEP_ROMAN = 72;
// Increase this number to add vertical space between separate mobile lyric rows.
// It does not change the gap between wrapped parts of the same lyric line.
export const MOBILE_LYRIC_LINE_STEP = 70;
export const MOBILE_LYRIC_LINE_STEP_ROMAN = MOBILE_LYRIC_LINE_STEP + 0;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function getTileScaleDefault(isMobile = false) {
  return isMobile ? MOBILE_TILE_SCALE_DEFAULT : DESKTOP_TILE_SCALE_DEFAULT;
}

export function getTileScaleLimits(isMobile = false) {
  return isMobile
    ? { max: MOBILE_TILE_SCALE_MAX, min: MOBILE_TILE_SCALE_MIN }
    : { max: DESKTOP_TILE_SCALE_MAX, min: DESKTOP_TILE_SCALE_MIN };
}

export function tokenize(value) {
  return String(value ?? "")
    .replace(/[.,!?;:()]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

function finiteNumberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

// Count grapheme-ish "letters", excluding combining marks (so Devanagari
// matras, Arabic harakat, etc. don't inflate the heuristic width).
export function countVisibleLetters(value) {
  return Array.from(String(value ?? "")).filter(
    (char) => !/\p{Mark}/u.test(char),
  ).length;
}

// Resolve display info for a word. The merged word schema carries gloss/roman
// directly; when absent (import / hand-edit / legacy), fall back positionally to
// the line's romanization/translation tokens — the prototype's graceful
// degradation, minus the Hindi dictionary.
export function resolveWordInfo(word, line, wordIndex) {
  const original =
    typeof word?.text === "string"
      ? word.text
      : typeof word?.word === "string"
        ? word.word
        : "";
  const gloss =
    typeof word?.gloss === "string" && word.gloss.trim()
      ? word.gloss
      : tokenize(line?.translation)[wordIndex] || "";
  const roman =
    typeof word?.roman === "string" && word.roman.trim()
      ? word.roman
      : tokenize(line?.romanization)[wordIndex] || original;
  return { english: gloss, original, roman };
}

// Build the board's internal line/word model from project lines. When a line
// has no words[], tokenize its original text so the board still renders.
export function prepareBoardLines(rawLines = []) {
  return (Array.isArray(rawLines) ? rawLines : []).map((line, lineIndex) => {
    const number = lineIndex + 1;
    const sourceWords =
      Array.isArray(line?.words) && line.words.length
        ? line.words
        : tokenize(line?.original).map((text) => ({ text }));

    const lineRef = {
      id: line?.id,
      original: line?.original ?? "",
      romanization: line?.romanization ?? "",
      translation: line?.translation ?? "",
    };
    const sourceLineId = line?.id ?? `line-${lineIndex}`;

    return {
      id: line?.id,
      number,
      original: lineRef.original,
      romanization: lineRef.romanization,
      sourceId: sourceLineId,
      start: finiteNumberOrNull(line?.start),
      end: finiteNumberOrNull(line?.end),
      translation: lineRef.translation,
      words: sourceWords.map((word, wordIndex) => {
        const info = resolveWordInfo(word, line, wordIndex);
        const sourceWordKey = `${sourceLineId}:${wordIndex}`;
        return {
          id: `${line?.id}-${wordIndex}`,
          original: info.original,
          english: info.english,
          roman: info.roman,
          start: finiteNumberOrNull(word?.start),
          end: finiteNumberOrNull(word?.end),
          sourceLineId,
          sourceWordIndex: wordIndex,
          sourceWordKey,
          wordIndex,
          lineId: line?.id,
          lineNumber: number,
          line: lineRef,
        };
      }),
    };
  });
}

// Measure a tile's width. When a `measureText(text, kind)` function is supplied
// (canvas-backed in the browser), use real rendered widths; otherwise fall back
// to the prototype's letter-count heuristic so it works headless / pre-paint.
export function measureTileWidth(word, { measureText, isMobile = false } = {}) {
  const original = word?.original ?? word?.text ?? "";
  const english = word?.enasglish ?? word?.gloss ?? "";
  const minWidth = isMobile ? 34 : 52;
  const maxWidth = isMobile ? 108 : 132;

  if (typeof measureText === "function") {
    const originalMeasured = measureText(original, "original");
    const englishMeasured = measureText(english, "gloss");
    const originalTextWidth = Number.isFinite(originalMeasured)
      ? originalMeasured * (isMobile ? 1.15 : 1)
      : null;
    const englishTextWidth = Number.isFinite(englishMeasured)
      ? englishMeasured * (isMobile ? 0.9 : 1)
      : null;
    const originalPadding = isMobile ? 10 : 12;
    const englishPadding = isMobile ? 5 : 12;

    if (
      Number.isFinite(originalTextWidth) &&
      Number.isFinite(englishTextWidth)
    ) {
      return clamp(
        Math.ceil(
          Math.max(
            minWidth,
            originalTextWidth + originalPadding,
            englishTextWidth + englishPadding,
          ),
        ),
        minWidth,
        maxWidth,
      );
    }
  }

  const originalWidth =
    (isMobile ? 18 : 36) + countVisibleLetters(original) * (isMobile ? 9 : 11);
  const englishWidth =
    (isMobile ? 14 : 24) + String(english).length * (isMobile ? 6 : 8);
  return clamp(
    Math.ceil(Math.max(minWidth, originalWidth, englishWidth)),
    minWidth,
    maxWidth,
  );
}

export function estimateLineWidth(line, options = {}) {
  const {
    boardScale = DEFAULT_BOARD_SCALE,
    isMobile = false,
    measureText,
  } = options;
  const words = line?.words || [];
  const wordWidth = words.reduce(
    (total, word) => total + measureTileWidth(word, { isMobile, measureText }),
    0,
  );
  const gapWidth = Math.max(0, words.length - 1) * (isMobile ? 3 : 5);
  const horizontalPadding = isMobile ? 8 : 36 * boardScale;
  return horizontalPadding + wordWidth + gapWidth;
}

// Derive the scaled board box from the available slot rect (ported from the
// prototype's updateBoardMetrics). Keeps the prototype's 1094/922 ratio.
export function measureBoardMetrics(rect = {}) {
  const availableWidth = Math.max(280, rect.width || SKETCH_IDEAL_BOARD_WIDTH);
  const availableHeight = Math.max(
    320,
    rect.height || availableWidth / FIGMA_BOARD_RATIO,
  );
  const boardWidth = Math.min(
    availableWidth,
    availableHeight * FIGMA_BOARD_RATIO,
  );
  const boardHeight = boardWidth / FIGMA_BOARD_RATIO;
  const boardScale = boardWidth / FIGMA_BOARD_WIDTH;
  return { boardHeight, boardScale, boardWidth };
}

// Available content width inside the stage (ported from sketchStageContentWidth).
export function stageContentWidth(metrics = {}) {
  const {
    isMobile = false,
    isCompactDesktop = false,
    boardScale = DEFAULT_BOARD_SCALE,
    boardWidth = SKETCH_IDEAL_BOARD_WIDTH,
    hostWidth,
  } = metrics;

  if (isMobile) {
    const width = hostWidth || boardWidth;
    const boardPaddingX = 8;
    const stagePaddingX = 6;
    const boardBorder = 2;
    const stageBorder = 2;
    return Math.max(
      220,
      width -
        boardBorder * 2 -
        boardPaddingX * 2 -
        stageBorder * 2 -
        stagePaddingX * 2,
    );
  }

  const boardPaddingX = isCompactDesktop ? 16 : Math.max(30, 47 * boardScale);
  const stagePaddingX = isCompactDesktop ? 10 : Math.max(18, 25 * boardScale);
  const boardBorder = 3;
  const stageBorder = isCompactDesktop ? 2 : 3;
  return Math.max(
    260,
    boardWidth -
      boardBorder * 2 -
      boardPaddingX * 2 -
      stageBorder * 2 -
      stagePaddingX * 2,
  );
}

export function fitLayoutScale(lines, options = {}) {
  const {
    tileScale = 1,
    availableWidth,
    boardScale = DEFAULT_BOARD_SCALE,
    isMobile = false,
    measureText,
  } = options;

  if (!lines.length || !(availableWidth > 0)) {
    return tileScale;
  }

  if (isMobile) {
    return tileScale;
  }

  const widestLine = Math.max(
    ...lines.map((line) =>
      estimateLineWidth(line, { boardScale, isMobile, measureText }),
    ),
  );
  if (!(widestLine > 0)) {
    return tileScale;
  }

  const fitScale = availableWidth / widestLine;
  const minScale = isMobile ? 0.38 : 0.62;
  return Math.min(tileScale, Math.max(minScale, fitScale));
}

export function splitWordsIntoRows(words = [], options = {}) {
  const {
    availableWidth,
    boardScale = DEFAULT_BOARD_SCALE,
    isMobile = false,
    measureText,
    tileScale = 1,
  } = options;

  if (!Array.isArray(words) || words.length <= 1 || !(availableWidth > 0)) {
    return [words];
  }

  const horizontalPadding = isMobile ? 8 : 36 * boardScale * tileScale;
  const usableWidth = Math.max(1, availableWidth - horizontalPadding);
  const wordGap = (isMobile ? 3 : 5) * tileScale;
  const rows = [];
  let currentRow = [];
  let usedWidth = 0;

  for (const word of words) {
    const width = measureTileWidth(word, { isMobile, measureText }) * tileScale;
    const nextWidth =
      currentRow.length > 0 ? usedWidth + wordGap + width : width;

    if (currentRow.length > 0 && nextWidth > usableWidth) {
      rows.push(currentRow);
      currentRow = [word];
      usedWidth = width;
    } else {
      currentRow.push(word);
      usedWidth = nextWidth;
    }
  }

  if (currentRow.length) {
    rows.push(currentRow);
  }

  return rows.length ? rows : [words];
}

export function estimateWrappedLineHeight(line, options = {}) {
  const {
    availableWidth,
    boardScale = DEFAULT_BOARD_SCALE,
    isMobile = false,
    measureText,
    showRoman = false,
    tileSizeRatio = 1,
    tileScale = 1,
  } = options;
  const words = line?.words || [];
  const rowStep =
    (isMobile
      ? showRoman
        ? MOBILE_LYRIC_LINE_STEP_ROMAN
        : MOBILE_LYRIC_LINE_STEP
      : showRoman
        ? DESKTOP_LYRIC_LINE_STEP_ROMAN
        : DESKTOP_LYRIC_LINE_STEP) * tileScale;

  if (!words.length || !(availableWidth > 0)) {
    return rowStep;
  }

  const rowCount = splitWordsIntoRows(words, {
    availableWidth,
    boardScale,
    isMobile,
    measureText,
    tileScale,
  }).length;
  const rowGap = 6 * tileScale;
  const tileShadowHeight = (showRoman ? 0 : isMobile ? 2 : 3) * tileSizeRatio;
  const unitHeight =
    (isMobile ? (showRoman ? 54 : 42) : showRoman ? 56 : 40) * tileScale +
    tileShadowHeight;

  return Math.max(rowStep, rowStep + (rowCount - 1) * (unitHeight + rowGap));
}

export function pageStageContentHeight(metrics = {}) {
  const {
    availableHeight,
    isCompactDesktop = false,
    boardScale = DEFAULT_BOARD_SCALE,
    boardWidth = SKETCH_IDEAL_BOARD_WIDTH,
  } = metrics;

  if (availableHeight > 0) {
    return availableHeight;
  }

  const boardHeight = boardWidth / FIGMA_BOARD_RATIO;
  const boardPaddingTop = isCompactDesktop ? 16 : Math.max(22, 40 * boardScale);
  const boardPaddingBottom = isCompactDesktop
    ? 14
    : Math.max(16, 24 * boardScale);
  const boardBorderY = 6;
  const stageBorderY = isCompactDesktop ? 4 : 6;
  const stagePaddingY = isCompactDesktop ? 8 : Math.max(10, 13 * boardScale);
  const pagerHeight = isCompactDesktop ? 78 : Math.max(96, 142 * boardScale);
  const boardGap = isCompactDesktop ? 8 : Math.max(10, 15 * boardScale);
  return (
    boardHeight -
    boardBorderY -
    boardPaddingTop -
    boardPaddingBottom -
    boardGap -
    pagerHeight -
    stageBorderY -
    stagePaddingY * 2
  );
}

// Compute how many lines fit per page in page mode. `metrics` carries the
// viewport-derived numbers the browser hook measures; defaults reproduce the
// prototype's ideal desktop board.
export function calculateLinesPerPage(metrics = {}) {
  const {
    availableHeight,
    availableWidth,
    lineCount = 0,
    lines,
    measureText,
    isMobile = false,
    isCompactDesktop = false,
    showRoman = false,
    tileSizeRatio = 1,
    tileScale = 1,
    boardScale = DEFAULT_BOARD_SCALE,
    boardWidth = SKETCH_IDEAL_BOARD_WIDTH,
  } = metrics;

  const maxLines = Math.min(
    SKETCH_MAX_VISIBLE_LINE_COUNT,
    lineCount || SKETCH_MAX_VISIBLE_LINE_COUNT,
  );

  if (isMobile) {
    return clamp(showRoman ? 3 : 4, 1, maxLines);
  }

  const rowStep = (showRoman ? 72 : 60) * tileScale;
  const stageContentHeight = pageStageContentHeight({
    availableHeight,
    isCompactDesktop,
    boardScale,
    boardWidth,
  });

  const rowHeight =
    Array.isArray(lines) && lines.length && availableWidth > 0
      ? Math.max(
          rowStep,
          ...lines.map((line) =>
            estimateWrappedLineHeight(line, {
              availableWidth,
              boardScale,
              isMobile,
              measureText,
              showRoman,
              tileSizeRatio,
              tileScale,
            }),
          ),
        )
      : rowStep;

  return clamp(Math.floor(stageContentHeight / rowHeight), 1, maxLines);
}

function cloneDisplayLine(line, displayId, displayNumber = line.number) {
  const sourceId = line.sourceId ?? line.id;
  return {
    id: displayId,
    sourceId,
    number: displayNumber,
    original: line.original,
    romanization: line.romanization,
    start: finiteNumberOrNull(line.start),
    end: finiteNumberOrNull(line.end),
    translation: line.translation,
    words: line.words.map((word, wordIndex) => ({
      ...word,
      id: `${displayId}-${wordIndex}`,
      lineId: displayId,
      sourceLineId: word.sourceLineId ?? sourceId,
      sourceWordIndex: word.sourceWordIndex ?? wordIndex,
      sourceWordKey: word.sourceWordKey ?? `${sourceId}:${wordIndex}`,
      lineNumber: displayNumber,
      wordIndex,
      line: {
        id: displayId,
        original: line.original,
        romanization: line.romanization,
        translation: line.translation,
      },
    })),
  };
}

// Page-mode visible lines for the given page. Returns the clamped page,
// pageCount, the absolute start index, and cloned display lines.
export function buildPageLines(lines, { page = 0, linesPerPage = 1 } = {}) {
  const safeLinesPerPage = Math.max(1, linesPerPage);
  const pageCount = Math.max(1, Math.ceil(lines.length / safeLinesPerPage));
  const safePage = clamp(page, 0, pageCount - 1);
  const start = safePage * safeLinesPerPage;
  const visible = lines
    .slice(start, start + safeLinesPerPage)
    .map((line, displayIndex) =>
      cloneDisplayLine(
        line,
        `sketch-${safePage}-${displayIndex}`,
        start + displayIndex + 1,
      ),
    );

  return {
    lines: visible,
    linesPerPage: safeLinesPerPage,
    page: safePage,
    pageCount,
    start,
  };
}

export function buildPageLinesByHeight(lines, options = {}) {
  const {
    page = 0,
    availableHeight,
    availableWidth,
    boardScale = DEFAULT_BOARD_SCALE,
    boardWidth = SKETCH_IDEAL_BOARD_WIDTH,
    isCompactDesktop = false,
    isMobile = false,
    measureText,
    showRoman = false,
    tileSizeRatio = 1,
    tileScale = 1,
  } = options;

  if (!Array.isArray(lines) || !lines.length) {
    return {
      lines: [],
      page: 0,
      pageCount: 1,
      pageStarts: [0],
      sourceLinePageMap: new Map(),
      start: 0,
    };
  }

  const stageContentHeight = pageStageContentHeight({
    availableHeight,
    isCompactDesktop,
    boardScale,
    boardWidth,
  });
  const maxLinesPerPage = Math.min(
    SKETCH_MAX_VISIBLE_LINE_COUNT,
    lines.length || SKETCH_MAX_VISIBLE_LINE_COUNT,
  );
  const lineHeights = lines.map((line) =>
    estimateWrappedLineHeight(line, {
      availableWidth,
      boardScale,
      isMobile,
      measureText,
      showRoman,
      tileSizeRatio,
      tileScale,
    }),
  );
  const pages = [];
  const pageStarts = [];
  let current = [];
  let currentHeight = 0;
  let currentStart = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const height = Math.max(1, lineHeights[index] || 0);
    const wouldOverflow =
      current.length > 0 && currentHeight + height > stageContentHeight;
    const wouldExceedCap = current.length >= maxLinesPerPage;

    if (wouldOverflow || wouldExceedCap) {
      pages.push({ lines: current, start: currentStart });
      pageStarts.push(currentStart);
      current = [];
      currentHeight = 0;
      currentStart = index;
    }

    current.push(lines[index]);
    currentHeight += height;
  }

  if (current.length) {
    pages.push({ lines: current, start: currentStart });
    pageStarts.push(currentStart);
  }

  const pageCount = Math.max(1, pages.length);
  const safePage = clamp(page, 0, pageCount - 1);
  const selected = pages[safePage] || { lines: [], start: 0 };
  const sourceLinePageMap = new Map();
  pages.forEach((pageEntry, pageIndex) => {
    pageEntry.lines.forEach((line) => {
      const sourceId = line?.sourceId ?? line?.id;
      if (sourceId != null) {
        sourceLinePageMap.set(sourceId, pageIndex);
      }
    });
  });
  const visible = selected.lines.map((line, displayIndex) =>
    cloneDisplayLine(
      line,
      `sketch-${safePage}-${displayIndex}`,
      selected.start + displayIndex + 1,
    ),
  );

  return {
    lines: visible,
    page: safePage,
    pageCount,
    pageStarts,
    sourceLinePageMap,
    start: selected.start,
  };
}

// Scroll-mode lines: every line, cloned with stable display ids.
export function buildScrollLines(lines) {
  return lines.map((line, lineIndex) =>
    cloneDisplayLine(line, `scroll-${lineIndex}`, lineIndex + 1),
  );
}
