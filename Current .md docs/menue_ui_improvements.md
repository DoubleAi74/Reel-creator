# Menu / sub-tab collapse — UI/UX design plan

A fresh coding agent should read this whole file, then acquire its own context
from the codebase before changing anything. **Confirm every anchor against the
source rather than trusting line numbers — this file (`components/editor-shell.js`)
is ~6k lines and the numbers drift.** Use the grep patterns given here.

Companion file: **`progress_ui_improvements.md`** — the ordered, checkable
implementation steps. This file is the "what & why"; that one is the "how".

---

## What this covers

The three-section editor menu on the right-hand side panel and its **second-level
sub-tab row**. Today each section owns 2–3 sub-tabs:

| Section | Current sub-tabs |
| --- | --- |
| **Audio** | Track upload · Get lyrics |
| **Lyrics** | Edit Text · Timings · Words |
| **Style** | Text display · Background |

We are **collapsing the sub-tabs away**. After this work each of the three top
sections is a single scroll surface (the second-level tab row is deleted):

| Section | After |
| --- | --- |
| **Audio** | One combined area = Track upload **+** Get lyrics (decluttered) |
| **Lyrics** | One area = the Timings list, with per-line text editing folded in; **Words tab removed**, **Edit Text tab removed** |
| **Style** | One area = **Text display** and **Background** as two independent vertically-collapsible units |

Nothing about the preview, word board, waveform dock, export, or API pipelines
changes here except where the navigation rewire touches them.

---

## Where the code lives

- **Everything below is in one file:** `components/editor-shell.js`.
  - Nav model: `const SECTIONS` / `const SUB_TABS` / `getSectionForSubTab`
    (top of file). State: `const [activeSubTab, setActiveSubTab] = useState("track-upload")`.
  - Tab-bar JSX: search `panel-tabs` — the section-tab row + the sub-tab row +
    the "Set times" toggle.
  - Content dispatch: `const renderActiveTab = () => { switch (activeSubTab) …`.
  - Per-tab renderers: `renderTrackUploadTab`, `renderGetLyricsTab`,
    `renderLyricsTab` (this is **Edit Text**), `renderTimingTab`,
    `renderStyleTab` (this is **Text display**), `renderBackgroundTab`,
    `renderWordsTab`.
  - The compact timing row component: `function TimingRow({ … })` (module scope,
    above `EditorShell`).
- **Styles:** `app/globals.css` — `.panel-tabs`, `.section-tab`, `.sub-tabs`,
  `.sub-tab`, `.editor-panel-content`, `.side-panel`.
- **Not affected but adjacent:** `components/waveform-timeline.js` (receives
  `isTimingActive`), `components/word-board/*` (reads `projectState.lines`, **not**
  the Words tab data), `lib/timing.js` (section/offset math), `lib/autosave.js`
  (does **not** persist the active tab — verified).

---

## Locked design decisions

From the product owner (2026-07-01):

1. **Section offsets → removed from the UI entirely.** The start/end trim card in
   Audio goes away. Sections run full-track. (Trimming/segment-select is expected
   to return later on the waveform scrub dock / the YT-import flow — see
   `Public_imp_plan.md` and `audio_scrub_ui_plan.md`. Out of scope here.)
2. **Lyrics merge = per-line pen toggle.** Each row in the Timings list gets a
   **small square pen ("edit") button in its top-right corner, visible only when
   that line is selected** (same visibility rule as the row's other action
   buttons). Clicking it toggles an **expanded editor** for that line where the
   Original / Romanization / Translation text can be edited inline.
3. **Style = independent collapsibles.** Text display and Background each toggle
   independently (both can be open at once). **Text display starts open**,
   **Background starts collapsed**.
4. **Track metadata = slim one-liner.** Replace the Track name / Duration /
   Upload-status cards with a single compact summary line (e.g.
   `song.mp3 · 03:24 · ready`). Keep the dropzone's existing status badge.

### Defaulted (flagged — change if you disagree)

- **6:00 export guard stays.** With no trim UI, a track longer than
  `MAX_SECTION_DURATION_SECONDS` (6:00) can't be shortened and export stays
  blocked. We keep the existing guard + the global warning banner as-is for now;
  re-introducing trim on the scrub bar is the follow-up. (Assumption: users upload
  ≤6:00 tracks in the interim.)
- **Relocation of the old Edit-Text bulk actions.** "Romanize lyrics" +
  "Generate word meanings" move to a header block at the top of the merged Lyrics
  tab; "Add lyric line" stays as a footer button; per-line **Move up / Move down /
  Delete** move *into* the pen-expanded editor (so the collapsed row stays compact
  for tap-timing). The redundant numeric "Start time" field from Edit Text is
  dropped — the row's time chip + Mark/nudge already own timing.

---

## Target navigation model

**Before:** two levels. `activeSubTab` (7 values) drives a `switch`; a section-tab
row sets the section, a sub-tab row picks the leaf, `getSectionForSubTab` maps
leaf→section.

**After:** one level. Three section tabs *are* the navigation.

- Replace `activeSubTab` with `activeSection` state, values `"audio" | "lyrics" |
  "style"`, default `"audio"`.
- Flatten `SECTIONS` to `[{id:"audio",label:"Audio"}, {id:"lyrics",label:"Lyrics"},
  {id:"style",label:"Style"}]`. Delete `SUB_TABS` and `getSectionForSubTab`.
- Delete the entire **sub-tab row** JSX (the `.sub-tabs` block).
- Dispatch: `switch (activeSection) { case "audio": renderAudioTab(); case
  "lyrics": renderLyricsTab(); case "style": renderStyleTab(); }`.

### ID remap (find every reference — `grep -n "activeSubTab" components/editor-shell.js`)

| Old | Reason it fires | New |
| --- | --- | --- |
| `useState("track-upload")` | initial | `useState("audio")` (rename to `activeSection`) |
| `setActiveSubTab("track-upload")` | new project / clear | `setActiveSection("audio")` |
| `setActiveSubTab("get-lyrics")` | after JSON import | `setActiveSection("audio")` |
| `setActiveSubTab("timings")` (×2 debug, +auto-time, +tap-start) | jump to timing work | `setActiveSection("lyrics")` |
| `activeSubTab === "timings"` (auto-follow scroll effect, keyboard Enter/Space/Esc/Undo handlers, `isTimingTab`) | timing-only behaviour | `activeSection === "lyrics"` |
| `isTimingTab` → passed to `<WaveformTimeline isTimingActive>` | waveform timing mode | `activeSection === "lyrics"` |

The **"Set times" / "Hide times"** toggle (currently in the tab-bar row, gated on
`activeSubTab === "timings"`) moves into the **top of the merged Lyrics panel**
and is gated on `activeSection === "lyrics"`. It still flips `timingControlsOpen`.

---

## Section A — Audio (combined)

Merge `renderTrackUploadTab` + `renderGetLyricsTab` into one `renderAudioTab`.

**Keep, in this order:**
1. **Upload dropzone** — Choose MP3 / Load sample / Clear track + the status
   `StatusBadge`. Unchanged.
2. **Slim track summary** *(new, replaces 4 cards)* — one line:
   `{audio.name || "No track"} · {duration|—} · {upload status}`. Show a neutral
   placeholder before upload. This is the only survivor of the removed metadata.
3. **Auto-lyrics** — Source language `<select>` (+ "Other" input), the
   "Generate & time lyrics" button, the romanization note, and the status panel.
   Unchanged behaviour.
4. **Lyrics data** — Import JSON / Export JSON / Clear lyrics + the inline JSON
   notice. Unchanged behaviour.

**Remove:** the **Section offsets** card (and its now-orphaned state/handlers:
`audioOffsetDrafts`, `buildAudioOffsetDrafts`, `commitAudioOffsetDraft`,
`resetAudioOffsetDraft`, `applySectionAudio`, `audioSectionNotice`, plus the
"Use track end" button), the **Track name** card, the **Duration** card, and the
**Upload status** card. Do **not** touch `normalizeAudioSection` /
`getSectionBounds` / `lib/timing.js` — the internal section stays full-track
(`startOffset:0`, `endOffset:null`) and preview/export keep working.

> ⚠️ `sourceLanguage` is read by Romanize + word-meanings, which now live in the
> Lyrics tab. That cross-tab dependency is fine — the state lives in `EditorShell`.
> Just don't move the select's state into a tab-local scope.

---

## Section B — Lyrics (Timings + inline text editing)

One tab, rendered by the merged `renderLyricsTab`. It is the **current
`renderTimingTab`** plus the folded-in text editing. Delete the old Edit-Text
renderer once its pieces are relocated.

**Panel header (top of the tab):**
- The **"Set times" / "Hide times"** toggle (moved here — see nav section).
- A bulk-actions row: **Romanize lyrics** + **Generate word meanings** buttons and
  their status text (lifted verbatim from the old Edit-Text header).
- Keep the existing tap-timing / auto-time controls block (`timingControlsVisible`).

**The list — extend `TimingRow`:**
- Add a **pen/edit square button, absolutely positioned top-right** of the row.
  Render it **only when the row is active/selected** (reuse the existing `isActive`
  gate). Give the row `position: relative`. The button toggles edit mode for this
  line via a new callback.
- Edit mode is single-line-at-a-time: add `const [editingLineId, setEditingLineId]`
  in `EditorShell`; pass `isEditing={editingLineId === line.id}` and
  `onToggleEdit={() => setEditingLineId(id => id === line.id ? null : line.id)}`.
- When `isEditing`, render an **expanded editor** below the row's existing active
  controls, containing:
  - `AutoGrowTextarea` × 3 → **Original**, **Romanization**, **Translation**
    (reuse the markup + `updateLine` handler from old `renderLyricsTab`).
  - **Move up / Move down / Delete** (reuse `moveLine` / `deleteLine`).
- **Every input/button inside the row must `stopPropagation`** on click (the row
  container is `role="button"` with an `onClick` select handler — see how the
  existing active time `<input>` already does `onClick={e => e.stopPropagation()}`).
- Drop the redundant numeric "Start time" field.

**Footer:** the **Add lyric line** button (lifted from old Edit-Text).

**Removed:** the whole **Words** tab — `renderWordsTab`, its nav entry, its
`switch` case. Its data (`wordTimingState`) was only ever displayed there (the Word
Board reads `projectState.lines`). After removing the tab, `wordTimingState` and
its helpers (`handleLoadWordTimings`, `canLoadWordTimings`, `wordTimingBusy`,
`buildWordTimingState`, `createIdleWordTimingState`, `normalizeWordTimings`,
`getFlattenedLineWords`, `normalizeLineWords`, and their `setWordTimingState`
calls) become dead. Remove them **only after** grepping `lib/autosave.js` /
`lib/project.js` to confirm nothing serializes word timings (verified: they don't).

---

## Section C — Style (independent collapsibles)

Keep `renderStyleTab` (Text display) and `renderBackgroundTab` (Background)
content exactly as-is, but render both inside the **single Style panel**, each
wrapped in a collapsible unit.

- Add a small reusable `CollapsibleSection({ title, open, onToggle, children })`:
  a header `<button>` (title + rotating chevron) and a conditionally-rendered body,
  styled to match existing cards (rounded, `var(--border)`, `var(--surface-2)`).
- State in `EditorShell`: `textDisplayOpen` (default **true**), `backgroundOpen`
  (default **false**). Independent — toggling one never closes the other.
- `renderStyleTab` returns:
  `<CollapsibleSection title="Text display" open={textDisplayOpen} …>{existing text-display body}</CollapsibleSection>`
  then the same for Background. The old `renderBackgroundTab` body becomes the
  Background collapsible's children; delete it as a separate `switch` case.
- Preserve every existing control (presets, font, sizes, colors, vertical
  position, lead-in, shadow; background mode, solid/gradient/media, scrim, asset
  status) inside the respective unit.

---

## Cross-cutting concerns

- **CSS:** the `.sub-tabs` / `.sub-tab` rules become unused once the row is gone —
  remove or leave dormant (call it out; don't leave misleading dead selectors if
  easy to drop). `.section-tab` styling stays.
- **Autosave:** does not persist the active tab (verified) — no migration needed.
- **Tests / scripts:** no unit/e2e test hard-references the sub-tab labels or IDs
  (`scripts/score-timing.mjs` is an unrelated word-timing scorer). Still, grep
  `.visual-parity/`, `app/debug/`, and any specs for `Track upload` / `Get lyrics`
  / `Edit Text` / `Words` / `Set times` before finishing, and update snapshots.
- **Debug probe:** `debugProbe` flows call `setActiveSubTab("timings")` — remap to
  `setActiveSection("lyrics")` so the timing probe still lands on the right panel.
- **Mobile bottom-sheet:** the side panel is a snap sheet on mobile
  (`SHEET_SNAPS`). Collapsibles + expandable rows change panel height — verify the
  sheet still scrolls and the snaps behave.

## Out of scope / follow-ups

- Waveform-based section trimming + YT-import segment select (replaces the removed
  offsets UI). See `audio_scrub_ui_plan.md` and `Public_imp_plan.md`.
- Backend / credits / storage (Day 2 in `Public_imp_plan.md`).
