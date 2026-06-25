import { tokenizeForTiming } from "./lyric-timing";
import { hasUsableTimedWordDuration } from "./timestamp-words";

const RISK_LEVELS = new Set(["ok", "review", "high"]);
const CONFIDENCE_LEVELS = new Set(["high", "medium", "low", "none"]);
const FLAG_SEVERITIES = new Set(["info", "review", "high"]);
const SEVERITY_RANK = {
  info: 0,
  review: 1,
  high: 2,
};
const RISK_RANK = {
  ok: 0,
  review: 1,
  high: 2,
};
const QUALITY_METRIC_KEYS = [
  "durationSec",
  "gapAfterSec",
  "gapBeforeSec",
  "matchedWordCount",
  "matchRatio",
  "tokenCount",
];
const AUDIO_BOUNDARY_TOLERANCE_SECONDS = 0.05;
const CROWDED_SHORT_GAP_SECONDS = 0.2;
const CROWDED_LINE_GAP_SECONDS = 0.45;
const ORDER_TOLERANCE_SECONDS = 0.05;
const MIN_TEXT_EVIDENCE_RATIO = 0.75;
const MIN_ALIGNER_MATCH_RATIO = 0.68;
const MIN_REPEAT_SEPARATION_SECONDS = 2.5;

function clampConfidence(value, fallback = "none") {
  return CONFIDENCE_LEVELS.has(value) ? value : fallback;
}

function clampRiskLevel(value, fallback = "ok") {
  return RISK_LEVELS.has(value) ? value : fallback;
}

function clampSeverity(value, fallback = "review") {
  return FLAG_SEVERITIES.has(value) ? value : fallback;
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getAudioStart(audio = {}) {
  return Number.isFinite(audio.startOffset) ? audio.startOffset : 0;
}

function getAudioEnd(audio = {}) {
  if (Number.isFinite(audio.endOffset) && audio.endOffset !== null) {
    return audio.endOffset;
  }

  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    return audio.duration;
  }

  return null;
}

function normalizeFlag(flag) {
  if (!flag || typeof flag !== "object") {
    return null;
  }

  const code = typeof flag.code === "string" ? flag.code.trim() : "";
  if (!code) {
    return null;
  }

  return {
    code,
    message:
      typeof flag.message === "string" && flag.message.trim()
        ? flag.message.trim()
        : code,
    severity: clampSeverity(flag.severity),
  };
}

function addFlag(flags, flag) {
  const normalized = normalizeFlag(flag);
  if (!normalized) {
    return;
  }

  const existing = flags.find((item) => item.code === normalized.code);
  if (!existing) {
    flags.push(normalized);
    return;
  }

  if (SEVERITY_RANK[normalized.severity] > SEVERITY_RANK[existing.severity]) {
    existing.severity = normalized.severity;
    existing.message = normalized.message;
  }
}

function getRiskLevel(flags) {
  if (flags.some((flag) => flag.severity === "high")) {
    return "high";
  }

  if (flags.some((flag) => flag.severity === "review")) {
    return "review";
  }

  return "ok";
}

function maxRiskLevel(left, right) {
  return RISK_RANK[left] >= RISK_RANK[right] ? left : right;
}

function getTextEvidenceConfidence({ match, matchedWordCount, tokenCount }) {
  const matchRatio = Number.isFinite(match?.matchRatio) ? match.matchRatio : 0;
  const coverage = tokenCount > 0 ? matchedWordCount / tokenCount : 0;
  const timingSource = match?.timingSource ?? "none";

  if (
    matchedWordCount <= 0 ||
    timingSource === "none" ||
    timingSource === "interpolated"
  ) {
    return "none";
  }

  if (matchRatio >= 0.9 && coverage >= 0.9) {
    return "high";
  }

  if (matchRatio >= MIN_TEXT_EVIDENCE_RATIO && coverage >= MIN_TEXT_EVIDENCE_RATIO) {
    return "medium";
  }

  return "low";
}

function getTimingConfidence(match) {
  if (!Number.isFinite(match?.start)) {
    return "none";
  }

  if (match.timingSource === "interpolated" || match.confidence === "estimated") {
    return "low";
  }

  if (match.timingSource === "repeat-template") {
    return "medium";
  }

  if (match.timingSource === "word-match" && match.confidence === "high") {
    return "high";
  }

  if (match.timingSource === "word-match" && match.confidence === "medium") {
    return "medium";
  }

  if (match.timingSource === "word-match") {
    return "low";
  }

  return "none";
}

function countMatchedWords(match) {
  if (Number.isFinite(match?.matchedWordCount)) {
    return Math.max(0, match.matchedWordCount);
  }

  if (Array.isArray(match?.words)) {
    return match.words.length;
  }

  return 0;
}

function getNearestPreviousStart(matches, index) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (Number.isFinite(matches[cursor]?.start)) {
      return matches[cursor].start;
    }
  }

  return null;
}

function getNearestNextStart(matches, index) {
  for (let cursor = index + 1; cursor < matches.length; cursor += 1) {
    if (Number.isFinite(matches[cursor]?.start)) {
      return matches[cursor].start;
    }
  }

  return null;
}

function getLineRepeatKey(line) {
  return tokenizeForTiming(line?.original ?? line?.text ?? "").join(" ");
}

function getPreviousRepeatedLineStart(lines, matches, index) {
  const repeatKey = getLineRepeatKey(lines[index]);

  if (!repeatKey) {
    return null;
  }

  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (
      getLineRepeatKey(lines[cursor]) === repeatKey &&
      Number.isFinite(matches[cursor]?.start)
    ) {
      return matches[cursor].start;
    }
  }

  return null;
}

function buildMetrics({ line, match, matches, index }) {
  const tokenCount = tokenizeForTiming(line?.original ?? line?.text ?? "").length;
  const matchedWordCount = countMatchedWords(match);
  const start = finiteOrNull(match?.start);
  const end = finiteOrNull(match?.end);
  const previousStart = getNearestPreviousStart(matches, index);
  const nextStart = getNearestNextStart(matches, index);

  return {
    durationSec: start !== null && end !== null ? Math.max(0, end - start) : null,
    gapAfterSec: start !== null && nextStart !== null ? nextStart - start : null,
    gapBeforeSec: start !== null && previousStart !== null ? start - previousStart : null,
    matchedWordCount,
    matchRatio: Number.isFinite(match?.matchRatio) ? match.matchRatio : 0,
    tokenCount,
  };
}

function addEvidenceFlags({ canonicalSource, flags, match, metrics }) {
  const timingSource = match?.timingSource ?? "none";
  const hasMatchedWords = metrics.matchedWordCount > 0;

  if (!hasMatchedWords || timingSource === "none" || timingSource === "interpolated") {
    addFlag(flags, {
      code: "unsupported_text",
      message: "No direct matched words support this lyric line.",
      severity: canonicalSource === "generated" ? "high" : "review",
    });
  }

  if (
    metrics.matchRatio < MIN_TEXT_EVIDENCE_RATIO ||
    (metrics.tokenCount > 0 &&
      metrics.matchedWordCount / metrics.tokenCount < MIN_TEXT_EVIDENCE_RATIO)
  ) {
    addFlag(flags, {
      code: "weak_text_evidence",
      message: "Matched words cover less than the expected share of this lyric line.",
      severity:
        canonicalSource === "generated" && metrics.matchRatio < MIN_ALIGNER_MATCH_RATIO
          ? "high"
          : "review",
    });
  }

  if (
    canonicalSource === "generated" &&
    getTextEvidenceConfidence({
      match,
      matchedWordCount: metrics.matchedWordCount,
      tokenCount: metrics.tokenCount,
    }) !== "high"
  ) {
    addFlag(flags, {
      code: "generated_not_high_evidence",
      message: "Generated lyric text is not backed by high-confidence word evidence.",
      severity: "review",
    });
  }
}

function addTimingFlags({ audio, flags, match, metrics }) {
  const timingSource = match?.timingSource ?? "none";
  const start = finiteOrNull(match?.start);
  const end = finiteOrNull(match?.end);
  const audioStart = getAudioStart(audio);
  const audioEnd = getAudioEnd(audio);
  const hasInvalidWordAnchor = (Array.isArray(match?.words) ? match.words : []).some(
    (word) =>
      Number.isFinite(Number(word?.start)) &&
      Number.isFinite(Number(word?.end)) &&
      !hasUsableTimedWordDuration(Number(word.start), Number(word.end)),
  );

  if (hasInvalidWordAnchor) {
    addFlag(flags, {
      code: "zero_duration_word_anchor",
      message:
        "Matched word evidence contains zero-duration or implausibly tiny timestamp anchors.",
      severity: "high",
    });
  }

  if (timingSource === "repeat-template") {
    addFlag(flags, {
      code: "repeat_template_timing",
      message: "Timing was copied from a matching repeated lyric pattern.",
      severity: "info",
    });
  }

  if (match?.confidence === "estimated" || timingSource === "interpolated") {
    addFlag(flags, {
      code: "timing_estimated",
      message: "Line timing was estimated between neighboring anchors.",
      severity: "review",
    });
  }

  if (
    start !== null &&
    (start < audioStart - AUDIO_BOUNDARY_TOLERANCE_SECONDS ||
      (audioEnd !== null && start > audioEnd + AUDIO_BOUNDARY_TOLERANCE_SECONDS) ||
      (end !== null && end < start) ||
      (audioEnd !== null && end !== null && end > audioEnd + AUDIO_BOUNDARY_TOLERANCE_SECONDS))
  ) {
    addFlag(flags, {
      code: "outside_audio_section",
      message: "Line timing falls outside the selected audio section.",
      severity: "high",
    });
  }

  if (
    metrics.tokenCount >= 3 &&
    metrics.durationSec !== null &&
    metrics.durationSec < Math.max(0.35, Math.min(1, metrics.tokenCount * 0.12))
  ) {
    addFlag(flags, {
      code: "suspicious_short_duration",
      message: "Line duration is unusually short for the amount of lyric text.",
      severity: "review",
    });
  }

  if (
    metrics.durationSec !== null &&
    metrics.durationSec > Math.max(8, metrics.tokenCount * 1.2)
  ) {
    addFlag(flags, {
      code: "suspicious_long_duration",
      message: "Line duration is unusually long for the amount of lyric text.",
      severity: "review",
    });
  }

  if (
    metrics.gapAfterSec !== null &&
    metrics.gapAfterSec >= 0 &&
    metrics.gapAfterSec <
      (metrics.tokenCount >= 3 ? CROWDED_LINE_GAP_SECONDS : CROWDED_SHORT_GAP_SECONDS)
  ) {
    addFlag(flags, {
      code: "crowded_neighbor",
      message: "The next lyric line starts unusually close to this one.",
      severity: "review",
    });
  }
}

function addOrderingFlags({ flags, line, lines, match, matches, metrics, index }) {
  if (
    Number.isFinite(match?.start) &&
    metrics.gapBeforeSec !== null &&
    metrics.gapBeforeSec < -ORDER_TOLERANCE_SECONDS
  ) {
    addFlag(flags, {
      code: "timing_out_of_order",
      message: "Line start is earlier than a preceding timed lyric line.",
      severity: "high",
    });
  }

  const previousRepeatStart = getPreviousRepeatedLineStart(lines, matches, index);
  const repeatGap =
    Number.isFinite(match?.start) && previousRepeatStart !== null
      ? match.start - previousRepeatStart
      : null;
  const minimumRepeatGap = Math.max(
    MIN_REPEAT_SEPARATION_SECONDS,
    metrics.tokenCount * 0.6,
  );

  if (
    repeatGap !== null &&
    repeatGap >= 0 &&
    repeatGap < minimumRepeatGap &&
    metrics.tokenCount >= 4
  ) {
    addFlag(flags, {
      code: "repeated_line_too_close",
      message: "A repeated lyric line is placed unusually close to a previous copy.",
      severity: "high",
    });
  }
}

function normalizeMetrics(metrics = {}) {
  const normalized = {};

  for (const key of QUALITY_METRIC_KEYS) {
    const value = finiteOrNull(metrics[key]);
    if (value !== null) {
      normalized[key] = value;
    }
  }

  return normalized;
}

export function normalizeLineQuality(quality) {
  if (!quality || typeof quality !== "object" || Array.isArray(quality)) {
    return null;
  }

  const flags = (Array.isArray(quality.flags) ? quality.flags : [])
    .map(normalizeFlag)
    .filter(Boolean);
  const flagRiskLevel = getRiskLevel(flags);
  const normalized = {
    flags,
    metrics: normalizeMetrics(quality.metrics),
    riskLevel: maxRiskLevel(
      clampRiskLevel(quality.riskLevel, flagRiskLevel),
      flagRiskLevel,
    ),
    textEvidenceConfidence: clampConfidence(quality.textEvidenceConfidence),
    timingConfidence: clampConfidence(quality.timingConfidence),
  };

  return normalized;
}

function countFlagsByCode(qualities) {
  const flagsByCode = {};

  for (const quality of qualities) {
    for (const flag of quality.flags) {
      flagsByCode[flag.code] = (flagsByCode[flag.code] ?? 0) + 1;
    }
  }

  return flagsByCode;
}

function summarizeQualities(qualities, canonicalSource, auditStatus = "not-run") {
  return {
    auditStatus,
    flagsByCode: countFlagsByCode(qualities),
    generatedLineCount: canonicalSource === "generated" ? qualities.length : 0,
    highRiskLineCount: qualities.filter((quality) => quality.riskLevel === "high")
      .length,
    okLineCount: qualities.filter((quality) => quality.riskLevel === "ok").length,
    reviewLineCount: qualities.filter((quality) => quality.riskLevel === "review")
      .length,
    totalLines: qualities.length,
  };
}

function addSummaryFlag(summary, code) {
  summary.flagsByCode[code] = (summary.flagsByCode[code] ?? 0) + 1;
}

function getSummaryOnlyFlags(previousSummary, previousQualities) {
  const lineFlagsByCode = countFlagsByCode(previousQualities);
  const summaryOnlyFlags = {};

  for (const [code, count] of Object.entries(previousSummary?.flagsByCode ?? {})) {
    const summaryOnlyCount = count - (lineFlagsByCode[code] ?? 0);
    if (summaryOnlyCount > 0) {
      summaryOnlyFlags[code] = summaryOnlyCount;
    }
  }

  return summaryOnlyFlags;
}

function addFlagsByCode(baseFlags, addedFlags) {
  const merged = { ...baseFlags };

  for (const [code, count] of Object.entries(addedFlags)) {
    merged[code] = (merged[code] ?? 0) + count;
  }

  return merged;
}

export function auditLyricTimingResult({
  audio = {},
  canonicalSource = "user",
  gapFillSummary = {},
  lines = [],
  matches = [],
} = {}) {
  const qualities = lines.map((line, index) => {
    const match = matches[index] ?? {};
    const flags = [];
    const metrics = buildMetrics({ index, line, match, matches });

    addEvidenceFlags({ canonicalSource, flags, match, metrics });
    addTimingFlags({ audio, flags, match, metrics });
    addOrderingFlags({ flags, index, line, lines, match, matches, metrics });

    return {
      flags,
      metrics,
      riskLevel: getRiskLevel(flags),
      textEvidenceConfidence: getTextEvidenceConfidence({
        match,
        matchedWordCount: metrics.matchedWordCount,
        tokenCount: metrics.tokenCount,
      }),
      timingConfidence: getTimingConfidence(match),
    };
  });
  const qualitySummary = summarizeQualities(
    qualities,
    canonicalSource,
    "not-run",
  );

  if (
    Number(gapFillSummary?.pass2?.errorCount ?? 0) > 0 ||
    Number(gapFillSummary?.pass3?.errorCount ?? 0) > 0
  ) {
    addSummaryFlag(qualitySummary, "gap_fill_error");
  }

  return {
    qualities,
    qualitySummary,
  };
}

export function applyGptQualityVerdicts(qualityAudit, verdicts = []) {
  const qualities = qualityAudit.qualities.map((quality) =>
    normalizeLineQuality(quality),
  );
  const summaryOnlyFlags = getSummaryOnlyFlags(
    qualityAudit.qualitySummary,
    qualityAudit.qualities,
  );
  const verdictByLineNumber = new Map();

  for (const verdict of Array.isArray(verdicts) ? verdicts : []) {
    const lineNumber = Number(verdict?.line_number);
    const normalizedVerdict = String(verdict?.verdict ?? "").trim();

    if (
      Number.isInteger(lineNumber) &&
      lineNumber >= 1 &&
      ["supported", "questionable", "unsupported"].includes(normalizedVerdict)
    ) {
      verdictByLineNumber.set(lineNumber, normalizedVerdict);
    }
  }

  for (let index = 0; index < qualities.length; index += 1) {
    const verdict = verdictByLineNumber.get(index + 1);

    if (verdict === "questionable") {
      addFlag(qualities[index].flags, {
        code: "gpt_questionable_text",
        message: "A secondary text audit marked this lyric as questionable.",
        severity: "review",
      });
    } else if (verdict === "unsupported") {
      addFlag(qualities[index].flags, {
        code: "gpt_unsupported_text",
        message: "A secondary text audit marked this lyric as unsupported.",
        severity: "high",
      });
    }

    qualities[index].riskLevel = getRiskLevel(qualities[index].flags);
  }

  const qualitySummary = summarizeQualities(qualities, "user", "passed");

  return {
    qualities,
    qualitySummary: {
      ...qualitySummary,
      flagsByCode: addFlagsByCode(qualitySummary.flagsByCode, summaryOnlyFlags),
      generatedLineCount: qualityAudit.qualitySummary.generatedLineCount,
    },
  };
}

export function markQualityAuditUnavailable(qualityAudit) {
  const qualitySummary = {
    ...qualityAudit.qualitySummary,
    auditStatus: "error",
    flagsByCode: {
      ...qualityAudit.qualitySummary.flagsByCode,
      qa_audit_unavailable:
        (qualityAudit.qualitySummary.flagsByCode.qa_audit_unavailable ?? 0) + 1,
    },
  };

  return {
    qualities: qualityAudit.qualities,
    qualitySummary,
  };
}
