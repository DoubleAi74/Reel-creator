# Audio Scrub Bar Load Polish Implementation Guide

Date: 2026-06-30

## Recommendation on Using a Fresh Agent

A fresh agent is reasonable for this task, but not required. The issue is visually subtle and stateful, so a fresh agent can be helpful if it follows this guide carefully and verifies with screenshots instead of relying on memory from the prior Word Board work.

The important constraint is that this is a polish pass around the audio transport only. Do not refactor unrelated editor state, timing logic, preview sync, or Word Board layout.

## User-Visible Problem

The screenshots in this folder show the audio scrub bar going through several visibly different states on page refresh when a track is already uploaded:

- `1.png`: early load state. The waveform area shows a real-ish waveform plus an odd tiny thumbnail-like artifact at the far right.
- `2.png`: intermediate state. The transport shell is cleaner, but the waveform appears as faint sparse vertical lines.
- `3.png`: final state. The intended waveform is visible.

The goal is not to make audio decode faster. The goal is to stop exposing these intermediate WaveSurfer render states to the user. The scrub bar should feel deliberate: a stable loading surface first, then a clean reveal of the final waveform.

## Source Map

Primary files:

- `components/waveform-timeline.js`
  - `WaveformTimeline` starts at approximately line 125.
  - WaveSurfer is created in the effect starting around line 206.
  - Current `status` state starts around line 151.
  - WaveSurfer `ready` handler currently sets `status` to `"ready"` around line 238.
  - Transport markup starts around line 439.

- `app/globals.css`
  - Transport shell styles start around line 519.
  - `.transport-wave-wrap` starts around line 541.
  - `.transport .waveform` starts around line 548.
  - Transport control button styles continue through roughly line 674.

- `components/editor-shell.js`
  - Audio upload state starts around line 890.
  - `audioObjectUrl` starts around line 898.
  - `verifyAssetExists` is around line 261.
  - Manual upload path is around line 2975.
  - Autosave restore is around line 3254.
  - `WaveformTimeline` is rendered around line 5618.

Supporting files:

- `lib/autosave.js`
  - Autosave persists the project, audio asset descriptor, and transcription pointer.
  - It does not persist blob URLs.

- `app/api/assets/[assetId]/route.js`
  - Restored sessions stream audio from `/api/assets/:assetId`.
  - The route reads the whole asset file and returns it with `Cache-Control: no-store`.

## Current Root Cause

`WaveformTimeline` currently renders the WaveSurfer container as soon as `audioSrc` exists:

```jsx
<div ref={containerRef} />
```

The component then lets WaveSurfer paint directly into the visible scrub bar while it:

1. Fetches the uploaded/restored MP3.
2. Decodes it with the WebAudio backend.
3. Measures the container.
4. Draws one or more waveform canvases.
5. Redraws after layout/resize settles.

WaveSurfer exposes lifecycle events that can be used for this:

- `load`
- `loading`
- `decode`
- `ready`
- `redraw`
- `redrawcomplete`
- `error`

The current implementation only uses `ready` for functional readiness. It does not distinguish "audio engine can play" from "the final waveform visual is safe to reveal." That is why screenshots show multiple WaveSurfer internal render states.

Autosave restore adds another visual stage: `EditorShell` restores project metadata immediately, then verifies the audio asset exists, then sets `audioObjectUrl`. This is correct behavior, but it means the transport needs a polished "restoring/loading waveform" presentation.

## UX Target

Implement one stable visual load sequence:

1. Transport dock appears immediately at its final size.
2. Time metadata can appear immediately if known, e.g. `0.0 / 05:20`.
3. The waveform capsule shows an app-owned loading skeleton, not WaveSurfer internals.
4. WaveSurfer mounts and loads behind that skeleton with `opacity: 0`, while still occupying the real layout box.
5. After WaveSurfer emits `ready` and the waveform has drawn, crossfade from skeleton to final waveform.
6. In reduced-motion mode, swap instantly or with near-zero duration.

## Non-Goals

Do not do these in the first pass:

- Do not change playback clock behavior.
- Do not change the WebAudio backend.
- Do not change the `shouldSeekEngineToCurrentTime` or playback backpressure logic.
- Do not change Word Board behavior.
- Do not add a new dependency.
- Do not persist waveform peaks in autosave yet. That can be a second phase.
- Do not hide the entire transport dock during loading.

## Step-by-Step Implementation Plan

### 1. Confirm The Baseline

Before editing:

1. Open the three screenshots in `Current .md docs`:
   - `1.png`
   - `2.png`
   - `3.png`
2. Run the app locally.
3. Reproduce a refresh with an already uploaded/restored track.
4. Note whether the staged visual issue is visible in Chromium. If possible, also check Firefox and WebKit.

Recommended commands:

```bash
npm run lint
```

If using Playwright for screenshots, capture the transport during reload and after final ready.

### 2. Split Functional Ready From Visual Ready

In `components/waveform-timeline.js`, keep the existing `status` behavior for functional audio readiness. Do not delay `status="ready"` until visual reveal, because controls, duration sync, and current-time sync already depend on `status`.

Add separate visual state:

```js
const [waveformVisualReady, setWaveformVisualReady] = useState(!audioSrc);
const [waveformLoadPercent, setWaveformLoadPercent] = useState(0);
```

Recommended refs:

```js
const waveReadyRef = useRef(false);
const waveRedrawCompleteRef = useRef(false);
const revealFrameRef = useRef(0);
const revealTimeoutRef = useRef(0);
```

Why separate state matters:

- `status` means "the audio engine can be controlled."
- `waveformVisualReady` means "the final waveform canvas can be shown."

This avoids tying playback behavior to visual polish.

### 3. Reset Visual State On Each Audio Source

Inside the `useEffect` that creates WaveSurfer:

```js
if (!containerRef.current || !audioSrc) {
  setStatus("empty");
  setErrorMessage("");
  setWaveformVisualReady(true);
  setWaveformLoadPercent(0);
  emitPlayingChange(false);
  return undefined;
}

setStatus("loading");
setErrorMessage("");
setWaveformVisualReady(false);
setWaveformLoadPercent(0);
waveReadyRef.current = false;
waveRedrawCompleteRef.current = false;
```

On cleanup, cancel any reveal timers/frames:

```js
window.cancelAnimationFrame(revealFrameRef.current);
window.clearTimeout(revealTimeoutRef.current);
```

Guard for `window` if needed, though this component is client-only.

### 4. Add A Reveal Helper

Create a small helper inside `WaveformTimeline` or inside the WaveSurfer effect. It should reveal only after both conditions are true:

- `ready` has fired.
- `redrawcomplete` has fired.

Suggested shape:

```js
const maybeRevealWaveform = () => {
  if (!waveReadyRef.current || !waveRedrawCompleteRef.current) {
    return;
  }

  window.cancelAnimationFrame(revealFrameRef.current);
  revealFrameRef.current = window.requestAnimationFrame(() => {
    revealFrameRef.current = window.requestAnimationFrame(() => {
      setWaveformVisualReady(true);
    });
  });
};
```

The double `requestAnimationFrame` gives the browser a chance to commit WaveSurfer's canvas layout before the crossfade begins.

Also add a safety fallback after `ready`, because third-party lifecycle events can vary:

```js
revealTimeoutRef.current = window.setTimeout(() => {
  setWaveformVisualReady(true);
}, 900);
```

Clear that timeout when `redrawcomplete` reveals normally.

### 5. Wire WaveSurfer Lifecycle Events

Add these event handlers:

```js
waveSurfer.on("loading", (percent) => {
  setWaveformLoadPercent(Number.isFinite(percent) ? percent : 0);
});

waveSurfer.on("decode", () => {
  setWaveformLoadPercent((current) => Math.max(current, 85));
});

waveSurfer.on("ready", (durationInSeconds) => {
  const nextTime = clampToSection(getSectionStart(), durationInSeconds);

  waveReadyRef.current = true;
  setStatus("ready");
  setWaveformLoadPercent(100);
  lastClockFrameRef.current = getClockFrame(nextTime);
  emitDurationChange(durationInSeconds);
  emitTimeChange(nextTime);
  waveSurfer.setTime(nextTime);

  revealTimeoutRef.current = window.setTimeout(() => {
    setWaveformVisualReady(true);
  }, 900);

  maybeRevealWaveform();
});

waveSurfer.on("redrawcomplete", () => {
  waveRedrawCompleteRef.current = true;
  window.clearTimeout(revealTimeoutRef.current);
  maybeRevealWaveform();
});
```

Keep the existing `error` handler, but also reveal the layer or hide the skeleton on error so the error text is visible:

```js
setWaveformVisualReady(true);
```

### 6. Keep WaveSurfer Mounted But Hidden While Loading

Change the audio-source markup around the WaveSurfer container.

Current simplified shape:

```jsx
<div className="waveform ...">
  <div className="relative">
    <div ref={containerRef} />
    {markers...}
  </div>
</div>
```

Recommended shape:

```jsx
<div
  className={`waveform waveform-surface ${
    waveformVisualReady ? "is-wave-ready" : "is-wave-loading"
  }`}
>
  <div className="waveform-content">
    <div className="waveform-engine-layer" aria-hidden={!waveformVisualReady}>
      <div ref={containerRef} />
      {markers.length ? <MarkerLayer /> : null}
    </div>

    {!waveformVisualReady ? (
      <WaveformSkeleton
        currentPercent={sectionDuration > 0 ? currentSectionTime / sectionDuration : 0}
        loadPercent={waveformLoadPercent}
        markerPercents={markers.map(...)}
      />
    ) : null}
  </div>
</div>
```

The important details:

- The `containerRef` must stay mounted while loading.
- The WaveSurfer layer must have width and height.
- Do not use `display: none` on the WaveSurfer layer.
- Use opacity and pointer-events.

### 7. Extract Marker Rendering To Avoid Duplication

The marker layer currently lives inline around line 451. Since the skeleton may also need faint markers, consider extracting:

```js
function WaveformMarkers({ activeLineId, audio, heardLine, markers, muted = false }) {
  ...
}
```

For skeleton markers:

- Use lower opacity.
- Keep `pointer-events: none`.
- Do not make active/heard markers too bright until the real waveform is ready.

If this feels too large, keep real markers only on the engine layer and skip skeleton markers for the first pass.

### 8. Add A Skeleton Component

Add a small local component in `components/waveform-timeline.js`:

```js
function WaveformSkeleton({ currentPercent = 0, loadPercent = 0 }) {
  return (
    <div className="waveform-skeleton" aria-hidden="true">
      <div className="waveform-skeleton-bars">
        {Array.from({ length: 112 }).map((_, index) => {
          const amplitude =
            0.28 +
            ((Math.sin(index * 0.47) + Math.sin(index * 0.19 + 1.8) + 2) / 4) *
              0.72;

          return (
            <span
              className="waveform-skeleton-bar"
              key={index}
              style={{ "--bar-h": `${Math.max(8, Math.round(42 * amplitude))}px` }}
            />
          );
        })}
      </div>
      <span
        className="waveform-skeleton-load"
        style={{ width: `${Math.max(8, Math.min(100, loadPercent))}%` }}
      />
      <span
        className="waveform-skeleton-cursor"
        style={{ left: `${Math.max(0, Math.min(100, currentPercent * 100))}%` }}
      />
    </div>
  );
}
```

Notes:

- The skeleton should be deterministic. Do not use `Math.random()`, because it can cause hydration or visual instability.
- Keep the skeleton bars visually related to the final bars: rounded, muted, dense enough to look intentional.
- The load overlay should be subtle. Avoid a loud progress bar.

### 9. Add CSS For Crossfade And Stable Dimensions

In `app/globals.css`, extend the transport styles near `.transport .waveform`.

Suggested CSS:

```css
.transport .waveform-surface {
  position: relative;
}

.waveform-content {
  position: relative;
  height: 100%;
  min-height: 0;
}

.waveform-engine-layer,
.waveform-skeleton {
  position: absolute;
  inset: 0;
}

.waveform-engine-layer {
  opacity: 1;
  transition: opacity 160ms ease;
}

.waveform-surface.is-wave-loading .waveform-engine-layer {
  opacity: 0;
  pointer-events: none;
}

.waveform-surface.is-wave-ready .waveform-engine-layer {
  opacity: 1;
}

.waveform-skeleton {
  display: flex;
  align-items: center;
  padding: 0;
  opacity: 1;
  transition: opacity 160ms ease;
}

.waveform-surface.is-wave-ready .waveform-skeleton {
  opacity: 0;
  pointer-events: none;
}

.waveform-skeleton-bars {
  display: flex;
  align-items: center;
  gap: 3px;
  width: 100%;
  height: 100%;
}

.waveform-skeleton-bar {
  flex: 1 1 0;
  height: var(--bar-h);
  min-width: 2px;
  border-radius: 999px;
  background: rgba(99, 91, 77, 0.18);
}

.waveform-skeleton-cursor {
  position: absolute;
  inset-block: 0;
  width: 2px;
  transform: translateX(-50%);
  border-radius: 999px;
  background: var(--accent);
}

.waveform-skeleton-load {
  position: absolute;
  inset-block: 0;
  left: 0;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    rgba(44, 155, 63, 0.06),
    rgba(44, 155, 63, 0.02)
  );
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .waveform-engine-layer,
  .waveform-skeleton {
    transition: none;
  }
}
```

Adjust selectors to match final markup. Keep CSS scoped under transport/waveform names to avoid affecting Word Board.

### 10. Avoid Interaction During Visual Loading

Functional `status` may become `"ready"` before `waveformVisualReady`. Decide whether scrub interactions should be available during the brief crossfade gap.

Recommended first pass:

- Disable waveform interaction until visual ready by adding `pointer-events: none` to `.waveform-engine-layer` while loading.
- Keep transport buttons disabled based on existing `isReady`, not visual readiness.

This means keyboard/button playback may become ready as soon as the engine is ready, but the user cannot click the hidden waveform layer while the skeleton is still covering it.

If this split feels odd in testing, use:

```js
const canUseTransport = isReady && waveformVisualReady;
```

But be careful: delaying controls may make the app feel slower. The preferred approach is visual-only gating.

### 11. Improve Autosave Restore Presentation

This is optional but recommended.

In `components/editor-shell.js`, when `restored.audioAsset?.assetId` exists, set an optimistic restoring state before `verifyAssetExists`:

```js
setAudioUpload({
  asset: { ...restored.audioAsset, kind: "audio" },
  message: `Restoring ${restored.audioAsset.name || "audio"} from your last session...`,
  status: "uploading",
});
```

Then keep the existing success path after `assetExists`.

Why:

- The upload card should not briefly imply "idle" while a known saved track is being checked.
- The transport skeleton and upload card will tell the same story: the saved audio is being restored.

Do not set `audioObjectUrl` before `verifyAssetExists` unless you also handle 404s cleanly in `WaveformTimeline`. The current verification-first path is safer.

### 12. Keep Existing Empty-State Waveform

The no-audio branch already renders a placeholder waveform. Do not remove it.

But after adding `WaveformSkeleton`, consider reusing it for the no-audio placeholder so the app has one visual language:

- Empty: static muted skeleton, no loading progress.
- Loading/restoring: skeleton with subtle load wash.
- Ready: real WaveSurfer waveform.

This reuse is optional. Avoid making the first patch too broad.

### 13. Testing And Verification

Minimum:

```bash
npm run lint
```

Manual visual checks:

1. Upload an MP3.
2. Refresh the page.
3. Confirm the transport dock appears at the same dimensions immediately.
4. Confirm the scrub bar shows one stable loading skeleton.
5. Confirm no WaveSurfer intermediate canvases are visible.
6. Confirm the real waveform crossfades in once.
7. Confirm Play/Rewind/-2s/+2s still work after ready.
8. Confirm clicking/scrubbing the waveform works after ready.
9. Confirm the error message appears if the restored audio asset is unavailable.

Cross-browser:

- Chromium
- Firefox
- WebKit

Playwright geometry checks:

- Capture `.transport .waveform` bounding box during loading and after ready.
- Assert width and height are unchanged.
- Capture screenshots before and after reveal.

Suggested selectors:

- `.transport`
- `.transport .waveform`
- `.waveform-engine-layer`
- `.waveform-skeleton`
- `.waveform-surface.is-wave-ready`
- `.waveform-surface.is-wave-loading`

### 14. Optional Slow-Load Test Harness

If the issue is too fast to see locally, create a temporary test-only delay around asset fetch. Do not commit this delay.

Options:

1. Use Playwright route interception to delay `/api/assets/*`.
2. Add a temporary local `await new Promise((resolve) => setTimeout(resolve, 1200));` inside `app/api/assets/[assetId]/route.js`, then remove before final.

Prefer Playwright route interception.

Example Playwright idea:

```js
await page.route("**/api/assets/**", async (route) => {
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await route.continue();
});
```

### 15. Risks To Watch

- If the WaveSurfer layer is `display: none`, it may measure width as `0` and render incorrectly. Use opacity only.
- If `status` is delayed until `redrawcomplete`, duration/current-time sync may feel late. Keep visual readiness separate.
- If the skeleton uses random heights, it may shimmer or change between renders. Use deterministic math.
- If marker layers are duplicated incorrectly, users may see double green lines after reveal.
- If cleanup misses a timeout or animation frame, a destroyed WaveSurfer instance could reveal a stale layer after switching tracks.
- If CSS selectors are too broad, the no-audio placeholder or mobile layout may be affected.

### 16. Suggested Acceptance Criteria

The implementation is acceptable when:

- On refresh with a restored MP3, the transport waveform area never shows the `1.png` or `2.png` intermediate appearances.
- The transport dock does not shift size while audio loads.
- The user sees a stable skeleton followed by one clean reveal of the final waveform.
- No playback/timing regressions occur.
- `npm run lint` passes.
- Chromium, Firefox, and WebKit show consistent loading and ready states.

## Phase Two Option: Persist Peaks

After the phase-one visual polish is approved and stable, consider a separate optimization:

1. After WaveSurfer decodes successfully, call `waveSurfer.exportPeaks({ channels: 1, maxLength: 1000, precision: 3 })`.
2. Store compact peaks in autosave next to the audio asset descriptor.
3. On restore, pass `peaks` and `duration` into WaveSurfer so the final waveform can render before full decode.

Do not implement this in the first pass unless explicitly approved. It changes autosave size and shape, and it needs storage-size testing.

## Open Questions For Approval

These are not blockers for phase one, but confirm if possible:

1. Should the loading skeleton animate subtly, or should it be completely static?
2. Should transport buttons become active as soon as audio is engine-ready, or only after the waveform visual reveal?
3. Should the upload card show `RESTORING` during autosave recovery, or keep the current `SUCCESS` after verification only?
4. Should skeleton lyric markers be shown faintly, or should markers appear only with the final waveform?

Recommended defaults:

- Static or very subtle skeleton.
- Buttons active when engine-ready.
- Add a restoring upload state.
- Skip skeleton markers in the first pass unless the UI feels too empty.
