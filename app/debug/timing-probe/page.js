import { EditorShell } from "@/components/editor-shell";
import { importProjectJson } from "@/lib/project";

const PROBE_PROJECT = importProjectJson(`{
  "version": 1,
  "meta": { "title": "Timing Drift Probe", "artist": "Codex" },
  "audio": {
    "name": "reel-clicktrack.mp3",
    "duration": 4.2,
    "startOffset": 0,
    "endOffset": 4.2
  },
  "lines": [
    { "original": "A", "translation": "", "start": 0.5 },
    { "original": "B", "translation": "", "start": 1.0 },
    { "original": "C", "translation": "", "start": 2.0 },
    { "original": "D", "translation": "", "start": 3.0166666667 }
  ],
  "style": {
    "preset": "clean",
    "font": "noto-world",
    "originalSize": 180,
    "translationSize": 44,
    "color": "#FFFFFF",
    "translationColor": "#D0D0D0",
    "verticalPosition": 0.78,
    "shadow": { "enabled": false, "blur": 8, "color": "#000000", "opacity": 0.6 },
    "outline": { "enabled": false, "width": 2, "color": "#000000" },
    "animation": { "type": "fade-slide", "durationMs": 0, "slidePx": 0 }
  },
  "background": {
    "type": "solid",
    "color": "#000000",
    "assetName": null,
    "scrim": { "enabled": false, "color": "#000000", "opacity": 0 },
    "gradient": { "from": "#000000", "to": "#000000", "angle": 0 }
  }
}`);

export default async function TimingProbePage({ searchParams }) {
  const params = await searchParams;
  const markClockMode = params?.mode === "live" ? "live" : "state";
  const autoMarkAtMs =
    typeof params?.marks === "string"
      ? params.marks
          .split(",")
          .map((value) => Number.parseFloat(value))
          .filter((value) => Number.isFinite(value) && value >= 0)
      : [];

  return (
    <EditorShell
      debugProbe={{
        autoMarkAtMs,
        audioUrl: "/reel-clicktrack.mp3",
        durationSec: 4.2,
        markClockMode,
        project: PROBE_PROJECT,
      }}
      project={PROBE_PROJECT}
    />
  );
}
