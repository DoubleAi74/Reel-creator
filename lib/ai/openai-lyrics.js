import {
  alignLyricLinesToWordTimings,
  summarizeLyricTimingMatches,
  tokenizeForTiming,
} from "../lyric-timing";
import {
  applyGptQualityVerdicts,
  auditLyricTimingResult,
  markQualityAuditUnavailable,
} from "../lyric-quality";
import { phoneticKey } from "../phonetics";
import { cutAudioWindow, splitAudioIntoChunks } from "./audio-chunks";
import { hasUsableTimedWordDuration } from "../timestamp-words";
import { applyWordMeaningsToLines } from "../word-meanings";

const TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";
const RESPONSES_URL = "https://api.openai.com/v1/responses";
// Accurate transcription of the lyric CONTENT (no timestamps). gpt-4o-transcribe
// hallucinates far less than whisper over instrumentals (it returns "♪"), so it
// is the source of truth for what is sung; whisper-1 supplies only the timing.
const CONTENT_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";
const TIMESTAMP_TRANSCRIPTION_MODEL = "whisper-1";
const LINE_BREAK_MODEL = "gpt-4o";
const TRANSLATION_MODEL = "gpt-5.4-mini";
const QA_AUDIT_MODEL = process.env.OPENAI_QA_AUDIT_MODEL ?? "gpt-4o-mini";
const SOURCE_REPAIR_MODEL =
  process.env.OPENAI_SOURCE_REPAIR_MODEL ?? "gpt-5.4-mini";
const DEFAULT_LYRIC_POLISH_MODEL = "gpt-5.4";
const LYRIC_POLISH_MODEL =
  process.env.OPENAI_LYRIC_POLISH_MODEL ?? DEFAULT_LYRIC_POLISH_MODEL;
const TIMING_PROMPT_MODE = String(
  process.env.OPENAI_TIMING_PROMPT_MODE ?? "lyrics",
)
  .trim()
  .toLowerCase();

const OPENAI_MAX_ATTEMPTS = Math.max(
  1,
  Number(process.env.OPENAI_MAX_ATTEMPTS ?? 3),
);
const OPENAI_RETRY_BASE_DELAY_MS = 1000;
// Chunks are short, so a single transcription request should never need
// minutes. Keep the per-request ceiling tight so the whole job stays well
// under the HTTP server's request timeout even across several chunks.
const OPENAI_REQUEST_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.OPENAI_REQUEST_TIMEOUT_MS ?? 90_000),
);
// Length of each audio segment sent to the transcription endpoint. Smaller
// chunks transcribe fast and make transient 5xx retries cheap.
const TRANSCRIPTION_CHUNK_SECONDS = Math.max(
  10,
  Number(process.env.OPENAI_TRANSCRIPTION_CHUNK_SECONDS ?? 45),
);
// When merging overlapping chunks, a word is a true overlap duplicate only if an
// identical word was already kept within this many seconds — tight enough not to
// remove a genuine fast repeat of a common word.
const TRANSCRIPTION_DEDUP_WINDOW_SECONDS = 0.5;
const TRANSCRIPTION_DEDUP_LOOKBACK = 12;
const GAP_WINDOW_PADDING_SECONDS = 0.5;
const TIGHT_GAP_WINDOW_PADDING_SECONDS = 1;
const MIN_GAP_WINDOW_SECONDS = 1.5;

// Whisper hallucinates lyrics over instrumental/silent audio. Its verbose_json
// segments carry confidence signals we use to drop those phantom segments:
// - no_speech_prob: likelihood the audio is non-speech (high => instrumental).
// - avg_logprob: token confidence (very low => the model was guessing).
// - compression_ratio: high => repetitive text, a classic hallucination tell.
const HALLUCINATION_NO_SPEECH_PROB_MAX = Number(
  process.env.OPENAI_NO_SPEECH_PROB_MAX ?? 0.6,
);
const HALLUCINATION_AVG_LOGPROB_MIN = Number(
  process.env.OPENAI_AVG_LOGPROB_MIN ?? -1,
);
const HALLUCINATION_COMPRESSION_RATIO_MAX = Number(
  process.env.OPENAI_COMPRESSION_RATIO_MAX ?? 2.4,
);

// gpt-4o-transcribe accepts up to 25 MB. Below this we transcribe the whole song
// in one call — that preserves punctuation and cross-line context the line
// formatter relies on. Larger files fall back to (non-overlapping) chunks.
const CONTENT_SINGLE_CALL_MAX_BYTES = Number(
  process.env.OPENAI_CONTENT_SINGLE_CALL_MAX_MB ?? 24,
) * 1024 * 1024;
// A whole-song content call isn't chunked, so allow it longer than the per-chunk
// ceiling (a 5-minute song takes ~40s).
const CONTENT_REQUEST_TIMEOUT_MS = Math.max(
  OPENAI_REQUEST_TIMEOUT_MS,
  Number(process.env.OPENAI_CONTENT_REQUEST_TIMEOUT_MS ?? 240_000),
);

const SOURCE_LANGUAGES = {
  ar: {
    label: "Arabic",
    transcriptionLanguage: "ar",
  },
  auto: {
    label: "Auto-detect",
    transcriptionLanguage: null,
  },
  es: {
    label: "Spanish",
    transcriptionLanguage: "es",
  },
  fr: {
    label: "French",
    transcriptionLanguage: "fr",
  },
  hi: {
    label: "Hindi",
    transcriptionLanguage: "hi",
  },
  ja: {
    label: "Japanese",
    transcriptionLanguage: "ja",
  },
  ko: {
    label: "Korean",
    transcriptionLanguage: "ko",
  },
  other: {
    label: "Other",
    transcriptionLanguage: null,
  },
  zh: {
    label: "Chinese",
    transcriptionLanguage: "zh",
  },
};

function timingPromptsEnabled() {
  return !["0", "false", "none", "off"].includes(TIMING_PROMPT_MODE);
}

// OpenAI strict json_schema requires every property to be listed in `required`,
// so romanization is added to both when requested rather than made optional.
function buildLyricLinesSchema(includeRomanization) {
  const properties = {
    line_number: { type: "integer", minimum: 1 },
    original: { type: "string" },
    translation: { type: "string" },
  };
  const required = ["line_number", "original", "translation"];

  if (includeRomanization) {
    properties.romanization = { type: "string" };
    required.push("romanization");
  }

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      lines: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          properties,
          required,
        },
      },
    },
    required: ["lines"],
  };
}

const LYRIC_QA_AUDIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          line_number: { type: "integer", minimum: 1 },
          reason: { type: "string" },
          verdict: {
            type: "string",
            enum: ["supported", "questionable", "unsupported"],
          },
        },
        required: ["line_number", "verdict", "reason"],
      },
    },
  },
  required: ["lines"],
};

const LYRIC_SOURCE_REPAIR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          change_type: {
            type: "string",
            enum: [
              "transcription_error",
              "orthographic_standardization",
              "possible_artist_style",
            ],
          },
          confidence: {
            type: "string",
            enum: ["high", "medium", "low"],
          },
          corrected_original: { type: "string" },
          evidence_type: {
            type: "string",
            enum: [
              "context",
              "repeat_consensus",
              "language_knowledge",
              "possible_artist_style",
            ],
          },
          line_number: { type: "integer", minimum: 1 },
          reason: { type: "string" },
        },
        required: [
          "line_number",
          "change_type",
          "confidence",
          "corrected_original",
          "evidence_type",
          "reason",
        ],
      },
    },
  },
  required: ["changes"],
};

function buildLyricPolishSchema({ allowOriginalChanges, includeRomanization }) {
  const properties = {
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
    },
    change_type: {
      type: "string",
      enum: [
        "semantic_error",
        "translation_error",
        "romanization_error",
        "orthographic_standardization",
        "possible_artist_style",
      ],
    },
    corrected_translation: { type: "string" },
    line_number: { type: "integer", minimum: 1 },
    reason: { type: "string" },
  };
  const required = [
    "line_number",
    "change_type",
    "confidence",
    "corrected_translation",
    "reason",
  ];

  if (allowOriginalChanges) {
    properties.corrected_original = { type: "string" };
    required.push("corrected_original");
  }

  if (includeRomanization) {
    properties.corrected_romanization = { type: "string" };
    required.push("corrected_romanization");
  }

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      changes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties,
          required,
        },
      },
    },
    required: ["changes"],
  };
}

function getApiKey() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY for auto-lyrics transcription.");
  }

  return apiKey;
}

export function normalizeSourceLanguage(sourceLanguage, otherLanguage = "") {
  const sourceLanguageId =
    typeof sourceLanguage === "string" && SOURCE_LANGUAGES[sourceLanguage]
      ? sourceLanguage
      : "auto";
  const sourceLanguageConfig = SOURCE_LANGUAGES[sourceLanguageId];

  if (sourceLanguageId !== "other") {
    return {
      id: sourceLanguageId,
      label: sourceLanguageConfig.label,
      transcriptionLanguage: sourceLanguageConfig.transcriptionLanguage,
    };
  }

  const label = cleanTextField(otherLanguage);

  if (!label) {
    throw new Error("Type the source language before using Other.");
  }

  if (label.length > 60) {
    throw new Error("Keep the source language under 60 characters.");
  }

  return {
    id: "other",
    label,
    transcriptionLanguage: null,
  };
}

// Whisper's auto-detect mishandles some scripts (e.g. it returns a mix of
// Gurmukhi/Latin/Devanagari for Hindi audio), which then matches nothing. When
// the user hasn't pinned a language but typed lyrics in a recognizable script,
// infer the transcription language from that script.
const SCRIPT_LANGUAGE_RANGES = [
  { language: "hi", pattern: /[ऀ-ॿ]/ }, // Devanagari
  { language: "ar", pattern: /[؀-ۿ]/ }, // Arabic
  { language: "ko", pattern: /[가-힣]/ }, // Hangul
  { language: "ja", pattern: /[぀-ヿ]/ }, // Hiragana / Katakana
  { language: "zh", pattern: /[一-鿿]/ }, // Han
];

function detectTranscriptionLanguageFromText(text) {
  const sample = String(text || "");

  for (const { language, pattern } of SCRIPT_LANGUAGE_RANGES) {
    if (pattern.test(sample)) {
      return language;
    }
  }

  return null;
}

// Return a source-language config whose transcriptionLanguage is filled in from
// the lyric script when the user left it unset (Auto / Other).
function resolveTranscriptionLanguage(sourceLanguage, lyricLineInputs) {
  if (sourceLanguage.transcriptionLanguage) {
    return sourceLanguage;
  }

  const sampleText = lyricLineInputs
    .map((line) => line.text)
    .join(" ");
  const detected = detectTranscriptionLanguageFromText(sampleText);

  if (!detected) {
    return sourceLanguage;
  }

  console.log(
    `[auto-time] Source language is "${sourceLanguage.id}"; detected ${detected} from lyric script. Passing language=${detected} to Whisper.`,
  );

  return {
    ...sourceLanguage,
    transcriptionLanguage: detected,
  };
}

function hasUsableLineTiming(match) {
  return (
    ["high", "medium", "low", "estimated"].includes(match?.confidence) &&
    Number.isFinite(match.start)
  );
}

function isConfidentWordMatch(match) {
  return (
    match?.timingSource === "word-match" &&
    ["high", "medium"].includes(match.confidence) &&
    Number.isFinite(match.start)
  );
}

function isGapFillTarget(match) {
  if (!match || !Number.isFinite(match.start)) {
    return true;
  }

  return (
    match.timingSource === "interpolated" ||
    match.timingSource === "none" ||
    match.confidence === "estimated" ||
    match.confidence === "none" ||
    match.confidence === "low"
  );
}

function getGapFillTargetIndexes(matches) {
  return matches
    .map((match, index) => (isGapFillTarget(match) ? index : null))
    .filter((index) => index !== null);
}

function getAudioBoundsForGapFill(audio = {}, fallbackDuration = 0) {
  const start = Number.isFinite(audio?.startOffset) ? Math.max(0, audio.startOffset) : 0;
  const rawEnd =
    audio?.endOffset == null || !Number.isFinite(audio.endOffset)
      ? Number.isFinite(fallbackDuration) && fallbackDuration > start
        ? fallbackDuration
        : Number.isFinite(audio?.duration) && audio.duration > start
          ? audio.duration
          : null
      : audio.endOffset;
  const end = Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : null;

  return { end, start };
}

function getMatchEnd(match) {
  if (Number.isFinite(match?.end)) {
    return match.end;
  }

  return Number.isFinite(match?.start) ? match.start : null;
}

function groupContiguousIndexes(indexes) {
  const groups = [];

  for (const index of indexes) {
    const current = groups.at(-1);

    if (current && index === current.at(-1) + 1) {
      current.push(index);
    } else {
      groups.push([index]);
    }
  }

  return groups;
}

function findPreviousAnchor(matches, beforeIndex) {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    if (isConfidentWordMatch(matches[index])) {
      return matches[index];
    }
  }

  return null;
}

function findNextAnchor(matches, afterIndex) {
  for (let index = afterIndex + 1; index < matches.length; index += 1) {
    if (isConfidentWordMatch(matches[index])) {
      return matches[index];
    }
  }

  return null;
}

function estimateLineDurationSeconds(match) {
  const tokenCount = tokenizeForTiming(match?.original).length;

  return Math.min(8, Math.max(1.6, tokenCount * 0.42));
}

function clampGapWindow({ bounds, end, minSeconds = MIN_GAP_WINDOW_SECONDS, start }) {
  const lowerBound = Number.isFinite(bounds.start) ? bounds.start : 0;
  const upperBound = Number.isFinite(bounds.end) ? bounds.end : null;
  let windowStart = Number.isFinite(start) ? start : lowerBound;
  let windowEnd = Number.isFinite(end) ? end : upperBound;

  windowStart = Math.max(lowerBound, windowStart);

  if (upperBound !== null) {
    windowEnd = Math.min(upperBound, windowEnd);
  }

  if (!Number.isFinite(windowEnd)) {
    windowEnd = windowStart + minSeconds;
  }

  if (windowEnd - windowStart < minSeconds) {
    const center = (windowStart + windowEnd) / 2;
    windowStart = center - minSeconds / 2;
    windowEnd = center + minSeconds / 2;

    if (windowStart < lowerBound) {
      windowEnd += lowerBound - windowStart;
      windowStart = lowerBound;
    }

    if (upperBound !== null && windowEnd > upperBound) {
      windowStart -= windowEnd - upperBound;
      windowEnd = upperBound;
      windowStart = Math.max(lowerBound, windowStart);
    }
  }

  if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) {
    return null;
  }

  if (windowEnd - windowStart <= 0) {
    return null;
  }

  return {
    end: windowEnd,
    start: windowStart,
  };
}

function mergeGapWindows(windows) {
  const sortedWindows = windows
    .filter(Boolean)
    .sort((left, right) => left.start - right.start);
  const merged = [];

  for (const window of sortedWindows) {
    const current = merged.at(-1);

    if (!current || window.start > current.end + 0.2) {
      merged.push({
        ...window,
        lineIndexes: [...new Set(window.lineIndexes)].sort((a, b) => a - b),
      });
      continue;
    }

    current.end = Math.max(current.end, window.end);
    current.lineIndexes = [...new Set([...current.lineIndexes, ...window.lineIndexes])].sort(
      (a, b) => a - b,
    );
  }

  return merged;
}

function buildAnchoredGapWindows({ audio, duration, matches }) {
  const bounds = getAudioBoundsForGapFill(audio, duration);
  const targetRuns = groupContiguousIndexes(getGapFillTargetIndexes(matches));
  const windows = [];

  for (const run of targetRuns) {
    const runStartIndex = run[0];
    const runEndIndex = run.at(-1);
    const previousAnchor = findPreviousAnchor(matches, runStartIndex);
    const nextAnchor = findNextAnchor(matches, runEndIndex);
    const firstGap = matches[runStartIndex];
    const lastGap = matches[runEndIndex];
    const estimatedStart = Number.isFinite(firstGap?.start) ? firstGap.start : null;
    const estimatedEnd = getMatchEnd(lastGap);
    const start =
      getMatchEnd(previousAnchor) ??
      (estimatedStart !== null ? estimatedStart - TIGHT_GAP_WINDOW_PADDING_SECONDS : bounds.start);
    const end =
      (Number.isFinite(nextAnchor?.start) ? nextAnchor.start : null) ??
      (estimatedEnd !== null
        ? estimatedEnd + TIGHT_GAP_WINDOW_PADDING_SECONDS
        : bounds.end);
    const window = clampGapWindow({
      bounds,
      end: end == null ? null : end + GAP_WINDOW_PADDING_SECONDS,
      start: start - GAP_WINDOW_PADDING_SECONDS,
    });

    if (window) {
      windows.push({
        ...window,
        lineIndexes: run,
      });
    }
  }

  return mergeGapWindows(windows);
}

function buildTightGapWindows({ audio, duration, matches }) {
  const bounds = getAudioBoundsForGapFill(audio, duration);
  const windows = [];

  for (const lineIndex of getGapFillTargetIndexes(matches)) {
    const match = matches[lineIndex];

    if (!Number.isFinite(match?.start)) {
      continue;
    }

    const estimatedEnd = Number.isFinite(match.end)
      ? match.end
      : match.start + estimateLineDurationSeconds(match);
    const window = clampGapWindow({
      bounds,
      end: estimatedEnd + TIGHT_GAP_WINDOW_PADDING_SECONDS,
      start: match.start - TIGHT_GAP_WINDOW_PADDING_SECONDS,
    });

    if (window) {
      windows.push({
        ...window,
        lineIndexes: [lineIndex],
      });
    }
  }

  return mergeGapWindows(windows);
}

function mergeTranscriptionWords(existingWords, newWords) {
  const entries = [
    ...normalizeTimestampWords(existingWords).map((word) => ({ source: 0, word })),
    ...normalizeTimestampWords(newWords).map((word) => ({ source: 1, word })),
  ].sort((left, right) => {
    if (left.word.start !== right.word.start) {
      return left.word.start - right.word.start;
    }

    return left.source - right.source;
  });
  const merged = [];

  for (const entry of entries) {
    if (isOverlapDuplicateWord(merged, entry.word.word, entry.word.start)) {
      continue;
    }

    merged.push(entry.word);
  }

  return merged;
}

async function transcribeGapWindows({
  contentType,
  fileBuffer,
  fileName,
  lines,
  onProgress,
  passNumber,
  sourceLanguage,
  windows,
}) {
  const words = [];
  const errors = [];

  for (let index = 0; index < windows.length; index += 1) {
    const window = windows[index];
    const windowLines = window.lineIndexes
      .map((lineIndex) => lines[lineIndex])
      .filter(Boolean);
    const transcriptionPrompt = buildTimingTranscriptionPrompt(windowLines);

    notifyProgress(onProgress, {
      detail: `Re-transcribing ${formatTimeRange(window.start, window.end)} for ${
        windowLines.length
      } weak lyric line${windowLines.length === 1 ? "" : "s"}.`,
      stage: `timing-pass-${passNumber}`,
      title: `Timing pass ${passNumber}`,
    });

    try {
      const audioWindow = await cutAudioWindow({
        end: window.end,
        fileBuffer,
        fileName,
        start: window.start,
      });
      const result = await requestTimestampedTranscription({
        allowEmptyWords: true,
        contentType: audioWindow.contentType || contentType,
        fileBuffer: audioWindow.buffer,
        fileName: audioWindow.fileName || `timing-pass-${passNumber}-${index + 1}.mp3`,
        sourceLanguage,
        transcriptionPrompt,
      });
      const offset = Number.isFinite(audioWindow.start) ? audioWindow.start : window.start;

      for (const word of result.words) {
        words.push({
          end: word.end + offset,
          start: word.start + offset,
          word: word.word,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({
        end: window.end,
        lineIndexes: window.lineIndexes,
        message,
        start: window.start,
      });
      console.warn(
        `[auto-time] Timing pass ${passNumber} window ${formatTimeRange(
          window.start,
          window.end,
        )} failed: ${message}`,
      );
    }
  }

  return {
    errors,
    windowCount: windows.length,
    words,
  };
}

function formatTimeRange(start, end) {
  const format = (value) => (Number.isFinite(value) ? `${value.toFixed(2)}s` : "?");

  return `${format(start)}-${format(end)}`;
}

const LEADING_REPEAT_VOCABLE_KEYS = new Set(["o", "oh"]);

function getRepeatTemplateTokens(value) {
  return tokenizeForTiming(value)
    .map((token) => phoneticKey(token))
    .filter(Boolean);
}

function getRepeatTemplateEntries(value) {
  const tokens = getRepeatTemplateTokens(value);
  const entries = [];

  if (tokens.length > 0) {
    entries.push({
      key: tokens.join("|"),
      leadingWordCount: 0,
    });
  }

  if (tokens.length > 1 && LEADING_REPEAT_VOCABLE_KEYS.has(tokens[0])) {
    entries.push({
      key: tokens.slice(1).join("|"),
      leadingWordCount: 1,
    });
  }

  return entries;
}

function splitDisplayWords(text) {
  return String(text || "").match(/\S+/gu) ?? [];
}

function buildLeadingTemplateWords({ leadDuration, targetStart, targetWords }) {
  if (!targetWords.length) {
    return [];
  }

  const wordDuration = leadDuration / targetWords.length;

  return targetWords.map((text, index) => ({
    end: targetStart + wordDuration * (index + 1),
    start: targetStart + wordDuration * index,
    text,
  }));
}

function buildTemplatedWords({
  targetLeadingWordCount,
  targetMatch,
  targetStart,
  templateLeadingWordCount,
  templateMatch,
}) {
  const allTemplateWords = Array.isArray(templateMatch?.words) ? templateMatch.words : [];
  const templateWords = allTemplateWords.slice(templateLeadingWordCount);
  const targetWords = splitDisplayWords(targetMatch?.original);
  const retainedTemplateStart = Number(templateWords[0]?.start);

  if (!templateWords.length || !Number.isFinite(retainedTemplateStart)) {
    return [];
  }

  const leadDuration =
    targetLeadingWordCount > 0
      ? Math.min(
          0.6,
          Math.max(
            0.25,
            Number.isFinite(templateWords[0].end - templateWords[0].start)
              ? templateWords[0].end - templateWords[0].start
              : 0.35,
          ),
        )
      : 0;
  const leadingWords = buildLeadingTemplateWords({
    leadDuration,
    targetStart,
    targetWords: targetWords.slice(0, targetLeadingWordCount),
  });
  const templateAnchorStart = targetStart + leadDuration;
  const mappedWords = templateWords.map((word, index) => ({
    end: templateAnchorStart + (word.end - retainedTemplateStart),
    start: templateAnchorStart + (word.start - retainedTemplateStart),
    text: targetWords[targetLeadingWordCount + index] ?? word.text ?? "",
  }));

  return [...leadingWords, ...mappedWords];
}

function applyRepeatTemplates(matches) {
  const templatesByKey = new Map();

  for (const match of matches) {
    if (!isConfidentWordMatch(match) || !Array.isArray(match.words) || !match.words.length) {
      continue;
    }

    for (const entry of getRepeatTemplateEntries(match.original)) {
      const templates = templatesByKey.get(entry.key) ?? [];
      templates.push({
        leadingWordCount: entry.leadingWordCount,
        match,
      });
      templatesByKey.set(entry.key, templates);
    }
  }

  return matches.map((match) => {
    if (!isGapFillTarget(match) || !Number.isFinite(match?.start)) {
      return match;
    }

    const candidates = getRepeatTemplateEntries(match.original).flatMap((entry) =>
      (templatesByKey.get(entry.key) ?? []).map((template) => ({
        targetLeadingWordCount: entry.leadingWordCount,
        template,
      })),
    );

    if (!candidates.length) {
      return match;
    }

    const candidate = candidates
      .filter((item) => item.template.match.index !== match.index)
      .sort(
        (left, right) =>
          Math.abs(left.template.match.start - match.start) -
            Math.abs(right.template.match.start - match.start),
      )[0];

    if (!candidate) {
      return match;
    }

    const template = candidate.template.match;
    const templateDuration =
      Number.isFinite(template.end) && Number.isFinite(template.start)
        ? Math.max(0.4, template.end - template.start)
        : estimateLineDurationSeconds(match);
    const words = buildTemplatedWords({
      targetLeadingWordCount: candidate.targetLeadingWordCount,
      targetMatch: match,
      targetStart: match.start,
      templateLeadingWordCount: candidate.template.leadingWordCount,
      templateMatch: template,
    });

    return {
      ...match,
      confidence: "medium",
      end: words.at(-1)?.end ?? match.start + templateDuration,
      matchRatio: Math.max(Number(match.matchRatio) || 0, Number(template.matchRatio) || 1),
      matchedWordCount: template.matchedWordCount ?? words.length,
      timingSource: "repeat-template",
      words,
    };
  });
}

function countByTimingSource(matches, source) {
  return matches.filter(
    (match) => Number.isFinite(match?.start) && match.timingSource === source,
  ).length;
}

async function fillTimingGaps({
  audio,
  contentType,
  duration,
  fileBuffer,
  fileName,
  lines,
  matches,
  onProgress,
  sourceLanguage,
  words,
}) {
  let currentWords = normalizeTimestampWords(words);
  let currentMatches = matches;
  const gapFillSummary = {
    finalWeakLineCount: 0,
    initialWeakLineCount: getGapFillTargetIndexes(currentMatches).length,
    pass2: {
      errorCount: 0,
      newWordCount: 0,
      windowCount: 0,
    },
    pass3: {
      errorCount: 0,
      newWordCount: 0,
      windowCount: 0,
    },
    repeatTemplateCount: 0,
    whisperPassCount: 1,
  };

  const pass2Windows = buildAnchoredGapWindows({
    audio,
    duration,
    matches: currentMatches,
  });

  if (pass2Windows.length > 0) {
    const pass2 = await transcribeGapWindows({
      contentType,
      fileBuffer,
      fileName,
      lines,
      onProgress,
      passNumber: 2,
      sourceLanguage,
      windows: pass2Windows,
    });

    gapFillSummary.pass2 = {
      errorCount: pass2.errors.length,
      newWordCount: pass2.words.length,
      windowCount: pass2.windowCount,
    };
    gapFillSummary.whisperPassCount = 2;

    if (pass2.words.length > 0) {
      currentWords = mergeTranscriptionWords(currentWords, pass2.words);
      currentMatches = alignLyricLinesToWordTimings(lines, currentWords, audio);
    }
  }

  const pass3Windows = buildTightGapWindows({
    audio,
    duration,
    matches: currentMatches,
  });

  if (pass3Windows.length > 0) {
    const pass3 = await transcribeGapWindows({
      contentType,
      fileBuffer,
      fileName,
      lines,
      onProgress,
      passNumber: 3,
      sourceLanguage,
      windows: pass3Windows,
    });

    gapFillSummary.pass3 = {
      errorCount: pass3.errors.length,
      newWordCount: pass3.words.length,
      windowCount: pass3.windowCount,
    };
    gapFillSummary.whisperPassCount = 3;

    if (pass3.words.length > 0) {
      currentWords = mergeTranscriptionWords(currentWords, pass3.words);
      currentMatches = alignLyricLinesToWordTimings(lines, currentWords, audio);
    }
  }

  const templatedMatches = applyRepeatTemplates(currentMatches);
  gapFillSummary.repeatTemplateCount = countByTimingSource(
    templatedMatches,
    "repeat-template",
  );
  gapFillSummary.finalWeakLineCount = getGapFillTargetIndexes(templatedMatches).length;

  return {
    gapFillSummary,
    matches: templatedMatches,
    words: currentWords,
  };
}

function normalizeLockedCanonicalLines(lines) {
  if (!Array.isArray(lines)) {
    return [];
  }

  return lines
    .map((line, index) => {
      const original = cleanTextField(line?.text ?? line?.original ?? line);

      if (!original) {
        return null;
      }

      return {
        id: typeof line?.id === "string" ? line.id : null,
        index: Number.isInteger(line?.index) ? line.index : index + 1,
        original,
        romanization: cleanTextField(line?.romanization),
        start: Number.isFinite(line?.start) ? line.start : null,
        translation: cleanTextField(line?.translation),
      };
    })
    .filter(Boolean);
}

function canonicalLinesToLyricInputs(lines) {
  return lines.map((line, index) => ({
    id: typeof line?.id === "string" ? line.id : null,
    index: Number.isInteger(line?.index) ? line.index : index + 1,
    original: line.original,
    text: line.original,
  }));
}

async function buildCanonicalLyricSet({
  contentType,
  fileBuffer,
  fileName,
  includeRomanization = false,
  lines,
  onProgress,
  onTranscriptDelta,
  sourceLanguage,
}) {
  const lockedLines = normalizeLockedCanonicalLines(lines);

  if (lockedLines.length > 0) {
    notifyProgress(onProgress, {
      detail: `Using ${lockedLines.length} existing lyric line${
        lockedLines.length === 1 ? "" : "s"
      } as the locked canonical set.`,
      stage: "canonical-lyrics",
      title: "Lyrics locked",
    });

    return {
      lines: lockedLines,
      source: "user",
      sourceRepairSummary: getEmptySourceRepairSummary("not-run", 0),
    };
  }

  notifyProgress(onProgress, {
    detail: "Transcribing lyric content with gpt-4o-transcribe.",
    stage: "canonical-lyrics",
    title: "Generating lyrics",
  });

  const transcriptionText = await requestContentTranscriptionResilient({
    contentType,
    fileBuffer,
    fileName,
    onProgress,
    sourceLanguage,
  });

  if (!transcriptionText) {
    throw new Error("The transcription produced no lyrics to format.");
  }

  onTranscriptDelta?.(transcriptionText, transcriptionText);

  notifyProgress(onProgress, {
    detail: "Breaking the transcript into short, natural lyric lines.",
    stage: "formatting",
    title: "Formatting lyric lines",
  });

  const lineBreakText = await requestLyricLineBreaks({
    sourceLanguage,
    text: transcriptionText,
  });
  const lyricLineInputs = normalizeTranscriptLineInput(null, lineBreakText);

  if (lyricLineInputs.length === 0) {
    throw new Error("The lyric line formatter returned no usable lines.");
  }

  const sourceRepairResult = await repairGeneratedSourceLines({
    lines: lyricLineInputs,
    onProgress,
    sourceLanguage,
    transcriptionText,
  });
  const repairedLyricLineInputs = sourceRepairResult.lines;

  notifyProgress(onProgress, {
    detail: `Translating ${repairedLyricLineInputs.length} lyric line${
      repairedLyricLineInputs.length === 1 ? "" : "s"
    } to English.`,
    stage: "translating",
    title: "Translating lyrics",
  });

  const translatedLines = await requestLyricTranslations({
    includeRomanization,
    lines: repairedLyricLineInputs,
    sourceLanguage,
  });

  return {
    lines: translatedLines.map((line, index) => ({
      id: null,
      index: index + 1,
      original: line.original,
      romanization: line.romanization ?? "",
      start: null,
      translation: line.translation ?? "",
    })),
    source: "generated",
    sourceRepairSummary: sourceRepairResult.sourceRepairSummary,
  };
}

export async function generateLyricsFromAudio({
  audio,
  contentType,
  fileBuffer,
  fileName,
  includeRomanization = false,
  onProgress,
  onTranscriptDelta,
  sourceLanguage,
}) {
  return runLyricTimingPipeline({
    audio,
    contentType,
    fileBuffer,
    fileName,
    includeRomanization,
    lines: [],
    onProgress,
    onTranscriptDelta,
    sourceLanguage,
  });
}

export async function runLyricTimingPipeline({
  audio,
  contentType,
  fileBuffer,
  fileName,
  includeRomanization = false,
  includeWordMeanings = false,
  lines,
  onProgress,
  onTranscriptDelta,
  sourceLanguage,
}) {
  const canonicalLyricSet = await buildCanonicalLyricSet({
    contentType,
    fileBuffer,
    fileName,
    includeRomanization,
    lines,
    onProgress,
    onTranscriptDelta,
    sourceLanguage,
  });
  const polishedLyricSet = await polishCanonicalLyricSet({
    canonicalSource: canonicalLyricSet.source,
    includeRomanization,
    lines: canonicalLyricSet.lines,
    onProgress,
    sourceLanguage,
  });
  const lyricLineInputs = canonicalLinesToLyricInputs(polishedLyricSet.lines);
  const effectiveSourceLanguage = resolveTranscriptionLanguage(
    sourceLanguage,
    lyricLineInputs,
  );
  const transcriptionPrompt = buildTimingTranscriptionPrompt(lyricLineInputs);

  notifyProgress(onProgress, {
    detail: "Requesting word-level timestamps for the locked lyric set.",
    stage: "timing-pass-1",
    title: "Transcribing timing words",
  });

  const timestampedTranscript = await requestTimestampedTranscriptionFromChunks({
    audio,
    contentType,
    fileBuffer,
    fileName,
    onProgress,
    sourceLanguage: effectiveSourceLanguage,
    transcriptionPrompt,
  });
  const initialTimingMatches = alignLyricLinesToWordTimings(
    lyricLineInputs,
    timestampedTranscript.words,
    audio,
  );
  const filledTiming = await fillTimingGaps({
    audio,
    contentType,
    duration: timestampedTranscript.duration,
    fileBuffer,
    fileName,
    lines: lyricLineInputs,
    matches: initialTimingMatches,
    onProgress,
    sourceLanguage: effectiveSourceLanguage,
    words: timestampedTranscript.words,
  });
  const timingMatches = filledTiming.matches;
  const timingSummary = summarizeLyricTimingMatches(timingMatches);
  const outputLines = polishedLyricSet.lines.map((line, index) => {
    const match = timingMatches[index];
    const timingFields = {
      confidence: match?.confidence ?? "none",
      end: Number.isFinite(match?.end) ? match.end : null,
      matchRatio: Number.isFinite(match?.matchRatio) ? match.matchRatio : 0,
      timingSource: match?.timingSource ?? "none",
      words: Array.isArray(match?.words) ? match.words : [],
    };

    if (hasUsableLineTiming(match)) {
      return {
        ...line,
        ...timingFields,
        start: match.start,
      };
    }

    return {
      ...line,
      ...timingFields,
      start: Number.isFinite(line.start) ? line.start : null,
    };
  });
  const qualityAudit = await runQualityAudit({
    audio,
    canonicalSource: canonicalLyricSet.source,
    gapFillSummary: filledTiming.gapFillSummary,
    lines: outputLines,
    matches: timingMatches,
    sourceLanguage: effectiveSourceLanguage,
    timingSummary,
    words: filledTiming.words,
  });
  const outputLinesWithQuality = outputLines.map((line, index) => ({
    ...line,
    quality: qualityAudit.qualities[index],
  }));

  // Coverage fill: add per-word gloss/roman for the Word Board (D-Gloss-Coverage).
  // Best-effort and opt-in — never blocks generation or alters timing.
  const { lines: linesWithMeanings, wordMeaningsSummary } =
    await attachWordMeaningsCoverage({
      enabled: includeWordMeanings,
      includeRomanization,
      lines: outputLinesWithQuality,
      onProgress,
      sourceLanguage: effectiveSourceLanguage,
    });

  notifyProgress(onProgress, {
    detail: `Locked ${outputLines.length} lyric line${
      outputLines.length === 1 ? "" : "s"
    } and matched ${timingSummary.matchedCount}.`,
    stage: "complete",
    title: "Timing pipeline complete",
  });

  return {
    canonicalLineCount: outputLines.length,
    canonicalSource: canonicalLyricSet.source,
    duration: timestampedTranscript.duration,
    gapFillSummary: filledTiming.gapFillSummary,
    language: timestampedTranscript.language,
    lineCount: outputLines.length,
    lines: linesWithMeanings,
    wordMeaningsSummary,
    lyricPolishSummary: polishedLyricSet.lyricPolishSummary,
    matches: timingMatches,
    qualitySummary: qualityAudit.qualitySummary,
    sourceLanguage: effectiveSourceLanguage.label,
    sourceRepairSummary: canonicalLyricSet.sourceRepairSummary,
    timingLanguage: effectiveSourceLanguage.transcriptionLanguage,
    timingSummary,
    wordCount: filledTiming.words.length,
    words: filledTiming.words,
  };
}

export async function autoTimeLyricLinesFromAudio({
  audio,
  contentType,
  fileBuffer,
  fileName,
  lines,
  onProgress,
  sourceLanguage,
}) {
  return runLyricTimingPipeline({
    audio,
    contentType,
    fileBuffer,
    fileName,
    includeRomanization: false,
    lines,
    onProgress,
    sourceLanguage,
  });
}

export async function getWordTimingsFromAudio({
  audio,
  contentType,
  fileBuffer,
  fileName,
  onProgress,
  sourceLanguage,
}) {
  const timestampedTranscript = await requestTimestampedTranscriptionFromChunks({
    audio,
    contentType,
    fileBuffer,
    fileName,
    onProgress,
    sourceLanguage,
  });

  return {
    duration: timestampedTranscript.duration,
    language: timestampedTranscript.language,
    text: timestampedTranscript.text,
    wordCount: timestampedTranscript.words.length,
    words: timestampedTranscript.words,
  };
}

// Strip music symbols (gpt-4o-transcribe emits "♪" for instrumental passages)
// so they don't become phantom lyric lines.
function cleanTranscriptContent(text) {
  return String(text || "")
    .replace(/[♪♫♬♩🎵🎶]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Accurate, timestamp-free transcription of the lyric content via
// gpt-4o-transcribe (response_format "json"; verbose_json is unsupported).
async function requestContentTranscription({
  contentType,
  fileBuffer,
  fileName,
  sourceLanguage,
  timeoutMs = OPENAI_REQUEST_TIMEOUT_MS,
  transcriptionPrompt = "",
}) {
  const formData = new FormData();
  const audioBlob = new Blob([fileBuffer], {
    type: contentType || "audio/mpeg",
  });

  formData.append("file", audioBlob, fileName || "audio.mp3");
  formData.append("model", CONTENT_TRANSCRIPTION_MODEL);
  formData.append("response_format", "json");

  if (transcriptionPrompt) {
    formData.append("prompt", transcriptionPrompt);
  }

  if (sourceLanguage.transcriptionLanguage) {
    formData.append("language", sourceLanguage.transcriptionLanguage);
  }

  const response = await fetchOpenAiWithRetry(
    TRANSCRIPTION_URL,
    {
      body: formData,
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
      },
      method: "POST",
    },
    { label: "Content transcription", timeoutMs },
  );
  const rawText = await response.text();
  const data = tryParseJson(rawText);

  if (!response.ok) {
    throw new Error(formatApiError(response.status, data, rawText));
  }

  return cleanTranscriptContent(typeof data?.text === "string" ? data.text : "");
}

// Accurate lyric content via gpt-4o-transcribe. A whole song (≤25 MB) goes in
// one call to preserve punctuation and cross-line context; only oversized files
// are split into non-overlapping chunks (overlap would duplicate lyrics, and
// there are no word timings to stitch here).
async function requestContentTranscriptionResilient({
  contentType,
  fileBuffer,
  fileName,
  onProgress,
  sourceLanguage,
  transcriptionPrompt = "",
}) {
  if (fileBuffer.length <= CONTENT_SINGLE_CALL_MAX_BYTES) {
    return requestContentTranscription({
      contentType,
      fileBuffer,
      fileName,
      sourceLanguage,
      timeoutMs: CONTENT_REQUEST_TIMEOUT_MS,
      transcriptionPrompt,
    });
  }

  let chunks = null;

  try {
    chunks = await splitAudioIntoChunks({
      chunkSeconds: TRANSCRIPTION_CHUNK_SECONDS,
      fileBuffer,
      fileName,
      overlapSeconds: 0,
    });
  } catch {
    chunks = null;
  }

  if (!chunks || chunks.length === 0) {
    return requestContentTranscription({
      contentType,
      fileBuffer,
      fileName,
      sourceLanguage,
      timeoutMs: CONTENT_REQUEST_TIMEOUT_MS,
      transcriptionPrompt,
    });
  }

  const texts = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];

    notifyProgress(onProgress, {
      detail: `Transcribing lyrics from segment ${index + 1} of ${chunks.length}.`,
      stage: "transcribing",
      title: "Transcribing audio",
    });

    const text = await requestContentTranscription({
      contentType: chunk.contentType || contentType,
      fileBuffer: chunk.buffer,
      fileName: chunk.fileName || `segment-${index + 1}.mp3`,
      sourceLanguage,
      transcriptionPrompt,
    });

    if (text) {
      texts.push(text);
    }
  }

  return texts.join(" ").trim();
}

async function requestTimestampedTranscription({
  allowEmptyWords = false,
  contentType,
  fileBuffer,
  fileName,
  onPlainTranscriptionFallback = null,
  onProgress,
  sourceLanguage,
  transcriptionPrompt = "",
}) {
  const formData = new FormData();
  const audioBlob = new Blob([fileBuffer], {
    type: contentType || "audio/mpeg",
  });

  formData.append("file", audioBlob, fileName || "audio.mp3");
  formData.append("model", TIMESTAMP_TRANSCRIPTION_MODEL);
  formData.append("response_format", "verbose_json");
  formData.append("timestamp_granularities[]", "word");

  // Whisper's `prompt` is a transcript-style context hint, not an instruction.
  // A long English instruction makes it romanize / echo / hallucinate, so only
  // send a prompt when we have real in-language text (the user's lyrics) to
  // bias spelling toward the correct script.
  if (transcriptionPrompt) {
    formData.append("prompt", transcriptionPrompt);
  }

  if (sourceLanguage.transcriptionLanguage) {
    formData.append("language", sourceLanguage.transcriptionLanguage);
  }

  const response = await fetchOpenAiWithRetry(
    TRANSCRIPTION_URL,
    {
      body: formData,
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
      },
      method: "POST",
    },
    { label: "Audio transcription" },
  );
  const rawText = await response.text();
  const data = tryParseJson(rawText);

  if (!response.ok) {
    if (onPlainTranscriptionFallback) {
      notifyProgress(onProgress, {
        detail: "Word timestamps were unavailable, trying plain transcription.",
        stage: "transcribing",
        title: "Falling back",
      });

      const text = await onPlainTranscriptionFallback();

      return {
        duration: 0,
        language: sourceLanguage.label,
        text,
        words: [],
      };
    }

    throw new Error(formatApiError(response.status, data, rawText));
  }

  // Drop words/text from segments whisper flagged as low-confidence or
  // non-speech — these are the phantom lyrics it invents over instrumentals.
  const hallucinatedRanges = getHallucinatedSegmentRanges(data?.segments);
  const words = dropHallucinatedWords(
    normalizeTimestampWords(data?.words),
    hallucinatedRanges,
  );

  if (words.length === 0) {
    if (onPlainTranscriptionFallback) {
      const text = await onPlainTranscriptionFallback();

      return {
        duration: 0,
        language: sourceLanguage.label,
        text,
        words: [],
      };
    }

    // A silent / instrumental segment legitimately has no words. When
    // transcribing chunks, return an empty result instead of failing the job.
    if (allowEmptyWords) {
      return {
        duration: Number.isFinite(data?.duration) ? data.duration : 0,
        language:
          typeof data?.language === "string" ? data.language : sourceLanguage.label,
        text: buildCleanTranscriptText(data?.segments, words),
        words: [],
      };
    }

    throw new Error("The timestamped transcription returned no word timings.");
  }

  return {
    duration: Number.isFinite(data?.duration) ? data.duration : 0,
    language: typeof data?.language === "string" ? data.language : sourceLanguage.label,
    text: buildCleanTranscriptText(data?.segments, words),
    words,
  };
}

function normalizeDedupWordText(value) {
  return cleanTextField(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[’']/g, "")
    .replace(/[़ँं्]/g, "");
}

function isOverlapDuplicateWord(mergedWords, wordText, globalStart) {
  const lookbackFrom = Math.max(0, mergedWords.length - TRANSCRIPTION_DEDUP_LOOKBACK);
  const normalizedWordText = normalizeDedupWordText(wordText);

  if (!normalizedWordText) {
    return false;
  }

  for (let index = mergedWords.length - 1; index >= lookbackFrom; index -= 1) {
    const existing = mergedWords[index];

    if (
      normalizeDedupWordText(existing.word) === normalizedWordText &&
      Math.abs(existing.start - globalStart) <= TRANSCRIPTION_DEDUP_WINDOW_SECONDS
    ) {
      return true;
    }
  }

  return false;
}

function getAudioSection(audio = {}) {
  const startOffset = Number.isFinite(audio?.startOffset)
    ? Math.max(0, audio.startOffset)
    : 0;
  const duration =
    Number.isFinite(audio?.duration) && audio.duration > 0 ? audio.duration : null;
  const rawEndOffset =
    audio?.endOffset == null || !Number.isFinite(audio.endOffset)
      ? duration
      : audio.endOffset;
  const endOffset =
    Number.isFinite(rawEndOffset) && rawEndOffset !== null
      ? Math.max(startOffset, rawEndOffset)
      : null;

  return {
    endOffset,
    startOffset,
  };
}

async function prepareTimingAudioWindow({
  audio,
  contentType,
  fileBuffer,
  fileName,
}) {
  const { endOffset, startOffset } = getAudioSection(audio);

  if (!endOffset || (startOffset <= 0 && !Number.isFinite(audio?.endOffset))) {
    return {
      contentType,
      fileBuffer,
      fileName,
      timelineOffset: 0,
      windowEnd: null,
      windowStart: 0,
    };
  }

  const window = await cutAudioWindow({
    end: endOffset,
    fileBuffer,
    fileName,
    start: startOffset,
  });

  return {
    contentType: window.contentType || contentType,
    fileBuffer: window.buffer,
    fileName: window.fileName || fileName,
    timelineOffset: window.start,
    windowEnd: window.end,
    windowStart: window.start,
  };
}

// Split long audio into short segments and transcribe them one by one, then
// stitch the per-chunk word timings back onto a single timeline by offsetting
// each chunk's words by the chunk's start time. Keeps every OpenAI request
// short (fast + cheap to retry) and the overall job under the request timeout.
async function requestTimestampedTranscriptionFromChunks({
  audio,
  contentType,
  fileBuffer,
  fileName,
  onProgress,
  sourceLanguage,
  transcriptionPrompt = "",
}) {
  const timingAudio = await prepareTimingAudioWindow({
    audio,
    contentType,
    fileBuffer,
    fileName,
  });
  const effectiveContentType = timingAudio.contentType;
  const effectiveFileBuffer = timingAudio.fileBuffer;
  const effectiveFileName = timingAudio.fileName;
  let chunks = null;

  try {
    chunks = await splitAudioIntoChunks({
      chunkSeconds: TRANSCRIPTION_CHUNK_SECONDS,
      fileBuffer: effectiveFileBuffer,
      fileName: effectiveFileName,
    });
  } catch {
    // If splitting is unavailable (e.g. ffmpeg missing), fall back to
    // transcribing the whole file in a single request.
    chunks = null;
  }

  if (!chunks || chunks.length === 0) {
    return requestTimestampedTranscription({
      contentType: effectiveContentType,
      fileBuffer: effectiveFileBuffer,
      fileName: effectiveFileName,
      onProgress,
      sourceLanguage,
      transcriptionPrompt,
    }).then((result) => ({
      ...result,
      duration:
        Number.isFinite(timingAudio.windowEnd) && timingAudio.windowEnd !== null
          ? timingAudio.windowEnd
          : result.duration,
      words: result.words.map((word) => ({
        ...word,
        end: word.end + timingAudio.timelineOffset,
        start: word.start + timingAudio.timelineOffset,
      })),
    }));
  }

  console.log(
    `[auto-time] Transcribing ${chunks.length} chunk(s) sequentially via Whisper (model=${TIMESTAMP_TRANSCRIPTION_MODEL}, language=${
      sourceLanguage.transcriptionLanguage ?? "auto"
    }).`,
  );

  const words = [];
  const texts = [];
  let duration = 0;
  let language = sourceLanguage.label;

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];

    notifyProgress(onProgress, {
      detail: `Transcribing segment ${index + 1} of ${chunks.length}.`,
      stage: "transcribing",
      title: "Transcribing audio",
    });

    const chunkResult = await requestTimestampedTranscription({
      allowEmptyWords: true,
      contentType: chunk.contentType || contentType,
      fileBuffer: chunk.buffer,
      fileName: chunk.fileName || `segment-${index + 1}.mp3`,
      sourceLanguage,
      transcriptionPrompt,
    });
    const offset =
      (Number.isFinite(chunk.start) ? chunk.start : 0) + timingAudio.timelineOffset;

    console.log(
      `[auto-time] Whisper response for chunk ${index + 1}/${chunks.length} (source ${
        Number.isFinite(chunk.start)
          ? (chunk.start + timingAudio.timelineOffset).toFixed(2)
          : "?"
      }s–${
        Number.isFinite(chunk.end)
          ? (chunk.end + timingAudio.timelineOffset).toFixed(2)
          : "?"
      }s):`,
      JSON.stringify(
        {
          language: chunkResult.language,
          text: chunkResult.text,
          wordCount: chunkResult.words.length,
          words: chunkResult.words.map((word) => ({
            end: Number((word.end + offset).toFixed(3)),
            start: Number((word.start + offset).toFixed(3)),
            word: word.word,
          })),
        },
        null,
        2,
      ),
    );

    for (const word of chunkResult.words) {
      const globalStart = word.start + offset;

      // Chunks overlap so no word is ever cut at a boundary. Drop only TRUE
      // overlap duplicates — the same word at nearly the same absolute time,
      // transcribed by two adjacent chunks. A tight window preserves legitimate
      // fast repeats of common words (a fixed time-cut instead drops boundary
      // words from both chunks and tears holes in the matchable sequence).
      if (isOverlapDuplicateWord(words, word.word, globalStart)) {
        continue;
      }

      words.push({
        end: word.end + offset,
        start: globalStart,
        word: word.word,
      });
    }

    if (chunkResult.text) {
      texts.push(chunkResult.text);
    }

    if (Number.isFinite(chunk.end)) {
      duration = Math.max(duration, chunk.end + timingAudio.timelineOffset);
    }

    if (typeof chunkResult.language === "string" && chunkResult.language) {
      language = chunkResult.language;
    }
  }

  if (words.length === 0) {
    throw new Error("The timestamped transcription returned no word timings.");
  }

  console.log(
    `[auto-time] Merged transcript across ${chunks.length} chunk(s): ${words.length} timed word(s), ${duration.toFixed(
      2,
    )}s total. Full text: ${texts.join(" ").trim()}`,
  );

  return {
    duration:
      Number.isFinite(timingAudio.windowEnd) && timingAudio.windowEnd !== null
        ? timingAudio.windowEnd
        : duration,
    language,
    text: texts.join(" ").trim() || words.map((word) => word.word).join(" "),
    words,
  };
}

async function requestLyricLineBreaks({ sourceLanguage, text }) {
  const response = await fetchOpenAiWithRetry(
    RESPONSES_URL,
    {
      body: JSON.stringify({
        input: buildLyricLineBreakPrompt(text, sourceLanguage),
        model: LINE_BREAK_MODEL,
        store: false,
        temperature: 0,
      }),
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
    { label: "Lyric line formatting" },
  );

  const rawText = await response.text();
  const data = tryParseJson(rawText);

  if (!response.ok) {
    throw new Error(formatApiError(response.status, data, rawText));
  }

  const refusal = extractRefusal(data);

  if (refusal) {
    throw new Error(refusal);
  }

  const outputText = extractResponseText(data);

  if (!outputText) {
    throw new Error("The lyric line-break call returned an empty response.");
  }

  return outputText;
}

function getEmptySourceRepairSummary(status = "not-run", lineCount = 0) {
  return {
    candidateLineCount: lineCount,
    changedLineCount: 0,
    flaggedLineCount: 0,
    flagsByCode: {},
    model: SOURCE_REPAIR_MODEL,
    status,
  };
}

function addSourceRepairFlag(summary, code) {
  summary.flagsByCode[code] = (summary.flagsByCode[code] ?? 0) + 1;
}

function getSourceRepairRepeatKey(line) {
  return tokenizeForTiming(line?.text ?? line?.original ?? "").join(" ");
}

function buildSourceRepairRepeatGroups(lines) {
  const byKey = new Map();

  for (const line of lines) {
    const key = getSourceRepairRepeatKey(line);

    if (!key) {
      continue;
    }

    byKey.set(key, [...(byKey.get(key) ?? []), line.index]);
  }

  return [...byKey.values()]
    .filter((lineNumbers) => lineNumbers.length > 1)
    .map((lineNumbers) => ({ line_numbers: lineNumbers }));
}

function buildLyricSourceRepairInput({ lines, sourceLanguage, transcriptionText }) {
  return {
    l: sourceLanguage.label,
    r: buildSourceRepairRepeatGroups(lines),
    t: cleanTextField(transcriptionText),
    x: lines.map((line, index) => ({
      n: index + 1,
      o: cleanTextField(line.text ?? line.original),
    })),
  };
}

function buildLyricSourceRepairInstructions(sourceLanguage) {
  return `You are a conservative source-lyric repair auditor for a lyric-video editor.

Input is compact JSON. Keys: l=source language, t=raw content transcript, r=repeated line-number groups, x=line-broken source lyrics. Per line: n=line number, o=current source lyric.

Source language: ${sourceLanguage.label}.

Return only lines that may need source-text attention. If nothing should change, return {"changes":[]}.

Rules:
- Correct only likely transcription/ASR mistakes in the source lyric text, across any language/script.
- Use the raw transcript, neighboring lines, repeated lines, and language knowledge as evidence.
- Preserve line count, line order, and line_number values. Do not add, remove, merge, or split lines.
- Preserve dialect, slang, poetic grammar, contractions, particles, colloquial spelling, unusual inflection, and artist-specific wording.
- Do not modernize, paraphrase, censor, translate, romanize, or stylistically improve lyrics.
- Do not force standard grammar/spelling when a form could reasonably be artist style, dialect, colloquial, or genre-specific.
- Use transcription_error only when the intended lyric is strongly supported by context, repeats, or language evidence.
- Use orthographic_standardization only when meaning is already clear but spelling/diacritics/spacing might be cleaner; these are advisory and should be rare.
- Use possible_artist_style when a nonstandard form may be intentional; do not treat that as an error.
- confidence must be high only when the correction is obvious. Use medium or low when uncertain.
- corrected_original must contain the final proposed source lyric for that line, in the original language/script.
- Do not add commentary outside the JSON.`;
}

async function requestLyricSourceRepair({ lines, sourceLanguage, transcriptionText }) {
  const response = await fetchOpenAiWithRetry(
    RESPONSES_URL,
    {
      body: JSON.stringify({
        input: JSON.stringify(
          buildLyricSourceRepairInput({
            lines,
            sourceLanguage,
            transcriptionText,
          }),
        ),
        instructions: buildLyricSourceRepairInstructions(sourceLanguage),
        model: SOURCE_REPAIR_MODEL,
        store: false,
        temperature: 0,
        text: {
          format: {
            description:
              "Reel Creator conservative source lyric repair suggestions.",
            name: "reel_creator_lyric_source_repair",
            schema: LYRIC_SOURCE_REPAIR_SCHEMA,
            strict: true,
            type: "json_schema",
          },
        },
      }),
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
    { label: "Lyric source repair" },
  );
  const rawText = await response.text();
  const data = tryParseJson(rawText);

  if (!response.ok) {
    throw new Error(formatApiError(response.status, data, rawText));
  }

  const refusal = extractRefusal(data);

  if (refusal) {
    throw new Error(refusal);
  }

  const outputText = extractResponseText(data);
  const payload = outputText ? tryParseJson(outputText) : null;
  const rawChanges = Array.isArray(payload?.changes) ? payload.changes : null;

  if (!rawChanges) {
    throw new Error("The lyric source repair response could not be parsed.");
  }

  return rawChanges;
}

function normalizeSourceRepairChange(change) {
  const lineNumber = Number(change?.line_number);
  const changeType = cleanTextField(change?.change_type);
  const confidence = cleanTextField(change?.confidence);
  const evidenceType = cleanTextField(change?.evidence_type);

  if (
    !Number.isInteger(lineNumber) ||
    lineNumber < 1 ||
    ![
      "transcription_error",
      "orthographic_standardization",
      "possible_artist_style",
    ].includes(changeType) ||
    !["high", "medium", "low"].includes(confidence) ||
    ![
      "context",
      "repeat_consensus",
      "language_knowledge",
      "possible_artist_style",
    ].includes(evidenceType)
  ) {
    return null;
  }

  return {
    changeType,
    confidence,
    correctedOriginal: cleanTextField(change?.corrected_original),
    evidenceType,
    lineNumber,
    reason: cleanTextField(change?.reason),
  };
}

function applySourceRepairChanges({ changes, lines }) {
  const nextLines = lines.map((line) => ({ ...line }));
  const summary = getEmptySourceRepairSummary("applied", lines.length);
  const seenLineNumbers = new Set();

  for (const rawChange of Array.isArray(changes) ? changes : []) {
    const change = normalizeSourceRepairChange(rawChange);

    if (
      !change ||
      change.lineNumber > nextLines.length ||
      seenLineNumbers.has(change.lineNumber)
    ) {
      continue;
    }

    seenLineNumbers.add(change.lineNumber);

    const currentText = cleanTextField(nextLines[change.lineNumber - 1].text);
    const shouldApply =
      change.confidence === "high" &&
      change.changeType === "transcription_error" &&
      change.correctedOriginal &&
      change.correctedOriginal !== currentText;

    if (!shouldApply) {
      summary.flaggedLineCount += 1;
      addSourceRepairFlag(
        summary,
        `source_repair_${change.changeType}_${change.confidence}`,
      );
      continue;
    }

    nextLines[change.lineNumber - 1].original = change.correctedOriginal;
    nextLines[change.lineNumber - 1].text = change.correctedOriginal;
    summary.changedLineCount += 1;
    addSourceRepairFlag(summary, "source_repair_applied");
  }

  return {
    lines: nextLines,
    sourceRepairSummary: summary,
  };
}

async function repairGeneratedSourceLines({
  lines,
  onProgress,
  sourceLanguage,
  transcriptionText,
}) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return {
      lines,
      sourceRepairSummary: getEmptySourceRepairSummary("not-run", 0),
    };
  }

  notifyProgress(onProgress, {
    detail: `Checking ${lines.length} source lyric line${
      lines.length === 1 ? "" : "s"
    } for conservative transcription repairs.`,
    stage: "source-repair",
    title: "Checking source lyrics",
  });

  try {
    const changes = await requestLyricSourceRepair({
      lines,
      sourceLanguage,
      transcriptionText,
    });

    return applySourceRepairChanges({ changes, lines });
  } catch (error) {
    console.warn(
      `[auto-time] Lyric source repair unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );

    return {
      lines,
      sourceRepairSummary: getEmptySourceRepairSummary("error", lines.length),
    };
  }
}

// Per-word gloss/roman for the Word Board. Strict json_schema requires every
// property in `required`, so roman is conditionally added to both.
export function buildWordMeaningsSchema(includeRomanization = true) {
  const wordProperties = {
    text: { type: "string" },
    gloss: { type: "string" },
  };
  const wordRequired = ["text", "gloss"];

  if (includeRomanization) {
    wordProperties.roman = { type: "string" };
    wordRequired.push("roman");
  }

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      lines: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            line_number: { type: "integer", minimum: 1 },
            words: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: wordProperties,
                required: wordRequired,
              },
            },
          },
          required: ["line_number", "words"],
        },
      },
    },
    required: ["lines"],
  };
}

function buildWordMeaningsInstructions(sourceLanguage, includeRomanization = true) {
  const romanRule = includeRomanization
    ? "- roman: a Latin-script phonetic transliteration of that single word using the standard system for the source language (IAST for Devanagari, Hepburn for Japanese, Pinyin for Chinese, Revised Romanization for Korean, etc.). If the word is already Latin script, copy it verbatim."
    : "- Do not return a roman field.";

  return `You are glossing source-language lyrics word-by-word for a Word Board in a lyric-video editor.

Source language: ${sourceLanguage.label}.

For each input line, split its "original" text into the SAME visible word tokens, in order (split on whitespace; keep the word's own characters; drop surrounding punctuation). Return one output word per visible token, in order.

For each word:
- text: the exact source-language word token as it appears in original.
- gloss: a concise English meaning for that single word in this line's context (1-3 words, no punctuation, no commentary).
${romanRule}

Rules:
- Preserve line count, order, and line_number values exactly; one output line per input line.
- The words array order must match the original token order.
- Do not translate the whole line; gloss each word individually.
- Do not add notes, markdown, or extra keys.`;
}

function validateWordMeaningLines(payload, sourceLines, includeRomanization = true) {
  const rawLines = Array.isArray(payload?.lines) ? payload.lines : null;

  if (!rawLines || rawLines.length !== sourceLines.length) {
    throw new Error(
      `The word-meanings call returned ${
        rawLines ? rawLines.length : 0
      } line(s) for ${sourceLines.length} input line(s).`,
    );
  }

  return sourceLines.map((_sourceLine, index) => {
    const rawLine = rawLines[index];
    const lineNumber = index + 1;

    if (rawLine?.line_number !== lineNumber) {
      throw new Error(`The word-meanings response was out of order at line ${lineNumber}.`);
    }

    const words = (Array.isArray(rawLine?.words) ? rawLine.words : [])
      .map((word) => {
        const text = cleanTextField(word?.text);
        if (!text) {
          return null;
        }
        return {
          gloss: cleanTextField(word?.gloss),
          roman: includeRomanization ? cleanTextField(word?.roman) : null,
          text,
        };
      })
      .filter(Boolean);

    return { line_number: lineNumber, words };
  });
}

// Generate per-word gloss/roman for the given lyric lines. Returns
// [{ line_number, words: [{ text, gloss, roman }] }]. Shared by the generation
// pipeline (coverage fill) and the re-runnable /api/ai/word-meanings route (P6).
export async function generateWordMeanings({
  includeRomanization = true,
  lines,
  sourceLanguage,
}) {
  const sourceLines = (Array.isArray(lines) ? lines : [])
    .map((line) => ({
      original: cleanTextField(line?.original ?? line?.text),
      romanization: cleanTextField(line?.romanization),
      translation: cleanTextField(line?.translation),
    }))
    .filter((line) => line.original);

  if (sourceLines.length === 0) {
    return [];
  }

  const response = await fetchOpenAiWithRetry(
    RESPONSES_URL,
    {
      body: JSON.stringify({
        input: `Input lyric lines JSON:\n${JSON.stringify(
          {
            lines: sourceLines.map((line, index) => ({
              line_number: index + 1,
              original: line.original,
              ...(line.romanization ? { romanization: line.romanization } : {}),
              ...(line.translation ? { translation: line.translation } : {}),
            })),
            source_language: sourceLanguage.label,
          },
          null,
          2,
        )}`,
        instructions: buildWordMeaningsInstructions(
          sourceLanguage,
          includeRomanization,
        ),
        model: TRANSLATION_MODEL,
        store: false,
        temperature: 0,
        text: {
          format: {
            description:
              "Reel Creator per-word gloss and romanization for the Word Board.",
            name: "reel_creator_word_meanings",
            schema: buildWordMeaningsSchema(includeRomanization),
            strict: true,
            type: "json_schema",
          },
        },
      }),
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
    { label: "Word meanings" },
  );

  const rawText = await response.text();
  const data = tryParseJson(rawText);

  if (!response.ok) {
    throw new Error(formatApiError(response.status, data, rawText));
  }

  const refusal = extractRefusal(data);
  if (refusal) {
    throw new Error(refusal);
  }

  const outputText = extractResponseText(data);
  if (!outputText) {
    throw new Error("The word-meanings call returned an empty response.");
  }

  const parsed = tryParseJson(outputText);
  if (!parsed) {
    throw new Error("The word-meanings response could not be parsed.");
  }

  return validateWordMeaningLines(parsed, sourceLines, includeRomanization);
}

// Run the meanings coverage fill over pipeline output. Returns the (possibly
// unchanged) lines plus a small summary. Swallows all errors so generation is
// never blocked by the gloss step.
async function attachWordMeaningsCoverage({
  enabled,
  includeRomanization,
  lines,
  onProgress,
  sourceLanguage,
}) {
  if (!enabled || !Array.isArray(lines) || lines.length === 0) {
    return { lines, wordMeaningsSummary: { glossedLineCount: 0, status: "not-run" } };
  }

  notifyProgress(onProgress, {
    detail: "Generating per-word meanings for the Word Board.",
    stage: "word-meanings",
    title: "Glossing words",
  });

  try {
    const meanings = await generateWordMeanings({
      includeRomanization: true,
      lines,
      sourceLanguage,
    });
    const merged = applyWordMeaningsToLines(lines, meanings, {
      onlyMissing: true,
    });
    const glossedLineCount = merged.filter(
      (line) =>
        Array.isArray(line?.words) &&
        line.words.some((word) => typeof word?.gloss === "string" && word.gloss),
    ).length;

    return {
      lines: merged,
      wordMeaningsSummary: { glossedLineCount, status: "ok" },
    };
  } catch (error) {
    notifyProgress(onProgress, {
      detail:
        error instanceof Error && error.message
          ? `Word meanings unavailable: ${error.message}`
          : "Word meanings unavailable.",
      stage: "word-meanings",
      title: "Glossing words",
    });
    return {
      lines,
      wordMeaningsSummary: { glossedLineCount: 0, status: "error" },
    };
  }
}

async function requestLyricTranslations({
  includeRomanization = false,
  lines,
  sourceLanguage,
}) {
  const response = await fetchOpenAiWithRetry(
    RESPONSES_URL,
    {
      body: JSON.stringify({
        input: `Input lyric lines JSON:\n${JSON.stringify(
          {
            lines: lines.map((line, index) => ({
              line_number: index + 1,
              text: line.text,
            })),
            source_language: sourceLanguage.label,
            translation_target: "English",
          },
          null,
          2,
        )}`,
        instructions: buildTranslationInstructions(
          sourceLanguage,
          includeRomanization,
        ),
        model: TRANSLATION_MODEL,
        store: false,
        temperature: 0,
        text: {
          format: {
            description:
              "Reel Creator lyric lines with original source text and English translations.",
            name: "reel_creator_lyric_lines",
            schema: buildLyricLinesSchema(includeRomanization),
            strict: true,
            type: "json_schema",
          },
        },
      }),
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
    { label: "Lyric translation" },
  );

  const rawText = await response.text();
  const data = tryParseJson(rawText);

  if (!response.ok) {
    throw new Error(formatApiError(response.status, data, rawText));
  }

  const refusal = extractRefusal(data);

  if (refusal) {
    throw new Error(refusal);
  }

  const outputText = extractResponseText(data);

  if (!outputText) {
    throw new Error("The lyric translation call returned an empty response.");
  }

  const payload = tryParseJson(outputText);

  if (!payload) {
    throw new Error("The lyric translation response could not be parsed.");
  }

  return validateTranslatedLines(payload, lines, includeRomanization);
}

function getEmptyLyricPolishSummary(status = "not-run") {
  return {
    changedLineCount: 0,
    originalTextChangeCount: 0,
    romanizationChangeCount: 0,
    status,
    translationChangeCount: 0,
  };
}

function shouldRunLyricPolish(canonicalSource, lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return false;
  }

  if (canonicalSource === "generated") {
    return true;
  }

  return lines.some(
    (line) => cleanTextField(line?.translation) || cleanTextField(line?.romanization),
  );
}

function shouldIncludePolishRomanization(lines, includeRomanization = false) {
  return (
    includeRomanization ||
    lines.some((line) => Boolean(cleanTextField(line?.romanization)))
  );
}

function buildLyricPolishInput({
  allowOriginalChanges,
  canonicalSource,
  includeRomanization,
  lines,
  sourceLanguage,
}) {
  return {
    l: sourceLanguage.label,
    m: canonicalSource,
    o: allowOriginalChanges,
    r: includeRomanization,
    x: lines.map((line, index) => {
      const item = {
        e: cleanTextField(line?.translation),
        n: index + 1,
        o: cleanTextField(line?.original),
      };

      if (includeRomanization) {
        item.p = cleanTextField(line?.romanization);
      }

      return item;
    }),
  };
}

function buildLyricPolishInstructions({
  allowOriginalChanges,
  includeRomanization,
  sourceLanguage,
}) {
  const originalRule = allowOriginalChanges
    ? "- You may correct original only when the source lyric has an obvious, high-confidence word-recognition, spelling, script, grammar, or spacing error."
    : "- Never change original/source lyric text. You may only correct translation and romanization.";
  const romanizationRule = includeRomanization
    ? "- corrected_romanization must be a faithful Latin phonetic transliteration of the final source text."
    : "- Do not return romanization.";
  const originalApplyRule = allowOriginalChanges
    ? "- For generated lyrics, high-confidence orthographic_standardization may be used for standard spelling/diacritics/spacing when it improves readability without changing meaning."
    : "- Because these are user-locked lyrics, do not use orthographic_standardization to rewrite original text.";

  return `You are a conservative lyric polish auditor for a lyric-video editor.

Input is compact JSON. Keys: l=source language, m=source mode, o=whether source text changes are allowed, r=romanization present, x=input lines. Per line: n=line number, o=original/source lyric, p=romanization when present, e=English translation.

Source language: ${sourceLanguage.label}.

Return only changed lines in strict JSON. If nothing should change, return {"changes":[]}.

Rules:
- Preserve line count, line order, and line_number values. Do not add, remove, merge, or split lines.
${originalRule}
- Correct obvious lyric, romanization, or translation mistakes across any language/script. Prefer under-correcting to over-correcting when evidence is weak.
- Use neighboring lines for context, especially when one lyric phrase completes the meaning of the next, a repeated chorus reveals the intended wording, or a literal line depends on the previous/next line.
- Do not modernize, paraphrase, poeticize, censor, or stylistically improve lyrics.
- Preserve dialect, register, slang, poetic grammar, contractions, particles, and artist-specific wording unless it is clearly an ASR/translation error.
- Preserve repeated lines as repeated lines unless context clearly proves they differ; repeated lines should generally be made internally consistent.
- English translations should be faithful, natural, concise, and subtitle-friendly.
${romanizationRule}
- change_type must be:
  - semantic_error: source lyric has the wrong word/meaning due to recognition, spelling, script, or grammar.
  - translation_error: source lyric is acceptable but English meaning is wrong or misleading.
  - romanization_error: romanization does not match the final source lyric.
  - orthographic_standardization: source meaning is right, but standard spelling, accents, diacritics, inflection, punctuation, or word spacing should be cleaned up.
  - possible_artist_style: the current wording may be nonstandard, dialectal, poetic, colloquial, or artist-intentional; do not force a correction.
${originalApplyRule}
- Use possible_artist_style instead of changing text when a nonstandard form could reasonably be intentional or genre-specific.
- confidence must be high only when the correction is obvious from language knowledge and local lyric context. Use medium or low when uncertain.
- For each returned changed line, every corrected_* field required by the schema must contain the final desired value. If that field itself is unchanged, copy the current value exactly.
- Do not add commentary outside the JSON.`;
}

async function requestLyricPolishAudit({
  allowOriginalChanges,
  canonicalSource,
  includeRomanization,
  lines,
  sourceLanguage,
}) {
  const response = await fetchOpenAiWithRetry(
    RESPONSES_URL,
    {
      body: JSON.stringify({
        input: JSON.stringify(
          buildLyricPolishInput({
            allowOriginalChanges,
            canonicalSource,
            includeRomanization,
            lines,
            sourceLanguage,
          }),
        ),
        instructions: buildLyricPolishInstructions({
          allowOriginalChanges,
          includeRomanization,
          sourceLanguage,
        }),
        model: LYRIC_POLISH_MODEL,
        store: false,
        temperature: 0,
        text: {
          format: {
            description:
              "Reel Creator conservative lyric text, romanization, and translation polish changes.",
            name: "reel_creator_lyric_polish_audit",
            schema: buildLyricPolishSchema({
              allowOriginalChanges,
              includeRomanization,
            }),
            strict: true,
            type: "json_schema",
          },
        },
      }),
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
    { label: "Lyric polish audit" },
  );
  const rawText = await response.text();
  const data = tryParseJson(rawText);

  if (!response.ok) {
    throw new Error(formatApiError(response.status, data, rawText));
  }

  const refusal = extractRefusal(data);

  if (refusal) {
    throw new Error(refusal);
  }

  const outputText = extractResponseText(data);
  const payload = outputText ? tryParseJson(outputText) : null;
  const rawChanges = Array.isArray(payload?.changes) ? payload.changes : null;

  if (!rawChanges) {
    throw new Error("The lyric polish response could not be parsed.");
  }

  return rawChanges;
}

function normalizePolishChange(change, { allowOriginalChanges, includeRomanization }) {
  const lineNumber = Number(change?.line_number);
  const changeType = cleanTextField(change?.change_type);
  const confidence = cleanTextField(change?.confidence);

  if (
    !Number.isInteger(lineNumber) ||
    lineNumber < 1 ||
    ![
      "semantic_error",
      "translation_error",
      "romanization_error",
      "orthographic_standardization",
      "possible_artist_style",
    ].includes(changeType) ||
    !["high", "medium", "low"].includes(confidence)
  ) {
    return null;
  }

  return {
    changeType,
    confidence,
    correctedOriginal: allowOriginalChanges
      ? cleanTextField(change?.corrected_original)
      : "",
    correctedRomanization: includeRomanization
      ? cleanTextField(change?.corrected_romanization)
      : "",
    correctedTranslation: cleanTextField(change?.corrected_translation),
    lineNumber,
    reason: cleanTextField(change?.reason),
  };
}

function applyLyricPolishChanges({
  allowOriginalChanges,
  changes,
  includeRomanization,
  lines,
}) {
  const nextLines = lines.map((line) => ({ ...line }));
  const summary = getEmptyLyricPolishSummary("applied");
  const seenLineNumbers = new Set();

  for (const rawChange of Array.isArray(changes) ? changes : []) {
    const change = normalizePolishChange(rawChange, {
      allowOriginalChanges,
      includeRomanization,
    });

    if (
      !change ||
      change.confidence !== "high" ||
      change.changeType === "possible_artist_style" ||
      change.lineNumber > nextLines.length ||
      seenLineNumbers.has(change.lineNumber)
    ) {
      continue;
    }

    const line = nextLines[change.lineNumber - 1];
    let changed = false;

    if (
      allowOriginalChanges &&
      change.correctedOriginal &&
      change.correctedOriginal !== cleanTextField(line.original)
    ) {
      line.original = change.correctedOriginal;
      changed = true;
      summary.originalTextChangeCount += 1;
    }

    if (
      includeRomanization &&
      change.correctedRomanization &&
      change.correctedRomanization !== cleanTextField(line.romanization)
    ) {
      line.romanization = change.correctedRomanization;
      changed = true;
      summary.romanizationChangeCount += 1;
    }

    if (
      change.correctedTranslation &&
      change.correctedTranslation !== cleanTextField(line.translation)
    ) {
      line.translation = change.correctedTranslation;
      changed = true;
      summary.translationChangeCount += 1;
    }

    seenLineNumbers.add(change.lineNumber);

    if (changed) {
      summary.changedLineCount += 1;
    }
  }

  return {
    lines: nextLines,
    lyricPolishSummary: summary,
  };
}

async function polishCanonicalLyricSet({
  canonicalSource,
  includeRomanization,
  lines,
  onProgress,
  sourceLanguage,
}) {
  if (!shouldRunLyricPolish(canonicalSource, lines)) {
    return {
      lines,
      lyricPolishSummary: getEmptyLyricPolishSummary("not-run"),
    };
  }

  const allowOriginalChanges = false;
  const includePolishRomanization = shouldIncludePolishRomanization(
    lines,
    includeRomanization,
  );

  notifyProgress(onProgress, {
    detail: `Checking ${lines.length} lyric line${
      lines.length === 1 ? "" : "s"
    } for text and translation polish.`,
    stage: "polishing",
    title: "Polishing lyrics",
  });

  try {
    const changes = await requestLyricPolishAudit({
      allowOriginalChanges,
      canonicalSource,
      includeRomanization: includePolishRomanization,
      lines,
      sourceLanguage,
    });

    return applyLyricPolishChanges({
      allowOriginalChanges,
      changes,
      includeRomanization: includePolishRomanization,
      lines,
    });
  } catch (error) {
    console.warn(
      `[auto-time] Lyric polish unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );

    return {
      lines,
      lyricPolishSummary: getEmptyLyricPolishSummary("error"),
    };
  }
}

function shouldRunGptQualityAudit(canonicalSource, qualityAudit) {
  return (
    canonicalSource === "generated" ||
    qualityAudit.qualities.some((quality) => quality.riskLevel === "high")
  );
}

function getGptQualityAuditTargetIndexes(canonicalSource, qualityAudit) {
  if (canonicalSource === "generated") {
    return qualityAudit.qualities.map((_quality, index) => index);
  }

  return qualityAudit.qualities
    .map((quality, index) => (quality.riskLevel === "high" ? index : null))
    .filter((index) => index !== null);
}

function normalizeAuditWord(word) {
  return {
    end: Number.isFinite(word?.end) ? word.end : null,
    start: Number.isFinite(word?.start) ? word.start : null,
    text: cleanTextField(word?.text ?? word?.word),
  };
}

function getNearbyTranscriptWords(words, line) {
  if (!Number.isFinite(line?.start)) {
    return [];
  }

  const windowStart = Math.max(0, line.start - 1.5);
  const windowEnd = Number.isFinite(line.end)
    ? line.end + 1.5
    : line.start + 5;

  return (Array.isArray(words) ? words : [])
    .filter(
      (word) =>
        Number.isFinite(word?.start) &&
        Number.isFinite(word?.end) &&
        word.end >= windowStart &&
        word.start <= windowEnd,
    )
    .slice(0, 60)
    .map(normalizeAuditWord);
}

function buildGptQualityAuditInput({
  canonicalSource,
  lines,
  qualityAudit,
  sourceLanguage,
  targetIndexes,
  words,
}) {
  return {
    audit_mode: "flag_only",
    canonical_source: canonicalSource,
    lines: targetIndexes.map((index) => {
      const line = lines[index] ?? {};
      const quality = qualityAudit.qualities[index] ?? {};

      return {
        deterministic_flags: (Array.isArray(quality.flags) ? quality.flags : []).map(
          (flag) => flag.code,
        ),
        line_number: index + 1,
        match_ratio: Number.isFinite(line.matchRatio) ? line.matchRatio : 0,
        matched_words: (Array.isArray(line.words) ? line.words : []).map(
          normalizeAuditWord,
        ),
        nearby_transcript_words: getNearbyTranscriptWords(words, line),
        next_line: cleanTextField(lines[index + 1]?.original),
        original: cleanTextField(line.original),
        previous_line: cleanTextField(lines[index - 1]?.original),
        timing: {
          confidence: line.confidence ?? "none",
          end: Number.isFinite(line.end) ? line.end : null,
          source: line.timingSource ?? "none",
          start: Number.isFinite(line.start) ? line.start : null,
        },
      };
    }),
    source_language: sourceLanguage.label,
  };
}

function buildQualityAuditInstructions(sourceLanguage) {
  return `You are a conservative lyric evidence auditor for a lyric-video editor.

Your job is only to decide whether each lyric line is supported by the matched and nearby transcript words. Do not rewrite, correct, translate, or normalize the lyric.

Source language: ${sourceLanguage.label}.

Verdict policy:
- supported: the lyric text is clearly supported by the matched/nearby words, allowing minor transcription spelling variants.
- questionable: part of the lyric is supported but important words are missing, garbled, or uncertain.
- unsupported: the lyric appears mostly invented, misplaced, or not supported by the nearby audio words.

Return exactly one result per input line, preserving line_number. Do not add commentary outside the JSON.`;
}

async function requestGptLyricQualityAudit({
  canonicalSource,
  lines,
  qualityAudit,
  sourceLanguage,
  targetIndexes,
  words,
}) {
  const response = await fetchOpenAiWithRetry(
    RESPONSES_URL,
    {
      body: JSON.stringify({
        input: `Lyric QA input JSON:\n${JSON.stringify(
          buildGptQualityAuditInput({
            canonicalSource,
            lines,
            qualityAudit,
            sourceLanguage,
            targetIndexes,
            words,
          }),
          null,
          2,
        )}`,
        instructions: buildQualityAuditInstructions(sourceLanguage),
        model: QA_AUDIT_MODEL,
        store: false,
        temperature: 0,
        text: {
          format: {
            description:
              "Reel Creator internal lyric evidence audit verdicts.",
            name: "reel_creator_lyric_quality_audit",
            schema: LYRIC_QA_AUDIT_SCHEMA,
            strict: true,
            type: "json_schema",
          },
        },
      }),
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
    { label: "Lyric quality audit" },
  );
  const rawText = await response.text();
  const data = tryParseJson(rawText);

  if (!response.ok) {
    throw new Error(formatApiError(response.status, data, rawText));
  }

  const refusal = extractRefusal(data);

  if (refusal) {
    throw new Error(refusal);
  }

  const outputText = extractResponseText(data);
  const payload = outputText ? tryParseJson(outputText) : null;
  const rawLines = Array.isArray(payload?.lines) ? payload.lines : null;

  if (!rawLines) {
    throw new Error("The lyric quality audit response could not be parsed.");
  }

  return rawLines;
}

async function runQualityAudit({
  audio,
  canonicalSource,
  gapFillSummary,
  lines,
  matches,
  sourceLanguage,
  timingSummary,
  words,
}) {
  const deterministicAudit = auditLyricTimingResult({
    audio,
    canonicalSource,
    gapFillSummary,
    lines,
    matches,
    timingSummary,
    words,
  });

  if (!shouldRunGptQualityAudit(canonicalSource, deterministicAudit)) {
    return deterministicAudit;
  }

  const targetIndexes = getGptQualityAuditTargetIndexes(
    canonicalSource,
    deterministicAudit,
  );

  try {
    const verdicts = await requestGptLyricQualityAudit({
      canonicalSource,
      lines,
      qualityAudit: deterministicAudit,
      sourceLanguage,
      targetIndexes,
      words,
    });

    return applyGptQualityVerdicts(deterministicAudit, verdicts);
  } catch (error) {
    console.warn(
      `[auto-time] Lyric quality audit unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return markQualityAuditUnavailable(deterministicAudit);
  }
}

const LYRIC_ROMANIZATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    lines: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          line_number: { type: "integer", minimum: 1 },
          romanization: { type: "string" },
        },
        required: ["line_number", "romanization"],
      },
    },
  },
  required: ["lines"],
};

function buildRomanizationInstructions(sourceLanguage) {
  return `You romanize source-language lyric lines for a lyric video editor.

Return exactly one output item per input line, in the same order.
For each line:
- line_number must exactly match the input line number.
- romanization must be a Latin-script phonetic transliteration of the line text, using the standard system for ${sourceLanguage.label} (Pinyin with tone marks for Chinese, Hepburn Romaji for Japanese, Revised Romanization for Korean, IAST for Devanagari/Hindi, etc.). If the line is already in Latin script, copy it verbatim.

Preserve repeated lines as repeated lines. Do not translate. Do not add commentary, notes, markdown, or extra keys.`;
}

async function requestLyricRomanizations({ lines, sourceLanguage }) {
  const response = await fetchOpenAiWithRetry(
    RESPONSES_URL,
    {
      body: JSON.stringify({
        input: `Input lyric lines JSON:\n${JSON.stringify(
          {
            lines: lines.map((line, index) => ({
              line_number: index + 1,
              text: line.text,
            })),
            source_language: sourceLanguage.label,
          },
          null,
          2,
        )}`,
        instructions: buildRomanizationInstructions(sourceLanguage),
        model: TRANSLATION_MODEL,
        store: false,
        temperature: 0,
        text: {
          format: {
            description:
              "Reel Creator lyric lines romanized into Latin script.",
            name: "reel_creator_lyric_romanizations",
            schema: LYRIC_ROMANIZATION_SCHEMA,
            strict: true,
            type: "json_schema",
          },
        },
      }),
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
    { label: "Lyric romanization" },
  );

  const rawText = await response.text();
  const data = tryParseJson(rawText);

  if (!response.ok) {
    throw new Error(formatApiError(response.status, data, rawText));
  }

  const refusal = extractRefusal(data);

  if (refusal) {
    throw new Error(refusal);
  }

  const outputText = extractResponseText(data);
  const payload = outputText ? tryParseJson(outputText) : null;
  const rawLines = Array.isArray(payload?.lines) ? payload.lines : null;

  if (!rawLines || rawLines.length !== lines.length) {
    throw new Error(
      `The romanization call returned ${
        rawLines ? rawLines.length : 0
      } line(s) for ${lines.length} input line(s).`,
    );
  }

  return rawLines.map((rawLine) => cleanTextField(rawLine?.romanization));
}

// Romanize already-known lyric lines (e.g. user-supplied or auto-timed lyrics)
// without re-translating them. Returns one { id, romanization } per input line.
export async function romanizeLyricLines({ lines, sourceLanguage }) {
  const normalizedLines = normalizeTranscriptLineInput(lines);

  if (normalizedLines.length === 0) {
    throw new Error("Add lyric lines before romanizing.");
  }

  const romanizations = await requestLyricRomanizations({
    lines: normalizedLines,
    sourceLanguage,
  });

  return normalizedLines.map((line, index) => ({
    id: typeof line.id === "string" ? line.id : null,
    romanization: romanizations[index] ?? "",
  }));
}

// Whisper's prompt is capped (~224 tokens). Build a context hint from the
// user's own lyric lines (deduped, in their original script) so the model is
// biased toward the correct spellings and script instead of romanizing.
const MAX_TRANSCRIPTION_PROMPT_CHARS = 600;

function buildTimingTranscriptionPrompt(lyricLineInputs) {
  return timingPromptsEnabled() ? buildLyricsTranscriptionPrompt(lyricLineInputs) : "";
}

function buildLyricsTranscriptionPrompt(lyricLineInputs) {
  const seen = new Set();
  let prompt = "";

  for (const line of lyricLineInputs) {
    const text = cleanTextField(line?.text ?? line?.original);

    if (!text || seen.has(text)) {
      continue;
    }

    seen.add(text);
    const next = prompt ? `${prompt} ${text}` : text;

    if (next.length > MAX_TRANSCRIPTION_PROMPT_CHARS) {
      break;
    }

    prompt = next;
  }

  return prompt;
}

function buildLyricLineBreakPrompt(text, sourceLanguage) {
  const languagePhrase =
    sourceLanguage.id === "auto"
      ? "the detected source language and script"
      : `${sourceLanguage.label}, preserving its source script`;

  return `Reformat the song text below into clean lyric-style line breaks.

Output each lyric line on its own line, with no blank lines between them.
Do not output anything else: no labels, headings, commentary, markdown, or code fences.

Rules:
- Preserve the original wording as much as possible.
- Break the text into short, natural lyric lines.
- Keep the original order of the text.
- Keep the output in ${languagePhrase}.
- Do not translate.

Correction policy:
- Make only minimal, conservative corrections.
- Only correct errors that are obvious and high-confidence.
- Prefer under-correcting to over-correcting.
- Do not creatively rewrite or normalize unusual wording unless clearly necessary.
- If uncertain, leave the text unchanged.

Text:

${text}`;
}

function buildTranslationInstructions(sourceLanguage, includeRomanization = false) {
  const romanizationRule = includeRomanization
    ? `
- romanization must be a Latin-script phonetic transliteration of original, using the standard system for the source language (Pinyin with tone marks for Chinese, Hepburn Romaji for Japanese, Revised Romanization for Korean, IAST for Devanagari/Hindi, etc.). If original is already in Latin script, copy it verbatim into romanization.`
    : "";
  const extraKeysRule = includeRomanization
    ? "Do not add commentary, notes, markdown, word tokens, or extra keys."
    : "Do not add commentary, notes, markdown, transliteration, word tokens, or extra keys.";

  return `You are preparing source-language lyric lines for a lyric video editor.

Return exactly one output item per input line, in the same order.
For each line:
- line_number must exactly match the input line number.
- original must copy the input line text exactly.
- translation must be a faithful, natural English translation.${romanizationRule}

Source language: ${sourceLanguage.label}.
Translation target: English.

Keep translations concise enough for subtitle-style display. Preserve repeated lines as repeated lines. ${extraKeysRule}`;
}

function validateTranslatedLines(payload, sourceLines, includeRomanization = false) {
  const rawLines = Array.isArray(payload?.lines) ? payload.lines : null;

  if (!rawLines || rawLines.length !== sourceLines.length) {
    throw new Error(
      `The lyric translation call returned ${
        rawLines ? rawLines.length : 0
      } line${rawLines?.length === 1 ? "" : "s"} for ${
        sourceLines.length
      } input line${sourceLines.length === 1 ? "" : "s"}.`,
    );
  }

  return sourceLines.map((sourceLine, index) => {
    const rawLine = rawLines[index];
    const lineNumber = index + 1;
    const translation = cleanTextField(rawLine?.translation);

    if (rawLine?.line_number !== lineNumber) {
      throw new Error(`The lyric translation response was out of order at line ${lineNumber}.`);
    }

    if (!translation) {
      throw new Error(`The lyric translation response was empty at line ${lineNumber}.`);
    }

    return {
      original: sourceLine.text,
      romanization: includeRomanization
        ? cleanTextField(rawLine?.romanization)
        : "",
      start: null,
      translation,
    };
  });
}

function normalizeTranscriptLineInput(lines, transcriptFallback = "") {
  if (Array.isArray(lines)) {
    return lines
      .map((line, index) => {
        const text = cleanTextField(line?.text ?? line?.original ?? line);

        if (!text) {
          return null;
        }

        return {
          index: Number.isInteger(line?.index) ? line.index : index + 1,
          id: typeof line?.id === "string" ? line.id : null,
          original: text,
          text,
        };
      })
      .filter(Boolean);
  }

  return normalizeTranscriptText(transcriptFallback)
    .split("\n")
    .map((line) => cleanTextField(line))
    .filter(Boolean)
    .map((line, index) => ({
      index: index + 1,
      text: line,
    }));
}

function normalizeTimestampWords(words) {
  if (!Array.isArray(words)) {
    return [];
  }

  return words
    .map((word) => {
      const start = Number(word?.start);
      const end = Number(word?.end);
      const text = cleanTextField(word?.word ?? word?.text);

      if (
        !text ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        !hasUsableTimedWordDuration(start, end)
      ) {
        return null;
      }

      return {
        end,
        start,
        word: text,
      };
    })
    .filter(Boolean);
}

function isLikelyHallucinatedSegment(segment) {
  const noSpeechProb = Number(segment?.no_speech_prob);
  const avgLogprob = Number(segment?.avg_logprob);
  const compressionRatio = Number(segment?.compression_ratio);

  if (
    Number.isFinite(noSpeechProb) &&
    noSpeechProb > HALLUCINATION_NO_SPEECH_PROB_MAX
  ) {
    return true;
  }

  if (Number.isFinite(avgLogprob) && avgLogprob < HALLUCINATION_AVG_LOGPROB_MIN) {
    return true;
  }

  if (
    Number.isFinite(compressionRatio) &&
    compressionRatio > HALLUCINATION_COMPRESSION_RATIO_MAX
  ) {
    return true;
  }

  return false;
}

// Build the time ranges of whisper segments that look like hallucinations, so
// their words/text can be dropped before timing or line-breaking.
function getHallucinatedSegmentRanges(segments) {
  if (!Array.isArray(segments)) {
    return [];
  }

  return segments
    .filter(isLikelyHallucinatedSegment)
    .map((segment) => ({
      end: Number(segment?.end),
      start: Number(segment?.start),
    }))
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end));
}

function isTimeInRanges(time, ranges) {
  return ranges.some((range) => time >= range.start && time <= range.end);
}

function dropHallucinatedWords(words, ranges) {
  if (!ranges.length) {
    return words;
  }

  return words.filter((word) => {
    const midpoint = (word.start + word.end) / 2;

    return !isTimeInRanges(midpoint, ranges);
  });
}

// Rebuild transcript text from only the segments that are not hallucinations,
// so downstream line-breaking never sees phantom lyrics. Falls back to the
// kept words when segment text is unavailable.
function buildCleanTranscriptText(segments, fallbackWords) {
  if (Array.isArray(segments) && segments.length > 0) {
    const text = segments
      .filter((segment) => !isLikelyHallucinatedSegment(segment))
      .map((segment) => cleanTextField(segment?.text))
      .filter(Boolean)
      .join(" ")
      .trim();

    if (text) {
      return text;
    }
  }

  return fallbackWords.map((word) => word.word).join(" ");
}

function notifyProgress(onProgress, progress) {
  onProgress?.(progress);
}

function cleanTextField(value) {
  return normalizeWhitespace(String(value || ""));
}

function normalizeTranscriptText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function tryParseJson(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeFetchError(error, label) {
  if (error?.name === "AbortError") {
    return new Error(
      `${label} timed out after ${Math.round(
        OPENAI_REQUEST_TIMEOUT_MS / 1000,
      )}s. Try again, or use a shorter / smaller audio file.`,
    );
  }

  return error instanceof Error
    ? error
    : new Error(`${label} failed to reach OpenAI.`);
}

// OpenAI's audio endpoints occasionally return a transient empty-body 5xx
// (especially for long transcriptions). Retry those with backoff instead of
// failing the whole job on the first blip. Non-retryable responses are handed
// back to the caller so existing error formatting still applies.
async function fetchOpenAiWithRetry(
  url,
  options,
  { label = "OpenAI request", timeoutMs = OPENAI_REQUEST_TIMEOUT_MS } = {},
) {
  let lastError;

  for (let attempt = 1; attempt <= OPENAI_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      if (
        response.ok ||
        !isRetryableStatus(response.status) ||
        attempt === OPENAI_MAX_ATTEMPTS
      ) {
        return response;
      }

      // Drain the body so the socket can be reused before we retry.
      await response.text().catch(() => {});
      lastError = new Error(`${label} returned status ${response.status}.`);
    } catch (error) {
      if (attempt === OPENAI_MAX_ATTEMPTS) {
        throw normalizeFetchError(error, label);
      }

      lastError = error;
    } finally {
      clearTimeout(timeoutId);
    }

    await delay(OPENAI_RETRY_BASE_DELAY_MS * attempt);
  }

  throw lastError ?? new Error(`${label} failed.`);
}

function formatApiError(status, data, rawText) {
  if (data?.error?.message) {
    return `OpenAI error (${status}): ${data.error.message}`;
  }

  if (typeof data?.message === "string") {
    return `OpenAI error (${status}): ${data.message}`;
  }

  if (rawText.trim()) {
    return `OpenAI error (${status}): ${rawText.trim()}`;
  }

  return `OpenAI error (${status}).`;
}

function extractRefusal(data) {
  const message = Array.isArray(data?.output)
    ? data.output.find((item) => item.type === "message")
    : null;
  const content = Array.isArray(message?.content) ? message.content : [];
  const refusalPart = content.find((part) => part.type === "refusal");

  return refusalPart?.refusal
    ? `OpenAI refusal: ${refusalPart.refusal}`
    : null;
}

function extractResponseText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const message = Array.isArray(data?.output)
    ? data.output.find((item) => item.type === "message")
    : null;
  const content = Array.isArray(message?.content) ? message.content : [];
  const textPart = content.find((part) => part.type === "output_text");

  return typeof textPart?.text === "string" ? textPart.text.trim() : "";
}
