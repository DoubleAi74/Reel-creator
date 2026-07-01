"use client";

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import WaveSurfer from "wavesurfer.js";

import {
  createWaveformPeaksCache,
  getWaveformPeaksForWaveSurfer,
  WAVEFORM_PEAKS_CACHE_CONFIG,
} from "@/lib/autosave";
import {
  clampTimeToSection,
  findActiveLine,
  getSectionFrameFromTime,
  getSectionBounds,
  getTimedLines,
} from "@/lib/timing";
import {
  rememberEmittedTime,
  shouldPublishPlaybackFrame,
  shouldSeekEngineToCurrentTime,
} from "@/lib/waveform-sync";
import { VIDEO_FPS } from "@/remotion/constants";

// One consistent clock format for both sides of the readout: `M:SS` (total) and
// `M:SS.t` (current). Holding the character count constant — plus tabular-nums and a
// min-width on the chip — keeps the readout from reflowing the row as it ticks.
function formatClock(totalSeconds, withTenths = false) {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = Math.floor(safeSeconds % 60);
  const base = `${minutes}:${String(seconds).padStart(2, "0")}`;

  if (!withTenths) {
    return base;
  }

  const tenths = Math.floor((safeSeconds % 1) * 10);

  return `${base}.${tenths}`;
}

function getMarkerLeftPercent(lineStart, audio) {
  const { sectionDuration, startOffset } = getSectionBounds(audio);

  if (!Number.isFinite(lineStart) || sectionDuration <= 0) {
    return 0;
  }

  return ((lineStart - startOffset) / sectionDuration) * 100;
}

function clampPercent(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}

function cancelWaveformReveal(frameRef, timeoutRef) {
  if (typeof window === "undefined") {
    return;
  }

  window.cancelAnimationFrame(frameRef.current);
  window.clearTimeout(timeoutRef.current);
  frameRef.current = 0;
  timeoutRef.current = 0;
}

function WaveformSkeleton({ currentPercent = 0 }) {
  const cursorLeft = clampPercent(currentPercent * 100);

  return (
    <div aria-hidden="true" className="waveform-skeleton">
      <div className="waveform-skeleton-bars">
        {Array.from({ length: 128 }).map((_, index) => {
          const amplitude =
            0.38 +
            ((Math.sin(index * 0.41) + Math.sin(index * 0.17 + 1.8) + 2) / 4) *
              0.52;

          return (
            <span
              className="waveform-skeleton-bar"
              key={index}
              style={{ "--bar-h": `${Math.max(8, Math.round(34 * amplitude))}px` }}
            />
          );
        })}
      </div>
      <span
        className="waveform-skeleton-cursor"
        style={{ left: `${cursorLeft}%` }}
      />
    </div>
  );
}

// The WebAudio backend plays through an AudioContext, which the browser starts
// suspended until a user gesture. Resume it before any play() so sound (and the
// audioContext-derived clock) actually advances.
async function resumeWaveAudioContext(waveSurfer) {
  const audioContext = waveSurfer?.getMediaElement?.()?.audioContext;

  if (audioContext && audioContext.state === "suspended") {
    try {
      await audioContext.resume();
    } catch {
      // Resume can reject if the context was torn down mid-gesture; ignore.
    }
  }
}

function installTimingDebugHook(waveSurferRef) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const debugState = (window.__reelTimingDebug ??= {});

  debugState.getWaveSurferTime = () => waveSurferRef.current?.getCurrentTime() ?? null;
  debugState.pauseWaveSurfer = () => waveSurferRef.current?.pause();
  debugState.playWaveSurfer = async () => {
    await resumeWaveAudioContext(waveSurferRef.current);
    return waveSurferRef.current?.play();
  };
  debugState.seekWaveSurfer = (nextTime) => waveSurferRef.current?.setTime(nextTime);
  debugState.getWaveSurferOnsets = ({
    threshold = 0.08,
    cooldownMs = 100,
  } = {}) => {
    const decoded = waveSurferRef.current?.getDecodedData?.();

    if (!decoded) {
      return null;
    }

    const samples = decoded.getChannelData(0);
    const cooldown = Math.floor((cooldownMs / 1000) * decoded.sampleRate);
    const onsets = [];

    for (let index = 0; index < samples.length; index += 1) {
      if (Math.abs(samples[index]) < threshold) {
        continue;
      }

      onsets.push(index / decoded.sampleRate);
      index += cooldown;
    }

    return {
      onsets,
      sampleRate: decoded.sampleRate,
    };
  };

  return () => {
    if (!window.__reelTimingDebug) {
      return;
    }

    delete window.__reelTimingDebug.getWaveSurferTime;
    delete window.__reelTimingDebug.pauseWaveSurfer;
    delete window.__reelTimingDebug.playWaveSurfer;
    delete window.__reelTimingDebug.seekWaveSurfer;
    delete window.__reelTimingDebug.getWaveSurferOnsets;
  };
}

export function WaveformTimeline({
  activeLineId,
  audio,
  audioAssetDurationSec = null,
  audioAssetId = "",
  audioSrc,
  cachedWaveformPeaks = null,
  currentTime,
  isAudioRestoring = false,
  isPlaying,
  isTimingActive,
  lines,
  onDurationChange,
  onMark,
  onPlayingChange,
  onTimeChange,
  onWaveformPeaks,
}) {
  const containerRef = useRef(null);
  const waveSurferRef = useRef(null);
  const lastClockFrameRef = useRef(null);
  const waveReadyRef = useRef(false);
  const waveRedrawCompleteRef = useRef(false);
  const revealFrameRef = useRef(0);
  const revealTimeoutRef = useRef(0);
  // Mirror of the `currentTime` prop, kept current (via the effect below) so the
  // rAF playback clock — an effect with a stale closure — can see how far the
  // parent has actually rendered.
  const currentTimeRef = useRef(currentTime);
  // Recent time values this component reported UP to the parent from the engine.
  // The controlled-sync effect can run with a STALE `currentTime` (renders lag
  // behind the engine clock during playback), so we match against a short history
  // — not just the latest emit — to tell an engine echo from an external seek.
  const emittedTimesRef = useRef(new Set());
  const [errorMessage, setErrorMessage] = useState("");
  const [status, setStatus] = useState(audioSrc ? "loading" : "empty");
  const [waveformVisualReadySource, setWaveformVisualReadySource] =
    useState(null);
  // 1 = normal, 0.5 = half-speed (pitch preserved). Reset to 1 whenever new audio
  // loads; applied to the engine by the effect below.
  const [speed, setSpeed] = useState(1);
  const hasReadyWaveform = Boolean(
    audioSrc && waveformVisualReadySource === audioSrc,
  );
  const isWaveformBusy = Boolean(
    (audioSrc && !hasReadyWaveform) || isAudioRestoring,
  );

  const emitTimeChange = useEffectEvent((timeInSeconds) => {
    rememberEmittedTime(emittedTimesRef.current, timeInSeconds);
    onTimeChange?.(timeInSeconds);
  });
  const emitPlayingChange = useEffectEvent((playing) => {
    onPlayingChange?.(playing);
  });
  const emitDurationChange = useEffectEvent((durationInSeconds) => {
    onDurationChange?.(durationInSeconds);
  });
  const emitWaveformPeaks = useEffectEvent((waveformPeaks) => {
    onWaveformPeaks?.(waveformPeaks);
  });
  const getWaveformPeaksForLoad = useEffectEvent(() =>
    getWaveformPeaksForWaveSurfer(cachedWaveformPeaks, {
      assetId: audioAssetId,
      durationSec: audioAssetDurationSec ?? audio.duration,
    }),
  );
  const createWaveformPeaksForCurrentAsset = useEffectEvent(
    (durationInSeconds, peaks) =>
      createWaveformPeaksCache({
        assetId: audioAssetId,
        durationSec: durationInSeconds,
        peaks,
      }),
  );
  const getSectionStart = useEffectEvent(() => getSectionBounds(audio).startOffset);
  const getClockFrame = useEffectEvent((timeInSeconds) =>
    getSectionFrameFromTime(timeInSeconds, audio, VIDEO_FPS),
  );
  // Single frame-bounded clock publisher. WaveSurfer reports time through several
  // redundant channels — the playback `timeupdate` timer, plus `seeking`/
  // `interaction` during a scrub — and the component also runs its own rAF clock.
  // Forwarding every one floods `currentAudioTime` with sub-frame updates that the
  // editor (preview + 300+ word tiles) cannot re-render fast enough; the per-frame
  // preview seek then trips React's update-depth limit. Coalescing every source to
  // at most one update per VIDEO frame (the only granularity the preview/board
  // need) keeps the editor able to keep up. Programmatic seeks (Mark/jump/section)
  // bypass this — they call onTimeChange directly. The live engine clock for Mark
  // is read straight from WaveSurfer, so timing precision is unaffected.
  const emitTimeAtFrame = useEffectEvent((timeInSeconds) => {
    const nextFrame = getClockFrame(timeInSeconds);

    if (lastClockFrameRef.current === nextFrame) {
      return;
    }

    lastClockFrameRef.current = nextFrame;
    emitTimeChange(timeInSeconds);
  });
  const clampToSection = useEffectEvent((timeInSeconds, durationInSeconds) =>
    clampTimeToSection(timeInSeconds, {
      ...audio,
      ...(Number.isFinite(durationInSeconds)
        ? { duration: durationInSeconds }
        : {}),
    }),
  );

  // Keep the rAF clock's view of the rendered `currentTime` up to date. A layout
  // effect flushes synchronously at the end of every commit — before the browser
  // paints and before the next rAF tick reads it — so the backpressure gate always
  // sees the frame the parent has actually rendered, with no lag.
  useLayoutEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => installTimingDebugHook(waveSurferRef), []);

  useEffect(() => {
    if (!containerRef.current || !audioSrc) {
      setStatus(isAudioRestoring ? "loading" : "empty");
      setErrorMessage("");
      emitPlayingChange(false);
      return undefined;
    }

    setStatus("loading");
    setErrorMessage("");
    setSpeed(1);
    waveReadyRef.current = false;
    waveRedrawCompleteRef.current = false;

    const revealWaveform = () => {
      window.cancelAnimationFrame(revealFrameRef.current);
      revealFrameRef.current = window.requestAnimationFrame(() => {
        revealFrameRef.current = window.requestAnimationFrame(() => {
          setWaveformVisualReadySource(audioSrc);
        });
      });
    };

    const maybeRevealWaveform = () => {
      if (!waveReadyRef.current || !waveRedrawCompleteRef.current) {
        return;
      }

      window.clearTimeout(revealTimeoutRef.current);
      revealTimeoutRef.current = 0;
      revealWaveform();
    };
    const cachedWaveform = getWaveformPeaksForLoad();
    const loadedWithCachedPeaks = Boolean(cachedWaveform);
    let exportedWaveformPeaks = false;
    let mediaCanPlay = !loadedWithCachedPeaks;
    let mediaCanPlayCleanup = () => {};
    let readyDuration = null;
    let statusReadyApplied = false;

    const waveSurfer = WaveSurfer.create({
      // Play through Web Audio (decoded PCM + AudioBufferSourceNode) instead of
      // an HTMLAudioElement. This gives a sample-accurate clock and exact,
      // rebuffer-free seeks, so the preview (which is slaved to this clock)
      // stays locked to the music after mid-song seeks and ±2s jumps.
      backend: "WebAudio",
      barGap: 2,
      barRadius: 999,
      barWidth: 2,
      container: containerRef.current,
      cursorColor: "#2C9B3F",
      dragToSeek: true,
      // Fill the container height (which CSS centres) instead of a fixed 64px that
      // mismatched the 63px track — that mismatch top-clipped the waveform and shoved
      // it below centre. "auto" also adapts to the per-breakpoint padding.
      height: "auto",
      normalize: true,
      progressColor: "rgba(44, 155, 63, 0.85)",
      waveColor: "rgba(99, 91, 77, 0.32)",
      url: audioSrc,
      ...(cachedWaveform
        ? {
            duration: cachedWaveform.duration,
            peaks: cachedWaveform.peaks,
          }
        : {}),
    });

    waveSurferRef.current = waveSurfer;

    const applyFunctionalReady = (durationInSeconds) => {
      if (statusReadyApplied || !mediaCanPlay) {
        return;
      }

      const usableDuration = Number.isFinite(durationInSeconds)
        ? durationInSeconds
        : waveSurfer.getDuration();
      const nextTime = clampToSection(getSectionStart(), usableDuration);

      statusReadyApplied = true;
      setStatus("ready");
      lastClockFrameRef.current = getClockFrame(nextTime);
      emitDurationChange(usableDuration);
      emitTimeChange(nextTime);
      waveSurfer.setTime(nextTime);
    };

    if (loadedWithCachedPeaks) {
      const mediaElement = waveSurfer.getMediaElement?.();
      const handleMediaCanPlay = () => {
        mediaCanPlay = true;
        applyFunctionalReady(readyDuration);
      };

      mediaElement?.addEventListener?.("canplay", handleMediaCanPlay, {
        once: true,
      });
      mediaCanPlayCleanup = () => {
        mediaElement?.removeEventListener?.("canplay", handleMediaCanPlay);
      };
    }

    const maybeExportWaveformPeaks = (durationInSeconds) => {
      if (loadedWithCachedPeaks || exportedWaveformPeaks) {
        return;
      }

      try {
        const exportDuration = Number.isFinite(durationInSeconds)
          ? durationInSeconds
          : waveSurfer.getDuration();
        const peaks = waveSurfer.exportPeaks({
          channels: WAVEFORM_PEAKS_CACHE_CONFIG.channels,
          maxLength: WAVEFORM_PEAKS_CACHE_CONFIG.maxLength,
          precision: WAVEFORM_PEAKS_CACHE_CONFIG.precision,
        });
        const waveformPeaks = createWaveformPeaksForCurrentAsset(
          exportDuration,
          peaks,
        );

        if (waveformPeaks) {
          exportedWaveformPeaks = true;
          emitWaveformPeaks(waveformPeaks);
        }
      } catch {
        // Peaks are a disposable performance cache. Decode/playback remain valid.
      }
    };

    waveSurfer.on("decode", (durationInSeconds) => {
      maybeExportWaveformPeaks(durationInSeconds);
    });

    waveSurfer.on("ready", (durationInSeconds) => {
      readyDuration = durationInSeconds;
      maybeExportWaveformPeaks(durationInSeconds);
      waveReadyRef.current = true;

      window.clearTimeout(revealTimeoutRef.current);
      revealTimeoutRef.current = window.setTimeout(() => {
        setWaveformVisualReadySource(audioSrc);
      }, 900);

      maybeRevealWaveform();
      applyFunctionalReady(durationInSeconds);
    });

    waveSurfer.on("redrawcomplete", () => {
      waveRedrawCompleteRef.current = true;
      maybeRevealWaveform();
    });

    // While playing, the rAF tick below is the SOLE clock publisher: it is
    // paint-aligned, so it self-limits to the rate the editor can actually
    // re-render. WaveSurfer's `timeupdate`/`seeking` fire on an independent timer
    // (~60/s) that does NOT slow down under load, so publishing them during
    // playback floods `currentAudioTime` faster than the preview + word board can
    // render — the backlog never drains and React reports "Maximum update depth
    // exceeded". They publish only when paused (e.g. seek-while-paused). A direct
    // user scrub still publishes immediately via `interaction` for responsiveness.
    waveSurfer.on("timeupdate", (nextTime) => {
      if (!waveSurfer.isPlaying()) {
        emitTimeAtFrame(nextTime);
      }
    });

    waveSurfer.on("interaction", (nextTime) => {
      emitTimeAtFrame(nextTime);
    });

    waveSurfer.on("seeking", (nextTime) => {
      if (!waveSurfer.isPlaying()) {
        emitTimeAtFrame(nextTime);
      }
    });

    waveSurfer.on("play", () => {
      emitPlayingChange(true);
    });

    waveSurfer.on("pause", () => {
      emitPlayingChange(false);
      // Publish the engine's EXACT stop position. During playback the rAF clock is
      // the sole publisher and is frame-gated + backpressure-gated, so the parent
      // legitimately lags the engine by up to a frame; without this the readout would
      // freeze at that lagged time (a visible backward jump) and snap forward on
      // resume. emitTimeChange is the UNGATED publisher and records into emittedTimes,
      // so the controlled-sync effect treats this as an echo and does NOT re-seek.
      emitTimeChange(clampToSection(waveSurfer.getCurrentTime()));
    });

    waveSurfer.on("finish", () => {
      const startOffset = getSectionStart();

      emitPlayingChange(false);
      emitTimeChange(startOffset);
      waveSurfer.setTime(startOffset);
    });

    waveSurfer.on("error", (error) => {
      setStatus("error");
      cancelWaveformReveal(revealFrameRef, revealTimeoutRef);
      setWaveformVisualReadySource(audioSrc);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "The uploaded MP3 could not be decoded for waveform playback.",
      );
      emitPlayingChange(false);
    });

    return () => {
      cancelWaveformReveal(revealFrameRef, revealTimeoutRef);
      mediaCanPlayCleanup();
      // destroy() leaves the WebAudio backend's AudioContext open (it's treated
      // as "external media"), so close it ourselves to avoid leaking contexts
      // across track changes (browsers cap how many can exist).
      const audioContext = waveSurfer.getMediaElement?.()?.audioContext ?? null;

      waveSurfer.destroy();

      if (audioContext && audioContext.state !== "closed") {
        audioContext.close().catch(() => {});
      }

      waveSurferRef.current = null;
    };
  }, [audioSrc, isAudioRestoring]);

  useEffect(() => {
    const waveSurfer = waveSurferRef.current;

    if (!waveSurfer || status !== "ready") {
      return;
    }

    const nextTime = clampTimeToSection(currentTime, audio);

    // Only push EXTERNAL/programmatic `currentTime` changes into the engine; an
    // engine time echoed back through the parent is left alone so it can't fight
    // live playback. See lib/waveform-sync for the full rationale.
    if (
      shouldSeekEngineToCurrentTime({
        currentTime,
        engineTime: waveSurfer.getCurrentTime(),
        audio,
        emittedTimes: emittedTimesRef.current,
      })
    ) {
      waveSurfer.setTime(nextTime);
    }

    lastClockFrameRef.current = getClockFrame(nextTime);
  }, [audio, currentTime, status]);

  // Apply the playback rate to the engine. preservePitch keeps 0.5× from dropping an
  // octave. The rAF clock reads the engine's own time, so half-rate playback needs no
  // clock changes — frames simply advance at half wall-clock speed.
  useEffect(() => {
    const waveSurfer = waveSurferRef.current;

    if (!waveSurfer || status !== "ready") {
      return;
    }

    waveSurfer.setPlaybackRate(speed, true);
  }, [speed, status]);

  useEffect(() => {
    if (status !== "ready" || !isPlaying) {
      return undefined;
    }

    let frameHandle = 0;

    const tick = () => {
      const waveSurfer = waveSurferRef.current;

      if (!waveSurfer) {
        return;
      }

      // Backpressure: do not publish the next playback frame until the parent has
      // re-rendered the LAST one we sent. rAF fires every animation frame whether
      // or not React has caught up; on a heavy editor (preview + word board) that
      // lets the clock outrun rendering, so commits never reach idle and React
      // reports "Maximum update depth exceeded". Gating on the reflected frame
      // couples the clock to the achievable render rate — it self-throttles under
      // load and runs at full frame rate when rendering is cheap.
      const reflectedFrame = getClockFrame(currentTimeRef.current);
      if (!shouldPublishPlaybackFrame(lastClockFrameRef.current, reflectedFrame)) {
        frameHandle = window.requestAnimationFrame(tick);
        return;
      }

      const nextTime = clampTimeToSection(waveSurfer.getCurrentTime(), audio);

      emitTimeAtFrame(nextTime);

      frameHandle = window.requestAnimationFrame(tick);
    };

    frameHandle = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frameHandle);
    };
  }, [audio, isPlaying, status]);

  const togglePlayback = async () => {
    const waveSurfer = waveSurferRef.current;

    if (!audioSrc) {
      onPlayingChange?.(!isPlaying);
      return;
    }

    if (!waveSurfer || status !== "ready") {
      return;
    }

    try {
      await resumeWaveAudioContext(waveSurfer);
      await waveSurfer.playPause();
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Playback could not start for this MP3.",
      );
      onPlayingChange?.(false);
    }
  };

  const jumpTo = (nextTime) => {
    const waveSurfer = waveSurferRef.current;

    if (!audioSrc) {
      onTimeChange?.(clampTimeToSection(nextTime, audio));
      return;
    }

    if (!waveSurfer || status !== "ready") {
      return;
    }

    const clampedTime = clampTimeToSection(nextTime, audio);
    waveSurfer.setTime(clampedTime);
    onTimeChange?.(clampedTime);
  };

  const { endOffset, sectionDuration, startOffset } = getSectionBounds(audio);
  const currentSectionTime = Math.max(
    0,
    clampTimeToSection(currentTime, audio) - startOffset,
  );
  const heardLine = findActiveLine(lines, currentTime, audio);
  const markers = getTimedLines(lines).filter(
    (line) =>
      Number.isFinite(line.start) &&
      line.start >= startOffset &&
      line.start <= endOffset,
  );
  // Nearest timed-lyric starts on either side of the playhead, for the prev/next
  // buttons. `markers` is already sorted ascending and clamped to the section. The
  // epsilon keeps a playhead sitting exactly on a marker from re-selecting it.
  const navReferenceTime = clampTimeToSection(currentTime, audio);
  const NAV_EPSILON = 1e-3;
  let previousLyricStart = null;
  let nextLyricStart = null;
  for (const line of markers) {
    if (line.start < navReferenceTime - NAV_EPSILON) {
      previousLyricStart = line.start;
    } else if (
      line.start > navReferenceTime + NAV_EPSILON &&
      nextLyricStart === null
    ) {
      nextLyricStart = line.start;
    }
  }
  const isReady = status === "ready" || (!audioSrc && !isAudioRestoring);
  const canMark = isReady && isTimingActive && Boolean(activeLineId) && typeof onMark === "function";
  const currentWaveformPercent =
    sectionDuration > 0 ? currentSectionTime / sectionDuration : 0;

  return (
    <div className="transport overflow-hidden border-t border-[var(--border)] bg-[var(--surface)] lg:rounded-[1.75rem] lg:border lg:border-[var(--border)] lg:bg-[var(--surface-2)]">
      <div className="transport-inner">
      <div className="transport-wave-wrap px-4 pb-3 pt-2.5 lg:px-4 lg:pb-2 lg:pt-3">
        <div className="relative">
          <div
            aria-busy={isWaveformBusy}
            className={`waveform waveform-surface ${
              hasReadyWaveform ? "is-wave-ready" : "is-wave-loading"
            } relative overflow-hidden rounded-xl bg-[var(--surface)] px-2.5 py-2 lg:rounded-[1rem] lg:px-3 lg:py-2.5`}
          >
            {/* Content-box wrapper: markers (CSS %) and the wavesurfer
                waveform/cursor share this exact coordinate space. */}
            <div className="waveform-content">
              {audioSrc ? (
                <div
                  aria-hidden={!hasReadyWaveform}
                  className="waveform-engine-layer"
                >
                  <div className="waveform-canvas" ref={containerRef} />

                  {markers.length ? (
                    // Purely visual lyric markers. pointer-events-none lets clicks
                    // fall through to the waveform so the mouse only seeks playback.
                    <div className="pointer-events-none absolute inset-0 z-10">
                      {markers.map((line) => {
                        const isActiveMarker = activeLineId === line.id;
                        const isHeardMarker =
                          !isActiveMarker && heardLine?.id === line.id;
                        const markerState = isActiveMarker
                          ? "active"
                          : isHeardMarker
                            ? "heard"
                            : "idle";
                        const left = getMarkerLeftPercent(line.start, audio);

                        return (
                          <div
                            aria-hidden="true"
                            className={`waveform-marker waveform-marker--${markerState}`}
                            key={line.id}
                            style={{ left: `${left}%` }}
                          >
                            <span className="waveform-marker-cap" />
                            <span className="waveform-marker-line" />
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="waveform-canvas" ref={containerRef} />
              )}

              <WaveformSkeleton currentPercent={currentWaveformPercent} />
            </div>
          </div>
        </div>

        {errorMessage ? (
          <p className="mt-3 text-sm leading-6 text-[var(--danger)]">{errorMessage}</p>
        ) : null}
      </div>

      <div className="transport-controls flex items-center gap-2 border-t border-[var(--border)] px-4 pb-5 pt-3 lg:flex-wrap lg:justify-between lg:gap-4 lg:px-4 lg:py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 lg:flex-none lg:flex-wrap">
          <button
            aria-label="Rewind to section start"
            className="rewind-button hidden rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs text-[var(--muted)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40 lg:inline-flex"
            disabled={!isReady}
            onClick={() => jumpTo(startOffset)}
            type="button"
          >
            ⏮ Rewind
          </button>
          <button
            aria-label="Jump to previous lyric"
            className="nav-button flex h-11 w-11 flex-none items-center justify-center rounded-full bg-[var(--surface-2)] text-[13px] text-[var(--muted)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40 lg:h-auto lg:w-auto lg:rounded-full lg:border lg:border-[var(--border)] lg:bg-[var(--surface)] lg:px-3 lg:py-1.5 lg:text-xs"
            data-dir="prev"
            disabled={!isReady || previousLyricStart === null}
            onClick={() => jumpTo(previousLyricStart)}
            title="Previous lyric"
            type="button"
          >
            <span aria-hidden>⇤</span>
          </button>
          <button
            aria-label={isPlaying ? "Pause" : "Play"}
            aria-pressed={isPlaying}
            className={`play-button flex h-11 w-11 flex-none items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--muted)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:bg-[var(--surface-2)] disabled:text-[var(--muted)] lg:h-auto lg:w-auto lg:gap-2 lg:rounded-full lg:bg-[var(--accent)] lg:px-5 lg:py-1.5 lg:text-sm lg:font-semibold lg:text-[var(--on-accent)] lg:hover:opacity-90 ${isPlaying ? "is-playing" : ""} ${isReady ? "" : "is-not-ready"}`}
            disabled={!isReady}
            onClick={togglePlayback}
            type="button"
          >
            <span aria-hidden>{isPlaying ? "❚❚" : "▶"}</span>
            <span className="hidden lg:inline">{isPlaying ? "Pause" : "Play"}</span>
          </button>
          <button
            aria-label="Jump to next lyric"
            className="nav-button flex h-11 w-11 flex-none items-center justify-center rounded-full bg-[var(--surface-2)] text-[13px] text-[var(--muted)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40 lg:h-auto lg:w-auto lg:rounded-full lg:border lg:border-[var(--border)] lg:bg-[var(--surface)] lg:px-3 lg:py-1.5 lg:text-xs"
            data-dir="next"
            disabled={!isReady || nextLyricStart === null}
            onClick={() => jumpTo(nextLyricStart)}
            title="Next lyric"
            type="button"
          >
            <span aria-hidden>⇥</span>
          </button>
          <button
            aria-label={`Playback speed ${speed === 1 ? "normal" : "half"}`}
            aria-pressed={speed !== 1}
            className="speed-button flex h-11 w-11 flex-none items-center justify-center rounded-full bg-[var(--surface-2)] text-[11px] font-semibold text-[var(--muted)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40 lg:h-auto lg:w-auto lg:rounded-full lg:border lg:border-[var(--border)] lg:bg-[var(--surface)] lg:px-3 lg:py-1.5 lg:text-xs"
            disabled={!isReady}
            onClick={() => setSpeed((current) => (current === 1 ? 0.5 : 1))}
            title="Toggle half-speed playback (keeps pitch)"
            type="button"
          >
            {speed === 1 ? "1×" : "0.5×"}
          </button>
          {isTimingActive ? (
            <button
              aria-label="Mark current lyric time"
              className="mark-button flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-[var(--accent)] text-sm font-bold text-[var(--on-accent)] shadow-[0_8px_24px_rgba(251,191,36,0.35)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-[var(--surface-2)] disabled:text-[var(--muted)] lg:h-auto lg:flex-none lg:border lg:border-[var(--accent)] lg:bg-[var(--surface-active)] lg:px-4 lg:py-1.5 lg:text-xs lg:font-semibold lg:uppercase lg:tracking-[0.18em] lg:text-[var(--accent)] lg:shadow-none lg:hover:bg-[var(--surface-hover)]"
              disabled={!canMark}
              onClick={onMark}
              type="button"
            >
              <span aria-hidden>●</span>
              <span>Mark</span>
              <span className="hidden rounded bg-black/25 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.1em] text-[var(--accent)] lg:inline">
                Enter
              </span>
            </button>
          ) : null}
        </div>

        <div className="transport-time">
          <span className="transport-time-readout font-mono">
            {formatClock(currentSectionTime, true)} / {formatClock(sectionDuration)}
          </span>
        </div>
      </div>
      </div>
    </div>
  );
}
