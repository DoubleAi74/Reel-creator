import {
  extensionForMimeType,
  pickClientExportMimeType,
} from "./mime.js";

/**
 * Record a DOM element (preview / export player) via tab capture + optional
 * Region Capture crop, mixed with an audio URL for the lyric track.
 *
 * @param {object} options
 * @param {HTMLElement} options.targetElement - Element to crop to when supported
 * @param {string} options.audioUrl - Playable audio (blob: or https:)
 * @param {number} options.durationSec - Section length to record
 * @param {number} [options.audioStartSec=0] - Offset into the audio file
 * @param {(progress: number) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ blob: Blob, mimeType: string, extension: string, usedRegionCapture: boolean }>}
 */
export async function recordCompositionExport({
  audioStartSec = 0,
  audioUrl,
  durationSec,
  onCaptureReady,
  onProgress,
  signal,
  targetElement,
}) {
  if (typeof window === "undefined") {
    throw new Error("Client export only runs in the browser.");
  }

  if (!targetElement || !(targetElement instanceof HTMLElement)) {
    throw new Error("Export preview is not ready. Open the preview and try again.");
  }

  if (typeof audioUrl !== "string" || !audioUrl) {
    throw new Error("Playable audio is required for browser export. Re-upload or re-convert the track.");
  }

  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error("The selected section has no length to export.");
  }

  if (signal?.aborted) {
    throw new DOMException("Export cancelled.", "AbortError");
  }

  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error(
      "This browser cannot capture the tab for export. Use the latest Chrome or Edge on desktop.",
    );
  }

  const mimeType = pickClientExportMimeType();

  if (mimeType === null) {
    throw new Error("MediaRecorder is not available in this browser.");
  }

  const displayStream = await requestTabCaptureStream();
  let usedRegionCapture = false;

  try {
    usedRegionCapture = await tryCropToElement(
      displayStream.getVideoTracks()[0],
      targetElement,
    );
  } catch {
    usedRegionCapture = false;
  }

  const audio = new Audio();
  audio.preload = "auto";
  audio.src = audioUrl;
  audio.crossOrigin = "anonymous";

  let audioContext = null;
  let mixedStream = displayStream;
  let mediaRecorder = null;
  const chunks = [];

  const cleanup = () => {
    try {
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
    } catch {
      // ignore
    }

    for (const track of displayStream.getTracks()) {
      track.stop();
    }

    if (mixedStream !== displayStream) {
      for (const track of mixedStream.getTracks()) {
        track.stop();
      }
    }

    audio.pause();
    audio.removeAttribute("src");
    audio.load();

    if (audioContext) {
      void audioContext.close().catch(() => {});
      audioContext = null;
    }
  };

  const abortHandler = () => {
    cleanup();
  };

  signal?.addEventListener("abort", abortHandler, { once: true });

  try {
    await waitForAudioReady(audio, signal);

    audioContext = new AudioContext();
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const sourceNode = audioContext.createMediaElementSource(audio);
    const destinationNode = audioContext.createMediaStreamDestination();
    sourceNode.connect(destinationNode);
    // Do not connect to speakers during export — avoids double-audio if tab is shared with system audio.

    mixedStream = new MediaStream([
      ...displayStream.getVideoTracks(),
      ...destinationNode.stream.getAudioTracks(),
    ]);

    const recorderOptions = mimeType ? { mimeType, videoBitsPerSecond: 8_000_000 } : { videoBitsPerSecond: 8_000_000 };
    mediaRecorder = new MediaRecorder(mixedStream, recorderOptions);

    const recordingDone = new Promise((resolve, reject) => {
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onerror = () => {
        reject(new Error("Recording failed in the browser."));
      };

      mediaRecorder.onstop = () => {
        resolve();
      };
    });

    const startOffset = Number.isFinite(audioStartSec) && audioStartSec > 0 ? audioStartSec : 0;
    audio.currentTime = startOffset;

    await new Promise((resolve, reject) => {
      const onSeeked = () => {
        audio.removeEventListener("seeked", onSeeked);
        audio.removeEventListener("error", onError);
        resolve();
      };
      const onError = () => {
        audio.removeEventListener("seeked", onSeeked);
        audio.removeEventListener("error", onError);
        reject(new Error("Could not seek the audio for export."));
      };
      audio.addEventListener("seeked", onSeeked, { once: true });
      audio.addEventListener("error", onError, { once: true });
      // Some browsers fire seeked synchronously when already at position.
      if (Math.abs(audio.currentTime - startOffset) < 0.05) {
        onSeeked();
      }
    });

    if (signal?.aborted) {
      throw new DOMException("Export cancelled.", "AbortError");
    }

    // Parent can start Remotion Player playback in sync with the audio timeline.
    await onCaptureReady?.({ usedRegionCapture });

    mediaRecorder.start(250);
    await audio.play();

    const startedAt = performance.now();
    const durationMs = durationSec * 1000;

    await new Promise((resolve, reject) => {
      const tick = () => {
        if (signal?.aborted) {
          reject(new DOMException("Export cancelled.", "AbortError"));
          return;
        }

        const elapsed = performance.now() - startedAt;
        const progress = Math.min(1, elapsed / durationMs);
        onProgress?.(progress);

        if (elapsed >= durationMs || audio.ended) {
          resolve();
          return;
        }

        window.setTimeout(tick, 100);
      };

      tick();
    });

    audio.pause();

    if (mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }

    await recordingDone;

    const finalMime =
      mediaRecorder.mimeType || mimeType || "video/webm";
    const blob = new Blob(chunks, { type: finalMime });

    if (blob.size < 1000) {
      throw new Error(
        "The recording was empty. When prompted, share this browser tab and keep the export preview visible.",
      );
    }

    onProgress?.(1);

    return {
      blob,
      extension: extensionForMimeType(finalMime),
      mimeType: finalMime,
      usedRegionCapture,
    };
  } finally {
    signal?.removeEventListener("abort", abortHandler);
    cleanup();
  }
}

async function requestTabCaptureStream() {
  const constraints = {
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: "include",
    surfaceSwitching: "exclude",
    systemAudio: "exclude",
    video: {
      displaySurface: "browser",
      frameRate: { ideal: 30, max: 30 },
    },
  };

  try {
    return await navigator.mediaDevices.getDisplayMedia(constraints);
  } catch (error) {
    if (error?.name === "NotAllowedError") {
      throw new Error(
        "Screen share was blocked. Click Export again and choose this tab when Chrome asks what to share.",
      );
    }

    throw new Error(
      error instanceof Error
        ? error.message
        : "Could not start tab capture for export.",
    );
  }
}

async function tryCropToElement(videoTrack, element) {
  if (!videoTrack || !element) {
    return false;
  }

  const CropTargetCtor = globalThis.CropTarget;

  if (typeof CropTargetCtor?.fromElement !== "function") {
    return false;
  }

  if (typeof videoTrack.cropTo !== "function") {
    return false;
  }

  const cropTarget = await CropTargetCtor.fromElement(element);
  await videoTrack.cropTo(cropTarget);

  return true;
}

function waitForAudioReady(audio, signal) {
  if (audio.readyState >= 2) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Audio could not be loaded for export."));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Export cancelled.", "AbortError"));
    };
    const cleanup = () => {
      audio.removeEventListener("canplay", onReady);
      audio.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };

    audio.addEventListener("canplay", onReady, { once: true });
    audio.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    audio.load();
  });
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
