import { phoneticKey } from "./phonetics";
import { hasUsableTimedWordDuration } from "./timestamp-words";

const DEFAULT_MIN_MATCH_RATIO = 0.68;
const SHORT_LINE_MAX_TOKENS = 4;
const SHORT_LINE_MAX_MISSES = 1;
const TOKEN_LOOKAHEAD = 3;
const MAX_CANDIDATES_PER_LINE = 120;
const MAX_ALIGNMENT_STATES = 600;
const UNMATCHED_LINE_PENALTY = -0.22;
const MIN_ESTIMATED_GAP_SECONDS = 0.35;

function normalizeToken(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[’']/g, "")
    // Drop Indic nasalization/conjunct marks that transcription renders
    // inconsistently (nukta, chandrabindu, anusvara, virama/halant) — e.g.
    // "घर्"→"घर", "गयां"→"गया", "अंबर"→"अबर". Vowel matras are preserved, so
    // distinct words like "मेरा"/"तेरा" stay distinct.
    .replace(/[़ँं्]/g, "");
}

export function tokenizeForTiming(value) {
  const normalized = normalizeToken(value);
  const hasDenseScript =
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(normalized);

  if (hasDenseScript && !/\s/u.test(normalized)) {
    return (
      normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{N}]/gu) ??
      []
    );
  }

  return normalized.match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
}

function editDistance(leftValue, rightValue) {
  const left = Array.from(leftValue);
  const right = Array.from(rightValue);
  const distances = Array.from({ length: left.length + 1 }, (_, index) => index);

  for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
    let previousDiagonal = distances[0];

    distances[0] = rightIndex;

    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
      const currentDiagonal = distances[leftIndex];
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;

      distances[leftIndex] = Math.min(
        distances[leftIndex] + 1,
        distances[leftIndex - 1] + 1,
        previousDiagonal + substitutionCost,
      );
      previousDiagonal = currentDiagonal;
    }
  }

  return distances[left.length];
}

function tokensAreSimilar(left, right) {
  if (left === right) {
    return true;
  }

  const longerLength = Math.max(left.length, right.length);

  if (
    longerLength >= 3 &&
    Math.abs(left.length - right.length) <= 1 &&
    (left.endsWith(right) || right.endsWith(left))
  ) {
    return true;
  }

  if (longerLength < 4) {
    return false;
  }

  const distance = editDistance(left, right);

  return longerLength >= 8 ? distance <= 2 : distance <= 1;
}

function normalizeTimedWord(rawWord) {
  const text = rawWord?.word ?? rawWord?.text ?? "";
  const start = Number(rawWord?.start);
  const end = Number(rawWord?.end);

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    !hasUsableTimedWordDuration(start, end) ||
    !text
  ) {
    return null;
  }

  return {
    end,
    start,
    word: String(text).trim(),
  };
}

function buildTimedTokens(words = [], audio = {}) {
  const startOffset = Number.isFinite(audio.startOffset) ? audio.startOffset : 0;
  const endOffset =
    Number.isFinite(audio.endOffset) && audio.endOffset !== null
      ? audio.endOffset
      : Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : Number.POSITIVE_INFINITY;

  return words
    .map(normalizeTimedWord)
    .filter(
      (word) =>
        word &&
        word.end >= startOffset &&
        word.start <= endOffset,
    )
    .flatMap((word, wordIndex) =>
      tokenizeForTiming(word.word)
        .map((token) => ({
          end: Math.min(word.end, endOffset),
          start: Math.max(word.start, startOffset),
          token: phoneticKey(token),
          word,
          wordIndex,
        }))
        .filter((entry) => entry.token),
    );
}

function splitDisplayWords(text) {
  const rawWords = String(text || "").match(/\S+/gu) ?? [];

  if (rawWords.length > 0) {
    return rawWords;
  }

  return String(text || "") ? [String(text)] : [];
}

function buildLineTokenEntries(line) {
  const text = line?.original ?? line?.text ?? "";
  const displayWords = splitDisplayWords(text);
  const entries = [];

  for (let wordIndex = 0; wordIndex < displayWords.length; wordIndex += 1) {
    const wordText = displayWords[wordIndex];
    const wordTokens = tokenizeForTiming(wordText);

    for (const tokenText of wordTokens) {
      const token = phoneticKey(tokenText);

      if (token) {
        entries.push({
          token,
          tokenText,
          wordIndex,
          wordText,
        });
      }
    }
  }

  if (entries.length > 0) {
    return entries;
  }

  return tokenizeForTiming(text)
    .map((tokenText, wordIndex) => ({
      token: phoneticKey(tokenText),
      tokenText,
      wordIndex,
      wordText: tokenText,
    }))
    .filter((entry) => entry.token);
}

function getMatchConfidence(matchRatio, skipCount) {
  if (matchRatio >= 0.9 && skipCount <= 3) {
    return "high";
  }

  if (matchRatio >= DEFAULT_MIN_MATCH_RATIO) {
    return "medium";
  }

  return "low";
}

function computeLineMatchAt(lineTokens, timedTokens, startIndex, maxExtraTokens) {
  const windowEnd = Math.min(
    timedTokens.length,
    startIndex + lineTokens.length + maxExtraTokens,
  );
  const pairs = [];
  let timedIndex = startIndex;

  for (let lineTokenIndex = 0; lineTokenIndex < lineTokens.length; lineTokenIndex += 1) {
    const lineToken = lineTokens[lineTokenIndex];
    const lookEnd = Math.min(windowEnd, timedIndex + TOKEN_LOOKAHEAD + 1);
    let foundIndex = -1;

    for (let probe = timedIndex; probe < lookEnd; probe += 1) {
      if (tokensAreSimilar(lineToken.token, timedTokens[probe].token)) {
        foundIndex = probe;
        break;
      }
    }

    if (foundIndex === -1) {
      continue;
    }

    pairs.push({ lineTokenIndex, timedIndex: foundIndex });
    timedIndex = foundIndex + 1;
  }

  if (!pairs.length) {
    return null;
  }

  const firstMatch = pairs[0];
  const lastMatch = pairs[pairs.length - 1];
  const matchedCount = pairs.length;
  const matchRatio = matchedCount / lineTokens.length;
  const span = lastMatch.timedIndex - firstMatch.timedIndex + 1;
  const skipCount = span - matchedCount;

  return {
    confidence: getMatchConfidence(matchRatio, skipCount),
    firstLineTokenIndex: firstMatch.lineTokenIndex,
    firstTimedTokenIndex: firstMatch.timedIndex,
    lastTimedTokenIndex: lastMatch.timedIndex,
    matchRatio,
    matchedCount,
    pairs,
    score: matchRatio - firstMatch.lineTokenIndex * 0.08 - skipCount * 0.018,
    skipCount,
  };
}

function candidateAccepted(candidate, lineLength) {
  if (candidate.matchRatio >= DEFAULT_MIN_MATCH_RATIO) {
    return true;
  }

  if (lineLength <= SHORT_LINE_MAX_TOKENS) {
    return lineLength - candidate.matchedCount <= SHORT_LINE_MAX_MISSES;
  }

  return false;
}

function getCandidateAlignmentScore(candidate) {
  const compactnessBonus = Math.max(0, 0.12 - candidate.skipCount * 0.015);

  return 1 + candidate.score + candidate.matchRatio * 0.25 + compactnessBonus;
}

function compareCandidates(left, right) {
  if (right.alignmentScore !== left.alignmentScore) {
    return right.alignmentScore - left.alignmentScore;
  }

  if (right.matchRatio !== left.matchRatio) {
    return right.matchRatio - left.matchRatio;
  }

  return left.firstTimedTokenIndex - right.firstTimedTokenIndex;
}

function buildLineCandidates(lineTokens, timedTokens) {
  if (!lineTokens.length || !timedTokens.length) {
    return [];
  }

  const maxExtraTokens = Math.min(16, Math.max(5, Math.ceil(lineTokens.length * 0.65)));
  const candidatesBySpan = new Map();

  for (let startIndex = 0; startIndex < timedTokens.length; startIndex += 1) {
    const candidate = computeLineMatchAt(
      lineTokens,
      timedTokens,
      startIndex,
      maxExtraTokens,
    );

    if (!candidate || !candidateAccepted(candidate, lineTokens.length)) {
      continue;
    }

    const enrichedCandidate = {
      ...candidate,
      alignmentScore: getCandidateAlignmentScore(candidate),
    };
    const spanKey = `${candidate.firstTimedTokenIndex}:${candidate.lastTimedTokenIndex}`;
    const currentCandidate = candidatesBySpan.get(spanKey);

    if (
      !currentCandidate ||
      compareCandidates(enrichedCandidate, currentCandidate) < 0
    ) {
      candidatesBySpan.set(spanKey, enrichedCandidate);
    }
  }

  return [...candidatesBySpan.values()]
    .sort(compareCandidates)
    .slice(0, MAX_CANDIDATES_PER_LINE)
    .sort((left, right) => left.firstTimedTokenIndex - right.firstTimedTokenIndex);
}

function getTransitionPenalty(previousState, candidate, timedTokens) {
  if (previousState.lastTimedTokenIndex < 0) {
    return 0;
  }

  const gapTokens = Math.max(
    0,
    candidate.firstTimedTokenIndex - previousState.lastTimedTokenIndex - 1,
  );
  const previousEnd = timedTokens[previousState.lastTimedTokenIndex]?.end ?? 0;
  const nextStart = timedTokens[candidate.firstTimedTokenIndex]?.start ?? previousEnd;
  const gapSeconds = Math.max(0, nextStart - previousEnd);

  return Math.min(0.28, gapTokens * 0.002 + gapSeconds * 0.01);
}

function pruneAlignmentStates(states) {
  const bestByLastToken = new Map();

  for (const state of states) {
    const current = bestByLastToken.get(state.lastTimedTokenIndex);

    if (
      !current ||
      state.score > current.score ||
      (state.score === current.score && state.wordMatchedCount > current.wordMatchedCount)
    ) {
      bestByLastToken.set(state.lastTimedTokenIndex, state);
    }
  }

  return [...bestByLastToken.values()]
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return right.wordMatchedCount - left.wordMatchedCount;
    })
    .slice(0, MAX_ALIGNMENT_STATES);
}

function solveGlobalAlignment(lineCandidates, timedTokens) {
  let states = [
    {
      candidate: undefined,
      lastTimedTokenIndex: -1,
      previous: null,
      score: 0,
      wordMatchedCount: 0,
    },
  ];

  for (const candidates of lineCandidates) {
    const nextStates = [];

    for (const state of states) {
      nextStates.push({
        candidate: null,
        lastTimedTokenIndex: state.lastTimedTokenIndex,
        previous: state,
        score: state.score + UNMATCHED_LINE_PENALTY,
        wordMatchedCount: state.wordMatchedCount,
      });

      for (const candidate of candidates) {
        if (candidate.firstTimedTokenIndex <= state.lastTimedTokenIndex) {
          continue;
        }

        nextStates.push({
          candidate,
          lastTimedTokenIndex: candidate.lastTimedTokenIndex,
          previous: state,
          score:
            state.score +
            candidate.alignmentScore -
            getTransitionPenalty(state, candidate, timedTokens),
          wordMatchedCount: state.wordMatchedCount + 1,
        });
      }
    }

    states = pruneAlignmentStates(nextStates);
  }

  const endState = states.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return right.wordMatchedCount - left.wordMatchedCount;
  })[0];
  const assignments = [];

  for (let state = endState; state?.previous; state = state.previous) {
    assignments.push(state.candidate);
  }

  return assignments.reverse();
}

function getAudioTimingBounds(audio = {}) {
  const start = Number.isFinite(audio.startOffset) ? audio.startOffset : 0;
  const end =
    Number.isFinite(audio.endOffset) && audio.endOffset !== null
      ? audio.endOffset
      : Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : Number.POSITIVE_INFINITY;

  return { end, start };
}

function clampEstimateToAudioBounds(value, audio) {
  const { end, start } = getAudioTimingBounds(audio);
  const lowerBound = Number.isFinite(start) ? start : 0;
  const upperBound = Number.isFinite(end) ? end : Number.POSITIVE_INFINITY;

  return Math.min(Math.max(value, lowerBound), upperBound);
}

function median(values) {
  const sortedValues = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);

  if (!sortedValues.length) {
    return null;
  }

  return sortedValues[Math.floor(sortedValues.length / 2)];
}

function getTypicalLineGap(matches) {
  const starts = matches
    .map((match) => match.start)
    .filter((value) => Number.isFinite(value));
  const gaps = [];

  for (let index = 1; index < starts.length; index += 1) {
    const gap = starts[index] - starts[index - 1];

    if (gap >= MIN_ESTIMATED_GAP_SECONDS && gap <= 12) {
      gaps.push(gap);
    }
  }

  return median(gaps) ?? 3;
}

function getLineWeight(match) {
  const text = match?.original ?? "";
  const tokenCount = tokenizeForTiming(text).length;

  return Math.max(1, tokenCount || Math.ceil(text.length / 8));
}

function interpolateBetweenAnchors({
  matches,
  nextAnchor,
  previousAnchor,
  runEndIndex,
  runStartIndex,
}) {
  const runWeights = [];
  let totalWeight = 0;

  for (let index = runStartIndex; index <= runEndIndex; index += 1) {
    const weight = getLineWeight(matches[index]);
    runWeights.push(weight);
    totalWeight += weight;
  }

  totalWeight += getLineWeight(nextAnchor);

  const available = nextAnchor.start - previousAnchor.start;
  let cumulative = 0;

  return runWeights.map((weight) => {
    cumulative += weight;
    return previousAnchor.start + available * (cumulative / totalWeight);
  });
}

function estimateMissingLineTimings(matches, audio) {
  const hasAnchor = matches.some((match) => Number.isFinite(match.start));

  if (!hasAnchor) {
    return matches;
  }

  const typicalGap = getTypicalLineGap(matches);
  const nextMatches = matches.map((match) => ({ ...match }));
  let index = 0;

  while (index < nextMatches.length) {
    if (Number.isFinite(nextMatches[index].start)) {
      index += 1;
      continue;
    }

    const runStartIndex = index;

    while (
      index < nextMatches.length &&
      !Number.isFinite(nextMatches[index].start)
    ) {
      index += 1;
    }

    const runEndIndex = index - 1;
    const runLength = runEndIndex - runStartIndex + 1;
    const previousAnchorIndex = runStartIndex - 1;
    const nextAnchorIndex = index < nextMatches.length ? index : -1;
    const previousAnchor =
      previousAnchorIndex >= 0 ? nextMatches[previousAnchorIndex] : null;
    const nextAnchor =
      nextAnchorIndex >= 0 ? nextMatches[nextAnchorIndex] : null;
    const interpolatedStarts =
      previousAnchor &&
      Number.isFinite(previousAnchor.start) &&
      nextAnchor &&
      Number.isFinite(nextAnchor.start)
        ? interpolateBetweenAnchors({
            matches: nextMatches,
            nextAnchor,
            previousAnchor,
            runEndIndex,
            runStartIndex,
          })
        : null;

    for (let offset = 0; offset < runLength; offset += 1) {
      const lineIndex = runStartIndex + offset;
      let estimatedStart;

      if (interpolatedStarts) {
        estimatedStart = interpolatedStarts[offset];
      } else if (previousAnchor && Number.isFinite(previousAnchor.start)) {
        estimatedStart = previousAnchor.start + typicalGap * (offset + 1);
      } else if (nextAnchor && Number.isFinite(nextAnchor.start)) {
        estimatedStart = nextAnchor.start - typicalGap * (runLength - offset);
      } else {
        continue;
      }

      const previousStart =
        lineIndex > 0 && Number.isFinite(nextMatches[lineIndex - 1].start)
          ? nextMatches[lineIndex - 1].start
          : null;
      const nextStart =
        lineIndex + 1 < nextMatches.length &&
        Number.isFinite(nextMatches[lineIndex + 1].start)
          ? nextMatches[lineIndex + 1].start
          : nextAnchor?.start;
      const minStart =
        previousStart == null
          ? Number.NEGATIVE_INFINITY
          : previousStart + MIN_ESTIMATED_GAP_SECONDS;
      const maxStart =
        nextStart == null
          ? Number.POSITIVE_INFINITY
          : nextStart - MIN_ESTIMATED_GAP_SECONDS;
      const clampedStart = clampEstimateToAudioBounds(
        Math.min(Math.max(estimatedStart, minStart), maxStart),
        audio,
      );
      const fallbackEnd = clampedStart + Math.max(1.2, typicalGap * 0.82);
      const estimatedEnd =
        nextStart == null
          ? fallbackEnd
          : Math.max(clampedStart, Math.min(nextStart, fallbackEnd));

      nextMatches[lineIndex] = {
        ...nextMatches[lineIndex],
        confidence: "estimated",
        end: clampEstimateToAudioBounds(estimatedEnd, audio),
        matchRatio: 0,
        start: clampedStart,
        timingSource: "interpolated",
        words: [],
      };
    }
  }

  return nextMatches;
}

function buildNoMatch(line, index) {
  const text = line?.original ?? line?.text ?? "";

  return {
    confidence: "none",
    end: null,
    id: line?.id ?? null,
    index,
    lineNumber: index + 1,
    matchRatio: 0,
    original: text,
    start: null,
    timingSource: "none",
    words: [],
  };
}

function buildMatchedWords(lineTokens, match, timedTokens) {
  const byWordIndex = new Map();

  for (const pair of match.pairs) {
    const lineToken = lineTokens[pair.lineTokenIndex];
    const timedToken = timedTokens[pair.timedIndex];
    const current = byWordIndex.get(lineToken.wordIndex);

    if (!current) {
      byWordIndex.set(lineToken.wordIndex, {
        end: timedToken.end,
        start: timedToken.start,
        text: lineToken.wordText,
      });
    } else {
      current.end = Math.max(current.end, timedToken.end);
      current.start = Math.min(current.start, timedToken.start);
    }
  }

  return [...byWordIndex.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, word]) => word);
}

function buildMatchedLine(line, lineTokens, index, match, timedTokens) {
  const text = line?.original ?? line?.text ?? "";
  const firstToken = timedTokens[match.firstTimedTokenIndex];
  const lastToken = timedTokens[match.lastTimedTokenIndex];

  return {
    confidence: match.confidence,
    end: lastToken.end,
    id: line?.id ?? null,
    index,
    lineNumber: index + 1,
    matchRatio: match.matchRatio,
    matchedWordCount: match.matchedCount,
    original: text,
    start: firstToken.start,
    timingSource: "word-match",
    words: buildMatchedWords(lineTokens, match, timedTokens),
  };
}

export function alignLyricLinesToWordTimings(lines = [], words = [], audio = {}) {
  const timedTokens = buildTimedTokens(words, audio);
  const lineTokenEntries = lines.map(buildLineTokenEntries);
  const lineCandidates = lineTokenEntries.map((tokens) =>
    buildLineCandidates(tokens, timedTokens),
  );
  const assignments = solveGlobalAlignment(lineCandidates, timedTokens);
  const directMatches = lines.map((line, index) => {
    const match = assignments[index];

    if (!match) {
      return buildNoMatch(line, index);
    }

    return buildMatchedLine(
      line,
      lineTokenEntries[index],
      index,
      match,
      timedTokens,
    );
  });

  return estimateMissingLineTimings(directMatches, audio);
}

export function summarizeLyricTimingMatches(matches = []) {
  const summary = {
    estimatedCount: 0,
    highConfidenceCount: 0,
    lineCount: matches.length,
    lowConfidenceCount: 0,
    matchedCount: 0,
    mediumConfidenceCount: 0,
    repeatTemplateCount: 0,
    timedCount: 0,
    unmatchedCount: 0,
    wordMatchedCount: 0,
  };

  for (const match of matches) {
    if (match.confidence === "high") {
      summary.highConfidenceCount += 1;
      summary.matchedCount += 1;
      summary.timedCount += 1;
      if (match.timingSource === "repeat-template") {
        summary.repeatTemplateCount += 1;
      } else {
        summary.wordMatchedCount += 1;
      }
      continue;
    }

    if (match.confidence === "medium") {
      summary.mediumConfidenceCount += 1;
      summary.matchedCount += 1;
      summary.timedCount += 1;
      if (match.timingSource === "repeat-template") {
        summary.repeatTemplateCount += 1;
      } else {
        summary.wordMatchedCount += 1;
      }
      continue;
    }

    if (match.confidence === "estimated") {
      summary.estimatedCount += 1;
      summary.timedCount += 1;
      continue;
    }

    if (match.confidence === "low") {
      summary.lowConfidenceCount += 1;
      if (Number.isFinite(match.start)) {
        summary.timedCount += 1;
        summary.wordMatchedCount += 1;
      }
      continue;
    }

    summary.unmatchedCount += 1;
  }

  return summary;
}
