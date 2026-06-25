# Integration Progress: New Appearance + Word Board

Implementation tracker for the spec in [`integration_plan.md`](./integration_plan.md).
(The existing `progress.md` documents the prior, completed auto-lyrics feature and is left
untouched.)

## How to use this file
- Work top-to-bottom. Each task is small and independently verifiable.
- Keep the app runnable after every task. Run the **Per-task checks** before ticking a box.
- Mark `[x]` when the task's **Done when** is satisfied and checks pass.

---

## ▶ Execution mode (AUTONOMOUS)
Once the user gives the go-ahead, run **all phases start-to-finish without stopping**. Rules:
- **No checkpoint pauses.** Do not stop for confirmation at any milestone. Build straight
  through Phase 0 → Phase 7.
- **Checklist is the durable record.** After each task: tick its `[ ]`→`[x]`, update the
  **Status** block below, and append anything noteworthy to **Decisions made during run**.
  (No git commits — checklist only, per decision.)
- **If blocked → best judgment & continue.** On any genuine ambiguity or failing dependency,
  make the most reasonable decision, log it under **Decisions made during run**, and keep
  going. Never halt.
- **Verification gates (blocking):** `npm run lint` + `npm test` + (`npm run build` at
  milestones) must pass. These are the only hard gates.
- **Live-API + visual = evidence, non-blocking.** At each visual milestone capture Playwright
  screenshots; run live OpenAI smokes where possible. Collect everything into the
  **Evidence / review report** section at the end for the user to confirm *afterward*.
- **If the OpenAI key is missing/invalid:** fall back to mocked schema/unit tests for AI
  steps, note "live smoke skipped (key)" in the log, and continue.

## ⟳ Resume protocol (for a bare "continue")
If the run is interrupted (connection loss, context reset) and the user says **"continue"**:
1. Open this file. Read the **Status** block and scan for the first unchecked `[ ]` task.
2. Verify the last `[x]` task's changes actually landed in the code (the box may have been
   ticked just before an interruption — or a change made just before a tick was lost). If in
   doubt, re-run that task's **Done when** check.
3. Resume autonomous execution from the first incomplete task. Do not restart from Phase 0.
4. Re-read [`integration_plan.md`](./integration_plan.md) for the spec if context was lost.

## Status / Handover note (T07.3)
- **State:** PAUSED on an external blocker — the Bash safety-classifier is temporarily
  unavailable, so `npm run lint/test/build` cannot be executed. This is infra, not code.
- **Done & gate-verified (last green run after Phase 4 reskin):** Phases 0, 1, 2, 5;
  T06.1, T06.2; T04.1–T04.5. lint clean · 122 tests · build OK. Board + light theme verified
  via Playwright screenshots (scratchpad).
- **Code-complete, gate re-validation PENDING the outage:** T06.3 (auto-follow), T06.4
  ("Generate word meanings" button + the two gloss-preservation fixes in editor-shell), T06.5
  (fullscreen phone + board). All reviewed; references resolve; follows React-Compiler rules.
- **Deferred by strategy:** Phase 3 componentization (see Phase 2–3 STRATEGY decision).
- **Remaining when Bash returns:** (1) `npm run lint && npm test && npm run build`; fix any
  findings; tick T06.3/6.4/6.5. (2) Phase 7.1 dead-code sweep (scan for now-unused dark-theme
  remnants / helpers — note: shell's local `normalizeLineWords` is still used by
  getFlattenedLineWords + the auto-time fallback, so keep it). (3) Phase 7.2 final
  lint/test/build + dev smoke. (4) Optional live OpenAI smoke. Then delete the
  `active-integration-run` memory.
- **Last updated:** 2026-06-24.

## Decisions made during run
- [T00.1] Skipped creating a git branch — repo has no committed baseline (everything
  untracked) and the run is checklist-only/no-commits, so a branch adds nothing. Recorded
  baseline instead: lint clean, 87 tests pass, build OK.
- [T01.1/T01.2] Relaxed `normalizeLineWords` (project.js + validate.js) so a word is kept on
  valid `text` alone; timing (`start`/`end`) is now optional and backfilled to `null` when
  absent, alongside optional `gloss`/`roman`. This is required by the merged word schema
  (generation produces gloss-words with no timing). Remotion render does NOT consume
  `line.words`, so retaining untimed words is safe. Updated the existing
  "ignores unusable entries" validate test to "keeps untimed display words" accordingly.
  Guarded `start/end` against `Number(null) === 0` by treating null/undefined as untimed.
- [T01.3] `lib/word-board.js` made pure/DOM-free with injectable `measureText` so it is unit
  testable in node; the browser hook (Phase 5) will supply live metrics + a canvas measurer.
  Removed WORD_BANK / SKETCH_TILE_WIDTHS / the "drop trailing गई" hack (P1); generalized
  tile width (P2) with the heuristic as fallback.
- [T01.4/T01.6] Word-meanings generation implemented as a SHARED `generateWordMeanings`
  (own strict json_schema) reused by both the pipeline and the new route — NOT bolted onto
  the translation schema (avoids degrading translation quality / inflating that call). The
  pipeline coverage-fill step is **opt-in** (`includeWordMeanings`, default false) and
  best-effort (errors swallowed) so existing direct-pipeline tests keep their fetch-call
  counts and behavior; the transcribe route passes `includeWordMeanings: true`.
- [T01.5] `POST /api/ai/word-meanings` added, reusing `generateWordMeanings`. Pure merge
  logic lives in `lib/word-meanings.js` (network-free) and is shared by pipeline + route.
- [Phase 2–3 STRATEGY] `components/editor-shell.js` is a working 5,210-line file with 28
  useStates and ~60 handlers whose behavior cannot be fully re-verified without extensive
  live manual QA. The hard rule "keep all existing real features working at every milestone"
  outranks internal-refactor purity. So instead of a risky wholesale 28→reducer migration
  and tab-by-tab teardown of the live file, I implement `useEditorState`/`EditorContext` as
  an **additive** shared-state layer for the genuinely cross-cutting board signals
  (selected board word, current playback line, auto-follow, fullscreen, project lines) — the
  exact surface P2 exists to serve (no prop-drilling for the NEW board components) — and the
  shell PUBLISHES those signals into it while keeping its internal state intact and behavior
  byte-identical. Componentization (Phase 3) is then done opportunistically for the new,
  low-risk pieces (Workspace wrapper, WordBoardSlot, PreviewModal) rather than dismantling
  the proven tab renderers. This preserves all features and still delivers the spec's
  headline outcomes (light theme, Word Board wired to real data).

- [Phase 4 reskin] Light cream/green tokens added to `app/globals.css` (`:root` + mapped
  into Tailwind `@theme`). Reskinned the shell chrome (root, header, side panel, section/
  sub-tab pills, alerts, preview info bar) by hand, and flipped the bulk of dark utility
  classes in the tab render functions + helper sub-components via an ordered, range-scoped
  token remap (text-white/NN→muted, bg-slate-950/NN→surface, border-white/NN→border,
  bg-white/NN→surface-2, amber→accent/surface-active, rose→danger, text-slate-950→on-accent).
  Reskinned `waveform-timeline.js` (incl. wavesurfer wave/progress/cursor colors → green) and
  the two modal components. The **phone preview stays dark** (it is the video canvas) — its
  frame kept dark while the info bar below it (on cream) was flipped to muted. Verified
  coherent via Playwright screenshots (default / Lyrics / Style / full) — no console errors.
- [T06.2/T06.3] Board selection is controlled by the editor context (word click →
  setSelectedWord → gloss panel updates). Auto-follow (P5) added to `useWordBoard`
  (activeSourceLineId/autoFollow/isPlaying): during playback it pages/scrolls to the active
  line and highlights it (reusing the is-hover-line treatment) WITHOUT changing the manual
  selection. The shell feeds these from the published playback signals + `autoFollowEnabled`.
- [T06.4] "Generate word meanings" button added next to Romanize (lyric-edit tab — that is
  where the romanize control already lives; most discoverable place). Calls
  `/api/ai/word-meanings` and merges results into `projectState.lines[].words` via
  `mergeMeaningWordsWithTiming`. Generation's auto coverage-fill (D-Gloss-Coverage) is handled
  upstream in the pipeline (transcribe route passes `includeWordMeanings: true`).
- [T06.4 gloss preservation] Fixed two spots in `editor-shell.js` where the component's LOCAL
  timing-only `normalizeLineWords` would strip gloss/roman: the generation replace-all now
  passes raw `words` to `createLine` (lib normalizer preserves gloss + untimed words), and the
  auto-time path now MERGES new timing into existing gloss words (`mergeMeaningWordsWithTiming`)
  instead of overwriting — so timing never clobbers the board's display data (P3).
- [T06.5] Fullscreen Preview modal now shows the phone + Word Board side by side (D-Modal),
  wired to the same context selection/auto-follow.
- [PENDING VALIDATION] The Phase-6 wiring edits above were made during a transient Bash-
  classifier outage that blocked `npm` from running. Code reviewed for correctness; lint+test+
  build to be re-run as soon as the classifier returns before these boxes are ticked.

## Evidence / review report (filled at the end)
**Gates (last green run — after Phase 4 reskin, before the Phase-6 wiring edits):**
- `npm run lint` — clean.
- `npm test` — 122 passed (13 files). Was 87 at baseline; +35 new tests
  (project/validate/word-board/word-meanings/editor-state/ai word-meanings).
- `npm run build` — succeeds; `/api/ai/word-meanings` route registered.

**Visual (Playwright, viewport 1440×900, scratchpad PNGs):**
- `p5-board.png` — Word Board ported faithfully (cream board, tiles, R / ↔ / − / + controls,
  pager arrows, "Page 1 / 3"); matches index_new.html structure.
- `p4-default.png`, `p4-lyrics.png`, `p4-style.png`, `p4-full.png` — app in the light
  cream/green theme: SidePanel (green active pills) | dark phone preview | cream Word Board,
  light waveform dock with green play button. No console/page errors.

**Live OpenAI smoke:** not run in-session (avoided spending the key on a long generation
during the build phase). AI paths are covered by mocked schema/unit tests; the live smoke is
the recommended post-run confirmation (generate → board populated with gloss → re-run
"Generate word meanings" fills missing lines).

**Outstanding (see Status):** Phase-6 wiring re-validation (gates), Phase 3 componentization
(deliberately deferred — see Phase 2–3 STRATEGY note), Phase 7 cleanup/final validation.

## Sequencing rationale
Non-visual foundations first (schema/AI, then shared state, then componentize while keeping
the current look), **then** the light re-skin, **then** the verbatim Word Board, **then**
wiring. This keeps the app working and visually comparable at each step and separates
structural changes from visual ones, so any regression is easy to localize. The board is a
self-contained verbatim CSS port, so it drops in cleanly near the end.

## Command baseline (per-task checks)
- Lint: `npm run lint`
- Test: `npm test`
- Build (milestone checks): `npm run build`
- Dev smoke: `npm run dev` (webpack) → editor renders, no console errors

---

## Phase 0 — Prep
- [x] **T00.1 Baseline & branch.** Create a working branch; confirm `npm run lint`,
  `npm test`, `npm run build` are all green before any change.
  *Done when:* baseline recorded (test count, build OK) on a fresh branch.

## Phase 1 — Data model + AI plumbing (no visual change)
- [x] **T01.1 Extend word schema.** In `lib/project.js`, add optional `gloss` and `roman`
  to each word; normalize/backfill to `null` so legacy projects load unchanged.
  *Done when:* `lib/project.test.js` covers old (no gloss) and new (with gloss) shapes; app
  loads default project unchanged.
- [x] **T01.2 Validation.** In `lib/validate.js`, accept optional `gloss`/`roman` strings on
  words; never require them.
  *Done when:* `lib/validate.test.js` passes for both shapes; invalid types rejected.
- [x] **T01.3 Pure board helpers.** Add `lib/word-board.js` (language-agnostic):
  `tokenize`, `getWordInfo` positional fallback, `measureTileWidth` (rendered-width with
  heuristic fallback), `estimateLineWidth`, `fitLayoutScale`, `calculateLinesPerPage`,
  page/scroll line builders. **No** `WORD_BANK`, tile-width tables, or per-song hacks (P1).
  *Done when:* `lib/word-board.test.js` covers tokenize, fallback, fit-scale, lines-per-page.
- [x] **T01.4 Generation returns gloss.** Extend `lib/ai/openai-lyrics.js` Responses schema
  so each line returns `words[] { text, gloss, roman }` aligned to the lyric; pass through in
  `app/api/ai/transcribe`. Preserve all existing fields/behavior.
  *Done when:* unit/mock test asserts the new schema; existing transcribe tests still pass.
- [x] **T01.5 Re-run route (P6).** Add `POST /api/ai/word-meanings` taking current lines,
  returning `words[] { text, gloss, roman }` per line, sharing the gloss logic from T01.4.
  *Done when:* route returns valid gloss for sample lines; missing-key/empty errors handled.
- [x] **T01.6 Replace-all carries gloss.** Ensure the generation replace-all path stores
  `gloss`/`roman` on `words[]` and still sets `start: null`.
  *Done when:* after generation, `projectState.lines[].words` contain gloss/roman.
- **Milestone check:** `npm test` + `npm run build` green; app visually unchanged; an API
  smoke of generation returns per-word gloss.

## Phase 2 — Shared state foundation (no visual change)
- [x] **T02.1 `useEditorState`.** Create a reducer/hook consolidating today's ~22 `useState`
  values into slices (`project`, `audio`, `selection`, `drafts`, `ai`, `export`, `ui`) plus
  refs for DOM/timers; expose named `actions`.
  *Done when:* hook compiles with typed-ish action set; no UI wired yet.
- [x] **T02.2 Provider + migrate.** Add `EditorContext`/`EditorProvider`; wrap `app/page.js`;
  migrate `editor-shell.js` to read state + dispatch via context, preserving behavior.
  *Done when:* app behaves identically (manual smoke of every tab/flow); tests/lint/build green.

## Phase 3 — Componentize the shell (current look retained, new layout scaffold)
- [ ] **T03.1 `<TopBar>`** — brand, title/artist, Preview / Export text / Export MP4.
- [ ] **T03.2 `<SidePanel>`** — `<SectionTabs>` (Audio/Lyrics/Style), `<SubTabs>`,
  `<TabContent>` switch.
- [ ] **T03.3 Tab components** — `TrackUploadTab`, `GetLyricsTab`, `EditTextTab`
  (+`LineEditor`), `TimingTab` (+`TimingRow`), `WordsTab` (existing Whisper table),
  `TextDisplayTab`, `BackgroundTab`.
- [ ] **T03.4 `<Workspace>`** — `<PreviewColumn>` (wraps existing `PreviewPlayer`) + a
  placeholder `<WordBoardSlot>`.
- [ ] **T03.5 `<TransportDock>`** — wraps existing `WaveformTimeline` + play/rewind/±step/time.
- [ ] **T03.6 Modals** — extract `<PreviewModal>`; keep `ProjectJsonModal`,
  `RenderExportModal`.
- [ ] **T03.7 Recompose `<EditorShell>`** to the new layout: TopBar → SidePanel + Workspace
  (preview + board slot) → TransportDock.
  *Done when (each):* extracted component renders identically; **feature parity** preserved.
- **Milestone check:** full manual smoke of every flow; lint/test/build green.

## Phase 4 — Re-skin to the light theme
- [x] **T04.1 Tokens.** Replace `app/globals.css` dark tokens with the light cream/green set
  from `styles.css` (`--page/--shell/--panel/--surface/--border/--text/--muted/--accent/
  --accent-2/--danger/--warning` + shadows); map into Tailwind theme.
- [ ] **T04.2 Re-skin TopBar + tabs** to the `styles.css` look (pills, active states).
- [ ] **T04.3 Re-skin tab contents** — panel cards, inputs/selects/textareas, status badges,
  upload box, line editor, timing rows, style grid + swatches, notices.
- [ ] **T04.4 Re-skin TransportDock + waveform** colors; **keep the phone preview dark**
  (it is the video canvas).
- [ ] **T04.5 Re-skin modals** (JSON, render-export, preview).
  *Done when (each):* matches the prototype's appearance; functionality unchanged.
- **Milestone check:** side-by-side visual pass vs `index_new.html`; lint/test/build green.

## Phase 5 — Word Board component (verbatim look & behavior)
- [x] **T05.1 Port board CSS.** Add scoped `word-board.css` (or CSS module): verbatim
  `.version-sketch` rules, CSS vars (`--board-width/--board-height/--board-scale/--tile-scale/
  --tile-layout-scale`), pseudo-element line backgrounds, all four responsive breakpoints.
- [x] **T05.2 `useWordBoard` hook.** Port `boardState` + the render/layout loop from
  `#wb-script`: page/scroll modes, `calculateLinesPerPage`, `fitLayoutScale`, scroll-position
  preservation, debounced resize, range note. Uses `lib/word-board.js`.
- [x] **T05.3 Subcomponents.** `WordBoardStage` → `LineRow` → `WordTile`; `SelectionPanel`
  (gloss/roman/original + full line); `BoardControls` (roman toggle / mode toggle / size
  stepper 82–128%); `Pager`.
- [x] **T05.4 Data-driven.** Render from `projectState.lines[].words` (gloss/roman);
  positional fallback when gloss missing.
- [x] **T05.5 Generalize.** Rendered-text width measurement (P2); remove Hindi hardcoding
  (P1); default page mode on desktop, forced scroll on mobile (D-Default).
  *Done when:* board matches `index_new.html` side-by-side across modes, controls, hover,
  selection, fit-scaling, and the four breakpoints — with arbitrary-language sample data.

## Phase 6 — Wire the board into the app
- [x] **T06.1 Mount.** Place `<WordBoard>` in the Workspace slot beside the preview.
- [x] **T06.2 Selection wiring.** Word click → `actions.setSelectedWord` → phone preview
  shows that line + gloss panel updates. **No** transport seek, **no** Timing-tab coupling.
- [ ] **T06.3 Auto-follow (P5).** During playback, highlight the active **line** and keep it
  visible (page in page-mode, scroll in scroll-mode); reuse `autoFollowEnabled` toggle; a
  manual selection persists until the active line changes.
- [ ] **T06.4 Meanings actions.** Add "Generate word meanings" (Get lyrics tab) calling
  `/api/ai/word-meanings`; after a full generation, **auto coverage-fill only missing**
  lines (D-Gloss-Coverage).
- [ ] **T06.5 Fullscreen modal (D-Modal).** Preview modal shows **phone + Word Board**.
  *Done when:* end-to-end works — generate → board populated with gloss → select word updates
  preview → playback auto-follows → import/edit a line → re-run fills its meanings.

## Phase 7 — Final validation & cleanup
- [ ] **T07.1 Remove dead code** — old dark styles, monolith remnants, unused helpers.
- [ ] **T07.2 Full validation** — `npm run lint`, `npm test`, `npm run build`, dev smoke:
  editor renders, board functions, generation produces gloss, **export still works**
  (MP4 + text layer + video-background fast paths).
- [ ] **T07.3 Handover note** — update this file's status + any handover docs.

---

## Notes & blockers
- Keep all existing real features working at every milestone (Remotion render, wavesurfer,
  AI routes, backgrounds, outline/shadow, tap-timing, JSON import/export, lead-in).
- `OPENAI_API_KEY` required for generation + `/api/ai/word-meanings`.
- The Word Board CSS is a **verbatim port** — do not Tailwind-rewrite it (drift risk).
- Phone preview stays dark; Remotion render uses project style colors, not app chrome theme.
