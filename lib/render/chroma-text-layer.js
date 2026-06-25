import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import sharp from "sharp";

import {
  TEXT_LAYER_CHROMA_COLOR,
  TEXT_LAYER_RENDER_FPS,
  TEXT_LAYER_RENDER_HEIGHT,
  TEXT_LAYER_RENDER_SCALE,
  TEXT_LAYER_RENDER_WIDTH,
} from "@/lib/render/formats";
import {
  getLineDisplayStart,
  getSectionBounds,
  getTimedLines,
  normalizeLyricLeadInMs,
} from "@/lib/timing";

const FONT_STACK =
  '"Noto Sans", "Noto Sans Devanagari", "Noto Sans JP", "Noto Sans KR", "Noto Sans Arabic", sans-serif';
const CHROMA_ALPHA_CUTOFF = 8;
const MAX_TEXT_BLOCK_HEIGHT = TEXT_LAYER_RENDER_HEIGHT * 0.42;
const MIN_FRAME_DURATION_SECONDS = 1 / 120;
const FONT_FACE_DEFINITIONS = [
  ["Noto Sans", 400, "@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff2"],
  ["Noto Sans", 500, "@fontsource/noto-sans/files/noto-sans-latin-500-normal.woff2"],
  ["Noto Sans", 700, "@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff2"],
  [
    "Noto Sans Devanagari",
    400,
    "@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff2",
  ],
  [
    "Noto Sans Devanagari",
    500,
    "@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-500-normal.woff2",
  ],
  [
    "Noto Sans Devanagari",
    700,
    "@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-700-normal.woff2",
  ],
  [
    "Noto Sans Arabic",
    400,
    "@fontsource/noto-sans-arabic/files/noto-sans-arabic-arabic-400-normal.woff2",
  ],
  [
    "Noto Sans Arabic",
    500,
    "@fontsource/noto-sans-arabic/files/noto-sans-arabic-arabic-500-normal.woff2",
  ],
  [
    "Noto Sans Arabic",
    700,
    "@fontsource/noto-sans-arabic/files/noto-sans-arabic-arabic-700-normal.woff2",
  ],
  [
    "Noto Sans JP",
    400,
    "@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-400-normal.woff2",
  ],
  [
    "Noto Sans JP",
    500,
    "@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-500-normal.woff2",
  ],
  [
    "Noto Sans JP",
    700,
    "@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-700-normal.woff2",
  ],
  [
    "Noto Sans KR",
    400,
    "@fontsource/noto-sans-kr/files/noto-sans-kr-korean-400-normal.woff2",
  ],
  [
    "Noto Sans KR",
    500,
    "@fontsource/noto-sans-kr/files/noto-sans-kr-korean-500-normal.woff2",
  ],
  [
    "Noto Sans KR",
    700,
    "@fontsource/noto-sans-kr/files/noto-sans-kr-korean-700-normal.woff2",
  ],
];
let cachedFontFaceCss = null;

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function normalizeHexColor(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim();
  const match = normalized.match(/^#?([0-9a-f]{6})$/i);

  return match ? `#${match[1].toUpperCase()}` : fallback;
}

function hexToRgb(hexColor) {
  const normalized = normalizeHexColor(hexColor, "#00FF00");

  return {
    b: Number.parseInt(normalized.slice(5, 7), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    r: Number.parseInt(normalized.slice(1, 3), 16),
  };
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getFontFaceCss() {
  if (cachedFontFaceCss) {
    return cachedFontFaceCss;
  }

  cachedFontFaceCss = FONT_FACE_DEFINITIONS.map(([family, weight, packagePath]) => {
    const fontPath = path.join(process.cwd(), "node_modules", packagePath);
    const fontUrl = pathToFileURL(fontPath).href;

    return `@font-face{font-family:"${family}";src:url("${fontUrl}") format("woff2");font-weight:${weight};font-style:normal;}`;
  }).join("");

  return cachedFontFaceCss;
}

function estimateCharacterWidth(character, fontSize) {
  if (/\s/u.test(character)) {
    return fontSize * 0.32;
  }

  const codePoint = character.codePointAt(0) ?? 0;

  if (
    (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
    (codePoint >= 0x3400 && codePoint <= 0x9fff) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af)
  ) {
    return fontSize * 0.95;
  }

  if (
    (codePoint >= 0x0600 && codePoint <= 0x06ff) ||
    (codePoint >= 0x0900 && codePoint <= 0x097f)
  ) {
    return fontSize * 0.68;
  }

  return fontSize * 0.54;
}

function estimateTextWidth(text, fontSize) {
  return Array.from(text).reduce(
    (total, character) => total + estimateCharacterWidth(character, fontSize),
    0,
  );
}

function splitLongToken(token, fontSize, maxWidth) {
  const chunks = [];
  let current = "";

  for (const character of Array.from(token)) {
    const candidate = `${current}${character}`;

    if (current && estimateTextWidth(candidate, fontSize) > maxWidth) {
      chunks.push(current);
      current = character;
      continue;
    }

    current = candidate;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function wrapText(text, fontSize, maxWidth) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();

  if (!normalized) {
    return [];
  }

  const words = normalized.split(" ");
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;

    if (estimateTextWidth(candidate, fontSize) <= maxWidth) {
      currentLine = candidate;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
      currentLine = "";
    }

    if (estimateTextWidth(word, fontSize) <= maxWidth) {
      currentLine = word;
      continue;
    }

    lines.push(...splitLongToken(word, fontSize, maxWidth));
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

function getLineLayout(line, styleConfig = {}) {
  const maxWidth = TEXT_LAYER_RENDER_WIDTH - 192 * TEXT_LAYER_RENDER_SCALE;
  const baseOriginalSize = clampNumber(
    (styleConfig.originalSize ?? 64) * TEXT_LAYER_RENDER_SCALE,
    18,
    78,
  );
  const baseTranslationSize = clampNumber(
    (styleConfig.translationSize ?? 44) * TEXT_LAYER_RENDER_SCALE,
    14,
    58,
  );
  const baseRomanizationSize = clampNumber(
    (styleConfig.romanizationSize ?? 40) * TEXT_LAYER_RENDER_SCALE,
    14,
    58,
  );
  const hasTranslation = Boolean(line.translation?.trim());
  const hasRomanization = Boolean(line.romanization?.trim());

  for (let factor = 1; factor >= 0.62; factor -= 0.04) {
    const originalSize = Math.round(baseOriginalSize * factor);
    const romanizationSize = Math.round(baseRomanizationSize * factor);
    const translationSize = Math.round(baseTranslationSize * factor);
    const originalLines = wrapText(line.original, originalSize, maxWidth);
    const romanizationLines = hasRomanization
      ? wrapText(line.romanization, romanizationSize, maxWidth)
      : [];
    const translationLines = hasTranslation
      ? wrapText(line.translation, translationSize, maxWidth)
      : [];
    const originalLineHeight = originalSize * 1.1;
    const romanizationLineHeight = romanizationSize * 1.2;
    const translationLineHeight = translationSize * 1.25;
    const romanizationGap = romanizationLines.length
      ? 16 * TEXT_LAYER_RENDER_SCALE * factor
      : 0;
    const gap = translationLines.length ? 22 * TEXT_LAYER_RENDER_SCALE * factor : 0;
    const totalHeight =
      originalLines.length * originalLineHeight +
      romanizationGap +
      romanizationLines.length * romanizationLineHeight +
      gap +
      translationLines.length * translationLineHeight;

    if (totalHeight <= MAX_TEXT_BLOCK_HEIGHT || factor <= 0.66) {
      return {
        gap,
        maxWidth,
        originalLineHeight,
        originalLines,
        originalSize,
        romanizationGap,
        romanizationLineHeight,
        romanizationLines,
        romanizationSize,
        totalHeight,
        translationLineHeight,
        translationLines,
        translationSize,
      };
    }
  }
}

function renderTextLines({
  color,
  filterAttribute,
  fontSize,
  fontStyle = "normal",
  fontWeight,
  lineHeight,
  lines,
  letterSpacing = 0,
  outlineColor,
  outlineWidth,
  y,
}) {
  return lines
    .map((text, index) => {
      const textY = y + index * lineHeight;

      return `<text x="${TEXT_LAYER_RENDER_WIDTH / 2}" y="${textY.toFixed(
        2,
      )}" text-anchor="middle" dominant-baseline="hanging" font-family="${escapeXml(
        FONT_STACK,
      )}" font-size="${fontSize}" font-style="${fontStyle}" font-weight="${fontWeight}" letter-spacing="${letterSpacing}" fill="${color}" stroke="${outlineColor}" stroke-width="${outlineWidth}" paint-order="stroke fill" ${filterAttribute}>${escapeXml(
        text,
      )}</text>`;
    })
    .join("");
}

function renderFrameSvg({
  line = null,
  progress = 1,
  styleConfig = {},
  textLayerMode,
} = {}) {
  if (!line) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${TEXT_LAYER_RENDER_WIDTH}" height="${TEXT_LAYER_RENDER_HEIGHT}" viewBox="0 0 ${TEXT_LAYER_RENDER_WIDTH} ${TEXT_LAYER_RENDER_HEIGHT}"></svg>`;
  }

  const layout = getLineLayout(line, styleConfig);
  const opacity = clampNumber(progress, 0, 1);
  const translateY =
    (1 - opacity) *
    (styleConfig.animation?.type === "none"
      ? 0
      : (styleConfig.animation?.slidePx ?? 40) * TEXT_LAYER_RENDER_SCALE);
  const blockTop =
    (styleConfig.verticalPosition ?? 0.78) * TEXT_LAYER_RENDER_HEIGHT -
    layout.totalHeight / 2;
  const shadowEnabled =
    textLayerMode !== "chroma" && (styleConfig.shadow?.enabled ?? true);
  const shadowColor = normalizeHexColor(styleConfig.shadow?.color, "#000000");
  const shadowOpacity = clampNumber(styleConfig.shadow?.opacity ?? 0.6, 0, 1);
  const shadowBlur = Math.max(
    0.1,
    ((styleConfig.shadow?.blur ?? 8) * TEXT_LAYER_RENDER_SCALE) / 2,
  );
  const outlineEnabled = styleConfig.outline?.enabled ?? false;
  const outlineColor = outlineEnabled
    ? normalizeHexColor(styleConfig.outline?.color, "#000000")
    : "none";
  const outlineWidth = outlineEnabled
    ? Math.max(1, (styleConfig.outline?.width ?? 2) * TEXT_LAYER_RENDER_SCALE)
    : 0;
  const filterDefinition = shadowEnabled
    ? `<filter id="text-shadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="0" stdDeviation="${shadowBlur.toFixed(
        2,
      )}" flood-color="${shadowColor}" flood-opacity="${shadowOpacity}"/><feDropShadow dx="0" dy="${(
        8 * TEXT_LAYER_RENDER_SCALE
      ).toFixed(2)}" stdDeviation="${(16 * TEXT_LAYER_RENDER_SCALE).toFixed(
        2,
      )}" flood-color="${shadowColor}" flood-opacity="${shadowOpacity}"/></filter>`
    : "";
  const filterAttribute = shadowEnabled ? 'filter="url(#text-shadow)"' : "";
  const originalColor = normalizeHexColor(styleConfig.color, "#FFFFFF");
  const romanizationColor = normalizeHexColor(
    styleConfig.romanizationColor,
    "#C9D4E0",
  );
  const translationColor = normalizeHexColor(
    styleConfig.translationColor,
    "#D0D0D0",
  );
  const originalMarkup = renderTextLines({
    color: originalColor,
    filterAttribute,
    fontSize: layout.originalSize,
    fontWeight: 650,
    letterSpacing: "-0.03em",
    lineHeight: layout.originalLineHeight,
    lines: layout.originalLines,
    outlineColor,
    outlineWidth,
    y: blockTop,
  });
  const romanizationTop =
    blockTop +
    layout.originalLines.length * layout.originalLineHeight +
    layout.romanizationGap;
  const romanizationMarkup = renderTextLines({
    color: romanizationColor,
    filterAttribute,
    fontSize: layout.romanizationSize,
    fontStyle: "italic",
    fontWeight: 500,
    lineHeight: layout.romanizationLineHeight,
    lines: layout.romanizationLines,
    outlineColor,
    outlineWidth: outlineEnabled ? Math.max(1, outlineWidth - 0.5) : 0,
    y: romanizationTop,
  });
  const translationTop =
    romanizationTop +
    layout.romanizationLines.length * layout.romanizationLineHeight +
    layout.gap;
  const translationMarkup = renderTextLines({
    color: translationColor,
    filterAttribute,
    fontSize: layout.translationSize,
    fontWeight: 450,
    lineHeight: layout.translationLineHeight,
    lines: layout.translationLines,
    outlineColor,
    outlineWidth: outlineEnabled ? Math.max(1, outlineWidth - 0.5) : 0,
    y: translationTop,
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TEXT_LAYER_RENDER_WIDTH}" height="${TEXT_LAYER_RENDER_HEIGHT}" viewBox="0 0 ${TEXT_LAYER_RENDER_WIDTH} ${TEXT_LAYER_RENDER_HEIGHT}"><defs><style>${escapeXml(
    getFontFaceCss(),
  )}</style>${filterDefinition}</defs><g opacity="${opacity.toFixed(
    3,
  )}" transform="translate(0 ${translateY.toFixed(
    2,
  )})">${originalMarkup}${romanizationMarkup}${translationMarkup}</g></svg>`;
}

async function writePngFrame({
  filePath,
  line,
  progress,
  styleConfig,
  textLayerMode,
}) {
  const svg = renderFrameSvg({ line, progress, styleConfig, textLayerMode });

  if (textLayerMode !== "chroma") {
    await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(filePath);
    return;
  }

  const keyColor = hexToRgb(TEXT_LAYER_CHROMA_COLOR);
  const { data, info } = await sharp(Buffer.from(svg))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgbBuffer = Buffer.alloc(info.width * info.height * 3);

  for (
    let sourceIndex = 0, targetIndex = 0;
    sourceIndex < data.length;
    sourceIndex += 4, targetIndex += 3
  ) {
    const alpha = data[sourceIndex + 3];

    if (alpha <= CHROMA_ALPHA_CUTOFF) {
      rgbBuffer[targetIndex] = keyColor.r;
      rgbBuffer[targetIndex + 1] = keyColor.g;
      rgbBuffer[targetIndex + 2] = keyColor.b;
      continue;
    }

    const opacity = Math.sqrt(alpha / 255);

    rgbBuffer[targetIndex] = Math.round(data[sourceIndex] * opacity);
    rgbBuffer[targetIndex + 1] = Math.round(data[sourceIndex + 1] * opacity);
    rgbBuffer[targetIndex + 2] = Math.round(data[sourceIndex + 2] * opacity);
  }

  await sharp(rgbBuffer, {
    raw: {
      channels: 3,
      height: info.height,
      width: info.width,
    },
  })
    .png({ compressionLevel: 9 })
    .toFile(filePath);
}

function addConcatEntry(entries, fileName, duration) {
  if (duration < MIN_FRAME_DURATION_SECONDS) {
    return;
  }

  entries.push({
    duration,
    fileName,
  });
}

async function createFrameWriter({ styleConfig, tempDir, textLayerMode }) {
  let frameIndex = 0;

  return async function writeFrame(line, progress) {
    const fileName = `frame-${String(frameIndex).padStart(4, "0")}.png`;
    frameIndex += 1;
    await writePngFrame({
      filePath: path.join(tempDir, fileName),
      line,
      progress,
      styleConfig,
      textLayerMode,
    });

    return fileName;
  };
}

async function createConcatTimeline({ project, tempDir, textLayerMode }) {
  const sectionBounds = getSectionBounds(project.audio);
  const lyricLeadInMs = normalizeLyricLeadInMs(project.timing?.lyricLeadInMs);
  const timedLines = getTimedLines(project.lines).filter(
    (line) =>
      Number.isFinite(line.start) &&
      line.start >= sectionBounds.startOffset &&
      line.start < sectionBounds.endOffset,
  );
  const entries = [];
  const writeFrame = await createFrameWriter({
    styleConfig: project.style,
    tempDir,
    textLayerMode,
  });
  const blankFrame = await writeFrame(null, 1);
  let cursorTime = sectionBounds.startOffset;

  if (!timedLines.length) {
    addConcatEntry(entries, blankFrame, sectionBounds.sectionDuration);

    return entries;
  }

  for (let index = 0; index < timedLines.length; index += 1) {
    const line = timedLines[index];
    const displayStart = getLineDisplayStart(
      line,
      project.audio,
      lyricLeadInMs,
    );
    const lineStart = clampNumber(
      displayStart ?? line.start,
      sectionBounds.startOffset,
      sectionBounds.endOffset,
    );

    if (lineStart > cursorTime) {
      addConcatEntry(entries, blankFrame, lineStart - cursorTime);
    }

    const nextLine = timedLines[index + 1];
    const rawLineEnd = nextLine
      ? getLineDisplayStart(nextLine, project.audio, lyricLeadInMs)
      : sectionBounds.endOffset;
    const lineEnd = clampNumber(
      rawLineEnd,
      sectionBounds.startOffset,
      sectionBounds.endOffset,
    );
    const lineDuration = lineEnd - lineStart;

    if (lineDuration > 0) {
      const animationDuration =
        project.style.animation?.type === "none"
          ? 0
          : Math.min(
              lineDuration,
              Math.max(0, (project.style.animation?.durationMs ?? 350) / 1000),
            );
      const animationFrameCount =
        animationDuration > 0
          ? Math.max(1, Math.ceil(animationDuration * TEXT_LAYER_RENDER_FPS))
          : 0;
      const animationFrameDuration = animationFrameCount
        ? animationDuration / animationFrameCount
        : 0;
      let fullyVisibleFrame = null;

      for (let frame = 0; frame < animationFrameCount; frame += 1) {
        const progress = (frame + 1) / animationFrameCount;
        const fileName = await writeFrame(line, progress);
        fullyVisibleFrame = progress === 1 ? fileName : fullyVisibleFrame;
        addConcatEntry(entries, fileName, animationFrameDuration);
      }

      const holdDuration = lineDuration - animationDuration;

      if (holdDuration > 0) {
        const fileName = fullyVisibleFrame ?? (await writeFrame(line, 1));
        addConcatEntry(entries, fileName, holdDuration);
      }
    }

    cursorTime = Math.max(cursorTime, lineEnd);
  }

  if (cursorTime < sectionBounds.endOffset) {
    addConcatEntry(entries, blankFrame, sectionBounds.endOffset - cursorTime);
  }

  return entries;
}

function createConcatList(entries) {
  const lines = [];

  for (const entry of entries) {
    lines.push(`file '${entry.fileName}'`);
    lines.push(`duration ${entry.duration.toFixed(6)}`);
  }

  if (entries.length) {
    lines.push(`file '${entries[entries.length - 1].fileName}'`);
  }

  return `${lines.join("\n")}\n`;
}

function parseFfmpegProgressTime(value) {
  if (!value) {
    return null;
  }

  if (/^\d+$/.test(value)) {
    return Number(value) / 1_000_000;
  }

  const match = value.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);

  if (!match) {
    return null;
  }

  return (
    Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
  );
}

function getFfmpegEncodeArgs(textLayerMode) {
  if (textLayerMode === "chroma") {
    return [
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-profile:v",
      "high444",
      "-pix_fmt",
      "yuv444p",
      "-movflags",
      "+faststart",
    ];
  }

  return [
    "-c:v",
    "prores_ks",
    "-profile:v",
    "4",
    "-pix_fmt",
    "yuva444p10le",
    "-alpha_bits",
    "8",
    "-qscale:v",
    "13",
    "-vendor",
    "apl0",
  ];
}

function encodeConcatVideo({
  duration,
  listPath,
  onProgress,
  outputLocation,
  textLayerMode,
}) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostats",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-r",
        String(TEXT_LAYER_RENDER_FPS),
        ...getFfmpegEncodeArgs(textLayerMode),
        "-progress",
        "pipe:1",
        outputLocation,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    let stdoutBuffer = "";

    ffmpeg.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const [key, value] = line.split("=");

        if (key !== "out_time" && key !== "out_time_us" && key !== "out_time_ms") {
          continue;
        }

        const time = parseFfmpegProgressTime(value);

        if (time != null && duration > 0) {
          onProgress?.(clampNumber(time / duration, 0, 1));
        }
      }
    });

    ffmpeg.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          stderr.trim() ||
            `FFmpeg text-layer encode failed with exit code ${code ?? "unknown"}.`,
        ),
      );
    });
  });
}

export async function renderChromaTextLayer({
  onProgress,
  outputLocation,
  project,
  textLayerMode = "chroma",
}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "reel-text-layer-"));

  try {
    onProgress?.(0.08);
    const entries = await createConcatTimeline({
      project,
      tempDir,
      textLayerMode,
    });
    const listPath = path.join(tempDir, "concat.txt");
    await writeFile(listPath, createConcatList(entries), "utf8");
    onProgress?.(0.2);
    await encodeConcatVideo({
      duration: getSectionBounds(project.audio).sectionDuration,
      listPath,
      onProgress: (progress) => onProgress?.(0.2 + progress * 0.76),
      outputLocation,
      textLayerMode,
    });
    onProgress?.(0.98);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}
