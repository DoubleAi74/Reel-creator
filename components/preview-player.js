"use client";

import { useEffect } from "react";

import { Player } from "@remotion/player";

import { shouldReportPreviewFrames } from "@/lib/preview-sync";
import { getSectionDurationInFrames } from "@/lib/timing";
import { VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from "@/remotion/constants";
import { LyricVideo } from "@/remotion/LyricVideo";

export function PreviewPlayer({
  backgroundDurationSec = null,
  backgroundUrl = null,
  onFrameChange,
  playerRef,
  project,
  targetFrame,
}) {
  const durationInFrames = getSectionDurationInFrames(project.audio, VIDEO_FPS);

  useEffect(() => {
    const player = playerRef.current;

    if (!player) {
      return;
    }

    if (player.isPlaying()) {
      player.pause();
    }

    if (player.getCurrentFrame() !== targetFrame) {
      player.seekTo(targetFrame);
    }
  }, [playerRef, targetFrame]);

  useEffect(() => {
    const player = playerRef.current;

    // Only subscribe to the player's frame stream when a consumer actually wants
    // it. Otherwise this fires a callback on every previewed frame for nothing,
    // and a per-frame parent setState there re-renders the whole editor — under a
    // scrub on a heavy project that storm exceeds React's update budget.
    if (!player || !shouldReportPreviewFrames(onFrameChange)) {
      return undefined;
    }

    const handleFrameChange = (event) => {
      onFrameChange(event.detail.frame);
    };

    player.addEventListener("frameupdate", handleFrameChange);
    player.addEventListener("seeked", handleFrameChange);
    onFrameChange(player.getCurrentFrame());

    return () => {
      player.removeEventListener("frameupdate", handleFrameChange);
      player.removeEventListener("seeked", handleFrameChange);
    };
  }, [durationInFrames, onFrameChange, playerRef]);

  return (
    <Player
      acknowledgeRemotionLicense
      component={LyricVideo}
      clickToPlay={false}
      compositionHeight={VIDEO_HEIGHT}
      compositionWidth={VIDEO_WIDTH}
      controls={false}
      doubleClickToFullscreen={false}
      durationInFrames={durationInFrames}
      fps={VIDEO_FPS}
      initialFrame={targetFrame}
      inputProps={{ backgroundDurationSec, backgroundUrl, project }}
      loop
      ref={playerRef}
      showPosterWhenPaused={false}
      spaceKeyToPlayOrPause={false}
      style={{
        height: "100%",
        width: "100%",
      }}
    />
  );
}
