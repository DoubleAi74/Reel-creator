import { describe, expect, it } from "vitest";

import {
  EMITTED_TIME_HISTORY_LIMIT,
  rememberEmittedTime,
  shouldPublishPlaybackFrame,
  shouldSeekEngineToCurrentTime,
} from "./waveform-sync";

const AUDIO = { duration: 10, startOffset: 0, endOffset: 10 };

// These guard the scrub-while-playing "Maximum update depth exceeded" fix. The
// controlled-sync effect must seek the WaveSurfer engine for EXTERNAL changes
// (Mark, transport jumps, section edits, lyric clicks, import) but never for the
// engine's own time echoed back through the parent — otherwise, while playing, a
// render-lagged echo would seek playback backward every render in a runaway.
describe("shouldSeekEngineToCurrentTime", () => {
  it("seeks for an external scrub while paused", () => {
    // Engine sitting at 0 (its only reported time); the user drags/clicks to 5.
    const emittedTimes = new Set([0]);

    expect(
      shouldSeekEngineToCurrentTime({
        currentTime: 5,
        engineTime: 0,
        audio: AUDIO,
        emittedTimes,
      }),
    ).toBe(true);
  });

  it("seeks for an external scrub WHILE PLAYING", () => {
    // Mid-playback the engine has reported ~2s; the user scrubs the waveform to 7s.
    const emittedTimes = new Set([2]);

    expect(
      shouldSeekEngineToCurrentTime({
        currentTime: 7,
        engineTime: 2.05,
        audio: AUDIO,
        emittedTimes,
      }),
    ).toBe(true);
  });

  it("seeks for an external/programmatic seek WHILE PLAYING (Mark, ±2s, jump)", () => {
    // A jump issued from elsewhere in the editor sets a time the engine never
    // reported; it must still take effect during playback.
    const emittedTimes = new Set([2, 2.0166, 2.0333]);

    expect(
      shouldSeekEngineToCurrentTime({
        currentTime: 4.0333,
        engineTime: 2.05,
        audio: AUDIO,
        emittedTimes,
      }),
    ).toBe(true);
  });

  it("does NOT seek on an engine echo, even after the live clock has drifted", () => {
    // THE regression: the parent feeds back 2.7 (a time the engine reported a
    // moment ago) while the still-playing engine has already advanced to 3.0.
    // Pre-fix, |3.0 - 2.7| > 0.05 seeked playback BACK to 2.7 every render.
    const emittedTimes = new Set([2.7]);

    expect(
      shouldSeekEngineToCurrentTime({
        currentTime: 2.7,
        engineTime: 3.0,
        audio: AUDIO,
        emittedTimes,
      }),
    ).toBe(false);
  });

  it("does not seek when the engine is already within the threshold", () => {
    const emittedTimes = new Set([1]);

    expect(
      shouldSeekEngineToCurrentTime({
        currentTime: 2,
        engineTime: 2.02,
        audio: AUDIO,
        emittedTimes,
      }),
    ).toBe(false);
  });

  it("compares against the section-clamped target", () => {
    // currentTime beyond the section end clamps to the end; engine already there.
    const emittedTimes = new Set();

    expect(
      shouldSeekEngineToCurrentTime({
        currentTime: 15,
        engineTime: 10,
        audio: AUDIO,
        emittedTimes,
      }),
    ).toBe(false);
  });
});

describe("rememberEmittedTime", () => {
  it("retains recent emits so a lagged echo is still recognized", () => {
    const emitted = new Set();
    for (let i = 0; i < 40; i += 1) {
      rememberEmittedTime(emitted, i / 10);
    }
    // A value reported many emits ago is still present within the history window.
    expect(emitted.has(0.5)).toBe(true);
    expect(emitted.has(3.9)).toBe(true);
  });

  it("evicts the oldest entries beyond the history limit", () => {
    const emitted = new Set();
    const total = EMITTED_TIME_HISTORY_LIMIT + 25;
    for (let i = 0; i < total; i += 1) {
      rememberEmittedTime(emitted, i);
    }
    expect(emitted.size).toBe(EMITTED_TIME_HISTORY_LIMIT);
    expect(emitted.has(total - 1)).toBe(true); // newest kept
    expect(emitted.has(0)).toBe(false); // oldest evicted
  });
});

// Guards the playback-clock backpressure that stops the rAF loop from outrunning
// the editor's render rate (the real-song scrub-while-playing failure).
describe("shouldPublishPlaybackFrame", () => {
  it("publishes the very first frame (nothing reflected yet)", () => {
    expect(shouldPublishPlaybackFrame(null, 0)).toBe(true);
    expect(shouldPublishPlaybackFrame(null, 120)).toBe(true);
  });

  it("publishes once the parent has rendered the last published frame", () => {
    expect(shouldPublishPlaybackFrame(120, 120)).toBe(true);
  });

  it("holds (back-pressures) while the parent still lags the last published frame", () => {
    // We published frame 120 but the parent has only rendered up to 118 — under
    // load the rAF must wait rather than pile on more updates.
    expect(shouldPublishPlaybackFrame(120, 118)).toBe(false);
    expect(shouldPublishPlaybackFrame(120, 0)).toBe(false);
  });

  it("simulated rAF loop self-limits to the render rate (no backlog)", () => {
    // Model: the engine advances 1 frame per rAF tick, but the parent renders the
    // published frame only every 3rd tick (a slow editor). Backpressure must keep
    // the number of published frames equal to the number of renders — never more.
    let engineFrame = 0;
    let lastPublished = null;
    let reflected = null;
    let published = 0;
    let renders = 0;
    for (let tick = 0; tick < 60; tick += 1) {
      engineFrame += 1; // engine clock advances every animation frame
      if (shouldPublishPlaybackFrame(lastPublished, reflected)) {
        if (engineFrame !== lastPublished) {
          lastPublished = engineFrame;
          published += 1;
        }
      }
      if (tick % 3 === 2) {
        reflected = lastPublished; // a (slow) render lands, parent catches up
        renders += 1;
      }
    }
    expect(published).toBeLessThanOrEqual(renders + 1);
    expect(published).toBeGreaterThan(0); // still makes forward progress
  });
});
