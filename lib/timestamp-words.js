export const MIN_TIMED_WORD_DURATION_SECONDS = 0.02;

export function hasUsableTimedWordDuration(start, end) {
  const duration = Number(end) - Number(start);

  return Number.isFinite(duration) && duration >= MIN_TIMED_WORD_DURATION_SECONDS;
}
