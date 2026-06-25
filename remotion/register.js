import "@fontsource/noto-sans/400.css";
import "@fontsource/noto-sans/500.css";
import "@fontsource/noto-sans/700.css";
import "@fontsource/noto-sans-devanagari/400.css";
import "@fontsource/noto-sans-devanagari/500.css";
import "@fontsource/noto-sans-devanagari/700.css";
import "@fontsource/noto-sans-arabic/400.css";
import "@fontsource/noto-sans-arabic/500.css";
import "@fontsource/noto-sans-jp/400.css";
import "@fontsource/noto-sans-jp/500.css";
import "@fontsource/noto-sans-kr/400.css";
import "@fontsource/noto-sans-kr/500.css";
import { Composition, registerRoot } from "remotion";

import { createDefaultProject } from "@/lib/project";
import { getSectionDurationInFrames } from "@/lib/timing";
import {
  REMOTION_COMPOSITION_ID,
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
} from "@/remotion/constants";
import { LyricVideo } from "@/remotion/LyricVideo";

const defaultProps = {
  audioUrl: null,
  backgroundDurationSec: null,
  backgroundUrl: null,
  project: createDefaultProject({
    lines: [
      {
        id: "placeholder-line",
        original: "Placeholder line",
        start: 0,
        translation: "Preview placeholder",
      },
    ],
  }),
};

function RemotionRoot() {
  return (
    <Composition
      calculateMetadata={({ props }) => ({
        durationInFrames: getSectionDurationInFrames(props.project?.audio, VIDEO_FPS),
      })}
      component={LyricVideo}
      defaultProps={defaultProps}
      durationInFrames={VIDEO_FPS}
      fps={VIDEO_FPS}
      height={VIDEO_HEIGHT}
      id={REMOTION_COMPOSITION_ID}
      width={VIDEO_WIDTH}
    />
  );
}

registerRoot(RemotionRoot);
