import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import {
  findActiveLine,
  getLineStartFrame,
  getSectionBounds,
  normalizeLyricLeadInMs,
} from "@/lib/timing";
import { TEXT_LAYER_CHROMA_COLOR } from "@/lib/render/formats";
import { Background } from "@/remotion/Background";
import { Line } from "@/remotion/Line";

export function LyricVideo({
  audioUrl = null,
  audioPrimingCompensationFrames = 0,
  backgroundDurationSec = null,
  backgroundUrl = null,
  project,
  textLayerMode = null,
  transparent = false,
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const isChromaTextLayer = transparent && textLayerMode === "chroma";
  const sectionBounds = getSectionBounds(project.audio);
  const lyricLeadInMs = normalizeLyricLeadInMs(project.timing?.lyricLeadInMs);
  const timelineTime = project.audio.startOffset + frame / fps;
  const activeLine = findActiveLine(project.lines, timelineTime, project.audio, {
    lyricLeadInMs,
  });
  const lineStartFrame = getLineStartFrame(activeLine, project.audio, fps, {
    lyricLeadInMs,
  });
  const animationDurationFrames = Math.max(
    0,
    Math.round(((project.style.animation?.durationMs ?? 350) / 1000) * fps),
  );
  const animationProgress =
    !activeLine || animationDurationFrames === 0
      ? activeLine
        ? 1
        : 0
      : interpolate(
          // Sample from the end of the current frame so a newly active line is visible immediately.
          frame + 1,
          [lineStartFrame, lineStartFrame + animationDurationFrames],
          [0, 1],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          },
        );

  return (
    <AbsoluteFill
      style={{
        overflow: "hidden",
        backgroundColor: isChromaTextLayer
          ? TEXT_LAYER_CHROMA_COLOR
          : transparent
            ? "transparent"
            : (project.background?.color ?? "#101018"),
      }}
    >
      {audioUrl && !transparent ? (
        <Sequence
          from={0 - audioPrimingCompensationFrames}
          layout="none"
        >
          <Audio
            endAt={
              project.audio.endOffset == null
                ? undefined
                : Math.round(sectionBounds.endOffset * fps)
            }
            src={audioUrl}
            startFrom={Math.round(sectionBounds.startOffset * fps)}
          />
        </Sequence>
      ) : null}
      {transparent ? null : (
        <>
          <Background
            background={project.background}
            backgroundDurationSec={backgroundDurationSec}
            backgroundUrl={backgroundUrl}
          />
          <AbsoluteFill
            style={{
              background:
                "linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0%, rgba(255, 255, 255, 0) 24%, rgba(0, 0, 0, 0.2) 100%)",
            }}
          />
        </>
      )}
      <Line
        animationProgress={animationProgress}
        line={activeLine}
        styleConfig={project.style}
      />
    </AbsoluteFill>
  );
}
