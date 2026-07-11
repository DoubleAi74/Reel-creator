"use client";

import { useEffect, useRef, useState } from "react";
import { Player } from "@remotion/player";

import {
  downloadBlob,
  recordCompositionExport,
} from "@/lib/client-export/record-composition";
import { formatLabelForMimeType } from "@/lib/client-export/mime";
import { getSectionBounds, getSectionDurationInFrames } from "@/lib/timing";
import { VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from "@/remotion/constants";
import { LyricVideo } from "@/remotion/LyricVideo";

/**
 * Fullscreen export stage: free-playing Remotion Player + tab/region capture.
 * Parent owns export modal progress via callbacks.
 */
export function ClientExportOverlay({
  audioUrl,
  backgroundDurationSec = null,
  backgroundUrl = null,
  onCancel,
  onError,
  onProgress,
  onSuccess,
  project,
  projectTitle = "Reel Creator",
}) {
  const stageRef = useRef(null);
  const playerRef = useRef(null);
  const abortRef = useRef(null);
  const startedRef = useRef(false);
  const [statusMessage, setStatusMessage] = useState(
    "When Chrome asks, share this tab so we can record the preview.",
  );

  const durationInFrames = getSectionDurationInFrames(project.audio, VIDEO_FPS);
  const sectionBounds = getSectionBounds(project.audio);

  useEffect(() => {
    if (startedRef.current) {
      return undefined;
    }

    startedRef.current = true;
    const abortController = new AbortController();
    abortRef.current = abortController;

    const run = async () => {
      try {
        await new Promise((resolve) => {
          window.requestAnimationFrame(() => resolve());
        });
        await new Promise((resolve) => {
          window.setTimeout(resolve, 350);
        });

        if (abortController.signal.aborted) {
          return;
        }

        setStatusMessage("Share this tab when prompted, then keep it focused…");

        const result = await recordCompositionExport({
          audioStartSec: sectionBounds.startOffset,
          audioUrl,
          durationSec: sectionBounds.sectionDuration,
          onCaptureReady: async () => {
            setStatusMessage("Recording… keep this tab focused.");
            const player = playerRef.current;

            if (player) {
              player.seekTo(0);
              await player.play();
            }
          },
          onProgress,
          signal: abortController.signal,
          targetElement: stageRef.current,
        });

        const player = playerRef.current;

        if (player?.isPlaying?.()) {
          player.pause();
        }

        const safeTitle =
          String(projectTitle || "reel")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 48) || "reel";
        const fileName = `${safeTitle}-export.${result.extension}`;
        downloadBlob(result.blob, fileName);

        onSuccess?.({
          extension: result.extension,
          fileName,
          formatLabel: formatLabelForMimeType(result.mimeType),
          mimeType: result.mimeType,
          usedRegionCapture: result.usedRegionCapture,
        });
      } catch (error) {
        if (error?.name === "AbortError") {
          onCancel?.();
          return;
        }

        onError?.(
          error instanceof Error
            ? error.message
            : "Browser export failed unexpectedly.",
        );
      }
    };

    void run();

    return () => {
      abortController.abort();
      abortRef.current = null;
    };
    // Single-flight export for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[75] flex flex-col items-center justify-center bg-black/92 p-4 backdrop-blur-sm">
      <p className="mb-3 max-w-lg text-center text-sm text-white/80">{statusMessage}</p>
      <p className="mb-4 max-w-lg text-center text-xs text-white/50">
        Share <strong className="font-semibold text-white/70">this tab</strong> if
        prompted. Project audio is mixed in automatically (not your microphone).
      </p>
      <div
        className="relative overflow-hidden rounded-[1.25rem] border border-white/15 bg-black shadow-[0_40px_120px_rgba(0,0,0,0.65)]"
        ref={stageRef}
        style={{
          aspectRatio: `${VIDEO_WIDTH} / ${VIDEO_HEIGHT}`,
          height: "min(78vh, 720px)",
          maxWidth: "100%",
          width: "auto",
        }}
      >
        <div className="absolute inset-0">
          <Player
            acknowledgeRemotionLicense
            clickToPlay={false}
            component={LyricVideo}
            compositionHeight={VIDEO_HEIGHT}
            compositionWidth={VIDEO_WIDTH}
            controls={false}
            doubleClickToFullscreen={false}
            durationInFrames={durationInFrames}
            fps={VIDEO_FPS}
            inputProps={{
              audioUrl: null,
              backgroundDurationSec,
              backgroundUrl,
              project,
              transparent: false,
            }}
            loop={false}
            ref={playerRef}
            showPosterWhenPaused={false}
            spaceKeyToPlayOrPause={false}
            style={{ height: "100%", width: "100%" }}
          />
        </div>
      </div>
      <button
        className="mt-5 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/15"
        onClick={() => {
          abortRef.current?.abort();
          onCancel?.();
        }}
        type="button"
      >
        Cancel
      </button>
    </div>
  );
}
