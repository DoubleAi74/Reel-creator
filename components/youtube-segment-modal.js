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
const PREVIEW_TICK_MS = 100;
const PREVIEW_START_GRACE_MS = 2500;
const STILL_RUNNING_CLIENT_MESSAGE =
  "Still converting on the server. Keep this page open or return here to keep checking status.";
const COMPLETE_WITHOUT_ASSET_MESSAGE =
  "Conversion finished but this browser session could not attach the audio. Refresh and try opening the import again, or re-convert.";
const PREVIEW_BLOCKED_HINT =
  "Preview couldn't start — it may be blocked for this video. You can still convert.";

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
  FFMPEG_MISSING:
    "This host cannot run local audio trim (no ffmpeg/ffprobe). Prefer auto/youtube-mp36 provider-trimmed imports, or configure FFMPEG_PATH/FFPROBE_PATH.",
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
  const videoId = useMemo(() => extractYouTubeVideoId(sourceUrl), [sourceUrl]);

  if (!isOpen) {
    return null;
  }

  // Keyed by video so all per-video state (duration, segment, preview, status)
  // resets naturally when the modal opens on a different video.
  return (
    <SegmentModalBody
      key={videoId || "no-video"}
      onClose={onClose}
      onComplete={onComplete}
      sourceUrl={sourceUrl}
      videoId={videoId}
    />
  );
}

function SegmentModalBody({ onClose, onComplete, sourceUrl, videoId }) {
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);
  const activeRequestRef = useRef(0);
  const pollingRef = useRef(false);
  const playerSessionRef = useRef(null);
  const previewTimerRef = useRef(null);
  // Stable callbacks so open/resume effects do not re-fire every parent render.
  const onCompleteRef = useRef(onComplete);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCompleteRef.current = onComplete;
    onCloseRef.current = onClose;
  }, [onClose, onComplete]);

  const thumbnailUrl = videoId
    ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    : "";
  const [durationSec, setDurationSec] = useState(null);
  const [videoTitle, setVideoTitle] = useState("");
  const [videoAuthor, setVideoAuthor] = useState("");
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(DEFAULT_SEGMENT_SECONDS);
  const [startDraft, setStartDraft] = useState("0:00");
  const [endDraft, setEndDraft] = useState("0:15");
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewSec, setPreviewSec] = useState(null);
  const [previewHint, setPreviewHint] = useState("");

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
  const canConvert =
    !loading && !converting && !validationMessage && Boolean(durationSec);
  const canPreview = canConvert;

  const returnFocus = useCallback(() => {
    window.setTimeout(() => {
      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus();
      }
    }, 0);
  }, []);

  const stopClientWait = useCallback(() => {
    activeRequestRef.current += 1;
    pollingRef.current = false;
  }, []);

  const stopPreview = useCallback((pausePlayer = true) => {
    if (previewTimerRef.current) {
      window.clearInterval(previewTimerRef.current);
      previewTimerRef.current = null;
    }

    if (pausePlayer) {
      try {
        playerSessionRef.current?.getPlayer()?.pauseVideo?.();
      } catch {}
    }

    setIsPreviewing(false);
    setPreviewSec(null);
  }, []);

  const startPreview = useCallback(() => {
    const player = playerSessionRef.current?.getPlayer();

    if (!player || typeof player.getCurrentTime !== "function") {
      return;
    }

    stopPreview(false);
    setPreviewHint("");

    const previewStart = startTime;
    const previewEnd = endTime;

    try {
      const state = Number(player.getPlayerState?.());

      if (state === -1 || state === 5) {
        // Never played yet: loading with startSeconds is the reliable way to
        // begin playback at the segment start on a freshly cued player.
        player.loadVideoById({ startSeconds: previewStart, videoId });
      } else {
        player.seekTo(previewStart, true);
        player.playVideo?.();
      }
    } catch {
      return;
    }

    setIsPreviewing(true);
    setPreviewSec(previewStart);
    const startedAt = Date.now();

    previewTimerRef.current = window.setInterval(() => {
      let current = Number.NaN;
      let state = null;

      try {
        current = Number(player.getCurrentTime?.());
        state = Number(player.getPlayerState?.());
      } catch {}

      if (Number.isFinite(current)) {
        setPreviewSec(clampTime(current, previewStart, previewEnd));

        if (current >= previewEnd - 0.05) {
          stopPreview();
          return;
        }
      }

      if (state === 0) {
        // Video ended before the segment end (segment reaches the video tail).
        stopPreview(false);
        return;
      }

      // 1 = playing, 3 = buffering. Anything else after the grace period means
      // playback was blocked (autoplay policy, non-embeddable video, ...).
      if (Date.now() - startedAt > PREVIEW_START_GRACE_MS && state !== 1 && state !== 3) {
        stopPreview();
        setPreviewHint(PREVIEW_BLOCKED_HINT);
      }
    }, PREVIEW_TICK_MS);
  }, [endTime, startTime, stopPreview, videoId]);

  const handleClose = useCallback(() => {
    // Always allow dismiss — cancel client poll but keep inflight job for resume.
    stopPreview();
    stopClientWait();
    onCloseRef.current?.();
    returnFocus();
  }, [returnFocus, stopClientWait, stopPreview]);

  const finishWithAsset = useCallback(
    (asset) => {
      clearInflightYoutubeAudioJob();
      onCompleteRef.current?.(asset, {
        segmentEndSec: endTime,
        segmentStartSec: startTime,
        type: "youtube",
        youtubeUrl: sourceUrl,
      });
      onCloseRef.current?.();
      returnFocus();
    },
    [endTime, returnFocus, sourceUrl, startTime],
  );

  const pollConversionJob = useCallback(async (jobId, requestId) => {
    let completeWithoutAssetTries = 0;

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

        // Session cookie / ingest can lag one tick; retry before failing hard.
        completeWithoutAssetTries += 1;
        if (completeWithoutAssetTries <= 5) {
          setMessage("Finishing audio attach...");
          await delay(400);
          continue;
        }

        return {
          kind: "error",
          message: COMPLETE_WITHOUT_ASSET_MESSAGE,
          clearInflight: true,
        };
      }

      if (!response.ok || payload.status === "failed") {
        return {
          kind: "error",
          message: errorMessage(payload.errorCode),
          clearInflight: true,
        };
      }

      completeWithoutAssetTries = 0;
      setMessage(statusMessage(payload.phase));
      await delay(POLL_INTERVAL_MS);
    }

    // Budget exhausted: keep inflight so visibility/focus can resume.
    return { kind: "budget" };
  }, []);

  const applyPollResult = useCallback(
    (result, requestId) => {
      if (activeRequestRef.current !== requestId) {
        return;
      }

      if (!result || result.kind === "cancelled") {
        return;
      }

      if (result.kind === "complete") {
        finishWithAsset(result.payload.asset);
        return;
      }

      if (result.kind === "budget") {
        // Leave inflight; allow Convert/Close again. Resume on reopen/focus.
        setStatus("ready");
        setMessage(STILL_RUNNING_CLIENT_MESSAGE);
        return;
      }

      if (result.kind === "error") {
        if (result.clearInflight) {
          clearInflightYoutubeAudioJob();
        }
        setStatus("error");
        setMessage(result.message || ERROR_COPY.INTERNAL_ERROR);
      }
    },
    [finishWithAsset],
  );

  const runPollForJob = useCallback(
    async (jobId, { announcePreparing = false } = {}) => {
      if (!jobId || pollingRef.current) {
        return;
      }

      const requestId = activeRequestRef.current + 1;
      activeRequestRef.current = requestId;
      pollingRef.current = true;
      setStatus("converting");
      setMessage(
        announcePreparing ? "Preparing audio..." : "Checking conversion status...",
      );

      try {
        const result = await pollConversionJob(jobId, requestId);
        applyPollResult(result, requestId);
      } finally {
        if (activeRequestRef.current === requestId) {
          pollingRef.current = false;
        }
      }
    },
    [applyPollResult, pollConversionJob],
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

  // Cancel any still-running client poll if the modal unmounts; the server
  // job and the persisted inflight record survive for resume on reopen.
  useEffect(() => {
    return () => {
      activeRequestRef.current += 1;
      pollingRef.current = false;
    };
  }, []);

  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    const id = window.setTimeout(() => {
      dialogRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(id);
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") {
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
  }, [handleClose]);

  // Resume poll after iOS background / tab freeze (Stage B).
  useEffect(() => {
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
  }, [resumeInflightIfAny]);

  // One hidden player per open: provides duration/title on load, then stays
  // alive so Preview can play the selected segment (audio only).
  useEffect(() => {
    if (!videoId) {
      return undefined;
    }

    let cancelled = false;
    const resumed = resumeInflightIfAny();

    const session = createPlayerSession(videoId, {
      onError: () => {
        if (cancelled || resumed || pollingRef.current) {
          return;
        }

        setStatus("error");
        setMessage("Video details could not be loaded.");
      },
      onReady: (info) => {
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
        setVideoTitle(info.title);
        setVideoAuthor(info.author);
        setStartTime(0);
        setEndTime(defaultEnd);
        setStartDraft(formatTime(0));
        setEndDraft(formatTime(defaultEnd));

        if (resumed || pollingRef.current) {
          return;
        }

        setStatus(duration >= MIN_SEGMENT_SECONDS ? "ready" : "error");
        setMessage(
          duration >= MIN_SEGMENT_SECONDS
            ? ""
            : "This video is too short for a selectable segment.",
        );
      },
    });

    playerSessionRef.current = session;

    return () => {
      cancelled = true;
      stopPreview(false);
      playerSessionRef.current = null;
      session.destroy();
    };
  }, [resumeInflightIfAny, stopPreview, videoId]);

  function setSegment(nextStart, nextEnd) {
    stopPreview();

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

    stopPreview();

    const requestId = activeRequestRef.current + 1;
    activeRequestRef.current = requestId;
    pollingRef.current = true;
    setStatus("converting");
    setMessage("Preparing audio...");
    const clientStartedAt = Date.now();

    const debugLog = (event, data = {}) => {
      // Browser console — open DevTools on the deployed site while converting.
      console.info("[yt-convert:client]", event, {
        ...data,
        ms: Date.now() - clientStartedAt,
      });
    };

    try {
      debugLog("post-start", {
        startTime,
        endTime,
        segmentSec: endTime - startTime,
        videoId,
      });

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
      const rawText = await startResponse.text();
      let startPayload = {};

      try {
        startPayload = rawText ? JSON.parse(rawText) : {};
      } catch {
        startPayload = { parseError: true, rawPreview: rawText.slice(0, 300) };
      }

      debugLog("post-response", {
        httpStatus: startResponse.status,
        ok: startResponse.ok,
        jobId: startPayload.jobId ?? null,
        status: startPayload.status ?? null,
        phase: startPayload.phase ?? null,
        errorCode: startPayload.errorCode ?? null,
        errorMessage: startPayload.errorMessage ?? null,
        hasAsset: Boolean(startPayload.asset?.assetId),
        hasEmbeddedAudio: Boolean(startPayload.asset?.audioBase64),
        parseError: startPayload.parseError === true,
        rawPreview:
          startPayload.parseError === true ? startPayload.rawPreview : undefined,
      });

      if (!startResponse.ok) {
        throw new Error(
          formatConvertFailure({
            errorCode: startPayload.errorCode,
            errorMessage: startPayload.errorMessage,
            httpStatus: startResponse.status,
            parseError: startPayload.parseError === true,
          }),
        );
      }

      if (!startPayload.jobId) {
        throw new Error("YouTube import did not return a job id.");
      }

      // Vercel (sync mode): POST awaits the full convert and may already include asset.
      if (
        startPayload.status === "complete" &&
        startPayload.asset?.assetId
      ) {
        debugLog("post-complete-with-asset", {
          assetId: startPayload.asset.assetId,
          hasEmbeddedAudio: Boolean(startPayload.asset.audioBase64),
        });
        if (activeRequestRef.current === requestId) {
          finishWithAsset(startPayload.asset);
        }
        return;
      }

      if (startPayload.status === "failed") {
        throw new Error(
          formatConvertFailure({
            errorCode: startPayload.errorCode,
            errorMessage: startPayload.errorMessage,
            httpStatus: startResponse.status,
          }),
        );
      }

      debugLog("post-async-poll", { jobId: startPayload.jobId });
      saveInflightYoutubeAudioJob({
        jobId: startPayload.jobId,
        sourceUrl,
        startedAt: Date.now(),
      });

      const result = await pollConversionJob(startPayload.jobId, requestId);
      debugLog("poll-result", { kind: result?.kind, message: result?.message });
      applyPollResult(result, requestId);
    } catch (error) {
      if (activeRequestRef.current !== requestId) {
        return;
      }

      debugLog("convert-error", {
        message: error instanceof Error ? error.message : String(error),
      });
      clearInflightYoutubeAudioJob();
      setStatus("error");
      setMessage(error instanceof Error ? error.message : ERROR_COPY.INTERNAL_ERROR);
    } finally {
      if (activeRequestRef.current === requestId) {
        pollingRef.current = false;
      }
    }
  }

  const statusText = validationMessage || message;
  const statusIsError = Boolean(validationMessage) || status === "error";
  const videoMeta = [videoAuthor, durationSec ? formatTime(durationSec) : ""]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="yt-modal-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          handleClose();
        }
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          handleClose();
        }
      }}
    >
      <section
        aria-labelledby="youtube-segment-title"
        aria-modal="true"
        className="yt-modal"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="yt-modal__header">
          <div className="min-w-0">
            <p className="yt-modal__eyebrow">YouTube import</p>
            <h2 className="yt-modal__title" id="youtube-segment-title">
              Choose audio segment
            </h2>
          </div>
          <button
            aria-label="Close"
            className="yt-modal__close"
            onClick={handleClose}
            type="button"
          >
            <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 14 14" width="14">
              <path
                d="M2 2l10 10M12 2L2 12"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="1.8"
              />
            </svg>
          </button>
        </div>

        <div className="yt-modal__media">
          <div
            aria-hidden="true"
            className="yt-modal__thumb"
            style={
              thumbnailUrl ? { backgroundImage: `url(${thumbnailUrl})` } : undefined
            }
          />
          <div className="yt-modal__meta">
            <p className="yt-modal__video-title">
              {videoTitle || (loading ? "Loading video details…" : "YouTube video")}
            </p>
            {videoMeta ? <p className="yt-modal__video-sub">{videoMeta}</p> : null}
          </div>
        </div>

        <TrimBar
          disabled={loading || converting || !durationSec}
          durationSec={durationSec || MAX_SEGMENT_SECONDS}
          endTime={endTime}
          onChange={setSegment}
          onInteract={stopPreview}
          playheadSec={isPreviewing ? previewSec : null}
          startTime={startTime}
        />

        <div className="yt-modal__controls">
          <button
            className="yt-modal__preview"
            disabled={!canPreview}
            onClick={() => {
              if (isPreviewing) {
                stopPreview();
              } else {
                startPreview();
              }
            }}
            type="button"
          >
            {isPreviewing ? (
              <svg aria-hidden="true" height="10" viewBox="0 0 10 10" width="10">
                <rect fill="currentColor" height="10" rx="2" width="10" />
              </svg>
            ) : (
              <svg aria-hidden="true" fill="none" height="12" viewBox="0 0 11 12" width="11">
                <path
                  d="M1.5 1.6c0-.8.9-1.3 1.6-.9l7 4.4c.6.4.6 1.4 0 1.8l-7 4.4c-.7.4-1.6-.1-1.6-.9V1.6z"
                  fill="currentColor"
                />
              </svg>
            )}
            {isPreviewing ? "Stop" : "Preview"}
          </button>
          <div className="yt-modal__times">
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
        </div>

        {previewHint ? <p className="yt-modal__hint">{previewHint}</p> : null}

        {statusText ? (
          <p
            className={`yt-modal__status ${statusIsError ? "is-error" : ""}`}
            role="status"
          >
            {converting ? <span aria-hidden="true" className="yt-spinner" /> : null}
            <span>{statusText}</span>
          </p>
        ) : null}

        <div className="yt-modal__actions">
          <button className="yt-modal__button" onClick={handleClose} type="button">
            {converting ? "Continue in background" : "Cancel"}
          </button>
          <button
            className="yt-modal__button is-primary"
            disabled={!canConvert}
            onClick={() => {
              void handleConvert();
            }}
            type="button"
          >
            {converting ? (
              <>
                <span aria-hidden="true" className="yt-spinner" />
                Converting…
              </>
            ) : (
              "Convert segment"
            )}
          </button>
        </div>
      </section>
    </div>
  );
}

function TrimBar({
  disabled,
  durationSec,
  endTime,
  onChange,
  onInteract,
  playheadSec,
  startTime,
}) {
  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(null);

  const startPct = durationSec > 0 ? (startTime / durationSec) * 100 : 0;
  const endPct = durationSec > 0 ? (endTime / durationSec) * 100 : 0;
  const widthPct = Math.max(0, endPct - startPct);
  const badgeOutside = widthPct < 14;
  const playheadPct =
    playheadSec == null || durationSec <= 0
      ? null
      : clampTime((playheadSec / durationSec) * 100, 0, 100);

  function timeFromPointer(event) {
    const rect = trackRef.current?.getBoundingClientRect();

    if (!rect || rect.width <= 0) {
      return 0;
    }

    const ratio = clampTime((event.clientX - rect.left) / rect.width, 0, 1);
    return ratio * durationSec;
  }

  // Live clamping: dragging can never produce an invalid segment (< 1s,
  // > 6 min, or outside the video).
  function clampStart(value) {
    return clampTime(
      value,
      Math.max(0, endTime - MAX_SEGMENT_SECONDS),
      Math.max(0, endTime - MIN_SEGMENT_SECONDS),
    );
  }

  function clampEnd(value) {
    return clampTime(
      value,
      Math.min(durationSec, startTime + MIN_SEGMENT_SECONDS),
      Math.min(durationSec, startTime + MAX_SEGMENT_SECONDS),
    );
  }

  function beginDrag(mode, event) {
    if (disabled) {
      return;
    }

    event.preventDefault();
    onInteract?.();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const grabOffset = mode === "window" ? timeFromPointer(event) - startTime : 0;
    const windowLen = Math.max(MIN_SEGMENT_SECONDS, endTime - startTime);
    setDragging(mode);

    function handleMove(moveEvent) {
      const time = timeFromPointer(moveEvent);

      if (mode === "start") {
        onChange(clampStart(time), endTime);
      } else if (mode === "end") {
        onChange(startTime, clampEnd(time));
      } else {
        const nextStart = clampTime(
          time - grabOffset,
          0,
          Math.max(0, durationSec - windowLen),
        );
        onChange(nextStart, nextStart + windowLen);
      }
    }

    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
      setDragging(null);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    handleMove(event);
  }

  function nudge(mode, event) {
    if (disabled) {
      return;
    }

    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      return;
    }

    event.preventDefault();
    onInteract?.();

    const direction =
      event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1;
    const step = (event.shiftKey ? 5 : 1) * direction;

    if (mode === "start") {
      onChange(clampStart(startTime + step), endTime);
    } else if (mode === "end") {
      onChange(startTime, clampEnd(endTime + step));
    } else {
      const windowLen = endTime - startTime;
      const nextStart = clampTime(
        startTime + step,
        0,
        Math.max(0, durationSec - windowLen),
      );
      onChange(nextStart, nextStart + windowLen);
    }
  }

  return (
    <div className="yt-trim">
      <div
        className={`yt-trim__track${disabled ? " is-disabled" : ""}`}
        ref={trackRef}
      >
        <div
          aria-disabled={disabled}
          aria-label="Move segment"
          aria-valuemax={Math.round(
            Math.max(0, durationSec - Math.max(0, endTime - startTime)),
          )}
          aria-valuemin={0}
          aria-valuenow={Math.round(startTime)}
          aria-valuetext={`${formatTime(startTime)} to ${formatTime(endTime)}`}
          className={`yt-trim__window${dragging === "window" ? " is-active" : ""}`}
          onKeyDown={(event) => nudge("window", event)}
          onPointerDown={(event) => beginDrag("window", event)}
          role="slider"
          style={{ left: `${startPct}%`, width: `${widthPct}%` }}
          tabIndex={disabled ? -1 : 0}
        >
          {badgeOutside && (dragging === "start" || dragging === "end") ? null : (
            <span
              className={`yt-trim__duration${badgeOutside ? " is-outside" : ""}`}
            >
              {formatTime(endTime - startTime)}
            </span>
          )}
        </div>
        {playheadPct == null ? null : (
          <div
            aria-hidden="true"
            className="yt-trim__playhead"
            style={{ left: `${playheadPct}%` }}
          />
        )}
        <button
          aria-label="Segment start"
          aria-valuemax={Math.round(durationSec)}
          aria-valuemin={0}
          aria-valuenow={Math.round(startTime)}
          aria-valuetext={formatTime(startTime)}
          className="yt-trim__handle is-start"
          disabled={disabled}
          onKeyDown={(event) => nudge("start", event)}
          onPointerDown={(event) => beginDrag("start", event)}
          role="slider"
          style={{ left: `${startPct}%` }}
          type="button"
        >
          <span aria-hidden="true" className="yt-trim__grip" />
          {dragging === "start" ? (
            <span className="yt-trim__bubble">{formatTime(startTime)}</span>
          ) : null}
        </button>
        <button
          aria-label="Segment end"
          aria-valuemax={Math.round(durationSec)}
          aria-valuemin={0}
          aria-valuenow={Math.round(endTime)}
          aria-valuetext={formatTime(endTime)}
          className="yt-trim__handle is-end"
          disabled={disabled}
          onKeyDown={(event) => nudge("end", event)}
          onPointerDown={(event) => beginDrag("end", event)}
          role="slider"
          style={{ left: `${endPct}%` }}
          type="button"
        >
          <span aria-hidden="true" className="yt-trim__grip" />
          {dragging === "end" ? (
            <span className="yt-trim__bubble">{formatTime(endTime)}</span>
          ) : null}
        </button>
      </div>
      <div aria-hidden="true" className="yt-trim__scale">
        <span>{formatTime(0)}</span>
        <span>{formatTime(durationSec)}</span>
      </div>
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

// Hidden player that lives for the whole modal session: reports duration and
// video metadata once ready, then stays available for segment preview.
function createPlayerSession(videoId, { onError, onReady }) {
  let destroyed = false;
  let settled = false;
  let player = null;

  const container = document.createElement("div");
  container.className = "youtube-hidden-player";
  document.body.appendChild(container);

  const timeoutId = window.setTimeout(() => {
    if (!destroyed && !settled) {
      settled = true;
      onError(new Error("Video details timed out."));
    }
  }, VIDEO_LOAD_TIMEOUT_MS);

  loadYouTubeIframeApi()
    .then((YT) => {
      if (destroyed) {
        return;
      }

      player = new YT.Player(container, {
        events: {
          onError: () => {
            window.clearTimeout(timeoutId);
            if (!destroyed && !settled) {
              settled = true;
              onError(new Error("Video details failed."));
            }
          },
          onReady: (event) => {
            window.clearTimeout(timeoutId);
            if (destroyed || settled) {
              return;
            }

            settled = true;
            const data = event.target?.getVideoData?.() || {};
            onReady({
              author: typeof data.author === "string" ? data.author : "",
              duration: Number(event.target?.getDuration?.()),
              title: typeof data.title === "string" ? data.title : "",
            });
          },
        },
        playerVars: {
          controls: 0,
          playsinline: 1,
        },
        videoId,
      });
    })
    .catch(() => {
      window.clearTimeout(timeoutId);
      if (!destroyed && !settled) {
        settled = true;
        onError(new Error("YouTube API failed to load."));
      }
    });

  return {
    destroy() {
      destroyed = true;
      window.clearTimeout(timeoutId);
      try {
        player?.destroy?.();
      } catch {}
      container.remove();
    },
    getPlayer() {
      return player;
    },
  };
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
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function clampTime(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function errorMessage(errorCode) {
  return ERROR_COPY[errorCode] || ERROR_COPY.INTERNAL_ERROR;
}

function formatConvertFailure({
  errorCode,
  errorMessage: serverMessage,
  httpStatus,
  parseError = false,
}) {
  if (parseError || (!errorCode && (httpStatus === 504 || httpStatus === 502))) {
    return `YouTube import timed out or returned a non-JSON error (HTTP ${httpStatus || "unknown"}). On Vercel Hobby this is often the ~10s function limit — check Vercel logs for [yt-audio:convert].`;
  }

  const friendly = errorMessage(errorCode);
  const parts = [friendly];

  if (errorCode && friendly === ERROR_COPY.INTERNAL_ERROR) {
    parts.push(`code=${errorCode}`);
  } else if (errorCode && friendly !== ERROR_COPY.INTERNAL_ERROR) {
    parts.push(`(${errorCode})`);
  }

  if (serverMessage && serverMessage !== friendly) {
    parts.push(serverMessage);
  }

  if (httpStatus && httpStatus >= 400) {
    parts.push(`[HTTP ${httpStatus}]`);
  }

  return parts.filter(Boolean).join(" ");
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
