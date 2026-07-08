# Implementation Plan: Cleaner Mobile Audio-Scrub Waveform

**Status:** Ready for a fresh implementation agent.
**Goal:** Reduce visual noise in the transport waveform (the audio scrubber) so the lyric marks read clearly against a calmer background, while keeping the scrubber fully functional. This is a **visual/styling change only** — no timing, seeking, or data changes.

**Scope — do exactly these things:**
1. Switch the WaveSurfer waveform from **vertical bars** to a **continuous filled silhouette**.
2. **Calm it down** — reduce amplitude and lower contrast so the waveform is a soft band, not a loud graphic.
3. **Shorten the waveform** to about **1/3 of the scrub-bar height, vertically centered** (empty space above and below it).
4. **Lyric marks span above and below the waveform** — the mark **lines** are taller than the now-short, centered waveform and centered on the bar, so each mark extends above and below the silhouette. (Still NOT full-height hairlines of the whole bar.)
5. **Cap dot only for active/heard** marks — hide the dot on idle marks.
6. **De-emphasize idle contrast** — make idle marks fainter than the active/heard marks.

**Explicitly OUT of scope (do NOT do):** collision culling/merging of markers; a separate marker "rail/lane"; any zoom / pinch / sliding-window / horizontal-expansion feature; any change to seeking, the audio clock, marker time positions, peaks caching, or the timing/marking engine. Do not restructure the component. Config values + CSS only.

---

## 1. Context to read first (do this before editing)

Read these so you understand the current structure and the one library fact that makes step 1 work.

- **`components/waveform-timeline.js`** — the transport + waveform React component.
  - The **WaveSurfer config** you will edit: `WaveSurfer.create({ ... })` at **lines 340–365** (`barGap:2, barRadius:999, barWidth:2, waveColor, progressColor, normalize`, etc.).
  - The **lyric-marker render** (context only — you likely will NOT change JSX here): **lines 709–737**. Each marker renders a `<span className="waveform-marker-cap" />` + `<span className="waveform-marker-line" />` inside a `.waveform-marker.waveform-marker--{state}` div, where `state` is `active | heard | idle` (computed lines 714–721). Horizontal position is `left: ${getMarkerLeftPercent(line.start, audio)}%` (line 722, 729) — **leave this untouched.**
- **`app/globals.css`** — the waveform + marker styling you will edit.
  - **Waveform internals** (`.transport .waveform*`), all-width/unlayered: **lines 502–597**. The two rules that control the waveform's on-screen height/centering are `.transport .waveform-engine-layer` (`position:absolute; inset:0; display:flex; align-items:center`, ~lines 533–538) and `.transport .waveform-canvas` (the WaveSurfer container, `height:100%`, ~lines 542–547) — these are what you constrain for step 3.
  - **Lyric marker rules** (`.transport .waveform-marker*`), all-width/unlayered: **lines 599–662** — this is the main block for steps 4–6.
  - **Skeleton** (loading placeholder bars, `.waveform-skeleton*`): **lines 558–597** — optional note in §6.
- **Verified library fact (WaveSurfer v7.12.7, already installed):** the renderer draws bars **only** when `barWidth`, `barGap`, or `barAlign` is truthy — `shouldRenderBars = Boolean(options.barWidth || options.barGap || options.barAlign)` (`node_modules/wavesurfer.js/dist/renderer-utils.js:118`). Otherwise it calls `renderLineWaveform` = a continuous filled silhouette. **This is why step 1 must remove `barGap` too, not just `barWidth`.** Also verified: `barHeight` scales the waveform amplitude even when `normalize:true` (`calculateVerticalScale` in the same file) — that's your amplitude lever for step 2.

**Note on breakpoint scope:** the `WaveSurfer.create` config and the `.transport .waveform*` / `.waveform-marker*` CSS are **shared across all widths** (there is a single WaveSurfer instance; the marker rules are not inside a media query). So every change below applies to **both mobile and desktop**. That is intended and fine (a calmer waveform + cleaner marks improve desktop too). You must still **verify desktop did not regress** (§5). Do not attempt to make the waveform bars-vs-fill differ per breakpoint — that would require a second config/re-render and is out of scope.

---

## 2. Guardrails (must hold)

- **Do not touch** any of: the audio clock / time publishing (the `interaction`, `timeupdate`, `seeking`, `decode`, `ready` handlers ~lines 431–475), `dragToSeek`, `getMarkerLeftPercent`, marker **state** computation, `createWaveformPeaksCache` / `getWaveformPeaksForWaveSurfer`, or the `peaks`/`duration` cache spread in the config.
- **Marker positions and interactivity are unchanged** — clicks still fall through to seek (`pointer-events-none` on the marker overlay stays).
- Keep the change **minimal**: edit config option values in `waveform-timeline.js` and rules in `globals.css`. No JSX/structure changes are required (idle cap is hidden via CSS, not by removing the span).
- Final colour/opacity/size numbers below are **starting points with ranges** — they are a visual judgement call. Tune by eye against the goal ("calm band + crisp marks"), staying within the given ranges unless you have a reason.

---

## 3. Step-by-step tasks

### Task 1 — Bars → continuous filled silhouette
File: `components/waveform-timeline.js`, in `WaveSurfer.create({ ... })` (lines 340–365).

- **Remove** the three bar options so the renderer switches to the filled line waveform:
  - delete `barGap: 2,` (line 346)
  - delete `barRadius: 999,` (line 347)
  - delete `barWidth: 2,` (line 348)
- Leave `normalize: true`, `cursorColor`, `dragToSeek`, `height: "auto"`, `waveColor`, `progressColor`, `backend`, `container`, `url`, and the cached `{ duration, peaks }` spread exactly as they are (you will tweak two colours in Task 2).
- **Why:** with none of `barWidth/barGap/barAlign` set, `shouldRenderBars` is false → `renderLineWaveform` draws one continuous filled shape. `waveColor` fills the unplayed silhouette; `progressColor` fills the played portion; the cursor still marks the playhead.
- **Check:** after this change the waveform is a smooth filled band (no picket-fence). If it still shows bars, you left one of `barGap`/`barWidth`/`barAlign` in.

### Task 2 — Calm it down (amplitude + contrast)
File: `components/waveform-timeline.js`, same config object.

- **Reduce amplitude:** add `barHeight: 0.7,` to the config (this key scales the waveform height in filled mode too — verified). Starting point `0.7`; acceptable range **0.6–0.85**. Lower = flatter/calmer.
- **Soften the unplayed fill:** change `waveColor: "rgba(99, 91, 77, 0.32)"` → lower alpha, e.g. `"rgba(99, 91, 77, 0.22)"`. Range **0.18–0.28**.
- **(Optional) soften the played fill:** change `progressColor: "rgba(44, 155, 63, 0.85)"` → e.g. `"rgba(44, 155, 63, 0.72)"` so the green band isn't louder than the active lyric mark. Range **0.65–0.85**. Keep it clearly green.
- **Do NOT** set `normalize: false` (that can make quiet tracks nearly invisible). `barHeight` is the correct amplitude control.
- **Do NOT** add a centre baseline line — with a continuous fill the centre is already solid, so a baseline is redundant.
- **Check:** the waveform now reads as a soft, low-contrast band; the green played portion and the green playhead are still clearly visible.

### Task 3 — Shorten the waveform to ~1/3 height, centered
File: `app/globals.css`, waveform internals (~lines 502–547).

The waveform currently fills the whole scrub-bar height: `.transport .waveform-engine-layer` is `position:absolute; inset:0; display:flex; align-items:center` (~lines 533–538) and `.transport .waveform-canvas` (the WaveSurfer container) is `height: 100%` (~lines 542–547). WaveSurfer's `height:"auto"` fills whatever height that container has.

- **Constrain the WaveSurfer container to ~1/3 of the bar, centered:** change `.transport .waveform-canvas` `height: 100%` → `height: 34%;` (≈1/3; range **30–38%**). The engine-layer's `align-items: center` keeps it vertically centered, so the silhouette sits in the middle third with empty space above and below.
- Because WaveSurfer is configured with `height: "auto"` (it reads its container's pixel height), shrinking the container shrinks the rendered waveform automatically and it stays centered — and it adapts to whatever the scrub-bar height is (desktop ~63px → ~21px waveform; mobile ~40px → ~13px). **Do NOT change the `height:"auto"` config option.**
- **Fallback (only if needed):** if in the browser WaveSurfer does not pick up the percentage (renders full-height or collapses to 0), give the container a definite height another way — e.g. wrap intent aside, set a fixed numeric `height` (~20) in the `WaveSurfer.create` config and center via the existing `align-items:center`. Prefer the percentage so it stays responsive; only fall back if the percentage visibly fails.
- This also shrinks the empty no-audio `.waveform-canvas` fallback (harmless) and does not change the loading skeleton (see §6).
- **Check:** the filled waveform now occupies roughly the centre third of the scrub bar, vertically centered, with clear empty space above and below it.

### Task 4 — Lyric marks span above and below the waveform
File: `app/globals.css`, marker block (lines 599–662).

Now that the waveform is a short centered band, make the marker **lines** taller than it and centered on the bar, so each mark brackets the waveform (extends above and below it) — but still NOT the full height of the whole bar.

- **Base line geometry** — edit `.transport .waveform-marker-line` (lines 613–621): replace `top: 7px;` and `bottom: 5px;` with a centered, taller-than-waveform span, e.g. `top: 20%;` `bottom: 20%;` (the line then covers the middle ~60% of the bar, centered). Since the waveform covers ~34% centered (≈33%–67% of the bar), a 20%–80% line clearly extends above and below it. Tune the `20%` by eye (range **12–24%**; smaller % = taller marks). This applies to all marks — idle, heard, active share this base rule.
- **Cap position** — the cap dot currently sits at the very top of the bar (`.transport .waveform-marker-cap`, `top: 1px`, lines 623–632). Move it to sit at the **top of the marker line** (just above the waveform) so it caps the centered mark: change `top: 1px` → about `top: calc(20% - 3px);` (aligns the ~5–7px dot's centre to the line's top edge at 20%; match this to whatever line `top` you chose). Keep the cap's width/height/`border-radius`/`box-shadow`. (Only active/heard show the cap — Task 5.)
- **Check:** every mark is a thin vertical line centered on the bar, taller than the waveform, extending above and below it; the active/heard marks carry a dot at the top of their line.

### Task 5 — Cap dot only for active/heard
File: `app/globals.css`, marker block.

- In `.transport .waveform-marker--idle .waveform-marker-cap` (currently lines 638–640, which sets `background`), **hide the dot**: set `display: none;` (you can drop the now-unused `background` line, or leave it — `display:none` wins).
- Leave the `--heard` cap (lines 647–651) and `--active` cap (lines 658–662) as they are — those dots stay.
- **Note:** the JSX still renders the cap `<span>` for every marker (line 731); hiding idle via CSS is intentional and keeps the render uniform — do **not** change the JSX to conditionally omit it.

### Task 6 — De-emphasize idle contrast
File: `app/globals.css`, marker block.

- In `.transport .waveform-marker--idle .waveform-marker-line` (lines 634–636), lower the idle colour so idle marks are clearly quieter than active (green) / heard (mauve):
  - change `background: hsl(28 8% 34% / 0.45);` → a fainter alpha, e.g. `hsl(28 8% 34% / 0.30);`. Range **0.24–0.38**.
- Keep the idle line thin (the base `width: 1.5px` is fine; do not thicken it) and do not give it a cap (Task 5). Idle marks use the same centered geometry as everything else (Task 4) — only their colour/weight is de-emphasized.
- **Do not** change `--heard`/`--active` colours or weights — reserving saturation/weight for them is the whole point (the eye should land on the current mark, not on every line). *(Optional emphasis: if active/heard need to stand out more, you may make just those two a touch taller — e.g. `top: 14%; bottom: 14%` on the `--active`/`--heard` line rules — but this is optional.)*

**Net marker result:** idle = faint thin centered line bracketing the waveform, no dot; heard = mauve centered line + dot; active = green centered line + dot. All marks extend above and below the short centered waveform.

---

## 4. What the finished result should look like
- Waveform: one smooth, low-contrast filled silhouette occupying the **centre ~1/3** of the scrub bar (empty space above and below); played portion green; a clear green playhead.
- Lyric marks: thin vertical lines **centered on the bar and taller than the waveform**, so each extends above and below the silhouette. Idle marks are faint with no dot; the **current** line is a bold green line + dot; the **last-heard** line is a mauve line + dot. The dots sit at the top of their lines, just above the waveform.
- The bars/hairlines/dots no longer visually collide; the band reads calm, the marks clearly bracket the waveform, and the active mark is obvious.

---

## 5. Verification
Run the app and check both breakpoints and that nothing functional broke.

1. `npm install` (if needed), then `npm run dev` → open `http://localhost:3000`.
2. Get a real waveform + markers: in the **Audio** tab use **"Load sample"** (`components/tabs/audio-tab.js:189`) — it loads sample audio and lyric lines so markers appear — or upload any MP3. (Markers come from lyric line start times; the **Lyrics** tab lets you mark lines.)
3. **Mobile (primary):** in devtools set width to **390px**. Confirm: waveform is a filled silhouette (no bars), calm/low-contrast, and **occupies ~1/3 of the scrub bar centered** (space above and below); the lyric marks are thin vertical lines **taller than the waveform, centered, extending above and below it**; idle marks are faint with no dots; play the track — the playhead moves, the played area fills green, the current line's mark becomes a green line + dot, a passed line shows the mauve "heard" mark.
4. **Function still works:** tapping/clicking the waveform **seeks**; play/pause works; on the Lyrics tab, **marking a line** still places a marker at the right spot; no new console errors/warnings.
5. **Desktop non-regression:** set width to **1440px** and confirm the transport waveform looks good there too — same filled/calm treatment, ~1/3-height centered waveform with marks bracketing it, controls unchanged. The config/CSS are shared, so this should follow automatically — just confirm it reads well at the larger 63px bar height.
6. (Optional) Capture before/after screenshots at 390px and 1440px for the PR.

---

## 6. Optional consistency note (only if it looks off)
Before the audio decodes, a **skeleton** placeholder of faint grey **bars** shows (`.waveform-skeleton*`, `app/globals.css` ~lines 558–597; markup in `components/waveform-timeline.js` `WaveformSkeleton`). It is brief and only appears pre-decode. It is full-height bars, so it will now differ from the short, centered filled waveform. If that transient mismatch looks jarring, you may optionally soften it (lower the bar alpha) and/or constrain the skeleton to the same centered ~1/3 band (e.g. cap the skeleton container height and center it, mirroring Task 3) — but this is **optional and low priority**; leaving it is acceptable. Do not spend significant effort here.

---

## 7. Risks & rollback
- **Risk:** removing `barGap` but leaving `barWidth` (or vice-versa) → still renders bars. Mitigation: remove all three bar keys (Task 1) and visually confirm the fill.
- **Risk:** over-softening (`waveColor` alpha or `barHeight` too low) makes the waveform hard to see. Mitigation: stay within the given ranges; verify against a quiet section of audio.
- **Risk:** idle tick too tall/dark still competes with the waveform. Mitigation: tune `height` (Task 3) and alpha (Task 5) by eye.
- **Rollback:** every change is a self-contained config value or CSS rule. Restoring `barGap/barRadius/barWidth` and reverting the `--idle` marker rules + the two colour tweaks returns the previous look exactly. No data/behaviour is touched.

---

## Appendix — exact current values (for before/after reference)
WaveSurfer config (`components/waveform-timeline.js:340–365`): `barGap: 2`, `barRadius: 999`, `barWidth: 2`, `waveColor: "rgba(99, 91, 77, 0.32)"`, `progressColor: "rgba(44, 155, 63, 0.85)"`, `cursorColor: "#2C9B3F"`, `normalize: true`, `height: "auto"`, `dragToSeek: true`.

Marker CSS (`app/globals.css`):
- base line 613–621: `.waveform-marker-line { top:7px; bottom:5px; left:50%; width:1.5px; transform:translateX(-50%); border-radius:999px; }`
- base cap 623–632: `.waveform-marker-cap { top:1px; left:50%; width:5px; height:5px; transform:translateX(-50%); border-radius:999px; box-shadow:0 0 0 1.5px var(--surface); }`
- idle line 634–636: `background: hsl(28 8% 34% / 0.45);` → **edit here (Tasks 3+5)**
- idle cap 638–640: `background: hsl(28 8% 34% / 0.7);` → **edit here (Task 4: display:none)**
- heard line/cap 642–651 and active line/cap 653–662: **leave unchanged.**
