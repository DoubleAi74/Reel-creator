# Integration Plan: Unify the New Appearance + Word Board into the Next.js App

Status: **AGREED.** All decisions resolved through discussion (Sections 3, 4, 4.1, 11).
This document is the spec we will implement. A separate `progress.md` will break it into
small, ordered steps.

---

## 1. Goal

Take the **new appearance and functionality of `index_new.html`** (plus its `styles.css`
and `script.js`) and integrate it into the real Next.js app (`Reel creator timing up
GPT5.5 unif/`). The headline outcomes:

1. The app adopts the prototype's **light "warm-paper / green-accent" design system**,
   replacing the current dark-navy theme.
2. The app adopts the prototype's **layout**: a top bar, a left editor side-panel
   (Audio / Lyrics / Style), a central workspace holding the **phone preview + the Word
   Board side by side**, and a bottom transport dock with the waveform.
3. The **Word Board** from `index_new.html` is brought in as a real React component that
   **looks and behaves exactly as it does now**, and is **wired into the lyric/word
   generation flow** so it is driven by real project data (not the hardcoded Hindi sample).
4. The 5,210-line `components/editor-shell.js` monolith is **broken into readable
   components** with a clean shared-state model.
5. **All existing real functionality is preserved** (Remotion render, wavesurfer timeline,
   AI routes, video/image/gradient/solid backgrounds, outline/shadow styling, tap-timing,
   JSON import/export, lead-in, word-timings).

The prototype (`index_new.html` / `styles.css` / `script.js`) is a **visual + interaction
reference**. Its mocked logic (stubbed export/render/transcribe, fake waveform, sine-wave
bars, `setTimeout` "generation") is **not** ported — the real engine stays.

---

## 2. Source-of-truth map

What we pull from each artifact:

| Artifact | Role | What we take |
|---|---|---|
| `index_new.html` (live `#wb-script` inline) | The **real Word Board** | Exact markup, modes, controls, selection panel, fit-scaling, behavior |
| `styles.css` | The **design system** | Color tokens, component look (panels, buttons, tabs, inputs, badges, upload box, timing rows, word tiles) |
| `index_new.html` `<style>` blocks | **Word Board CSS** | The `.version-sketch` board styles + 4 responsive breakpoints (ported verbatim) |
| `script.js` | **Layout + interaction reference** | Section/tab structure, editor panel composition, transport wiring — already mirrors the React app |
| Next.js app | The **real engine** | Everything functional: state, AI routes, Remotion, wavesurfer, file storage, validation |

Note: `script.js`'s own simpler word board (`renderWordBoard`/`[data-word-board]`) is
**dormant** in `index_new.html` (no `[data-word-board]` element exists). The **live** board
is the elaborate `#wb-script` module. We port the live one.

---

## 3. Confirmed decisions (from discussion)

1. **Per-word gloss source:** folded into the lyric-generation flow. Generation returns,
   per line, a `words[]` array carrying `{ text, gloss, roman }` aligned to the lyric text.
2. **Missing gloss handling:** lines that never went through generation (JSON import,
   hand-edited text, "Add line", legacy projects) **degrade gracefully** via a positional
   split (today's prototype fallback), plus a **re-runnable "Generate word meanings"**
   action to fill them properly via AI.
3. **Word schema:** a **single merged `words[]`** per line:
   `{ text, start, end, gloss, roman }`. Generation fills `text/gloss/roman`; timing fills
   `start/end`; the board reads all of it.
4. **Theme:** **full replace** with the light cream/green design system. The **phone
   preview stays dark** because it is the video canvas; the Remotion render is unaffected
   (it uses the project's own style colors, not the app chrome theme).
5. **Functional scope:** keep **all** existing real features; re-skin + add the board on top.
6. **Word Board placement:** **central workspace**, beside the phone preview (mirrors the
   draft). Always visible.
7. **Word Board CSS:** **verbatim port** (scoped stylesheet inside the board component).
   The rest of the app is a **full Tailwind rewrite** to the new tokens.
8. **Layout model:** **fluid/responsive app shell** (not the fixed 1610×920 scaled canvas),
   but the **board keeps its own internal fit-scaling math exactly**.
9. **Board wiring on word-select:** update the **phone preview** to the word's line, and
   update the board's **gloss/selection panel**. **No** transport seek and **no** Timing-tab
   coupling on select.
10. **Playback:** the board **auto-follows** the active line during playback (highlight +
    page/scroll to it), consistent with the app's existing auto-follow. Toggleable.
11. **Shared state:** introduce an **editor context** backed by a `useEditorState`
    reducer/hook, so the new components read state + dispatch actions without deep
    prop-drilling.

---

## 4. Proposed decisions — APPROVED

All of P1–P6 were reviewed and approved.

- **P1 — Remove Hindi-specific hardcoding.** Drop `WORD_BANK`, `SKETCH_TILE_WIDTHS`, and
  the `sketchWords()` "drop trailing गई" hack from the ported board. The board becomes
  language-agnostic, driven by project data. (The Hindi sample stays available only as
  optional demo content.)
- **P2 — Generalize tile-width measurement.** The board's fit-scaling uses
  `sketchTileWidth()` (hardcoded widths + a Devanagari letter-count heuristic). Replace with
  a **real rendered-width measurement** (offscreen/canvas measure of the tile text) so it
  works for any script while preserving the same visual sizing/behavior. Fallback to the
  existing heuristic formula if measurement is unavailable.
- **P3 — Original word tokens come from the merged `words[]`.** When gloss data exists, the
  board renders those tokens. When absent, it tokenizes `line.original` and attaches
  positional roman/gloss. (Whisper timing tokens remain on the same `words[]`; if Whisper
  tokenization diverges, timing is matched best-effort and never blocks the board.)
- **P4 — Default project unchanged.** Keep the app's current default/seed project; the
  Hindi `Hindi_Lines.js` sample is not required at runtime.
- **P5 — Auto-follow contract.** During playback the board highlights the active **line**
  and keeps it visible (page in page-mode, scroll in scroll-mode). A manual word click still
  sets the preview + gloss panel; auto-follow does not overwrite a manual selection mid-line
  unless the active line changes. Provide an auto-follow toggle (reuse existing
  `autoFollowEnabled` semantics).
- **P6 — New AI route for re-runnable gloss.** Add `POST /api/ai/word-meanings` that takes
  the current lines and returns `words[] { text, gloss, roman }` per line. The generation
  flow reuses the same gloss logic so behavior is identical whether gloss arrives via
  initial generation or a later re-run.

### 4.1 Final layout/UX decisions

- **D-Modal — Fullscreen preview shows phone + Word Board.** The fullscreen Preview modal
  includes both the dark phone preview and the Word Board (not phone-only), so users can
  explore words while previewing.
- **D-Default — Board default = page mode on desktop.** Matches the prototype; mobile still
  forces scroll mode.
- **D-Gloss-Coverage — Auto-run a coverage fill after generation.** Immediately after a full
  lyric generation, run a meanings pass that **only fills lines missing `gloss`/`roman`**
  (a no-op when generation already covered them). This guarantees board coverage without
  paying a full redundant AI cost on every generation.
- **D-Brand — Keep current title/artist.** The new top bar keeps the existing project
  title/artist; no brand/copy changes.

---

## 5. Target architecture

### 5.1 Component tree (new)

```
app/page.js
  └─ <EditorProvider project={initial}>        # context + useEditorState reducer
       └─ <EditorShell>                         # layout only
            ├─ <TopBar>                          # brand, title/artist, Preview / Export text / Export MP4
            ├─ <SidePanel>                       # editor column
            │    ├─ <SectionTabs>                # Audio / Lyrics / Style
            │    ├─ <SubTabs>                    # contextual sub-tabs
            │    └─ <TabContent>                 # switches on active sub-tab:
            │         ├─ <TrackUploadTab>
            │         ├─ <GetLyricsTab>          # + "Generate word meanings" re-run action
            │         ├─ <EditTextTab> → <LineEditor>
            │         ├─ <TimingTab> → <TimingRow>
            │         ├─ <WordsTab>              # existing Whisper word-timings table (kept)
            │         ├─ <TextDisplayTab>
            │         └─ <BackgroundTab>
            ├─ <Workspace>
            │    ├─ <PreviewColumn>              # phone frame
            │    │    └─ <PreviewPlayer>         # existing Remotion player (unchanged engine)
            │    └─ <WordBoard>                  # NEW — verbatim-ported board
            │         ├─ useWordBoard()          # boardState + fit-scaling (ported from #wb-script)
            │         ├─ <WordBoardStage> → <LineRow> → <WordTile>
            │         ├─ <BoardControls>         # roman toggle / mode toggle / size stepper
            │         ├─ <SelectionPanel>        # english / roman / original + full line
            │         └─ <Pager>
            ├─ <TransportDock>
            │    ├─ <WaveformTimeline>           # existing wavesurfer (unchanged engine)
            │    └─ transport buttons (play / rewind / ±step / time label)
            └─ modals: <PreviewModal>, <ProjectJsonModal>, <RenderExportModal>
```

### 5.2 State model

- `EditorContext` provides `{ state, actions }` from `useEditorState` (a `useReducer`
  wrapper, plus refs for non-render values like DOM nodes/timers).
- `state` consolidates today's ~22 `useState` values into grouped slices:
  `project`, `audio` (upload + transport time + playing), `selection`
  (selected timing line, selected board word), `drafts` (timing/offset/json), `ai`
  (autoLyrics/autoTiming/wordTimings/wordMeanings/romanize), `export`, `ui`
  (active sub-tab, sheet snap, fullscreen, notices).
- `actions` are named dispatchers (`updateLine`, `addLine`, `moveLine`, `deleteLine`,
  `setSelectedWord`, `setAudioTime`, `setActiveSubTab`, `applyStylePreset`, etc.).
- The **Word Board's** internal `boardState` (page, mode, scroll, tileScale, layoutScale,
  showRoman, hover) lives in `useWordBoard` (local to the board), **not** global state.
  Only the **cross-cutting** signals cross the boundary: selected word → preview/gloss,
  current playback line → board auto-follow.

### 5.3 Data / schema changes (`lib/`)

- `lib/project.js`: extend the per-word shape to `{ text, start, end, gloss, roman }`;
  add normalization that backfills `gloss`/`roman` as `null`/positional when absent so old
  projects load cleanly.
- `lib/validate.js`: accept optional `gloss`/`roman` string fields on words; never require
  them.
- `lib/word-board.js` (new): pure, language-agnostic helpers ported/generalized from
  `#wb-script` — `tokenize`, `getWordInfo` fallback, tile-width measurement, line-width
  estimate, `fitLayoutScale`, `calculateLinesPerPage`, page/scroll line builders. Unit-tested.
- `lib/ai/openai-lyrics.js` + `app/api/ai/transcribe`: extend the Responses schema so each
  generated line includes `words[] { text, gloss, roman }`.
- `app/api/ai/word-meanings` (new): re-runnable gloss for current lines (P6).

### 5.4 Styling

- `app/globals.css`: replace dark-navy tokens with the new light tokens (port the
  `:root` variables from `styles.css` — `--page`, `--shell`, `--panel`, `--surface`,
  `--border`, `--text`, `--muted`, `--accent` (green), `--accent-2` (maroon), `--danger`,
  `--warning`, shadows). Map them into Tailwind theme tokens so utilities pick them up.
- App-shell components: **Tailwind rewrite** against the new tokens, matching `styles.css`
  classes' look (panels, buttons, tabs, inputs, badges, upload box, timing rows, etc.).
- Word Board: a **scoped, verbatim-ported stylesheet** (`word-board.css` or a CSS module)
  carrying the `.version-sketch` rules, CSS variables, pseudo-elements, and all four
  breakpoints, applied to the `<WordBoard>` subtree only.

---

## 6. The Word Board, in detail (fidelity contract)

Behaviors that must match `index_new.html` exactly:

- **Two modes:** page (arrow pager) and scroll (continuous). **Mobile (`max-width:780px`)
  forces scroll mode.**
- **Controls:** tile-size stepper clamped **82%–128%**; roman-label toggle (`R`); mode
  toggle (`↔`/`↕`, disabled on mobile).
- **Tiles:** show the original word; reveal the gloss on hover/selection; show an inline
  roman label under the tile when roman is toggled on.
- **Selection panel:** selected word's gloss / roman / original, a divider, then the full
  line's original / romanization / translation.
- **Fit-scaling:** preserve `--board-width`, `--board-height`, `--board-scale`,
  `--tile-scale`, `--tile-layout-scale`; preserve `calculateLinesPerPage`,
  `fitLayoutScale`, and the page/scroll line builders. Board ratio stays the prototype's
  `1094 / 922` (or revisit only if it harms the fluid shell).
- **Scroll-position preservation** across re-renders in scroll mode; live "Lines X–Y / N"
  or "Page p / N" range note.
- **Responsiveness:** re-measure and re-render on resize (debounced), and when the board's
  slot changes size.

Generalizations (P1/P2/P3): no hardcoded dictionary or tile widths or per-song hacks; data
comes from project `words[]`; tile widths measured from rendered text.

Wiring (decision 9): click a word → `actions.setSelectedWord(word)` → preview shows the
line + gloss panel updates. No seek, no timing-tab change. Auto-follow (decision 10 / P5):
playback's active line drives a line-level highlight and visibility, toggleable.

---

## 7. The word-generation flow (how the board gets real data)

1. User uploads MP3 → existing upload/session storage (unchanged).
2. User runs **Generate** (Audio → Get lyrics). The transcribe/Responses pipeline now
   returns, per line, `{ original, romanization, translation, words: [{ text, gloss, roman }] }`.
3. Replace-all loads these lines into `projectState.lines` with IDs and `start: null`
   (unchanged behavior), now **including per-word gloss/roman**.
4. The Word Board renders directly from `projectState.lines[].words`.
5. For lines without gloss (import/edit/add/legacy): board falls back to positional
   roman/gloss; user can click **"Generate word meanings"** to fill them via
   `/api/ai/word-meanings`.
6. Whisper word-**timings** continue to populate `start/end` on the same `words[]` and feed
   the existing Words tab; they do not block the board.

---

## 8. Explicitly out of scope / preserved as-is

- Remotion composition + render pipeline, `/api/render`, text-layer/ProRes + FFmpeg fast
  paths (kept; only consume the new word fields if useful, otherwise untouched).
- wavesurfer waveform engine (re-skinned visually, same engine).
- Existing AI routes for transcribe/auto-time/romanize/word-timings (extended, not replaced).
- File/session storage (`lib/files.js`, `/api/upload`).
- No new heavy dependencies; no state library.

---

## 9. Risks & mitigations

- **Board visual drift** → mitigated by verbatim CSS port (decision 7) + side-by-side
  screenshot checks against `index_new.html`.
- **Gloss/timing tokenization mismatch** → board never depends on Whisper tokens; gloss is
  authoritative for display, timing is best-effort matched (P3).
- **Big refactor regressions** → componentize behind the new context incrementally, keeping
  the app runnable at each step; rely on existing tests (`npm test`) + lint + build at each
  milestone.
- **Fixed-canvas vs fluid tension** → app shell fluid, board self-scales; verify on mobile
  (forced scroll) and compact-desktop breakpoints.

---

## 10. Validation baseline (unchanged commands)

- Lint: `npm run lint`
- Test: `npm test`
- Build: `npm run build`
- Dev: `npm run dev` (webpack), smoke-check the editor renders, board functions, generation
  populates gloss, export still works.

---

## 11. Open questions — RESOLVED

- Q-A: P1–P6 — **approved** (Section 4).
- Q-B: Fullscreen Preview modal — **phone + Word Board** (Section 4.1, D-Modal).
- Q-C: Brand/title — **keep current** title/artist (Section 4.1, D-Brand).
- Q-D: Board default — **page mode** on desktop, scroll on mobile (Section 4.1, D-Default).
- Q-E: Post-generation meanings — **auto-run a coverage fill** for missing lines only
  (Section 4.1, D-Gloss-Coverage).

No open questions remain. The spec is ready to be broken into `progress.md` steps.
```
