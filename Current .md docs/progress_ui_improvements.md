# Menu / sub-tab collapse — implementation checklist

Ordered steps for a fresh agent. Read **`menue_ui_improvements.md`** first (the
design + rationale), then work top-to-bottom here. Check boxes as you go.

**Ground rules**
- All UI work is in `components/editor-shell.js` unless noted. It is ~6k lines —
  navigate with the grep patterns given, **not** absolute line numbers.
- Keep each phase independently runnable: `npm run dev` (or the project's dev
  command) should compile after every phase.
- Reuse existing classes/tokens (`var(--accent)`, `var(--surface-2)`, `.rounded-…`)
  so the new UI matches. Match the surrounding code's style — no new libraries.
- Do **not** alter `lib/timing.js`, the preview player, export, or the API flows.

---

## Phase 0 — Context & baseline
- [x] Read `menue_ui_improvements.md` fully.
- [x] Skim `components/editor-shell.js`: `SECTIONS`, `activeSubTab`, the
      `panel-tabs` JSX, `renderActiveTab`, the 7 `render*Tab` fns, and
      `function TimingRow`.
- [x] Run the app; note current behaviour of each tab so you can compare after.
- [x] `grep -n "activeSubTab" components/editor-shell.js` — save the hit list; it
      is your remap worklist for Phase 1.

## Phase 1 — Flatten the navigation model
- [x] Rename state `activeSubTab` → `activeSection`; default `"audio"`. Remove the
      `activeSection = getSectionForSubTab(...)` derived line.
- [x] Flatten `SECTIONS` to `[{id:"audio",label:"Audio"},{id:"lyrics",label:"Lyrics"},
      {id:"style",label:"Style"}]`. Delete `SUB_TABS` and `getSectionForSubTab`.
- [x] In the tab-bar JSX (`grep -n "panel-tabs"`): section buttons set
      `setActiveSection(section.id)` and compare `section.id === activeSection`.
      **Delete the entire `.sub-tabs` sub-tab row block.**
- [x] Move the **"Set times / Hide times"** button out of the tab-bar row (see
      Phase 3); for now just change its gate to `activeSection === "lyrics"`.
- [x] Rewrite `renderActiveTab` to `switch (activeSection)` → `renderAudioTab()` /
      `renderLyricsTab()` / `renderStyleTab()`.
- [x] Apply the **ID remap** from the design doc to every `activeSubTab` hit:
  - [x] new-project + clear → `setActiveSection("audio")`
  - [x] after JSON import → `setActiveSection("audio")`
  - [x] debug-probe (×2) + auto-time + tap-start → `setActiveSection("lyrics")`
  - [x] all `activeSubTab === "timings"` guards + `isTimingTab` →
        `activeSection === "lyrics"`
- [x] Compile. Tabs switch with a single row; content still renders (renderers not
      merged yet — a temporary `switch` mapping old fns is fine mid-phase, but by
      end of Phase 4 only the 3 merged renderers remain).

## Phase 2 — Audio combined tab
- [x] Create `renderAudioTab` = old `renderTrackUploadTab` **dropzone only** +
      old `renderGetLyricsTab` (Auto-lyrics + Lyrics data), in the order listed in
      the design doc.
- [x] Add the **slim summary line** (`name · duration · status`) after the
      dropzone; neutral placeholder before upload.
- [x] Delete the **Section offsets** card, **Track name** card, **Duration** card,
      **Upload status** card.
- [x] Remove now-orphaned offset code: `audioOffsetDrafts` state,
      `buildAudioOffsetDrafts`, `commitAudioOffsetDraft`, `resetAudioOffsetDraft`,
      `applySectionAudio`, `audioSectionNotice`, the "Use track end" button. Fix
      any remaining references (e.g. new-project/clear handlers that reset these).
- [x] Confirm `sectionWithinLimit` guard + the global 6:00 warning banner still
      render (kept intentionally).
- [ ] Delete old `renderTrackUploadTab` / `renderGetLyricsTab`. Compile & click
      through: upload, load sample, clear, generate, import/export JSON.

## Phase 3 — Lyrics merged tab (per-line pen edit)
- [x] Add state `const [editingLineId, setEditingLineId] = useState(null)`.
- [x] Merge into `renderLyricsTab` (built from the old `renderTimingTab`):
  - [x] Top: the moved **Set times/Hide times** toggle; then a **bulk-actions**
        row = Romanize lyrics + Generate word meanings buttons + status text
        (lifted from old Edit-Text header); then the existing tap/auto-time block.
  - [x] Footer: **Add lyric line** button (from old Edit-Text).
- [x] Extend `TimingRow` props: `isEditing`, `onToggleEdit`, plus `updateLine`,
      `moveLine`, `deleteLine` (or pass narrow callbacks). Wire from the list.
- [x] In `TimingRow`: make the container `position: relative`; add a **square pen
      button, absolute top-right, rendered only when `isActive`**, calling
      `onToggleEdit`. Use an inline SVG pen icon.
- [x] When `isEditing`, render the expanded editor under the active controls:
      3 × `AutoGrowTextarea` (Original / Romanization / Translation via
      `updateLine`) + Move up / Move down / Delete. Drop the numeric Start field.
- [x] Ensure **every** new input/button `stopPropagation`s on click (row is a
      `role="button"`). Mirror the existing active time `<input>`.
- [x] Delete the standalone old Edit-Text renderer once its parts are relocated.
- [x] Compile. Verify: select a line → pen appears top-right → toggles editor →
      text edits persist to preview → move/delete work → tap-timing still fast.

## Phase 4 — Style collapsibles
- [x] Add `CollapsibleSection({ title, open, onToggle, children })` (header button
      + rotating chevron + conditional body, card-styled).
- [x] Add state `textDisplayOpen = true`, `backgroundOpen = false` (independent).
- [x] Wrap the existing Text-display body and Background body each in a
      `CollapsibleSection`, both returned from `renderStyleTab`. Delete
      `renderBackgroundTab` as a separate case (its body becomes the children).
- [ ] Compile. Verify: Style opens with Text display expanded, Background
      collapsed; each toggles independently; all controls still work.

## Phase 5 — Words tab removal & cleanup
- [x] Remove `renderWordsTab`, its nav entry, and the `switch` case (should already
      be gone after Phase 1's flatten — confirm).
- [x] `grep -n "wordTimings\|WordTiming\|word.*timings" lib/autosave.js lib/project.js`
      → confirm nothing serializes it (expected: nothing).
- [x] Remove dead `wordTimingState` machinery: `wordTimingState`/`setWordTimingState`,
      `handleLoadWordTimings`, `canLoadWordTimings`, `wordTimingBusy`,
      `buildWordTimingState`, `createIdleWordTimingState`, and the now-unused
      `normalizeWordTimings` / `getFlattenedLineWords` / `normalizeLineWords` if no
      other caller remains. Remove their calls in generate/auto-time/import/clear.
- [x] Remove unused `.sub-tabs` / `.sub-tab` CSS in `app/globals.css` if dropping.

## Phase 6 — Verify
- [x] `npm run lint` and the test suite (`npm test` / project equivalent) pass.
- [ ] Full manual pass across all three sections + mobile bottom-sheet snaps
      (panel scrolls; expandable rows and collapsibles don't break the sheet).
- [x] `grep -rn "Track upload\|Get lyrics\|Edit Text\|Words\|Set times" .visual-parity app/debug scripts`
      → update anything that referenced the removed tabs; refresh visual-parity
      snapshots.
- [ ] Sanity: preview, export readiness, and the 6:00 warning still behave.

---

### Done-when
Three single-surface sections; no second-level tab row; Audio decluttered with a
one-line summary and no offsets UI; Lyrics rows edit text via a per-line pen
toggle; Style shows two independent collapsibles (Text open, Background closed);
Words tab and its dead state gone; app compiles, lints, and passes tests.
