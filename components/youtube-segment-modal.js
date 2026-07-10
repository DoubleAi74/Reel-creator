"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  clearInflightYoutubeAudioJob,
  inflightMatchesSourceUrl,
  loadInflightYoutubeAudioJob,
  saveInflightYoutubeAudioJob,
} from "@/lib/youtube-audio/client-inflight-job";
import {
  MAX_SEGMENT_SECONDS,
  MIN_SEGMENT_SECONDS,
} from "@/lib/youtube-audio/validation";
import { extractYouTubeVideoId } from "@/lib/youtube-audio/youtube-url";

const DEFAULT_SEGMENT_SECONDS = 15;
const VIDEO_LOAD_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 2200;
const MAX_POLL_ATTEMPTS = 120;
const STILL_RUNNING_CLIENT_MESSAGE =
  "Still converting on the server. Keep this page open or return here to keep checking status.";
const COMPLETE_WITHOUT_ASSET_MESSAGE =
  "Conversion finished but this browser session could not attach the audio. Refresh and try opening the import again, or re-convert.";

const ERROR_COPY = {
  FEATURE_DISABLED: "YouTube imports are not enabled on this server.",
  INVALID_INPUT: "Check the YouTube URL and selected times.",
  SEGMENT_TOO_LONG: "Select a segment of 6 minutes or less.",
  RESOURCE_LIMIT_REACHED: "There are already YouTube imports running. Try again shortly.",
  PROVIDER_AUTH_FAILED: "The audio provider is not available right now.",
  PROVIDER_RATE_LIMITED: "The audio provider is temporarily rate limited.",
  PROVIDER_REJECTED: "This video could not be converted.",
  PROVIDER_TIMEOUT: "The audio provider took too long to respond.",
  PROVIDER_MALFORMED_RESPONSE: "The audio provider returned an unusable response.",
  CONVERSION_FAILED: "The audio segment could not be prepared.",
  RESULT_EXPIRED: "This conversion expired. Try converting the segment again.",
  INTERNAL_ERROR: "YouTube import failed unexpectedly.",
};

let youtubeApiPromise = null;

export function YoutubeSegmentModal({
  isOpen,
  onClose,
  onComplete,
  sourceUrl,
}) {
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);
  const activeRequestRef = useRef(0);
  const pollingRef = useRef(false);
  const videoId = useMemo(() => extractYouTubeVideoId(sourceUrl), [sourceUrl]);
  const [durationSec, setDurationSec] = useState(null);
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(DEFAULT_SEGMENT_SECONDS);
  const [startDraft, setStartDraft] = useState("0:00");
  const [endDraft, setEndDraft] = useState("0:15");
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");

  const converting = status === "converting";
  const loading = status === "loading";
  const segmentDuration = Math.max(0, endTime - startTime);
  const validationMessage = getSegmentValidationMessage({
    durationSec,
    endTime,
    segmentDuration,
    startTime,
    videoId,
  });
  const canConvert = !loading && !converting && !validationMessage;

  const returnFocus = useCallback(() => {
    window.setTimeout(() => {
      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus();
      }
    }, 0);
  }, []);

  const handleClose = useCallback(() => {
    if (converting) {
      return;
    }

    activeRequestRef.current += 1;
    onClose?.();
    returnFocus();
  }, [converting, onClose, returnFocus]);

  const finishWithAsset = useCallback(
    (asset) => {
      clearInflightYoutubeAudioJob();
      onComplete?.(asset);
      onClose?.();
      returnFocus();
    },
    [onClose, onComplete, returnFocus],
  );

  const pollConversionJob = useCallback(async (jobId, requestId) => {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
      if (activeRequestRef.current !== requestId) {
        return { kind: "cancelled" };
      }

      let response;
      let payload = {};

      try {
        response = await fetch(`/api/youtube-audio-segments/${jobId}`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        payload = await response.json().catch(() => ({}));
      } catch {
        // Transient network blip (common when iOS wakes) — keep polling.
        setMessage(statusMessage("downloading"));
        await delay(POLL_INTERVAL_MS);
        continue;
      }

      if (payload.status === "complete") {
        if (payload?.asset?.assetId) {
          return { kind: "complete", payload };
        }

        clearInflightYoutubeAudioJob();
        return {
          kind: "error",
          message: COMPLETE_WITHOUT_ASSET_MESSAGE,
        };
      }

      if (!response.ok || payload.status === "failed") {
        clearInflightYoutubeAudioJob();
        return {
          kind: "error",
          message: errorMessage(payload.errorCode),
        };
      }

      setMessage(statusMessage(payload.phase));
      await delay(POLL_INTERVAL_MS);
    }

    // Budget exhausted: keep inflight so visibility/focus can resume.
    return { kind: "budget" };
  }, []);

  const runPollForJob = useCallback(
    async (jobId, { announcePreparing = false } = {}) => {
      if (!jobId || pollingRef.current) {
        return;
      }

      const requestId = activeRequestRef.current + 1;
      activeRequestRef.current = requestId;
      pollingRef.current = true;
      setStatus("converting");

      if (announcePreparing) {
        setMessage("Preparing audio...");
      } else {
        setMessage("Checking conversion status...");
      }

      try {
        const result = await pollConversionJob(jobId, requestId);

        if (activeRequestRef.current !== requestId) {
          return;
        }

        if (result?.kind === "cancelled") {
          return;
        }

        if (result?.kind === "complete") {
          finishWithAsset(result.payload.asset);
          return;
        }

        if (result?.kind === "budget") {
          setStatus("converting");
          setMessage(STILL_RUNNING_CLIENT_MESSAGE);
          return;
        }

        if (result?.kind === "error") {
          setStatus("error");
          setMessage(result.message || ERROR_COPY.INTERNAL_ERROR);
        }
      } finally {
        if (activeRequestRef.current === requestId) {
          pollingRef.current = false;
        }
      }
    },
    [finishWithAsset, pollConversionJob],
  );

  const resumeInflightIfAny = useCallback(() => {
    const inflight = loadInflightYoutubeAudioJob();

    if (!inflightMatchesSourceUrl(inflight, sourceUrl)) {
      return false;
    }

    if (pollingRef.current) {
      return true;
    }

    void runPollForJob(inflight.jobId, { announcePreparing: false });
    return true;
  }, [runPollForJob, sourceUrl]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    previousFocusRef.current = document.activeElement;
    const id = window.setTimeout(() => {
      dialogRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(id);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape" && !converting) {
        event.preventDefault();
        handleClose();
        return;
      }

      if (event.key === "Tab") {
        trapFocus(event, dialogRef.current);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [converting, handleClose, isOpen]);

  // Resume poll after iOS background / tab freeze (Stage B).
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function onVisible() {
      if (document.visibilityState && document.visibilityState !== "visible") {
        return;
      }

      resumeInflightIfAny();
    }

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [isOpen, resumeInflightIfAny]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (!videoId) {
      return undefined;
    }

    let cancelled = false;

    // If a convert is already in flight for this URL, resume instead of only loading UI.
    const resumed = resumeInflightIfAny();

    loadYoutubeVideoInfo(videoId)
      .then((info) => {
        if (cancelled) {
          return;
        }

        const duration = Number.isFinite(info.duration) ? info.duration : 0;
        const defaultEnd = Math.min(
          Math.max(MIN_SEGMENT_SECONDS, duration),
          DEFAULT_SEGMENT_SECONDS,
          MAX_SEGMENT_SECONDS,
        );

        setDurationSec(duration);
        setThumbnailUrl(info.thumbnailUrl);
        setStartTime(0);
        setEndTime(defaultEnd);
        setStartDraft(formatTime(0));
        setEndDraft(formatTime(defaultEnd));

        if (resumed || pollingRef.current) {
          // Keep converting status/message from resume poll.
          return;
        }

        setStatus(duration >= MIN_SEGMENT_SECONDS ? "ready" : "error");
        setMessage(
          duration >= MIN_SEGMENT_SECONDS
            ? ""
            : "This video is too short for a selectable segment.",
        );
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        if (resumed || pollingRef.current) {
          return;
        }

        setStatus("error");
        setMessage("Video details could not be loaded.");
      });

    return () => {
      cancelled = true;
      // Do not bump activeRequestRef here — that would cancel resume polls on
      // strict-mode double-mount or videoId-stable re-runs. Close cancels instead.
    };
  }, [isOpen, resumeInflightIfAny, videoId]);

  if (!isOpen) {
    return null;
  }

  function setSegment(nextStart, nextEnd) {
    const clampedStart = clampTime(nextStart, 0, durationSec ?? MAX_SEGMENT_SECONDS);
    const clampedEnd = clampTime(nextEnd, 0, durationSec ?? MAX_SEGMENT_SECONDS);
    const orderedStart = Math.min(clampedStart, clampedEnd);
    const orderedEnd = Math.max(clampedStart, clampedEnd);

    setStartTime(orderedStart);
    setEndTime(orderedEnd);
    setStartDraft(formatTime(orderedStart));
    setEndDraft(formatTime(orderedEnd));
  }

  function handleDraftCommit(which, value) {
    const parsed = parseTimeInput(value);

    if (!Number.isFinite(parsed)) {
      if (which === "start") {
        setStartDraft(formatTime(startTime));
      } else {
        setEndDraft(formatTime(endTime));
      }
      return;
    }

    if (which === "start") {
      setSegment(parsed, endTime);
    } else {
      setSegment(startTime, parsed);
    }
  }

  async function handleConvert() {
    if (!canConvert || pollingRef.current) {
      return;
    }

    const requestId = activeRequestRef.current + 1;
    activeRequestRef.current = requestId;
    pollingRef.current = true;
    setStatus("converting");
    setMessage("Preparing audio...");

    try {
      const startResponse = await fetch("/api/youtube-audio-segments", {
        body: JSON.stringify({
          url: sourceUrl,
          startTime,
          endTime,
        }),
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const startPayload = await startResponse.json().catch(() => ({}));

      if (!startResponse.ok) {
        throw new Error(errorMessage(startPayload.errorCode));
      }

      if (!startPayload.jobId) {
        throw new Error("YouTube import did not return a job id.");
      }

      saveInflightYoutubeAudioJob({
        jobId: startPayload.jobId,
        sourceUrl,
        startedAt: Date.now(),
      });

      const result = await pollConversionJob(startPayload.jobId, requestId);

      if (activeRequestRef.current !== requestId) {
        return;
      }

      if (result?.kind === "cancelled") {
        return;
      }

      if (result?.kind === "complete") {
        finishWithAsset(result.payload.asset);
        return;
      }

      if (result?.kind === "budget") {
        setStatus("converting");
        setMessage(STILL_RUNNING_CLIENT_MESSAGE);
        return;
      }

      if (result?.kind === "error") {
        setStatus("error");
        setMessage(result.message || ERROR_COPY.INTERNAL_ERROR);
        return;
      }
    } catch (error) {
      if (activeRequestRef.current !== requestId) {
        return;
      }

      clearInflightYoutubeAudioJob();
      setStatus("error");
      setMessage(error instanceof Error ? error.message : ERROR_COPY.INTERNAL_ERROR);
    } finally {
      if (activeRequestRef.current === requestId) {
        pollingRef.current = false;
      }
    }
  }

  const statusText =
    validationMessage || message || (loading ? "Loading video details..." : "");

  return (
    <div
      className="youtube-modal-overlay"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !converting) {
          event.preventDefault();
          handleClose();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !converting) {
          handleClose();
        }
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !converting) {
          handleClose();
        }
      }}
    >
      <section
        aria-labelledby="youtube-segment-title"
        aria-modal="true"
        className="youtube-modal"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="youtube-modal__header">
          <div className="min-w-0">
            <p className="youtube-modal__eyebrow">YouTube import</p>
            <h2 id="youtube-segment-title">Choose audio segment</h2>
          </div>
          <button
            className="youtube-modal__close"
            disabled={converting}
            onClick={handleClose}
            type="button"
          >
            Close
          </button>
        </div>

        {thumbnailUrl ? (
          <div
            aria-hidden="true"
            className="youtube-modal__thumb"
            style={{ backgroundImage: `url(${thumbnailUrl})` }}
          />
        ) : null}

        <div className="youtube-modal__summary">
          <span>{durationSec ? formatTime(durationSec) : "--:--"}</span>
          <span>{formatTime(segmentDuration)}</span>
        </div>

        <SegmentTimeline
          disabled={loading || converting || !durationSec}
          durationSec={durationSec || MAX_SEGMENT_SECONDS}
          endTime={endTime}
          onChange={setSegment}
          startTime={startTime}
        />

        <div className="youtube-modal__time-grid">
          <label>
            <span>Start</span>
            <input
              disabled={loading || converting}
              onBlur={(event) => handleDraftCommit("start", event.target.value)}
              onChange={(event) => setStartDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  handleDraftCommit("start", event.currentTarget.value);
                }
              }}
              value={startDraft}
            />
          </label>
          <label>
            <span>End</span>
            <input
              disabled={loading || converting}
              onBlur={(event) => handleDraftCommit("end", event.target.value)}
              onChange={(event) => setEndDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  handleDraftCommit("end", event.currentTarget.value);
                }
              }}
              value={endDraft}
            />
          </label>
        </div>

        {statusText ? (
          <p
            className={`youtube-modal__status ${
              validationMessage || status === "error" ? "is-error" : ""
            }`}
          >
            {statusText}
          </p>
        ) : null}

        <div className="youtube-modal__actions">
          <button
            className="youtube-modal__button"
            disabled={converting}
            onClick={handleClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="youtube-modal__button is-primary"
            disabled={!canConvert}
            onClick={() => {
              void handleConvert();
            }}
            type="button"
          >
            {converting ? "Converting..." : "Convert segment"}
          </button>
        </div>
      </section>
    </div>
  );
}

function SegmentTimeline({
  disabled,
  durationSec,
  endTime,
  onChange,
  startTime,
}) {
  const trackRef = useRef(null);
  const startPct = durationSec > 0 ? (startTime / durationSec) * 100 : 0;
  const endPct = durationSec > 0 ? (endTime / durationSec) * 100 : 0;

  function timeFromPointer(event) {
    const rect = trackRef.current?.getBoundingClientRect();

    if (!rect) {
      return 0;
    }

    const ratio = clampTime((event.clientX - rect.left) / rect.width, 0, 1);
    return ratio * durationSec;
  }

  function beginDrag(which, event) {
    if (disabled) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    function handleMove(moveEvent) {
      const nextTime = timeFromPointer(moveEvent);

      if (which === "start") {
        onChange(nextTime, endTime);
      } else {
        onChange(startTime, nextTime);
      }
    }

    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
    handleMove(event);
  }

  function nudge(which, event) {
    if (disabled) {
      return;
    }

    const step = event.shiftKey ? 5 : 1;
    const direction =
      event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1;

    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      return;
    }

    event.preventDefault();

    if (which === "start") {
      onChange(startTime + direction * step, endTime);
    } else {
      onChange(startTime, endTime + direction * step);
    }
  }

  return (
    <div className="youtube-timeline" ref={trackRef}>
      <div className="youtube-timeline__selection" style={{
        left: `${Math.min(startPct, endPct)}%`,
        right: `${100 - Math.max(startPct, endPct)}%`,
      }} />
      <button
        aria-label="Segment start"
        aria-valuemax={Math.round(durationSec)}
        aria-valuemin={0}
        aria-valuenow={Math.round(startTime)}
        className="youtube-timeline__handle"
        disabled={disabled}
        onKeyDown={(event) => nudge("start", event)}
        onPointerDown={(event) => beginDrag("start", event)}
        role="slider"
        style={{ left: `${startPct}%` }}
        type="button"
      />
      <button
        aria-label="Segment end"
        aria-valuemax={Math.round(durationSec)}
        aria-valuemin={0}
        aria-valuenow={Math.round(endTime)}
        className="youtube-timeline__handle"
        disabled={disabled}
        onKeyDown={(event) => nudge("end", event)}
        onPointerDown={(event) => beginDrag("end", event)}
        role="slider"
        style={{ left: `${endPct}%` }}
        type="button"
      />
    </div>
  );
}

function getSegmentValidationMessage({
  durationSec,
  endTime,
  segmentDuration,
  startTime,
  videoId,
}) {
  if (!videoId) {
    return "Enter a valid YouTube URL.";
  }

  if (!durationSec) {
    return "";
  }

  if (startTime < 0 || endTime > durationSec) {
    return "Keep the segment inside the video.";
  }

  if (segmentDuration < MIN_SEGMENT_SECONDS) {
    return "Select at least 1 second.";
  }

  if (segmentDuration > MAX_SEGMENT_SECONDS) {
    return "Select 6 minutes or less.";
  }

  return "";
}

function loadYouTubeIframeApi() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("YouTube API unavailable."));
  }

  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (youtubeApiPromise) {
    return youtubeApiPromise;
  }

  youtubeApiPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const previousReady = window.onYouTubeIframeAPIReady;
    const timeoutId = window.setTimeout(() => {
      reject(new Error("YouTube API timed out."));
    }, VIDEO_LOAD_TIMEOUT_MS);

    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeoutId);
      previousReady?.();
      resolve(window.YT);
    };

    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      window.clearTimeout(timeoutId);
      reject(new Error("YouTube API failed to load."));
    };
    document.head.appendChild(script);
  });

  return youtubeApiPromise;
}

async function loadYoutubeVideoInfo(videoId) {
  const YT = await loadYouTubeIframeApi();

  return new Promise((resolve, reject) => {
    const container = document.createElement("div");
    container.className = "youtube-hidden-player";
    document.body.appendChild(container);

    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Video details timed out."));
    }, VIDEO_LOAD_TIMEOUT_MS);

    let player = null;

    function cleanup() {
      window.clearTimeout(timeoutId);
      try {
        player?.destroy?.();
      } catch {}
      container.remove();
    }

    player = new YT.Player(container, {
      events: {
        onError: () => {
          cleanup();
          reject(new Error("Video details failed."));
        },
        onReady: (event) => {
          const duration = Number(event.target?.getDuration?.());
          cleanup();
          resolve({
            duration,
            thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          });
        },
      },
      playerVars: {
        controls: 0,
        playsinline: 1,
      },
      videoId,
    });
  });
}

function parseTimeInput(value) {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    return Number.NaN;
  }

  const parts = trimmed.split(":");

  if (parts.length === 1) {
    const seconds = Number(parts[0]);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : Number.NaN;
  }

  let multiplier = 1;
  let total = 0;

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const valuePart = Number(parts[index]);

    if (!Number.isFinite(valuePart) || valuePart < 0) {
      return Number.NaN;
    }

    total += valuePart * multiplier;
    multiplier *= 60;
  }

  return total;
}

function formatTime(value) {
  const totalSeconds = Math.max(0, Math.round(Number(value) || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function clampTime(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function errorMessage(errorCode) {
  return ERROR_COPY[errorCode] || ERROR_COPY.INTERNAL_ERROR;
}

function statusMessage(phase) {
  switch (phase) {
    case "calling_provider":
      return "Requesting audio...";
    case "downloading":
      return "Downloading source audio...";
    case "trimming":
      return "Trimming segment...";
    case "finalizing":
      return "Finalizing MP3...";
    default:
      return "Preparing audio...";
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trapFocus(event, root) {
  if (!root) {
    return;
  }

  const focusable = Array.from(
    root.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  );

  if (focusable.length === 0) {
    event.preventDefault();
    root.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
