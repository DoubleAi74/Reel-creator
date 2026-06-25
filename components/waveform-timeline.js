"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";

import {
  clampTimeToSection,
  findActiveLine,
  getSectionFrameFromTime,
  getSectionBounds,
  getTimedLines,
} from "@/lib/timing";
import { VIDEO_FPS } from "@/remotion/constants";

function formatTime(totalSeconds) {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = Math.floor(safeSeconds % 60);

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatTenths(totalSeconds) {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0;

  return safeSeconds < 60
    ? safeSeconds.toFixed(1)
    : `${Math.floor(safeSeconds / 60)}:${String(
        Math.floor(safeSeconds % 60),
      ).padStart(2, "0")}`;
}

function getMarkerLeftPercent(lineStart, audio) {
  const { sectionDuration, startOffset } = getSectionBounds(audio);

  if (!Number.isFinite(lineStart) || sectionDuration <= 0) {
    return 0;
  }

  return ((lineStart - startOffset) / sectionDuration) * 100;
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
  audioSrc,
  currentTime,
  isPlaying,
  isTimingActive,
  lines,
  onDurationChange,
  onMark,
  onPlayingChange,
  onTimeChange,
}) {
  const containerRef = useRef(null);
  const waveSurferRef = useRef(null);
  const lastClockFrameRef = useRef(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [status, setStatus] = useState(audioSrc ? "loading" : "empty");

  const emitTimeChange = useEffectEvent((timeInSeconds) => {
    onTimeChange?.(timeInSeconds);
  });
  const emitPlayingChange = useEffectEvent((playing) => {
    onPlayingChange?.(playing);
  });
  const emitDurationChange = useEffectEvent((durationInSeconds) => {
    onDurationChange?.(durationInSeconds);
  });
  const getSectionStart = useEffectEvent(() => getSectionBounds(audio).startOffset);
  const getClockFrame = useEffectEvent((timeInSeconds) =>
    getSectionFrameFromTime(timeInSeconds, audio, VIDEO_FPS),
  );
  const clampToSection = useEffectEvent((timeInSeconds, durationInSeconds) =>
    clampTimeToSection(timeInSeconds, {
      ...audio,
      ...(Number.isFinite(durationInSeconds)
        ? { duration: durationInSeconds }
        : {}),
    }),
  );

  useEffect(() => installTimingDebugHook(waveSurferRef), []);

  useEffect(() => {
    if (!containerRef.current || !audioSrc) {
      setStatus("empty");
      setErrorMessage("");
      emitPlayingChange(false);
      return undefined;
    }

    setStatus("loading");
    setErrorMessage("");

    const waveSurfer = WaveSurfer.create({
      // Play through Web Audio (decoded PCM + AudioBufferSourceNode) instead of
      // an HTMLAudioElement. This gives a sample-accurate clock and exact,
      // rebuffer-free seeks, so the preview (which is slaved to this clock)
      // stays locked to the music after mid-song seeks and ±2s jumps.
      backend: "WebAudio",
      barGap: 3,
      barRadius: 999,
      barWidth: 4,
      container: containerRef.current,
      cursorColor: "#2C9B3F",
      dragToSeek: true,
      height: 64,
      normalize: true,
      progressColor: "rgba(44, 155, 63, 0.85)",
      waveColor: "rgba(99, 91, 77, 0.32)",
      url: audioSrc,
    });

    waveSurferRef.current = waveSurfer;

    waveSurfer.on("ready", (durationInSeconds) => {
      const nextTime = clampToSection(getSectionStart(), durationInSeconds);

      setStatus("ready");
      lastClockFrameRef.current = getClockFrame(nextTime);
      emitDurationChange(durationInSeconds);
      emitTimeChange(nextTime);
      waveSurfer.setTime(nextTime);
    });

    waveSurfer.on("timeupdate", (nextTime) => {
      emitTimeChange(nextTime);
    });

    waveSurfer.on("interaction", (nextTime) => {
      emitTimeChange(nextTime);
    });

    waveSurfer.on("seeking", (nextTime) => {
      emitTimeChange(nextTime);
    });

    waveSurfer.on("play", () => {
      emitPlayingChange(true);
    });

    waveSurfer.on("pause", () => {
      emitPlayingChange(false);
    });

    waveSurfer.on("finish", () => {
      const startOffset = getSectionStart();

      emitPlayingChange(false);
      emitTimeChange(startOffset);
      waveSurfer.setTime(startOffset);
    });

    waveSurfer.on("error", (error) => {
      setStatus("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "The uploaded MP3 could not be decoded for waveform playback.",
      );
      emitPlayingChange(false);
    });

    return () => {
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
  }, [audioSrc]);

  useEffect(() => {
    const waveSurfer = waveSurferRef.current;

    if (!waveSurfer || status !== "ready") {
      return;
    }

    const nextTime = clampTimeToSection(currentTime, audio);

    if (Math.abs(waveSurfer.getCurrentTime() - nextTime) > 0.05) {
      waveSurfer.setTime(nextTime);
    }

    lastClockFrameRef.current = getClockFrame(nextTime);
  }, [audio, currentTime, status]);

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

      const nextTime = clampTimeToSection(waveSurfer.getCurrentTime(), audio);
      const nextFrame = getClockFrame(nextTime);

      if (lastClockFrameRef.current !== nextFrame) {
        lastClockFrameRef.current = nextFrame;
        emitTimeChange(nextTime);
      }

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
  const isReady = status === "ready" || !audioSrc;
  const canMark = isReady && isTimingActive && Boolean(activeLineId) && typeof onMark === "function";

  return (
    <div className="transport overflow-hidden border-t border-[var(--border)] bg-[var(--surface)] lg:rounded-[1.75rem] lg:border lg:border-[var(--border)] lg:bg-[var(--surface-2)]">
      <div className="transport-inner">
      <div className="transport-wave-wrap px-4 pb-3 pt-2.5 lg:px-4 lg:pb-2 lg:pt-3">
        {audioSrc ? (
          <div className="relative">
            <div className="waveform relative overflow-hidden rounded-xl bg-[var(--surface)] px-2.5 py-2 lg:rounded-[1rem] lg:px-3 lg:py-2.5">
              {/* Content-box wrapper: markers (CSS %) and the wavesurfer
                  waveform/cursor share this exact coordinate space. */}
              <div className="relative">
                <div ref={containerRef} />

                {markers.length ? (
                  // Purely visual lyric markers. pointer-events-none lets clicks
                  // fall through to the waveform so the mouse only seeks playback.
                  <div className="pointer-events-none absolute inset-0 z-10">
                    {markers.map((line) => {
                      const isActiveMarker = activeLineId === line.id;
                      const isHeardMarker = heardLine?.id === line.id;
                      const left = getMarkerLeftPercent(line.start, audio);

                      return (
                        <div
                          aria-hidden="true"
                          className="absolute inset-y-0 z-10 w-4 -translate-x-1/2"
                          key={line.id}
                          style={{ left: `${left}%` }}
                        >
                          <span
                            className={`absolute inset-y-2 left-1/2 w-0.5 -translate-x-1/2 rounded-full ${
                              isActiveMarker
                                ? "bg-[var(--accent)]"
                                : isHeardMarker
                                  ? "bg-[var(--surface-2)]"
                                  : "bg-[var(--surface-2)]"
                            }`}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <div
            aria-hidden="true"
            className="waveform relative overflow-hidden rounded-xl bg-[var(--surface)] px-2.5 py-2 lg:rounded-[1rem] lg:px-3 lg:py-2.5"
          >
            <div className="flex h-9 items-center gap-[3px] lg:h-14">
              {Array.from({ length: 84 }).map((_, index) => {
                const amplitude = 0.25 + ((Math.sin(index * 0.55) + 1) / 2) * 0.75;

                return (
                  <span
                    className="flex-1 rounded-full bg-slate-400/55"
                    key={index}
                    style={{
                      height: `${Math.max(8, Math.round(24 * amplitude))}px`,
                    }}
                  />
                );
              })}
            </div>
            <div
              className="absolute inset-y-0 w-px bg-sky-200/35"
              style={{ left: "10%" }}
            />
            <div
              className="absolute inset-y-0 w-0.5 bg-[var(--accent)] shadow-[0_0_8px_rgba(251,191,36,0.8)]"
              style={{ left: "14%" }}
            />
          </div>
        )}

        {errorMessage ? (
          <p className="mt-3 text-sm leading-6 text-[var(--danger)]">{errorMessage}</p>
        ) : null}
      </div>

      <div className="transport-controls flex items-center gap-2 border-t border-[var(--border)] px-4 pb-5 pt-3 lg:flex-wrap lg:justify-between lg:gap-4 lg:px-4 lg:py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 lg:flex-none lg:flex-wrap">
          <span className="font-mono text-[11px] text-[var(--muted)] lg:hidden">
            {formatTenths(currentSectionTime)}
          </span>
          <button
            className="rewind-button hidden rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs text-[var(--muted)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:text-[var(--muted)] lg:inline-flex"
            disabled={!isReady}
            onClick={() => jumpTo(startOffset)}
            type="button"
          >
            ⏮ Rewind
          </button>
          <button
            className={`play-button flex h-11 w-11 flex-none items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--muted)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:bg-[var(--surface-2)] disabled:text-[var(--muted)] lg:h-auto lg:w-auto lg:gap-2 lg:rounded-full lg:bg-[var(--accent)] lg:px-5 lg:py-1.5 lg:text-sm lg:font-semibold lg:text-[var(--on-accent)] lg:hover:opacity-90 ${isPlaying ? "is-playing" : ""}`}
            disabled={!isReady}
            onClick={togglePlayback}
            type="button"
          >
            <span aria-hidden>{isPlaying ? "❚❚" : "▶"}</span>
            <span className="hidden lg:inline">{isPlaying ? "Pause" : "Play"}</span>
          </button>
          <button
            className="step-button hidden rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs text-[var(--muted)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:text-[var(--muted)] lg:inline-flex"
            disabled={!isReady}
            onClick={() =>
              jumpTo((waveSurferRef.current?.getCurrentTime() ?? currentTime) - 2)
            }
            type="button"
          >
            -2s
          </button>
          <button
            className="step-button flex h-11 w-11 flex-none items-center justify-center rounded-full bg-[var(--surface-2)] text-[11px] text-[var(--muted)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:bg-[var(--surface-2)] disabled:text-[var(--muted)] lg:h-auto lg:w-auto lg:rounded-full lg:border lg:border-[var(--border)] lg:bg-[var(--surface-2)] lg:px-3 lg:py-1.5 lg:text-xs"
            disabled={!isReady}
            onClick={() =>
              jumpTo((waveSurferRef.current?.getCurrentTime() ?? currentTime) + 2)
            }
            type="button"
          >
            +2s
          </button>
          {isTimingActive ? (
            <button
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

        <div className="transport-time flex items-center gap-3 text-[11px] font-medium text-[var(--muted)]">
          <span className="font-mono text-[var(--muted)] lg:hidden">
            {formatTenths(sectionDuration)}
          </span>
          <div className="hidden items-center gap-4 lg:flex">
            <span className="font-mono text-[var(--muted)]">
              {formatTenths(currentSectionTime)} / {formatTime(sectionDuration)}
            </span>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
