# File-structure refactor — implementation checklist

Ordered steps for a fresh agent. **Read `dir_structure_change.md` first** (design +
rationale + target tree + prop groups), then work top-to-bottom here. Check boxes as
you go.

**Ground rules**
- This is a **pure move**: relocate JSX/helpers into new files, change **nothing**
  about behaviour, DOM, classes, effect order, or state. If you feel tempted to
  "improve" something, don't — note it at the bottom instead.
- **All state stays in `EditorShell`.** You are moving *JSX and presentational
  helpers*, not `useState`/`useEffect`/handlers. Children receive **grouped props**
  (see design doc).
- Navigate with the **grep anchors** given, **not** absolute line numbers — they
  drift after the first extraction.
- Use the `@/` import alias (e.g. `@/components/ui/status-badge`), matching existing
  code. kebab-case filenames, `PascalCase` exports.
- **The compiler is your prop-finder.** After moving a body: `npm run lint` +
  `npm run build`; each `X is not defined` = one prop to thread in. Repeat until
  clean. Do not hand-guess the full prop list.
- Keep each phase independently green: the **phase-close CHECK** must pass before
  starting the next phase.
- **Do not `git commit`** unless the user asks. (If they do, one commit per closed
  phase.)
- Do **not** touch `lib/timing.js`, the preview player internals, export/render
  flows, or API routes.

**The per-file extraction recipe (use this every time)**
1. Create the new file; add `"use client";` at the top **iff** it uses hooks/events
   (all tab + region files do; pure `ui/*` presentational ones that take only props
   still need it because they render interactive elements — match `preview-player.js`,
   which has it).
2. Cut the target function/JSX out of `editor-shell.js` into the new file as an
   exported `PascalCase` component.
3. In `editor-shell.js`, import it and render it where the code used to be.
4. `npm run lint` → for each undefined identifier, add it to the appropriate
   **grouped prop** and pass it at the call site. Repeat.
5. `npm run build` → fix any import/compile error.
6. Sanity-glance the diff: only *moves* + prop wiring, no logic edits.

---

## Phase 0 — Baseline & scaffolding
- [ ] Read `dir_structure_change.md` fully.
- [ ] Skim `editor-shell.js` anchors: `export function EditorShell`,
      `const renderAudioTab`, `const renderLyricsTab`, `const renderStyleTab`,
      `const renderTextDisplayControls`, `const renderBackgroundControls`,
      `const renderActiveTab`, and the six `function StatusBadge|StyleSlider|StyleColorField|CollapsibleSection|AutoGrowTextarea|TimingRow`.
- [ ] Record a baseline: `npm run test`, `npm run lint`, `npm run build` — all should
      be green **before** you start. Note the current `wc -l components/editor-shell.js`.
- [ ] Confirm `npm run visual:parity` runs and captures/compares a baseline (it drives
      `scripts/visual-parity.mjs`). If it can't run in this environment, note that and
      rely on `npm run dev` manual checks instead.
- [ ] `mkdir -p components/ui components/tabs`.
- [ ] **CHECK:** baseline commands green; scaffolding dirs exist. Do not proceed
      otherwise.

## Phase 1 — Shared primitives & pure helpers  *(prerequisite for everything)*
Extract the module-scope pieces the tabs/regions depend on, so later phases can
import them.

- [ ] **`components/ui/status-badge.js`** ← `function StatusBadge`. Move verbatim,
      `export function StatusBadge`. Import back into `editor-shell.js`.
- [ ] **`components/ui/style-slider.js`** ← `function StyleSlider`. (same pattern)
- [ ] **`components/ui/style-color-field.js`** ← `function StyleColorField`.
- [ ] **`components/ui/collapsible-section.js`** ← `function CollapsibleSection`.
- [ ] **`components/ui/auto-grow-textarea.js`** ← `function AutoGrowTextarea`
      (note: it uses `useRef`/`useEffect` — keep those imports in the new file).
- [ ] **`components/ui/timing-row.js`** ← `function TimingRow` (largest primitive;
      check what it references — if it needs a formatter/helper, that helper must move
      in Phase 1 too, or be imported).
- [ ] **`lib/editor-format.js`** ← move ONLY the pure helpers/constants that the
      soon-to-be-extracted tabs/regions use. Start with the likely set:
      `formatPreciseTime`, `formatTime`, `formatBytes`, `formatSectionRelativeTime`,
      `parseTypedTime`, `isBackgroundMediaType`, `getBackgroundUploadEntry`,
      `getBackgroundAssetName`, `getLineNumber`, `getLineSummary`,
      `BACKGROUND_UPLOAD_COPY`, `SOURCE_LANGUAGE_OPTIONS`. Re-import them into
      `editor-shell.js`. **Leave** shell-only helpers (`readAutosaveRaw`,
      `writeAutosaveRaw`, `clearAutosaveRaw`, `cloneProject`, `createIdle*State`,
      autosave/probe utils) in place.
- [ ] For each moved primitive/helper, confirm it's still referenced by
      `editor-shell.js` via the new import (grep the old name — zero stray local
      defs left).
- [ ] **CHECK (phase close):** `npm run lint` + `npm run build` green;
      `npm run test` green; `npm run visual:parity` shows no diff. Manual: `npm run
      dev`, open Style tab (exercises Slider/ColorField/Collapsible) and Lyrics tab
      (exercises TimingRow/AutoGrowTextarea) — pixel-identical.

## Phase 2 — Extract layout regions
Order: simplest → most involved. One file per step; run the recipe (lint+build) after
each.

- [ ] **`components/editor-tab-bar.js`** ← anchor `className="panel-tabs`
      (the `SECTIONS.map` button row). Props: `activeSection`, `onSelectSection`.
      Import `SECTIONS` from wherever it's shared (keep the single definition;
      re-export from the shell or a small shared module — do not duplicate the array).
      Render `<EditorTabBar activeSection={activeSection} onSelectSection={setActiveSection} />`.
- [ ] **`components/editor-header.js`** ← anchor `className="top-frame`.
      Props: `title` (`projectState.meta.title`), `artist`, `showPreview`,
      `showWordBoard`, `onTogglePreview` (`handleTogglePreview`), `onToggleWordBoard`.
- [ ] **`components/editor-modals.js`** ← anchors `<ProjectJsonModal` +
      `<RenderExportModal`. Props grouped as `json={{…}}` and `export={{…}}` per the
      design doc. Keep the `exportModalOpen` gate behaviour (render nothing when
      closed, exactly as now).
- [ ] **`components/preview-stage.js`** ← anchor `className={\`preview-col` through the
      end of the `wb-slot` `<section>`. Absorbs both `<WordBoard>` call sites +
      `preview-under-actions`. Props per design doc; prefer `useEditor()` inside the
      file for word-board selection (it renders within `EditorProvider`). Keep the
      fullscreen conditional structure identical.
- [ ] **CHECK (phase close):** full table — `npm run test`, `npm run lint`,
      `npm run build`, `npm run visual:parity` (no diff). Manual: header title/toggles,
      tab switching, preview + fullscreen (✕ closes), Preview/Export under-buttons,
      JSON import modal, export modal all behave as before.

## Phase 3 — Extract the three tabs  *(the main event)*
Do them one at a time, simplest first. After each: lint+build, then resolve every
undefined identifier into a grouped prop.

- [ ] **`components/tabs/style-tab.js`** ← `const renderStyleTab` **plus**
      `const renderTextDisplayControls` **plus** `const renderBackgroundControls`
      (all three move together; the two controls become internal helpers of the file).
      Import `StyleSlider`/`StyleColorField`/`CollapsibleSection` from `@/components/ui/*`.
      Prop groups: `textDisplay`, `background` (see design doc). Remember: the hidden
      `<input>`s stay in the shell — pass `onPickImage`/`onPickVideo` callbacks that
      `.click()` the shell's refs.
- [ ] **`components/tabs/audio-tab.js`** ← `const renderAudioTab`. Prop groups:
      `audio`, `lyricsSource`, `project`. `onPickFile` triggers the shell's
      `audioInputRef`.
- [ ] **`components/tabs/lyrics-tab.js`** ← `const renderLyricsTab` (largest; most
      timing state). Prop groups: `timing`, `project`, `transport`. Watch the
      `timingRowRefs` map and `editorScrollRef`-driven auto-scroll — those refs stay
      owned by the shell; pass what the tab needs. Do not alter the
      `activeSection === "lyrics"` gated effects (they stay in the shell).
- [ ] Rewrite `const renderActiveTab` (`switch (activeSection)`) to return
      `<AudioTab …/>` / `<LyricsTab …/>` / `<StyleTab …/>` with the grouped props;
      delete the now-empty `render*Tab` locals.
- [ ] Grep for stray references to the deleted render fns and old inline helper names
      — should be zero.
- [ ] **CHECK (phase close):** full table green + no `visual:parity` diff. Manual, all
      three tabs: upload MP3 + load sample + clear (Audio); generate/clear lyrics +
      transcription language (Audio); mark/nudge/clear times + tap-timing + inline
      edit + auto-follow scroll (Lyrics); text-display sliders/colors + background
      image/video upload + collapsibles (Style).

## Phase 4 — Cleanup & final verification
- [ ] Confirm `editor-shell.js` now reads as *state + refs + effects + handlers +
      composition*. Re-check `wc -l` vs. the Phase 0 baseline (expect a large drop;
      target well under ~2k lines).
- [ ] Remove any now-unused imports in `editor-shell.js` (`npm run lint` flags these).
- [ ] Verify no duplicated helper/component definitions remain (grep each moved name:
      exactly one definition, in its new home).
- [ ] Confirm every new file has `"use client";` where required and uses `@/` imports.
- [ ] **Final CHECK:** `npm run test` ✅ `npm run lint` ✅ `npm run build` ✅
      `npm run visual:parity` (no diff) ✅ + a full manual click-through.
- [ ] Report: files created, before/after line counts, and any deviations.

---

## Rollback
Each phase is self-contained. If a CHECK fails and can't be fixed quickly, revert the
files touched in that phase (`git checkout -- <files>` or `git restore`) back to the
last green phase boundary and retry — do not carry a red state into the next phase.

## Notes / deviations (fill in as you go)
- …
