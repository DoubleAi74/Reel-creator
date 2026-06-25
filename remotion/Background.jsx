import {
  AbsoluteFill,
  Html5Video,
  Img,
  OffthreadVideo,
  Sequence,
  useRemotionEnvironment,
  useVideoConfig,
} from "remotion";

function gradientBackgroundStyle(background) {
  const angle = background.gradient?.angle ?? 160;
  const from = background.gradient?.from ?? "#1a1a2e";
  const to = background.gradient?.to ?? "#0f0c29";

  return {
    backgroundImage: `linear-gradient(${angle}deg, ${from}, ${to})`,
  };
}

function LoopingVideoBackground({ backgroundDurationSec, backgroundUrl }) {
  const environment = useRemotionEnvironment();
  const { durationInFrames, fps } = useVideoConfig();
  const backgroundDurationInFrames =
    Number.isFinite(backgroundDurationSec) && backgroundDurationSec > 0
      ? Math.max(1, Math.round(backgroundDurationSec * fps))
      : null;
  const videoStyle = {
    inset: 0,
    height: "100%",
    objectFit: "cover",
    position: "absolute",
    width: "100%",
  };
  const segmentCount = backgroundDurationInFrames
    ? Math.max(1, Math.ceil(durationInFrames / backgroundDurationInFrames))
    : 1;

  return Array.from({ length: segmentCount }, (_, index) => {
    const from = backgroundDurationInFrames ? index * backgroundDurationInFrames : 0;
    const segmentDuration = backgroundDurationInFrames
      ? Math.min(backgroundDurationInFrames, durationInFrames - from)
      : durationInFrames;
    const commonProps = {
      endAt: segmentDuration,
      muted: true,
      pauseWhenBuffering: false,
      src: backgroundUrl,
      style: videoStyle,
      volume: 0,
    };

    return (
      <Sequence durationInFrames={segmentDuration} from={from} key={from} layout="none">
        {environment.isRendering ? (
          <OffthreadVideo {...commonProps} />
        ) : (
          <Html5Video {...commonProps} playsInline />
        )}
      </Sequence>
    );
  });
}

function renderBackgroundFill(background, backgroundDurationSec, backgroundUrl) {
  if (background?.type === "image" && backgroundUrl) {
    return (
      <Img
        src={backgroundUrl}
        style={{
          height: "100%",
          objectFit: "cover",
          width: "100%",
        }}
      />
    );
  }

  if (background?.type === "video" && backgroundUrl) {
    return (
      <LoopingVideoBackground
        backgroundDurationSec={backgroundDurationSec}
        backgroundUrl={backgroundUrl}
      />
    );
  }

  const style =
    background?.type === "solid"
      ? { backgroundColor: background.color ?? "#101018" }
      : gradientBackgroundStyle(background ?? {});

  return <AbsoluteFill style={style} />;
}

export function Background({
  background,
  backgroundDurationSec = null,
  backgroundUrl = null,
}) {
  const scrimEnabled = background?.scrim?.enabled ?? true;
  const scrimOpacity = background?.scrim?.opacity ?? 0.4;
  const scrimColor = background?.scrim?.color ?? "#000000";
  const showMediaScrim =
    (background?.type === "image" || background?.type === "video") &&
    backgroundUrl &&
    scrimEnabled &&
    scrimOpacity > 0;

  return (
    <AbsoluteFill>
      {renderBackgroundFill(background, backgroundDurationSec, backgroundUrl)}
      {showMediaScrim ? (
        <AbsoluteFill
          style={{
            backgroundColor: scrimColor,
            opacity: scrimOpacity,
          }}
        />
      ) : null}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at top, rgba(251, 191, 36, 0.15), transparent 28%)",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(5, 10, 18, 0.1) 0%, rgba(5, 10, 18, 0.5) 100%)",
        }}
      />
    </AbsoluteFill>
  );
}
