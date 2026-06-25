// Pure helpers for merging AI-generated per-word meanings (gloss/roman) onto
// project lines. Kept network-free so the pipeline, the /api/ai/word-meanings
// route, and unit tests can all share the same merge logic (P6).

function cleanField(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// A line "has meanings" once any of its words carries a non-empty gloss.
export function lineHasMeanings(line) {
  return (
    Array.isArray(line?.words) &&
    line.words.some((word) => cleanField(word?.gloss))
  );
}

export function linesMissingMeanings(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((line, index) => ({ index, line }))
    .filter(({ line }) => !lineHasMeanings(line));
}

// Merge meaning tokens (text/gloss/roman, authoritative for display) with any
// existing timing tokens (start/end). Timing is attached positionally when the
// token counts line up, else by exact text match — best-effort, never required.
export function mergeMeaningWordsWithTiming(timingWords, meaningWords) {
  if (!Array.isArray(meaningWords) || meaningWords.length === 0) {
    return Array.isArray(timingWords) ? timingWords : [];
  }

  const timing = Array.isArray(timingWords) ? timingWords : [];
  const sameLength = timing.length === meaningWords.length;

  return meaningWords.map((word, index) => {
    const match = sameLength
      ? timing[index]
      : timing.find((candidate) => candidate?.text === word?.text);

    return {
      end: match && Number.isFinite(match.end) ? match.end : null,
      gloss: cleanField(word?.gloss),
      roman: cleanField(word?.roman),
      start: match && Number.isFinite(match.start) ? match.start : null,
      text: typeof word?.text === "string" ? word.text.trim() : "",
    };
  }).filter((word) => word.text);
}

// Apply a meanings result (array of { line_number, words }) onto lines, matching
// by 1-based line number. `onlyMissing` implements the post-generation coverage
// fill (D-Gloss-Coverage): leave lines that already have gloss untouched.
export function applyWordMeaningsToLines(lines, meanings, { onlyMissing = false } = {}) {
  const byNumber = new Map();
  for (const entry of Array.isArray(meanings) ? meanings : []) {
    if (entry && Number.isInteger(entry.line_number)) {
      byNumber.set(entry.line_number, entry.words);
    }
  }

  return (Array.isArray(lines) ? lines : []).map((line, index) => {
    const meaningWords = byNumber.get(index + 1);
    if (!meaningWords) {
      return line;
    }
    if (onlyMissing && lineHasMeanings(line)) {
      return line;
    }
    return {
      ...line,
      words: mergeMeaningWordsWithTiming(line.words, meaningWords),
    };
  });
}
