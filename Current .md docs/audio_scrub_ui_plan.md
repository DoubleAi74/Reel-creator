# Audio scrub & transport — UI update plan

A fresh coding agent should read this whole file, then acquire its own context
from the codebase before changing anything. Confirm each root cause against the
source rather than trusting line numbers (they drift).

## What this covers

The bottom "audio scrub" dock: the waveform, the transport buttons, the time
readout, and their playback behaviour. It is **one persistent component rendered
once for every tab.**

### Where the code lives

- **Component:** `components/waveform-timeline.js` — waveform strip (WaveSurfer.js),
  transport buttons (Rewind / Play-Pause / −2s / +2s / Mark), and the time readout.
- **Mounted at:** `components/editor-shell.js` (~line 5809) as `<WaveformTimeline …>`.
  Props: `audio`, `audioSrc`, `currentTime`, `isPlaying`, `isTimingActive`, `lines`,
  `activeLineId`, `onDurationChange`, `onMark`, `onPlayingChange`, `onTimeChange`.
- **Styles:** `app/globals.css`, the `.transport*` / `.waveform*` block (~519–758)
  and the mobile `@media` blocks (~765+, ~882+, ~926+). The desktop row is assembled
  with `display: contents` on `.transport-controls` plus CSS `order` on the children
  of `.transport-inner` (so buttons, time, and waveform are siblings in one flex row).
- **Engine:** `WaveSurfer.create({ … })` (~line 305): `height: 64`, `barWidth: 4`,
  `barGap: 3`, `barRadius: 999`, `normalize: true`, `dragToSeek: true`, green
  cursor/progress, brownish `waveColor`.
- **Time-sync model:** `lib/waveform-sync.js` plus the rAF clock and the
  `emitTimeChange` / `emitTimeAtFrame` helpers (~lines 220–253) and the WaveSurfer
  event handlers (~lines 377–407).

> ⚠️ **Read the comments in `lib/waveform-sync.js` and around the rAF clock before
> touching playback.** The frame-coalescing + backpressure there is deliberate — it
> prevents a render storm ("Maximum update depth exceeded") on the heavy editor.
> Do not remove or loosen it. The only playback-behaviour change in this plan is the
> one-shot pause sync (item 4).

---

## Changes

### 1. Time readout — stop the layout shift, and give it a shaded chip
**Problem:** as the current time ticks (e.g. `9.0` → `10.0`, or crossing 60s) the
time box changes width and pushes the rest of the row, visibly shoving the waveform
to the right. The time should be independent of everything else's width. The format
also mixes units: current time in tenths (`0.0`) vs total in `mm:ss` (`05:20`).
**Root cause:** `.transport-time` is `flex: 0 0 auto` with no reserved width and
ordinary (proportional) digits, so any digit-width change reflows its neighbours in
the `display:contents` flex row (globals.css ~725; JSX ~719–727; `formatTenths` /
`formatTime` in the component ~lines 25–41).
**Goal:**
- Width-stable time: `font-variant-numeric: tabular-nums` **and** a fixed min-width
  sized to the longest possible string, so digit changes never move neighbours.
- One consistent format on both sides (e.g. `M:SS.t / M:SS`).
- Present it inside a small shaded chip consistent with the buttons (surface
  background, 1px border, pill radius, matching height rhythm).

### 2. Replace −2s / +2s with "jump to previous / next lyric"
**Goal:** remove the two ±2s step buttons and add buttons that seek the playhead to
the **previous** and **next** timed-lyric start relative to the current time.
**Pointers:** ±2s buttons live at JSX ~683–702 (CSS `.step-button` ~738). Timed
markers are already derived as `markers` / `getTimedLines(lines)` (~line 554).
- Previous = the largest `line.start` strictly `< currentTime`.
- Next = the smallest `line.start` strictly `> currentTime`.
- Clamp to the section and seek via the existing `jumpTo(time)`.
- Disable each button when there is no lyric in that direction.

### 3. Add a 0.5× speed toggle
**Goal:** a button that toggles playback between 1× and 0.5×, via
`waveSurfer.setPlaybackRate(rate, /* preservePitch */ true)` so the pitch is not
lowered. Track the rate in local state, reflect the active state on the button
(`aria-pressed`), and decide whether to reset to 1× when new audio loads. The frame
clock reads engine time, so half-rate playback needs no clock changes — verify.

### 4. Fix the time jumping backward on pause (then forward on play) — behavioural bug
**Problem:** pausing shows a time *earlier* than where the audio actually stopped;
pressing play then snaps forward. Pausing should freeze at the true current time.
**Root cause (confirmed in source):** during playback only the rAF clock publishes
time, and it is frame-gated + backpressure-gated (`shouldPublishPlaybackFrame` in
`lib/waveform-sync.js`), so the parent's `currentAudioTime` legitimately lags the
engine clock. The `pause` handler (component ~lines 397–399) emits only the
play-state (`emitPlayingChange(false)`) and never the engine's real position — so
the displayed time stays at the last lagged frame (backward jump). On play, the
engine resumes from its true position and frames catch up (forward jump).
**Fix:** in the `pause` handler also publish the engine's exact position, e.g.
`emitTimeChange(clampTimeToSection(waveSurfer.getCurrentTime(), audio))`. Use the
**ungated** `emitTimeChange` (it records into `emittedTimes`, so the controlled-sync
effect treats the value as an echo and does **not** re-seek — verify against
`shouldSeekEngineToCurrentTime`). Keep all existing coalescing/backpressure intact.

### 5. Waveform vertical alignment & sizing
**Problem:** the waveform looks too wide and sits below the vertical centre / is not
symmetric.
**Likely levers (verify at runtime):** container `.transport .waveform` is `height:
63px` while WaveSurfer renders at `height: 64` (1px mismatch → bottom clip / downward
offset); the engine layer is `position:absolute; inset:0` but the WaveSurfer canvas
may top-align rather than centre; `barWidth: 4` / `barGap: 3` may read as too wide.
(globals.css ~548–589; engine options ~305–320.)
**Goal:** waveform vertically centred and symmetric within its track, with balanced
bar width/gap and matched container/engine heights (no clip, no downward shift). Aim
for a clean, professional look.

### 6. Lyric markers — clear, professional contrast against the waveform
**Problem:** markers are thin 2px lines in `--surface-2`, so they blend into the
waveform bars. The "heard" vs idle states are also identical today — a dead branch at
JSX ~603–609 resolves both to `--surface-2`.
**Goal:** redesign markers so they read clearly but stay clean — a treatment distinct
from the waveform palette (e.g. a crisp full-height hairline in a contrasting colour
with a small top cap/flag, or a subtle translucent band), with **three distinct
states**: idle / heard (currently playing) / active (selected). Fix the dead branch so
heard ≠ idle. Markers should remain non-interactive for click-through seeking unless
item-list "optional" hover is added (see below). (JSX ~586–614.)

### 7. Cleaner arrangement + accessibility + button states
- **Re-group** the controls now that ±2s is gone. Recommended order (tune to taste):
  primary transport cluster `[Rewind · Prev-lyric · Play/Pause · Next-lyric]`, then
  the **0.5× toggle**, then the **time chip**, then **Mark** (timing tab only), with
  the waveform filling the remaining width. Use the existing `order`-based scheme;
  keep consistent heights, radii, and spacing.
- **Accessibility:** every icon-only button (Play/Pause, Rewind, Prev/Next lyric,
  speed, Mark) gets an `aria-label`; Play/Pause and speed get `aria-pressed`. (Today
  the mobile Play button has no accessible name.)
- **Decoding state:** while `!isReady`, make Play visually distinct from idle (dim or
  spinner) so "not ready yet" is obvious.
- **Breakpoints:** keep the layout coherent on mobile. Today Rewind is hidden on small
  screens and the ±2s buttons were asymmetric (−2s hidden, +2s shown); ensure the new
  transport/nav buttons are shown/adapted consistently. (mobile CSS ~765+, ~882+,
  ~926+.)

---

## Optional enhancements (include if low-risk / time permits)

These were raised as ideas; treat as stretch, not required:
- Hover-over-waveform tooltip showing the target time (drag-to-seek already exists).
- Zoom + horizontal scroll for long tracks, keeping the playhead in view.
- A–B / per-section loop.
- Spacebar play-pause and ←/→ seek hotkeys (no transport hotkey exists today; the
  current hotkeys are timing-mode only — wire carefully so they don't fire while
  typing in inputs).
- Volume / mute control.

---

## Workflow

1. Read `components/waveform-timeline.js` end-to-end and the `lib/waveform-sync.js`
   comments **before** touching playback.
2. Reproduce each issue and confirm the root cause from source.
3. Plan each change as CSS-only vs component vs engine; keep edits minimal and
   matched to the existing design tokens and style.
4. Implement.
5. **Verify:** run `npm run lint` and `npx vitest run` (esp. `lib/waveform-sync.test.js`
   and the timing tests). Then manually confirm: play→pause leaves the time exactly
   where it stopped (no backward/forward jump); prev/next-lyric land on lyric starts;
   0.5× preserves pitch; the time never reflows the row as it ticks; markers are
   legible against the waveform; the waveform is vertically centred and symmetric.
   Check Chrome, Firefox, and Safari (this dock had cross-browser issues elsewhere).

## Constraints

- **Preserve the playback-sync architecture** (frame coalescing + backpressure). The
  only playback-behaviour change is the pause-time sync (item 4).
- Don't regress mobile / narrow layouts.
- Keep the established visual language (rounded pills, `--surface` / `--accent`
  tokens, soft shadows).
- This dock is global across all tabs — verify the Timing tab too (Mark button
  visible) as well as the others.
- Summarise what changed and why when finished.
