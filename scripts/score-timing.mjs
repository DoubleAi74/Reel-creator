import { existsSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register(new URL("./extensionless-loader.mjs", import.meta.url));

const { alignLyricLinesToWordTimings, summarizeLyricTimingMatches } = await import(
  "../lib/lyric-timing.js"
);
const { auditLyricTimingResult } = await import("../lib/lyric-quality.js");

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const defaultSamplePath = path.join(rootDir, "samples", "aaj-se-teri.json");
const defaultTruthPath = path.join(rootDir, "samples", "aaj-se-teri.truth.json");
const defaultWordsPath = path.join(rootDir, "samples", "aaj-se-teri.words.json");

function readFlag(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return fallback;
  }
  return process.argv[index + 1] ?? fallback;
}

function positionalArgs() {
  const out = [];
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg.startsWith("--")) {
      index += 1;
      continue;
    }
    out.push(arg);
  }
  return out;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function stableLineId(index) {
  return `aaj-se-teri-${String(index + 1).padStart(2, "0")}`;
}

function unwrapResult(payload) {
  return payload?.result && typeof payload.result === "object" ? payload.result : payload;
}

function getWords(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  const result = unwrapResult(payload);
  return Array.isArray(result?.words) ? result.words : [];
}

function getPipelineMatches(payload, lines) {
  const result = unwrapResult(payload);

  if (!Array.isArray(result?.matches) || result.matches.length !== lines.length) {
    return null;
  }

  return result.matches.map((match, index) => ({
    ...lines[index],
    ...match,
    index: Number.isInteger(match?.index) ? match.index : index,
    lineNumber: Number.isInteger(match?.lineNumber) ? match.lineNumber : index + 1,
    original: match?.original ?? lines[index].original,
  }));
}

function getAudio(payload, sampleProject) {
  const result = unwrapResult(payload);
  return {
    ...(sampleProject.audio ?? {}),
    duration: Number.isFinite(result?.duration)
      ? result.duration
      : Number(sampleProject.audio?.duration ?? 0),
  };
}

function getSummaryCounts(matches) {
  const sourceCounts = {};
  for (const match of matches) {
    const source = match.timingSource ?? match.confidence ?? "unknown";
    sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;
  }

  return {
    directMatched: matches.filter(
      (match) =>
        Number.isFinite(match.start) &&
        (match.timingSource === "word-match" ||
          (match.timingSource == null &&
            (match.confidence === "high" || match.confidence === "medium"))),
    ).length,
    interpolated: matches.filter(
      (match) =>
        Number.isFinite(match.start) &&
        (match.timingSource === "interpolated" || match.confidence === "estimated"),
    ).length,
    repeatTemplated: matches.filter(
      (match) =>
        Number.isFinite(match.start) && match.timingSource === "repeat-template",
    ).length,
    sourceCounts,
    timed: matches.filter((match) => Number.isFinite(match.start)).length,
  };
}

function summarizeLineQualities(qualities) {
  const flagsByCode = {};

  for (const quality of qualities) {
    for (const flag of Array.isArray(quality?.flags) ? quality.flags : []) {
      if (typeof flag?.code === "string" && flag.code) {
        flagsByCode[flag.code] = (flagsByCode[flag.code] ?? 0) + 1;
      }
    }
  }

  return {
    auditStatus: "not-run",
    flagsByCode,
    highRiskLineCount: qualities.filter((quality) => quality?.riskLevel === "high")
      .length,
    okLineCount: qualities.filter((quality) => quality?.riskLevel === "ok").length,
    reviewLineCount: qualities.filter((quality) => quality?.riskLevel === "review")
      .length,
    totalLines: qualities.length,
  };
}

function getQualitySummary(payload, { audio, lines, matches }) {
  const result = unwrapResult(payload);

  if (result?.qualitySummary && typeof result.qualitySummary === "object") {
    return result.qualitySummary;
  }

  const resultLines = Array.isArray(result?.lines) ? result.lines : [];
  const qualities = resultLines.map((line) => line?.quality).filter(Boolean);

  if (qualities.length === lines.length) {
    return summarizeLineQualities(qualities);
  }

  return auditLyricTimingResult({
    audio,
    canonicalSource: result?.canonicalSource ?? "user",
    gapFillSummary: result?.gapFillSummary,
    lines,
    matches,
    timingSummary: result?.timingSummary,
    words: getWords(payload),
  }).qualitySummary;
}

function formatFlagsByCode(flagsByCode = {}) {
  const entries = Object.entries(flagsByCode).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  if (!entries.length) {
    return "none";
  }

  return entries.map(([code, count]) => `${code}=${count}`).join(", ");
}

function getLyricPolishSummary(payload) {
  const result = unwrapResult(payload);

  return result?.lyricPolishSummary && typeof result.lyricPolishSummary === "object"
    ? result.lyricPolishSummary
    : null;
}

function loadTruthEntries(rawTruth, lineCount) {
  const entries = [];
  if (!rawTruth || typeof rawTruth !== "object" || Array.isArray(rawTruth)) {
    return entries;
  }

  for (const [key, value] of Object.entries(rawTruth)) {
    const numericKey = Number(key);
    const seconds = Number(value);
    if (!Number.isInteger(numericKey) || !Number.isFinite(seconds)) {
      continue;
    }

    let index = null;
    if (numericKey >= 1 && numericKey <= lineCount) {
      index = numericKey - 1;
    } else if (numericKey >= 0 && numericKey < lineCount) {
      index = numericKey;
    }

    if (index !== null) {
      entries.push({ index, seconds });
    }
  }

  return entries.sort((a, b) => a.index - b.index);
}

function median(values) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2) {
    return sorted[midpoint];
  }
  return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function formatSeconds(value) {
  return Number.isFinite(value) ? value.toFixed(3).padStart(8, " ") : "       -";
}

function formatRatio(value) {
  return Number.isFinite(value) ? value.toFixed(2).padStart(5, " ") : "    -";
}

async function expandTargets(args) {
  const targets = args.length ? args : [defaultWordsPath];
  const files = [];

  for (const target of targets) {
    const resolved = path.resolve(target);
    if (!existsSync(resolved)) {
      throw new Error(`Input not found: ${target}`);
    }

    if (statSync(resolved).isDirectory()) {
      const names = await readdir(resolved);
      for (const name of names.sort()) {
        if (/^auto-time-.*\.json$/i.test(name)) {
          files.push(path.join(resolved, name));
        }
      }
    } else {
      files.push(resolved);
    }
  }

  return files;
}

async function scoreFile({ filePath, sampleProject, truthEntries }) {
  const payload = await readJson(filePath);
  const words = getWords(payload);
  const audio = getAudio(payload, sampleProject);
  const lines = sampleProject.lines.map((line, index) => ({
    id: line.id ?? stableLineId(index),
    original: line.original,
  }));
  const pipelineMatches = getPipelineMatches(payload, lines);
  const matches = pipelineMatches ?? alignLyricLinesToWordTimings(lines, words, audio);
  const summary = summarizeLyricTimingMatches(matches);
  const counts = getSummaryCounts(matches);
  const qualitySummary = getQualitySummary(payload, { audio, lines, matches });
  const lyricPolishSummary = getLyricPolishSummary(payload);
  const errors = truthEntries
    .map(({ index, seconds }) => {
      const match = matches[index];
      if (!Number.isFinite(match?.start)) {
        return null;
      }
      return {
        error: Math.abs(match.start - seconds),
        index,
        start: match.start,
        truth: seconds,
      };
    })
    .filter(Boolean);
  const errorValues = errors.map((entry) => entry.error);
  const truthByIndex = new Map(truthEntries.map((entry) => [entry.index, entry.seconds]));
  const errorByIndex = new Map(errors.map((entry) => [entry.index, entry.error]));

  console.log("");
  console.log(`Scorecard: ${path.relative(rootDir, filePath)}`);
  console.log(`Words: ${words.length}`);
  console.log(`Matches: ${pipelineMatches ? "pipeline result" : "offline aligner"}`);
  console.log(
    `Lines timed: ${counts.timed}/${matches.length} ` +
      `(direct ${counts.directMatched}, repeat-template ${counts.repeatTemplated}, ` +
      `interpolated ${counts.interpolated})`,
  );
  console.log(
    `Confidence: high ${summary.highConfidenceCount ?? 0}, ` +
      `medium ${summary.mediumConfidenceCount ?? 0}, ` +
      `low ${summary.lowConfidenceCount ?? 0}, ` +
      `estimated ${summary.estimatedCount ?? 0}, ` +
      `unmatched ${summary.unmatchedCount ?? 0}`,
  );
  console.log(
    `QA: ok ${qualitySummary.okLineCount ?? 0}, ` +
      `review ${qualitySummary.reviewLineCount ?? 0}, ` +
      `high ${qualitySummary.highRiskLineCount ?? 0}`,
  );
  console.log(`Flags: ${formatFlagsByCode(qualitySummary.flagsByCode)}`);
  if (lyricPolishSummary) {
    console.log(
      `Polish: ${lyricPolishSummary.status ?? "unknown"}, ` +
        `changed ${lyricPolishSummary.changedLineCount ?? 0}, ` +
        `original ${lyricPolishSummary.originalTextChangeCount ?? 0}, ` +
        `romanization ${lyricPolishSummary.romanizationChangeCount ?? 0}, ` +
        `translation ${lyricPolishSummary.translationChangeCount ?? 0}`,
    );
  }

  if (truthEntries.length) {
    console.log(
      `Truth labels: ${truthEntries.length}; scored ${errors.length}; ` +
        `median |error| ${formatSeconds(median(errorValues)).trim()}s; ` +
        `max |error| ${
          errorValues.length ? formatSeconds(Math.max(...errorValues)).trim() : "-"
        }s`,
    );
  } else {
    console.log("Truth labels: 0; add samples/aaj-se-teri.truth.json for error stats");
  }

  console.log("");
  console.log("Line Conf       Ratio    Start    Truth    |Err| Text");
  console.log("---- ---------- ----- -------- -------- -------- ------------------------------");

  for (const match of matches) {
    const truth = truthByIndex.get(match.index);
    const error = errorByIndex.get(match.index);
    const confidence = String(match.timingSource ?? match.confidence ?? "none").padEnd(10);
    const text = String(match.original ?? "").slice(0, 46);

    console.log(
      `${String(match.lineNumber).padStart(4)} ` +
        `${confidence} ` +
        `${formatRatio(match.matchRatio)} ` +
        `${formatSeconds(match.start)} ` +
        `${formatSeconds(truth)} ` +
        `${formatSeconds(error)} ${text}`,
    );
  }

  return { counts, errors, matches, summary, words };
}

async function main() {
  const samplePath = path.resolve(readFlag("sample", defaultSamplePath));
  const truthPath = path.resolve(readFlag("truth", defaultTruthPath));
  const outPath = readFlag("out", null);
  const sampleProject = await readJson(samplePath);
  const rawTruth = existsSync(truthPath) ? await readJson(truthPath) : {};
  const truthEntries = loadTruthEntries(rawTruth, sampleProject.lines?.length ?? 0);
  const files = await expandTargets(positionalArgs());

  if (!files.length) {
    throw new Error("No timing captures found to score.");
  }

  for (const filePath of files) {
    await scoreFile({ filePath, sampleProject, truthEntries });
  }

  if (outPath) {
    const resolvedOutPath = path.resolve(outPath);
    await mkdir(path.dirname(resolvedOutPath), { recursive: true });
    await writeFile(resolvedOutPath, `${scorecardLines.join("\n")}\n`, "utf8");
  }
}

const scorecardLines = [];
const originalLog = console.log.bind(console);
console.log = (...args) => {
  const line = args.map((arg) => String(arg)).join(" ");
  scorecardLines.push(line);
  originalLog(...args);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
