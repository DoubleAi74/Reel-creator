# Directory / file-structure refactor — design & rationale

Companion to **`structure_change_progress.md`** (the step-by-step checklist). Read
this first for the *why* and the *target shape*; then work the checklist
top-to-bottom.

This is a **Phase 2** refactor. Phase 1 (collapsing the menu to three flat tabs —
Audio / Lyrics / Style, no sub-tabs, Words removed) is **already done and merged**
(see `menue_ui_improvements.md` / `progress_ui_improvements.md`). Nothing about the
navigation model changes here.

---

## The problem

`components/editor-shell.js` is **~5,064 lines** and holds one component,
`EditorShell` (`grep -n "export function EditorShell"`), that contains:

- **36** `useState`, **13** `useRef`, **35** `useEffect`, **34** `handle*` handlers
- three tab bodies as closures: `renderAudioTab`, `renderLyricsTab`,
  `renderStyleTab` (the last composes `renderTextDisplayControls` +
  `renderBackgroundControls`)
- all layout regions inline: page header, tab bar, preview stage, word-board slot,
  waveform mount, the two trailing modals, and the debug probe
- ~35 module-scope helpers (pure utils + 6 presentational mini-components) defined
  above the component

It works, but every edit means re-reading a huge file, and editing one tab risks
the others because everything shares one scope.

## The goal (and the non-goals)

**Goal:** split `editor-shell.js` into focused files without changing a single
pixel or behaviour. This is a *pure move* — same DOM, same classes, same effects,
same order of execution.

**Non-goals for this pass (explicitly out of scope):**
- No logic changes, no new features, no CSS/token changes, no dependency changes.
- No re-architecting state. **All 36 `useState` / 35 `useEffect` / 34 handlers stay
  inside `EditorShell`.** We are moving *JSX*, not *state*.
- No splitting a tab's internals into finer children (decision: *"move whole tab
  as-is"*). `renderTextDisplayControls` / `renderBackgroundControls` travel *with*
  the Style tab as internal helpers.
- No conversion to `useCallback`/`useMemo`, no context expansion, no custom hooks.

## The chosen mechanism: **grouped props**

Each extracted piece keeps working by receiving the shell state/handlers it needs
as **grouped prop objects** (not 60 loose props, not an expanded context). The
shell stays the single owner of state; children are presentational.

Example call site after extraction:

```jsx
<AudioTab
  audio={{ upload: audioUpload, objectUrl: audioObjectUrl, isLoadingSample,
           onFile: handleAudioFile, onClear: handleClearAudio,
           onLoadSample: handleLoadSample, onPickFile: () => audioInputRef.current?.click() }}
  lyricsSource={{ auto: autoLyricsState, autoTiming: autoTimingState, transcription,
                  sourceLanguage, otherSourceLanguage, onSourceLanguage: setSourceLanguage,
                  onOtherSourceLanguage: setOtherSourceLanguage,
                  onGenerate: handleGenerateAutoLyrics, onClearLyrics: handleClearLyrics }}
  project={projectState}
/>
```

### Why grouped props (vs. the alternatives)
- **Lowest risk / behaviour-identical.** Nothing about render order or effect timing
  changes; we only relocate JSX and thread its inputs.
- **The compiler finds the prop list for you.** Move a body, run `npm run build` /
  `npm run lint`; every `is not defined` is exactly one prop to add. No guesswork.
- Context-expansion and per-tab hooks were rejected for this pass: the 35 effects are
  intertwined, so pulling state apart now is where bugs hide. Grouped props keep the
  risky part (state) untouched.

---

## Target file structure

```
components/
  editor-shell.js          # SLIMMED: state + refs + effects + handlers + composition only
  editor-header.js         # NEW  brand lockup + title + mobile Preview/Word-board toggle
  editor-tab-bar.js        # NEW  the 3 SECTIONS buttons
  preview-stage.js         # NEW  PreviewPlayer + WordBoard (both call sites) + fullscreen + under-actions
  editor-modals.js         # NEW  ProjectJsonModal + RenderExportModal wiring
  editor-context.js        # unchanged
  editor-state.js          # unchanged
  preview-player.js        # unchanged (already a component)
  waveform-timeline.js     # unchanged (already a component)
  project-json-modal.js    # unchanged
  render-export-modal.js   # unchanged
  word-board/              # unchanged (already a component)
  ui/                      # NEW  shared presentational primitives (moved out of editor-shell.js)
    status-badge.js        #      function StatusBadge
    style-slider.js        #      function StyleSlider
    style-color-field.js   #      function StyleColorField
    collapsible-section.js #      function CollapsibleSection
    auto-grow-textarea.js  #      function AutoGrowTextarea
    timing-row.js          #      function TimingRow
  tabs/                    # NEW
    audio-tab.js           #      renderAudioTab body
    lyrics-tab.js          #      renderLyricsTab body
    style-tab.js           #      renderStyleTab + renderTextDisplayControls + renderBackgroundControls
lib/
  editor-format.js         # NEW  pure helpers/constants shared by shell + tabs (only the shared ones)
```

**Naming:** kebab-case files, `PascalCase` component exports — matches the existing
repo (`preview-player.js` → `PreviewPlayer`, etc.). Use the `@/` alias for all
imports (`jsconfig.json` maps `@/* → ./*`), consistent with current code.

**On "Word board":** the `WordBoard` *component* already exists
(`components/word-board/word-board.js`) and does **not** move. What is still inline
is the two `<WordBoard …/>` call sites (fullscreen + `wb-slot`) and their wrapper
markup — those are absorbed into **`preview-stage.js`**, which naturally composes
preview + board. We are **not** creating a redundant word-board file.

---

## What each new file owns

### `ui/*` — shared presentational primitives  *(extract FIRST — everything else depends on them)*
Pure, stateless-ish components currently at module scope in `editor-shell.js`:
`StatusBadge`, `StyleSlider`, `StyleColorField`, `CollapsibleSection`,
`AutoGrowTextarea`, `TimingRow` (`grep -nE "^function (StatusBadge|StyleSlider|StyleColorField|CollapsibleSection|AutoGrowTextarea|TimingRow)"`).
Move each verbatim; export it; import back into `editor-shell.js`. No prop changes.

### `lib/editor-format.js` — shared pure helpers  *(extract with the primitives)*
Only the module-scope pure functions/constants that the **extracted tab/region
files will reference** (e.g. `formatPreciseTime`, `formatBytes`,
`formatSectionRelativeTime`, `parseTypedTime`, `isBackgroundMediaType`,
`getBackgroundUploadEntry`, `getBackgroundAssetName`, `getLineNumber`,
`getLineSummary`, `BACKGROUND_UPLOAD_COPY`, `SOURCE_LANGUAGE_OPTIONS`). Helpers used
*only* by the shell's surviving handlers/effects (e.g. `readAutosaveRaw`,
`cloneProject`, `createIdle*State`) **stay in `editor-shell.js`**. Let the build tell
you which ones the tabs actually need — don't move speculatively.
(`lib/` is where this repo keeps pure logic + colocated tests — this is consistent.)

### `editor-header.js`
Anchor: `grep -n 'className="top-frame'`. Brand mark + title/artist + the
`mobile-view-toggle` (Preview / Word board buttons).
**Props:** `title`, `artist`, `showPreview`, `showWordBoard`, `onTogglePreview`,
`onToggleWordBoard`.

### `editor-tab-bar.js`
Anchor: `grep -n 'className="panel-tabs'` (the `SECTIONS.map` button row).
**Props:** `activeSection`, `onSelectSection`. (`SECTIONS` can be imported directly
or passed — keep it imported from a shared spot to avoid duplication.)

### `preview-stage.js`
Anchors: `grep -n 'className={\`preview-col'` through the end of the `wb-slot`
`<section>`. Encapsulates the preview column (PreviewPlayer, fullscreen close
button, gradient), the fullscreen-only WordBoard, the `preview-under-actions`
(Preview / Export MP4 buttons), and the standard `wb-slot` WordBoard.
**Props (grouped):**
- `project` (`projectState`), `previewPlayerRef`, `previewCurrentFrame`,
  `backgroundPreviewUrl`, `backgroundDurationSec` (`activeBackgroundAsset?.durationSec`)
- `isPreviewFullscreen`, `onEnterFullscreen`, `onExitFullscreen`
- `currentAudioTime`, `wordBoardFollowAudioResetKey`, `showPreview`, `showWordBoard`
- export under-action: `canExport` (`exportReadiness.canExport`), `exportBusy`,
  `onExport`
- word-board selection: may read `useEditor()` directly (it renders inside
  `EditorProvider`), or take `selectedWordId` + `onSelectWord`. Prefer `useEditor()`
  to match how `WordBoard` already consumes context.

### `editor-modals.js`
Anchors: `grep -n "<ProjectJsonModal"` and `grep -n "<RenderExportModal"` (the two
trailing blocks). A thin wrapper that renders both with grouped props:
- `json={{ isOpen, draft, errorMessage, onChange, onClose, onFileSelected, onImport, onStartNew }}`
- `export={{ isOpen: exportModalOpen, state: exportState, lineCount, sectionDuration,
             projectTitle, progressPercent, onClose, onDownload, onRetry }}`

*(Low structural value — already-componentised modals — but in scope by request.)*

### `tabs/audio-tab.js` — `renderAudioTab` body
Anchor: `grep -n "const renderAudioTab"`. **Prop groups:** `audio` (upload/object
URL/sample + file & clear handlers), `lyricsSource` (auto-lyrics / auto-timing /
transcription / language + generate & clear handlers), `project`.

### `tabs/lyrics-tab.js` — `renderLyricsTab` body
Anchor: `grep -n "const renderLyricsTab"`. **Prop groups:** `timing`
(`timingDrafts`, `tapTimingSession`, `selectedTimingLineId`,
`resolvedSelectedTimingLineId`, `activeTimingLineId`, `editingLineId`,
`timingControlsOpen`, `timingNotice`, `autoFollowEnabled`, `timingRowRefs` + the
timing handlers: `onSelect`, `onDraftCommit`, `onDraftReset`, `onMark`, `onNudge`,
`onClearAll`, `onJump`, `setTimingControlsOpen`, `setEditingLineId`,
`setAutoFollowEnabled`), `project` (lines), `transport` (`currentAudioTime`,
`isTransportPlaying`).

### `tabs/style-tab.js` — `renderStyleTab` (+ its two control helpers)
Anchors: `grep -n "const renderStyleTab"`, `const renderTextDisplayControls`,
`const renderBackgroundControls`. Move all three; the two control renders become
internal functions/subcomponents of the file. **Prop groups:** `textDisplay`
(`projectState.style`, `textDisplayOpen`, `setTextDisplayOpen`, style change
handler), `background` (`backgroundUpload`, `backgroundOpen`, `setBackgroundOpen`,
`activeBackgroundAsset`, `backgroundPreviewUrl`, `projectState.background`,
`onImageFile`, `onVideoFile`, `onPickImage`, `onPickVideo`), imports `StyleSlider`,
`StyleColorField`, `CollapsibleSection` from `ui/`.

---

## Two details that will bite if missed

1. **Hidden file `<input>`s stay in the shell.** The three hidden inputs
   (`ref={audioInputRef}`, `backgroundImageInputRef`, `backgroundVideoInputRef`,
   `grep -n 'ref={audioInputRef}'`) live in the side-panel JSX and are triggered by
   the Audio and Style tabs. **Keep the `<input>` elements in `editor-shell.js`** and
   pass tabs an `onPick*` callback that calls `ref.current?.click()`. Do **not**
   move the inputs into the tabs (would change focus/DOM structure).

2. **`renderActiveTab` becomes composition.** After extraction, the `switch
   (activeSection)` (`grep -n "const renderActiveTab"`) returns `<AudioTab …/>` /
   `<LyricsTab …/>` / `<StyleTab …/>` with the grouped props above, replacing the
   `render*Tab()` calls.

---

## Verification strategy (behaviour-preserving)

This repo has the tools to *prove* the refactor changed nothing:

| Check | Command | Meaning |
|---|---|---|
| Unit/logic | `npm run test` (vitest) | Pure logic in `lib/` still green |
| Lint | `npm run lint` (eslint) | No undefined identifiers / unused vars — **catches missing props** |
| Build | `npm run build` (next) | Compiles; no broken imports |
| Visual parity | `npm run visual:parity` | **Pixel diff** — the strongest proof no UI changed |
| Manual | `npm run dev` | Click each tab; upload audio; open fullscreen; export path |

Run lint + build after **every** file extraction; run the full table at each **phase
boundary**. Confirm `visual:parity` actually runs during Phase 0 before relying on it.

## Definition of done
- `editor-shell.js` is materially smaller (target: well under ~2k lines) and reads as
  *state + effects + handlers + a composition tree*.
- New files exist per the tree above; each is a focused, presentational unit.
- `npm run test`, `npm run lint`, `npm run build` all green.
- `npm run visual:parity` shows no diff (or documented, intentional zero-diff).
- No behaviour change observed in manual pass.
