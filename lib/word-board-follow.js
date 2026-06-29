export const FOLLOW_LINE_GRACE_SECONDS = 0.1;
export const FOLLOW_WORD_GAP_HOLD_SECONDS = 1;
const TIME_EPSILON_SECONDS = 0.000001;

function isFiniteTime(value) {
  return Number.isFinite(value);
}

function getSourceLineId(line, lineIndex) {
  return line?.sourceId ?? line?.id ?? `line-${lineIndex}`;
}

function getDisplayLineId(line) {
  return line?.id ?? null;
}

function getSourceWordKey(word, lineSourceId, wordIndex) {
  return word?.sourceWordKey ?? `${lineSourceId}:${wordIndex}`;
}

// Build per-line timing metadata.
//
// Authority model: WORD timing is authoritative; `line.start` is only a hint.
// Auto-timed `line.start` values are frequently compressed and land earlier than
// (and closer together than) the words actually sung, so we must NOT use them to
// clip which words belong to a line. Every timed word stays attached to its
// structural line, and each line's active window is derived from its own words
// (min start … max end). `line.start` is used only to pull a line's highlight a
// little earlier (anticipation), and is clamped so it can never reach back across
// the previous line's sung words.
function buildLineMetas(lines = []) {
  const inputLines = Array.isArray(lines) ? lines : [];

  const metas = inputLines
    .map((line, index) => {
      const sourceId = getSourceLineId(line, index);
      const lineStart = isFiniteTime(line?.start) ? line.start : null;
      const lineEnd = isFiniteTime(line?.end) ? line.end : null;

      // Keep every timed word; do not clip by the (unreliable) line window.
      const validWords = (Array.isArray(line?.words) ? line.words : [])
        .map((word, wordIndex) => ({
          end: word?.end,
          index: wordIndex,
          key: getSourceWordKey(word, sourceId, wordIndex),
          start: word?.start,
        }))
        .filter(
          (word) =>
            isFiniteTime(word.start) &&
            isFiniteTime(word.end) &&
            word.end >= word.start,
        );

      const effStart = validWords.length
        ? Math.min(...validWords.map((word) => word.start))
        : lineStart;
      const effEnd = validWords.length
        ? Math.max(...validWords.map((word) => word.end))
        : lineEnd;

      // The earliest the line may begin highlighting: its own first word, pulled
      // back toward `line.start` when that hint sits before the first word.
      const anchorStart =
        effStart != null && lineStart != null
          ? Math.min(lineStart, effStart)
          : (effStart ?? lineStart);

      return {
        anchorStart,
        displayId: getDisplayLineId(line),
        effEnd,
        effStart,
        index,
        lineStart,
        sourceId,
        validWords,
      };
    })
    .filter((meta) => meta.effStart != null);

  // Order lines by where they actually start being sung (word authority), so a
  // line whose `line.start` hint is out of order still slots in correctly.
  metas.sort((left, right) => {
    if (left.effStart !== right.effStart) {
      return left.effStart - right.effStart;
    }
    return left.index - right.index;
  });

  return metas.map((meta, timedIndex) => ({
    ...meta,
    nextEffStart: metas[timedIndex + 1]?.effStart ?? Number.POSITIVE_INFINITY,
    prevEffEnd:
      timedIndex > 0
        ? (metas[timedIndex - 1].effEnd ?? Number.NEGATIVE_INFINITY)
        : Number.NEGATIVE_INFINITY,
    timedIndex,
  }));
}

function getLineWindowStart(meta, graceSeconds) {
  if (meta.timedIndex === 0) {
    return meta.anchorStart;
  }
  // Anticipate up to `graceSeconds` before the line, and don't reach back across
  // the previous line's sung words — BUT never open later than this line's own
  // first sung word (`effStart`). Without that cap, a previous line whose word
  // timings overlap into this one (common with compressed auto-timing) would
  // keep this line dark until those words end, so the line would only light up
  // after the playhead had already moved through it.
  return Math.min(
    meta.effStart,
    Math.max(meta.prevEffEnd, meta.anchorStart - graceSeconds),
  );
}

function getLineWindowEnd(meta, graceSeconds) {
  return meta.effEnd + graceSeconds;
}

function isLineWindowActive(meta, currentTime, graceSeconds) {
  return (
    currentTime >= getLineWindowStart(meta, graceSeconds) &&
    currentTime <= getLineWindowEnd(meta, graceSeconds)
  );
}

function findActiveLineMeta(metas, currentTime, graceSeconds) {
  if (!metas.length || !isFiniteTime(currentTime)) {
    return null;
  }

  // The latest line (in sung order) whose window contains the playhead wins, so
  // overlapping trailing grace / anticipation resolves to the newer line.
  let active = null;
  for (const meta of metas) {
    if (isLineWindowActive(meta, currentTime, graceSeconds)) {
      active = meta;
    }
  }
  return active;
}

function resolveCurrentWords(activeMeta, currentTime, gapHoldSeconds, reachableKeys) {
  if (!activeMeta?.validWords?.length || !isFiniteTime(currentTime)) {
    return [];
  }

  // Only reachable words (those not preceded by a not-yet-sung word in reading
  // order) can be current. This rejects a word whose timing is out of order —
  // e.g. a duplicate "के" copied to the end of a line carrying a stale early
  // start — so it can't light up as current alongside the real word.
  const words = [...activeMeta.validWords]
    .filter((word) => reachableKeys.has(word.key))
    .sort((left, right) => {
      if (left.start !== right.start) {
        return left.start - right.start;
      }

      return left.index - right.index;
    });
  const overlapping = words.filter(
    (word) => word.start <= currentTime && currentTime <= word.end,
  );

  if (overlapping.length) {
    return overlapping;
  }

  const previousWords = words.filter((word) => word.end < currentTime);
  const nextWord = words.find((word) => word.start > currentTime);

  if (!previousWords.length || !nextWord) {
    return [];
  }

  const previousWord = previousWords.reduce((best, word) => {
    if (!best || word.end > best.end) {
      return word;
    }

    if (word.end === best.end && word.index > best.index) {
      return word;
    }

    return best;
  }, null);
  const gap = nextWord.start - previousWord.end;

  if (
    gap > 0 &&
    gap <= gapHoldSeconds + TIME_EPSILON_SECONDS &&
    currentTime < nextWord.start
  ) {
    return [previousWord];
  }

  return [];
}

// Every display word in reading (document) order, timed or not. Used for the
// ordinal passed sweep so untimed/skipped words behind the playhead still shade.
function buildOrderedWords(lines = []) {
  const inputLines = Array.isArray(lines) ? lines : [];
  const ordered = [];
  inputLines.forEach((line, index) => {
    const sourceId = getSourceLineId(line, index);
    (Array.isArray(line?.words) ? line.words : []).forEach((word, wordIndex) => {
      ordered.push({
        key: getSourceWordKey(word, sourceId, wordIndex),
        start: word?.start,
        timed: isFiniteTime(word?.start) && isFiniteTime(word?.end) && word.end >= word.start,
      });
    });
  });
  return ordered;
}

// Mark which words are "reachable" at the current time: a word is reachable
// only if no earlier word in reading order is still in the future (start >
// currentTime). Words are sung left to right, so you cannot be currently
// singing — or have already sung — a word while an earlier word has not begun.
// This makes the resolver robust to out-of-order / stale-duplicate timing: such
// a word sits after a not-yet-sung word, so it is unreachable and is ignored for
// both current and passed-frontier purposes (it still shades passed ordinally
// once the playhead legitimately moves past its reading position). Untimed words
// never block, since they carry no claim about playback position.
function computeReachableKeys(orderedWords, currentTime) {
  const reachable = new Set();
  let blocked = false;
  for (const word of orderedWords) {
    if (!blocked) {
      reachable.add(word.key);
    }
    if (word.timed && word.start > currentTime) {
      blocked = true;
    }
  }
  return reachable;
}

export function hasFollowAudioTiming(lines) {
  const metas = buildLineMetas(lines);

  return metas.some((meta) => meta.validWords.length > 0);
}

export function resolveFollowAudioState(lines, currentTime, options = {}) {
  const lineGraceSeconds =
    Number.isFinite(options.lineGraceSeconds) && options.lineGraceSeconds >= 0
      ? options.lineGraceSeconds
      : FOLLOW_LINE_GRACE_SECONDS;
  const wordGapHoldSeconds =
    Number.isFinite(options.wordGapHoldSeconds) && options.wordGapHoldSeconds >= 0
      ? options.wordGapHoldSeconds
      : FOLLOW_WORD_GAP_HOLD_SECONDS;
  const metas = buildLineMetas(lines);
  const available = metas.some((meta) => meta.validWords.length > 0);
  const orderedWords = buildOrderedWords(lines);
  const reachableKeys = computeReachableKeys(orderedWords, currentTime);
  const activeMeta = available
    ? findActiveLineMeta(metas, currentTime, lineGraceSeconds)
    : null;
  const currentWords = activeMeta
    ? resolveCurrentWords(activeMeta, currentTime, wordGapHoldSeconds, reachableKeys)
    : [];
  const currentWordKeySet = new Set(currentWords.map((word) => word.key));

  // Passed words are resolved ORDINALLY over EVERY display word (timed or not),
  // in reading order. Two rules:
  //   1. Everything strictly BEHIND the current word shades passed — including
  //      untimed or skipped words (an untimed trailing "गई", a word with no
  //      timing between two sung words). No tile behind the playhead is stray.
  //   2. NOTHING at or after the current word shades. This matters because a
  //      word's timing can be out of order (e.g. a duplicate "के" copied to the
  //      end of a line carries an early start), and that must never drag the
  //      passed region past the word actually being sung.
  // When there is no current word (gap / before-first / after-last) the passed
  // region extends to the furthest reachable timed word that has started;
  // trailing untimed words with nothing sung after them stay normal, and a stale
  // out-of-order word cannot drag the region forward.
  const passedWordKeys = [];

  if (available && isFiniteTime(currentTime)) {
    const firstCurrentIndex = orderedWords.findIndex((word) =>
      currentWordKeySet.has(word.key),
    );

    let frontier;
    if (firstCurrentIndex >= 0) {
      frontier = firstCurrentIndex - 1;
    } else {
      frontier = -1;
      for (let i = 0; i < orderedWords.length; i += 1) {
        const word = orderedWords[i];
        if (word.timed && word.start <= currentTime && reachableKeys.has(word.key)) {
          frontier = i;
        }
      }
    }

    for (let i = 0; i <= frontier; i += 1) {
      passedWordKeys.push(orderedWords[i].key);
    }
  }

  return {
    activeDisplayLineId: activeMeta?.displayId ?? null,
    activeSourceLineId: activeMeta?.sourceId ?? null,
    available,
    currentWordKeys: [...currentWordKeySet],
    passedWordKeys,
  };
}
