import { clampTimeToSection } from "./timing";

// How far the engine clock may drift from the requested time before the
// controlled-sync effect corrects it with a seek.
export const SYNC_SEEK_THRESHOLD_SECONDS = 0.05;

// Number of recent engine-reported times to remember for echo detection. The
// controlled-sync effect can run against a STALE `currentTime` (renders lag the
// engine clock during playback), so matching only the latest emit is not enough;
// a short history covers the lag and self-limits once the re-render storm stops.
export const EMITTED_TIME_HISTORY_LIMIT = 150;

// Record a time this component reported UP to its parent from the engine, evicting
// the oldest once the history is full. The exact float values are kept so they can
// be matched against the `currentTime` prop they round-trip back as.
export function rememberEmittedTime(
  emittedTimes,
  time,
  limit = EMITTED_TIME_HISTORY_LIMIT,
) {
  emittedTimes.add(time);
  if (emittedTimes.size > limit) {
    emittedTimes.delete(emittedTimes.values().next().value);
  }
  return emittedTimes;
}

// Decide whether the controlled-sync effect should seek the WaveSurfer engine to
// match the `currentTime` prop.
//
// The prop carries two kinds of change:
//   - ENGINE ECHO: the engine's own reported time, round-tripped through the
//     parent. The engine is already there, so seeking would do nothing useful —
//     and while playing, a slow render lets the live clock drift past the
//     threshold before this runs, so a seek would yank playback BACKWARD to the
//     stale time every render (a runaway that trips "Maximum update depth
//     exceeded"). These must NOT seek.
//   - EXTERNAL/PROGRAMMATIC: Mark, transport jumps, section edits, import — values
//     the engine never reported. These SHOULD seek, including during playback.
//
// Echoes are told apart from external changes by membership in the emitted-time
// history, which is robust to render lag (unlike comparing against the engine
// clock, which legitimately differs during playback).
export function shouldSeekEngineToCurrentTime({
  currentTime,
  engineTime,
  audio,
  emittedTimes,
  threshold = SYNC_SEEK_THRESHOLD_SECONDS,
}) {
  if (emittedTimes && emittedTimes.has(currentTime)) {
    return false;
  }

  const target = clampTimeToSection(currentTime, audio);

  return Math.abs(engineTime - target) > threshold;
}

// Backpressure gate for the rAF playback clock. The requestAnimationFrame loop
// fires every animation frame regardless of whether React has rendered the last
// time we published; on a heavy editor that lets the clock outrun rendering, so
// commits never reach idle and React reports "Maximum update depth exceeded".
// Publishing the next frame only once the parent has rendered the previous one
// (its `currentTime` prop reflects `lastPublishedFrame`) couples the clock to the
// achievable render rate: full speed when rendering is cheap, self-throttling
// under load. `null` means nothing has been published yet, so publishing is
// allowed (e.g. the very first playback frame).
export function shouldPublishPlaybackFrame(lastPublishedFrame, reflectedFrame) {
  return lastPublishedFrame === null || lastPublishedFrame === reflectedFrame;
}
