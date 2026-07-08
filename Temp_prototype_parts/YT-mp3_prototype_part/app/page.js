"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_YOUTUBE_AUDIO_PROVIDER_ID,
  YOUTUBE_AUDIO_FALLBACK_PROVIDER_IDS,
  YOUTUBE_AUDIO_PROVIDER_OPTIONS,
  getYoutubeAudioProviderOption,
} from "../lib/provider-options";
import { extractYouTubeVideoId } from "../lib/youtube-url";

const YOUTUBE_IFRAME_SCRIPT_ID = "youtube-iframe-api";
const VIDEO_LOAD_TIMEOUT_MS = 15000;
const DEFAULT_SEGMENT_SECONDS = 15;
const MIN_SEGMENT_SECONDS = 1;
const MAX_SEGMENT_SECONDS = 6 * 60;
const POLL_INTERVAL_MS = 2200;
const MAX_POLL_ATTEMPTS = 120;

const PHASE_COPY = {
  queued: "Queued...",
  calling_provider: "Calling provider...",
  downloading: "Downloading audio...",
  trimming: "Trimming segment...",
  finalizing: "Finalizing MP3...",
  ready: "Ready.",
};

const ERROR_COPY = {
  INVALID_INPUT: "Check the YouTube URL and selected times.",
  INVALID_PROVIDER: "Choose one of the available providers.",
  SEGMENT_TOO_LONG: "Segments can be no longer than 6 minutes.",
  PROVIDER_RATE_LIMITED: "That provider is rate limited or out of quota.",
  PROVIDER_AUTH_FAILED: "Provider authentication failed. Check the RapidAPI key and subscription.",
  PROVIDER_REJECTED: "That provider could not convert this video.",
  PROVIDER_TIMEOUT: "The conversion took too long. Try a shorter clip or another provider.",
  PROVIDER_MALFORMED_RESPONSE: "That provider returned an unusable response.",
  CONVERSION_FAILED: "The audio could not be converted.",
  RESULT_EXPIRED: "The temporary result expired. Try again.",
  INTERNAL_ERROR: "Something went wrong while converting the clip.",
};

function formatTime(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function parseTimeInput(value) {
  const cleaned = value.trim();

  if (!cleaned) {
    return null;
  }

  if (/^\d+(\.\d+)?$/.test(cleaned)) {
    return Number(cleaned);
  }

  if (!/^\d{0,3}:?\d{0,2}$/.test(cleaned)) {
    return null;
  }

  const [minutesRaw = "0", secondsRaw = "0"] = cleaned.split(":");
  const minutes = Number(minutesRaw || 0);
  const seconds = Number(secondsRaw || 0);

  if (
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    seconds >= 60
  ) {
    return null;
  }

  return minutes * 60 + seconds;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function roundTime(value) {
  return Math.round(value * 10) / 10;
}

function getSegmentValidation(segment) {
  const duration = segment.endTime - segment.startTime;
  const messages = [];

  if (segment.endTime <= segment.startTime) {
    messages.push("End time must be after start time.");
  } else if (duration < MIN_SEGMENT_SECONDS) {
    messages.push("Select at least 1 second of audio.");
  }

  if (duration > MAX_SEGMENT_SECONDS) {
    messages.push("Segments can be no longer than 6 minutes.");
  }

  return messages;
}

function loadYouTubeIframeApi() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Browser APIs are unavailable"));
  }

  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (window.__youtubeIframeApiPromise) {
    return window.__youtubeIframeApiPromise;
  }

  window.__youtubeIframeApiPromise = new Promise((resolve, reject) => {
    const existingCallback = window.onYouTubeIframeAPIReady;
    let settled = false;

    const timeout = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("YouTube player API did not load"));
      }
    }, VIDEO_LOAD_TIMEOUT_MS);

    window.onYouTubeIframeAPIReady = () => {
      existingCallback?.();

      if (!settled) {
        settled = true;
        window.clearTimeout(timeout);
        resolve(window.YT);
      }
    };

    if (!document.getElementById(YOUTUBE_IFRAME_SCRIPT_ID)) {
      const script = document.createElement("script");
      script.id = YOUTUBE_IFRAME_SCRIPT_ID;
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          reject(new Error("YouTube player API failed to load"));
        }
      };
      document.head.appendChild(script);
    }
  });

  return window.__youtubeIframeApiPromise;
}

export default function Home() {
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [modalUrl, setModalUrl] = useState("");
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [inputError, setInputError] = useState("");
  const [videoLoadAttempt, setVideoLoadAttempt] = useState(0);
  const [videoState, setVideoState] = useState({
    status: "idle",
    videoId: null,
    duration: 0,
    thumbnailUrl: "",
    error: "",
  });
  const [segment, setSegment] = useState({
    startTime: 0,
    endTime: DEFAULT_SEGMENT_SECONDS,
  });
  const [timeInputs, setTimeInputs] = useState({
    startTime: "0:00",
    endTime: "0:15",
  });
  const [selectedProviderId, setSelectedProviderId] = useState(
    DEFAULT_YOUTUBE_AUDIO_PROVIDER_ID,
  );
  const [conversionStatus, setConversionStatus] = useState("idle");
  const [conversionMessage, setConversionMessage] = useState("");
  const [conversionError, setConversionError] = useState("");
  const [resultClip, setResultClip] = useState(null);
  const [providerAttempts, setProviderAttempts] = useState([]);
  const [editingTimeField, setEditingTimeField] = useState(null);
  const [activeHandle, setActiveHandle] = useState(null);
  const playerNodeRef = useRef(null);
  const timelineRef = useRef(null);
  const activeConversionRef = useRef(null);
  const validationMessages = getSegmentValidation(segment);
  const canConvert =
    videoState.status === "ready" &&
    validationMessages.length === 0 &&
    conversionStatus !== "converting";

  function openPicker() {
    const trimmedUrl = youtubeUrl.trim();
    const videoId = extractYouTubeVideoId(trimmedUrl);

    if (!videoId) {
      setInputError("Enter a valid YouTube link");
      return;
    }

    setInputError("");
    setModalUrl(trimmedUrl);
    setConversionStatus("idle");
    setConversionMessage("");
    setConversionError("");
    setProviderAttempts([]);
    setIsPickerOpen(true);
  }

  function closePicker() {
    if (conversionStatus === "converting") {
      return;
    }

    setIsPickerOpen(false);
  }

  function retryVideoLoad() {
    setVideoLoadAttempt((attempt) => attempt + 1);
  }

  function timeFromClientX(clientX) {
    const timeline = timelineRef.current;

    if (!timeline || videoState.status !== "ready") {
      return 0;
    }

    const rect = timeline.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);

    return roundTime(ratio * videoState.duration);
  }

  function updateSegmentHandle(handle, value) {
    if (videoState.status !== "ready") {
      return;
    }

    setSegment((current) => {
      if (handle === "start") {
        const latestStart = clamp(
          value,
          0,
          Math.max(0, current.endTime - MIN_SEGMENT_SECONDS),
        );

        return {
          ...current,
          startTime: roundTime(latestStart),
        };
      }

      const latestEnd = clamp(
        value,
        Math.min(videoState.duration, current.startTime + MIN_SEGMENT_SECONDS),
        videoState.duration,
      );

      return {
        ...current,
        endTime: roundTime(latestEnd),
      };
    });
  }

  function beginHandleDrag(handle, event) {
    event.preventDefault();
    event.stopPropagation();
    setActiveHandle(handle);
    updateSegmentHandle(handle, timeFromClientX(event.clientX));
  }

  function moveNearestHandle(event) {
    if (videoState.status !== "ready") {
      return;
    }

    const nextTime = timeFromClientX(event.clientX);
    const distanceToStart = Math.abs(nextTime - segment.startTime);
    const distanceToEnd = Math.abs(nextTime - segment.endTime);
    updateSegmentHandle(distanceToStart <= distanceToEnd ? "start" : "end", nextTime);
  }

  function nudgeHandle(handle, deltaSeconds) {
    const currentValue =
      handle === "start" ? segment.startTime : segment.endTime;
    updateSegmentHandle(handle, currentValue + deltaSeconds);
  }

  function updateTimeInput(field, value) {
    setTimeInputs((current) => ({
      ...current,
      [field]: value,
    }));

    const parsedTime = parseTimeInput(value);

    if (parsedTime !== null) {
      updateSegmentTime(field, parsedTime);
    }
  }

  function normalizeTimeInput(field) {
    setEditingTimeField(null);
    setTimeInputs((current) => ({
      ...current,
      [field]: formatTime(segment[field]),
    }));
  }

  function updateSegmentTime(field, value) {
    if (videoState.status !== "ready") {
      return;
    }

    setSegment((current) => ({
      ...current,
      [field]: roundTime(clamp(value, 0, videoState.duration)),
    }));
  }

  async function convertSegment() {
    if (!canConvert) {
      return;
    }

    const conversionToken = Date.now();
    activeConversionRef.current = conversionToken;
    setConversionStatus("converting");
    setConversionMessage("Starting conversion...");
    setConversionError("");
    setProviderAttempts([]);

    try {
      const startResponse = await fetch("/api/youtube-audio-segments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: modalUrl,
          startTime: segment.startTime,
          endTime: segment.endTime,
          providerId: selectedProviderId,
        }),
      });
      const startJob = await readJson(startResponse);
      setProviderAttempts(startJob.attempts || []);

      if (!startResponse.ok || startJob.status === "failed") {
        throw new ConversionError(
          startJob.errorCode || "INTERNAL_ERROR",
          startJob.attempts || [],
        );
      }

      const completeJob = await pollConversionJob(
        startJob,
        conversionToken,
        setConversionMessage,
        setProviderAttempts,
      );

      if (activeConversionRef.current !== conversionToken) {
        return;
      }

      setResultClip({
        src: completeJob.downloadUrl,
        downloadSrc: `${completeJob.downloadUrl}?download=1`,
        fileName: `youtube-segment-${Math.round(segment.startTime)}-${Math.round(
          segment.endTime,
        )}.mp3`,
        startTime: segment.startTime,
        endTime: segment.endTime,
        providerName:
          completeJob.finalProviderName ||
          completeJob.providerName ||
          getYoutubeAudioProviderOption(selectedProviderId)?.name ||
          selectedProviderId,
        attempts: completeJob.attempts || [],
      });
      setProviderAttempts(completeJob.attempts || []);
      setConversionStatus("ready");
      setConversionMessage("");
      setIsPickerOpen(false);
    } catch (error) {
      if (activeConversionRef.current !== conversionToken) {
        return;
      }

      const errorCode =
        error instanceof ConversionError ? error.errorCode : "INTERNAL_ERROR";
      setProviderAttempts(
        error instanceof ConversionError ? error.attempts || [] : [],
      );
      setConversionStatus("error");
      setConversionError(ERROR_COPY[errorCode] || ERROR_COPY.INTERNAL_ERROR);
      setConversionMessage("");
    }
  }

  useEffect(() => {
    if (!isPickerOpen) {
      setVideoState((current) =>
        current.status === "idle"
          ? current
          : {
              status: "idle",
              videoId: null,
              duration: 0,
              thumbnailUrl: "",
              error: "",
            },
      );
      return undefined;
    }

    const videoId = extractYouTubeVideoId(modalUrl);

    if (!videoId) {
      setVideoState({
        status: "error",
        videoId: null,
        duration: 0,
        thumbnailUrl: "",
        error: "Enter a valid YouTube link",
      });
      return undefined;
    }

    let cancelled = false;
    let player = null;
    let durationTimer = null;
    let timeoutTimer = null;

    setVideoState({
      status: "loading",
      videoId,
      duration: 0,
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      error: "",
    });

    function fail(message) {
      if (cancelled) {
        return;
      }

      setVideoState({
        status: "error",
        videoId,
        duration: 0,
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        error: message,
      });
    }

    function readDuration(target) {
      const duration = Number(target?.getDuration?.());

      if (Number.isFinite(duration) && duration > 0) {
        window.clearTimeout(timeoutTimer);
        window.clearInterval(durationTimer);

        if (!cancelled) {
          setVideoState({
            status: "ready",
            videoId,
            duration,
            thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            error: "",
          });
        }
      }
    }

    loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled || !playerNodeRef.current) {
          return;
        }

        player = new YT.Player(playerNodeRef.current, {
          videoId,
          width: "1",
          height: "1",
          playerVars: {
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
          },
          events: {
            onReady: (event) => {
              readDuration(event.target);
              durationTimer = window.setInterval(
                () => readDuration(event.target),
                250,
              );
            },
            onError: () => {
              fail("Duration could not be read for this video.");
            },
          },
        });

        timeoutTimer = window.setTimeout(() => {
          fail("Duration could not be read for this video.");
        }, VIDEO_LOAD_TIMEOUT_MS);
      })
      .catch(() => {
        fail("YouTube video metadata could not be loaded.");
      });

    return () => {
      cancelled = true;
      window.clearInterval(durationTimer);
      window.clearTimeout(timeoutTimer);

      if (player?.destroy) {
        player.destroy();
      }
    };
  }, [isPickerOpen, modalUrl, videoLoadAttempt]);

  useEffect(() => {
    if (videoState.status !== "ready") {
      return;
    }

    setSegment({
      startTime: 0,
      endTime: Math.min(DEFAULT_SEGMENT_SECONDS, roundTime(videoState.duration)),
    });
  }, [videoState.status, videoState.videoId, videoState.duration]);

  useEffect(() => {
    setTimeInputs((current) => ({
      startTime:
        editingTimeField === "startTime"
          ? current.startTime
          : formatTime(segment.startTime),
      endTime:
        editingTimeField === "endTime"
          ? current.endTime
          : formatTime(segment.endTime),
    }));
  }, [segment.startTime, segment.endTime, editingTimeField]);

  useEffect(() => {
    if (!activeHandle) {
      return undefined;
    }

    function handlePointerMove(event) {
      updateSegmentHandle(activeHandle, timeFromClientX(event.clientX));
    }

    function handlePointerUp() {
      setActiveHandle(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [activeHandle, videoState.status, videoState.duration]);

  useEffect(() => () => {
    activeConversionRef.current = null;
  }, []);

  return (
    <main className="app-shell">
      <section className="workspace" aria-labelledby="page-title">
        <div className="intro">
          <p className="eyebrow">YouTube to MP3</p>
          <h1 id="page-title">Choose a precise audio segment</h1>
        </div>

        <form className="url-panel">
          <label className="field-label" htmlFor="youtube-url">
            YouTube URL
          </label>
          <div className="input-row">
            <input
              id="youtube-url"
              type="url"
              value={youtubeUrl}
              onChange={(event) => setYoutubeUrl(event.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              autoComplete="off"
            />
            <button type="button" onClick={openPicker}>
              Choose segment
            </button>
          </div>
          <div className="provider-row">
            <label className="field-label" htmlFor="provider-select">
              Provider
            </label>
            <select
              id="provider-select"
              value={selectedProviderId}
              onChange={(event) => setSelectedProviderId(event.target.value)}
            >
              {YOUTUBE_AUDIO_PROVIDER_OPTIONS.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </div>
          {inputError ? <p className="input-error">{inputError}</p> : null}
        </form>

        <section className="results-area" aria-label="Converted clip result">
          {resultClip ? (
            <div className="result-card">
              <div className="result-copy">
                <p className="result-label">MP3 ready</p>
                <p>
                  {formatTime(resultClip.startTime)} to{" "}
                  {formatTime(resultClip.endTime)} via {resultClip.providerName}
                </p>
              </div>
              <audio controls src={resultClip.src} preload="metadata">
                Your browser does not support audio playback.
              </audio>
              <a
                className="download-button"
                href={resultClip.downloadSrc || resultClip.src}
                download={resultClip.fileName}
              >
                Download MP3
              </a>
              <ProviderAttemptSummary attempts={resultClip.attempts || []} />
            </div>
          ) : (
            <p>No converted clip yet.</p>
          )}
        </section>
      </section>

      {isPickerOpen ? (
        <div
          className="modal-overlay"
          onClick={closePicker}
          role="presentation"
        >
          <section
            className="segment-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="segment-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-header">
              <div>
                <p className="modal-kicker">Segment picker</p>
                <h2 id="segment-modal-title">Selected YouTube video</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={closePicker}
                aria-label="Close segment picker"
                title="Close"
                disabled={conversionStatus === "converting"}
              >
                x
              </button>
            </header>

            <div className="modal-body">
              {conversionStatus === "converting" ? (
                <div className="converting-state" role="status">
                  <div className="spinner" aria-hidden="true" />
                  <p>{conversionMessage || "Converting segment..."}</p>
                </div>
              ) : null}

              {conversionStatus === "error" ? (
                <div className="conversion-error" role="alert">
                  <p>{conversionError}</p>
                  <ProviderAttemptSummary attempts={providerAttempts} compact />
                </div>
              ) : null}

              <div className="video-summary">
                {videoState.thumbnailUrl ? (
                  <img
                    src={videoState.thumbnailUrl}
                    alt=""
                    className="video-thumbnail"
                  />
                ) : null}
                <div>
                  <p className="video-url-preview">
                    {modalUrl || "No URL entered"}
                  </p>
                  {videoState.status === "ready" ? (
                    <p className="duration-readout">
                      Duration {formatTime(videoState.duration)}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="hidden-youtube-player" aria-hidden="true">
                <div ref={playerNodeRef} />
              </div>

              {videoState.status === "ready" ? (
                <SegmentTimeline
                  duration={videoState.duration}
                  segment={segment}
                  timeInputs={timeInputs}
                  validationMessages={validationMessages}
                  timelineRef={timelineRef}
                  activeHandle={activeHandle}
                  onTrackPointerDown={moveNearestHandle}
                  onHandlePointerDown={beginHandleDrag}
                  onNudgeHandle={nudgeHandle}
                  onTimeInputChange={updateTimeInput}
                  onTimeInputFocus={setEditingTimeField}
                  onTimeInputBlur={normalizeTimeInput}
                />
              ) : (
                <div className="timeline-placeholder">
                {videoState.status === "loading" ? (
                  <span>Loading video duration...</span>
                ) : null}
                {videoState.status === "error" ? (
                  <div className="modal-error">
                    <p>{videoState.error}</p>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={retryVideoLoad}
                    >
                      Retry
                    </button>
                  </div>
                ) : null}
                </div>
              )}
            </div>

            <footer className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={closePicker}
                disabled={conversionStatus === "converting"}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={!canConvert}
                onClick={convertSegment}
              >
                {conversionStatus === "converting"
                  ? "Converting..."
                  : "Convert segment"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}

class ConversionError extends Error {
  constructor(errorCode, attempts = []) {
    super(errorCode);
    this.name = "ConversionError";
    this.errorCode = errorCode;
    this.attempts = attempts;
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function pollConversionJob(
  initialJob,
  conversionToken,
  setMessage,
  setAttempts,
) {
  let latestJob = initialJob;

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      latestJob = await fetchJob(initialJob.jobId);
    }

    setAttempts(latestJob.attempts || []);

    if (latestJob.status === "complete" && latestJob.downloadUrl) {
      return latestJob;
    }

    if (latestJob.status === "failed") {
      throw new ConversionError(
        latestJob.errorCode || "INTERNAL_ERROR",
        latestJob.attempts || [],
      );
    }

    setMessage(PHASE_COPY[latestJob.phase] || "Converting segment...");
    await delay(POLL_INTERVAL_MS);

    if (conversionToken === null) {
      throw new ConversionError("INTERNAL_ERROR");
    }
  }

  throw new ConversionError("PROVIDER_TIMEOUT");
}

async function fetchJob(jobId) {
  const response = await fetch(`/api/youtube-audio-segments/${jobId}`, {
    cache: "no-store",
  });
  const job = await readJson(response);

  if (!response.ok) {
    throw new ConversionError(job.errorCode || "RESULT_EXPIRED");
  }

  return job;
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function ProviderAttemptSummary({ attempts, compact = false }) {
  const rows = YOUTUBE_AUDIO_FALLBACK_PROVIDER_IDS.map((providerId) => {
    const option = getYoutubeAudioProviderOption(providerId);
    const attempt = attempts.find((entry) => entry.providerId === providerId);

    return {
      providerId,
      providerName: option?.name || providerId,
      attempt,
    };
  });

  return (
    <div
      className={`provider-attempt-summary ${compact ? "is-compact" : ""}`}
      aria-label="Provider attempts"
    >
      {rows.map(({ providerId, providerName, attempt }) => (
        <div className="provider-attempt-row" key={providerId}>
          <div>
            <p className="provider-attempt-name">{providerName}</p>
            <p className={`provider-attempt-status ${statusClass(attempt)}`}>
              {statusLabel(attempt)}
              {attempt?.preferredFormat ? ` (${attempt.preferredFormat})` : ""}
            </p>
            {attempt?.userMessage ? (
              <p className="provider-attempt-message">{attempt.userMessage}</p>
            ) : null}
          </div>
          <div className="provider-quota-lines">
            {quotaLines(attempt).map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function statusLabel(attempt) {
  if (!attempt || attempt.status === "skipped") {
    return "Not checked this run";
  }

  if (attempt.status === "succeeded") {
    return "Completed";
  }

  if (attempt.status === "failed") {
    return "Failed";
  }

  if (attempt.status === "running") {
    return "Running";
  }

  return "Pending";
}

function statusClass(attempt) {
  if (!attempt || attempt.status === "skipped") {
    return "is-muted";
  }

  return `is-${attempt.status}`;
}

function quotaLines(attempt) {
  if (!attempt || attempt.status === "skipped") {
    return ["Quota: not checked this run"];
  }

  if (!attempt.quota) {
    return ["Quota: not reported by provider"];
  }

  const lines = [
    quotaGroupLine("Requests", attempt.quota.requests),
    quotaGroupLine("Units", attempt.quota.units),
    quotaGroupLine("Hard limit", attempt.quota.hardLimit),
  ].filter(Boolean);

  return lines.length > 0 ? lines : ["Quota: not reported by provider"];
}

function quotaGroupLine(label, group) {
  if (!group) {
    return null;
  }

  const remaining = group.remaining ?? "?";
  const limit = group.limit ?? "?";

  return `${label}: ${remaining} / ${limit} remaining`;
}

function SegmentTimeline({
  duration,
  segment,
  timeInputs,
  validationMessages,
  timelineRef,
  activeHandle,
  onTrackPointerDown,
  onHandlePointerDown,
  onNudgeHandle,
  onTimeInputChange,
  onTimeInputFocus,
  onTimeInputBlur,
}) {
  const startPercent = (segment.startTime / duration) * 100;
  const endPercent = (segment.endTime / duration) * 100;
  const selectedPercent = Math.max(0, endPercent - startPercent);
  const selectedLength = Math.max(0, segment.endTime - segment.startTime);

  function handleKeyDown(handle, event) {
    const step = event.shiftKey ? 5 : 1;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onNudgeHandle(handle, -step);
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      onNudgeHandle(handle, step);
    }
  }

  return (
    <div className="timeline-control">
      <div
        className="timeline-track"
        ref={timelineRef}
        onPointerDown={onTrackPointerDown}
      >
        <div
          className="timeline-selected-range"
          style={{
            left: `${startPercent}%`,
            width: `${selectedPercent}%`,
          }}
        />
        <button
          className={`timeline-handle ${
            activeHandle === "start" ? "is-active" : ""
          }`}
          type="button"
          style={{ left: `${startPercent}%` }}
          aria-label="Start handle"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, segment.endTime - MIN_SEGMENT_SECONDS)}
          aria-valuenow={Math.round(segment.startTime)}
          onPointerDown={(event) => onHandlePointerDown("start", event)}
          onKeyDown={(event) => handleKeyDown("start", event)}
        />
        <button
          className={`timeline-handle ${
            activeHandle === "end" ? "is-active" : ""
          }`}
          type="button"
          style={{ left: `${endPercent}%` }}
          aria-label="End handle"
          aria-valuemin={Math.min(duration, segment.startTime + MIN_SEGMENT_SECONDS)}
          aria-valuemax={duration}
          aria-valuenow={Math.round(segment.endTime)}
          onPointerDown={(event) => onHandlePointerDown("end", event)}
          onKeyDown={(event) => handleKeyDown("end", event)}
        />
      </div>
      <div className="timeline-scale">
        <span>0:00</span>
        <span>{formatTime(duration)}</span>
      </div>
      <p className="segment-readout">
        Start {formatTime(segment.startTime)} | End {formatTime(segment.endTime)} |
        Length {formatTime(selectedLength)}
      </p>
      <div className="time-input-grid">
        <label>
          <span>Start</span>
          <input
            type="text"
            inputMode="numeric"
            value={timeInputs.startTime}
            onFocus={() => onTimeInputFocus("startTime")}
            onChange={(event) =>
              onTimeInputChange("startTime", event.target.value)
            }
            onBlur={() => onTimeInputBlur("startTime")}
          />
        </label>
        <label>
          <span>End</span>
          <input
            type="text"
            inputMode="numeric"
            value={timeInputs.endTime}
            onFocus={() => onTimeInputFocus("endTime")}
            onChange={(event) => onTimeInputChange("endTime", event.target.value)}
            onBlur={() => onTimeInputBlur("endTime")}
          />
        </label>
      </div>
      {validationMessages.length > 0 ? (
        <div className="validation-messages" role="alert">
          {validationMessages.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
