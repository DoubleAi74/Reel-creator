# Staged lyric pipeline — implementation checklist

Ordered steps for a fresh agent. **Read `staged_lyrics_pipeline.md` first** (design,
contracts, locked decisions, re-run policy), then work top-to-bottom here. Check boxes
as you go and fill the **Notes / deviations** section at the bottom.

**Ground rules**
- **Behaviour-preserving until Phase 5.** Phases 1–4 are infrastructure: the app keeps
  working exactly like today (single full run) the whole time. Only Phase 5 flips the UI
  to expose the three parts. Never leave a red state at a phase boundary.
- **Stateless phases.** Each part sends the *current* `projectState.lines` +
  `audioAssetId` and returns only its own slice. No server-side pipeline state between
  parts. (See design §3.)
- **Reuse what exists.** `applyAutoTimingResult` (Part 3 apply) and
  `applyWordMeaningsToLines` (Part 2 merge) already exist — do not reinvent them.
- **Navigate with grep anchors, not line numbers** (they drift). Anchors are given per
  step. Use the `@/` import alias, kebab-case filenames, `PascalCase` exports — match the
  surrounding code.
- **The compiler/tests are your safety net.** After each change: `npm run test`,
  `npm run lint`, `npm run build`. Keep [lib/ai/openai-lyrics.test.js](../lib/ai/openai-lyrics.test.js)
  and [lib/word-meanings.test.js](../lib/word-meanings.test.js) green throughout Phase 1.
- **Do not `git commit`** unless the user asks. (If they do: one commit per closed phase.)
- **Do not touch** render/export flows, waveform, preview player, or Word Board internals.
- **Locked decisions** (design §1) are not up for re-litigation: manual gating + presets;
  toggles + single Run; first-class editing; silent-except-Part-1-confirm re-run.

**Per-change recipe**
1. Make the smallest change that compiles.
2. `npm run lint` + `npm run build` → resolve errors.
3. `npm run test` → keep green (add/adjust tests in the same step when behaviour is new).
4. Sanity-glance the diff: is it only what this step intends?

---

## Phase 0 — Baseline & safety net
- [x] Read `staged_lyrics_pipeline.md` fully (esp. §2 what-exists, §3 target, §6 re-run).
- [x] Record a green baseline: `npm run test`, `npm run lint`, `npm run build`.
      → **VERIFIED 2026-07-01 (prior session):** test **186/186 (19 files)**, lint **clean**,
      build **compiled** (all 15 routes emit). Line counts: `lib/ai/openai-lyrics.js`
      **3566**, `components/editor-shell.js` **3621**, `lib/ai/transcribe-job.js` **104**,
      `lib/autosave.js` **288**. Re-confirm these are still green before you start.
- [x] Skim the anchors you'll touch: `runLyricTimingPipeline`, `buildCanonicalLyricSet`,
      `requestLyricTranslations`, `polishCanonicalLyricSet`, `fillTimingGaps`,
      `runQualityAudit`, `requestTimestampedTranscriptionFromChunks`,
      `attachWordMeaningsCoverage` (openai-lyrics.js); `runTranscribeJob`
      (transcribe-job.js); `handleGenerateAutoLyrics`, `startTranscriptionJob`,
      `beginTranscriptionTracking`, `applyAutoLyricsResult`, `applyAutoTimingResult`,
      `transcription` state (editor-shell.js); `normalizeTranscription` (autosave.js);
      `onGenerate` (audio-tab.js).
      → NOTE: `alignLyricLinesToWordTimings`, `summarizeLyricTimingMatches`,
      `tokenizeForTiming` are **imported from `../lyric-timing`** (not defined in
      openai-lyrics.js). `applyWordMeaningsToLines` is imported from `../word-meanings`.
- [ ] Confirm the manual smoke path works today: `npm run dev`, upload an MP3, pick a
      source language, run the single button, watch it complete. This is your reference.
      (Not done in the prior session — do this before Phase 1.)
- [x] **CHECK:** baseline green. → PASS (test/lint/build). Manual smoke still owed (above).

## Phase 1 — Server: decompose the monolith (pure refactor, no behaviour change)
Goal: three composable functions the staged flow can call, **without regressing the
existing full run**. This is the highest-risk phase; keep tests green after each step.

> ⚠️ **CRITICAL CAVEAT — do NOT literally "recompose `runLyricTimingPipeline` from the
> three functions".** The design doc (§3.1) suggests that, but it is unsafe as written,
> because the current execution order is **transcribe → translate → polish → TIMING →
> word-meanings** — i.e. word-meanings runs **after** timing, *not* bundled with
> translate/polish. A literal recompose that calls a bundled `enrichLyricLines`
> (translate+polish+word-meanings) in the middle would move word-meanings *before*
> timing and **change the output** (the gloss/timing word-merge order flips).
>
> **Safe approach for Phase 1 (verified against the real code — treat as authoritative):**
> 1. Extract **`transcribeAndCleanLyrics`** = the transcribe+clean block of
>    `buildCanonicalLyricSet` (everything *except* its final `requestLyricTranslations`).
>    Then make `buildCanonicalLyricSet` call `transcribeAndCleanLyrics` + `requestLyricTranslations`
>    → identical output, so `runLyricTimingPipeline` is untouched behaviourally. ✅ safe.
> 2. Add **`enrichLyricLines`** and **`timeLyricLinesFromAudio`** as **new standalone
>    functions composed from the existing lower-level primitives** (`requestLyricTranslations`,
>    `polishCanonicalLyricSet`, `generateWordMeanings`/`applyWordMeaningsToLines`; and
>    `requestTimestampedTranscriptionFromChunks` → `alignLyricLinesToWordTimings` →
>    `fillTimingGaps` → `runQualityAudit`). These are for the **staged** flow only.
> 3. **Leave `runLyricTimingPipeline`'s body as-is** (still the `phase:"full"` default).
>    A small, temporary orchestration overlap between it and the two new standalone
>    functions is acceptable and *far* safer than surgically carving its interleaved
>    timing/word-meanings tail. Consolidate later (Phase 7) once the client no longer
>    calls the full path — only then can `runLyricTimingPipeline` be simplified to chain
>    the three (accepting the word-meanings reorder, which is fine for a then-unused path).
>
> Record this as deviation #1 in the notes. Verify the staged functions via their **own**
> new tests (incl. the "2 then 3" / "3 then 2" merge-order test), not via the full-run test.

- [ ] **`transcribeAndCleanLyrics(...)`** ← extract from `buildCanonicalLyricSet`
      *everything except* the final `requestLyricTranslations` call. It returns
      `{ lines: [{ id, original }], sourceRepairSummary, source }`. Assign stable line
      `id`s here (grep how ids are created elsewhere, e.g. `createLine`/`crypto.randomUUID`).
      Keep the locked-lines early-return behaviour.
- [ ] **`enrichLyricLines({ lines, sourceLanguage, includeRomanization, onProgress })`**
      ← compose `requestLyricTranslations` + `polishCanonicalLyricSet` + word-meanings
      (`generateWordMeanings`/`attachWordMeaningsCoverage`). Returns per-line
      `{ id, translation, romanization, words:[{text,gloss,roman}] }`. **Do not** do timing.
      (Polish scoping / D2 is applied in Phase 6 — for now keep polish as-is to preserve
      behaviour; note the TODO.)
- [ ] **`timeLyricLinesFromAudio({ lines, fileBuffer, fileName, contentType, audio, sourceLanguage, onProgress })`**
      ← extract the timing tail: `requestTimestampedTranscriptionFromChunks` →
      `alignLyricLinesToWordTimings` → `fillTimingGaps` → `runQualityAudit`. Returns the
      per-line timing slice + `{ duration, words, language }`. Takes already-canonical
      lines; must **not** re-transcribe content or translate.
- [ ] **Do NOT recompose `runLyricTimingPipeline` in Phase 1** (see the CRITICAL CAVEAT
      above). Only step 1 touches it *indirectly* — via `buildCanonicalLyricSet` now
      delegating its transcribe+clean block to `transcribeAndCleanLyrics`. Confirm
      `runLyricTimingPipeline`'s output is byte-equivalent (existing tests prove it). Its
      result keys must stay: `lines`, `words`, `duration`, `timingSummary`, `qualitySummary`,
      `sourceRepairSummary`, `lyricPolishSummary`, `wordMeaningsSummary`, etc. Full-path
      consolidation is deferred to Phase 7.
- [ ] Add/extend unit tests for the three new functions (mirror existing patterns in
      [lib/ai/openai-lyrics.test.js](../lib/ai/openai-lyrics.test.js)). Include a
      **"2 then 3" and "3 then 2"** word-merge ordering test (design §8).
- [ ] **CHECK (phase close):** `npm run test` (incl. existing openai-lyrics + word-meanings
      suites) + `npm run lint` + `npm run build` all green. `runLyricTimingPipeline` output
      unchanged (existing tests prove it). No route/client files touched yet.

## Phase 2 — Server: phase-aware job + route (backward compatible)
- [ ] **`runTranscribeJob`** ([lib/ai/transcribe-job.js](../lib/ai/transcribe-job.js)):
      accept a `phase` param and dispatch — `"transcribe"` → `transcribeAndCleanLyrics`,
      `"enrich"` → `enrichLyricLines`, `"time"` → `timeLyricLinesFromAudio`,
      absent/`"full"` → `runLyricTimingPipeline` (today's behaviour, unchanged default).
      Reuse the existing `markTranscribeJob*` progress plumbing.
- [ ] **Route** ([app/api/ai/transcribe/route.js](../app/api/ai/transcribe/route.js)):
      read `payload.phase` and `payload.lines` (validate like `normalizeLines`
      elsewhere); thread them into `runTranscribeJob`. Absent `phase` = full run (existing
      callers keep working). Keep the 409 in-flight adoption + session recovery intact.
- [ ] The `[jobId]` status route + `toTranscribeJobResponse` need **no change** (they already
      return `result` on done; per-phase result shape differs, applied client-side).
- [ ] Tests for the route/job dispatch per phase (mirror
      [lib/ai/transcribe-store.test.js](../lib/ai/transcribe-store.test.js) style if a job
      test exists; otherwise a focused unit test on the dispatch).
- [ ] **CHECK (phase close):** green table. Manually re-run the single button end-to-end
      (`npm run dev`) — still identical (it sends no `phase`, hits the full-run default).

## Phase 3 — Client: phase-aware tracking + enrich apply path (still single-button UX)
No visible UX change yet — the single button still works. This wires the three apply
paths behind the scenes.

- [ ] **Generalise the job pointer:** rename `transcription.mode` → `transcription.phase`
      across [components/editor-shell.js](../components/editor-shell.js) (grep
      `transcription.mode`, `mode: "lyrics"`, `mode === "timing"`, `beginTranscriptionTracking`).
      Values: `"transcribe" | "enrich" | "time" | "full"`.
- [ ] **Autosave:** update `normalizeTranscription`
      ([lib/autosave.js](../lib/autosave.js)) to accept the phase values (map legacy
      `"lyrics"`→`"transcribe"`, `"timing"`→`"time"`). Prefer bumping `AUTOSAVE_VERSION`
      (design §10.3) over a fragile tolerant decoder. Update
      [lib/autosave.test.js](../lib/autosave.test.js).
- [ ] **`startTranscriptionJob`**: add a `phase` (and `lines` for enrich/time) to the POST
      body (grep `fetch("/api/ai/transcribe"`).
- [ ] **Apply paths** — in the poll effect (grep `payload.status === "done"`):
      - `transcribe` → `applyAutoLyricsResult` (existing; replaces lines).
      - `enrich` → **new `applyEnrichResult`**: merge `translation`/`romanization` by id +
        fold gloss via `applyWordMeaningsToLines`; must NOT touch `start`/`end`.
      - `time` → `applyAutoTimingResult` (existing).
- [ ] **CHECK (phase close):** green table. Manual: temporarily invoke each phase (e.g. a
      scratch dev-only call, or wire the existing button to `phase:"full"`) and confirm the
      full run still applies correctly. Remove any scratch wiring before closing.

## Phase 4 — Client: selection state + Run orchestration + gating (logic only)
- [ ] Add transient selection state (not persisted): toggled parts `{1,2,3}` + active preset.
- [ ] Derive `canRun` per part from line data (design §5): Part 1 ⇔ audio uploaded; Parts
      2 & 3 ⇔ lines with `original` exist.
- [ ] **`handleRunPipeline`**: run the selected parts **sequentially** — for each selected
      part in order 1→2→3: `startTranscriptionJob({ phase, lines: projectState.lines, ... })`
      → `beginTranscriptionTracking(jobId, phase)` → await the poll effect to reach
      `done`/`error` → on done the apply path has run → proceed to next part reading the
      *updated* `projectState.lines`. Stop the chain on error. (Await pattern: resolve when
      `transcription.phase === phase && status === "done"`; reuse existing refs/guards.)
- [ ] Presets set the toggles (All three=1,2,3 · First two=1,2 · First one=1).
- [ ] **CHECK (phase close):** green table. Unit-test the gating derivation + preset→toggle
      mapping where practical.

## Phase 5 — UI: toggles + presets + Run in the Audio tab  *(the visible switch)*
- [ ] Replace the single **"Generate & time lyrics"** control (grep `onGenerate` /
      "Generate & time lyrics" in [components/tabs/audio-tab.js](../components/tabs/audio-tab.js))
      with: preset chips (All three / First two / First one), three part toggles
      (disabled when `canRun` is false), and one **Run** button (label reflects the
      selection; disabled when nothing selected or a job is in flight).
- [ ] Per-part **status readout**. Decide the shape (design §10.2): recommended single
      `pipelineState` with a sub-status per part. Reuse the existing status-badge styling.
      Preserve the language selector + requirement message behaviour (grep
      `autoLyricsLanguageRequirementMessage`, `sourceLanguage`).
- [ ] Thread new props through the shell's `lyricsSource` group (grep `lyricsSource={{`)
      — follow the existing grouped-prop convention (no new prop-drilling beyond the group).
- [ ] **CHECK (phase close):** green table + manual matrix (`npm run dev`):
      - Upload MP3 → run **First one** → review lyrics → edit a line → run **Part 2 only**
        → review translations → run **Part 3 only** → timing appears, gloss preserved.
      - **All three** in one go → intermediate results appear as each part lands.
      - `1 + 3` (manual, skip 2) → timing works without translations.
      - Reload mid-job → the in-flight part resumes (autosave recovery).

## Phase 6 — Re-run policy: confirm + polish scoping (design §6)
- [ ] **Part-1 confirm:** before running when Part 1 is selected AND downstream data exists
      (derive: any line has `translation` or finite `start`), show one confirm — *"This
      rebuilds your lyric set and clears the translation and timing below. Continue?"* Treat
      **line add/delete/reorder** as a Part-1-level structural change for this gate.
- [ ] Parts 2 and 3 re-run **silently** (no dialog, no badge). Manual edits stay silent.
- [ ] **D2 polish scoping:** make the standalone Part 2 (`enrichLyricLines`) polish **not
      rewrite `original`** (grep `allowOriginalChanges` / `buildLyricPolishSchema`). The
      recomposed full-run path may keep today's behaviour. Add a test asserting Part 2 leaves
      `original` untouched (so re-running Part 2 can't invalidate Part 3 timing).
- [ ] **CHECK (phase close):** green table. Manual: with all three done, re-run Part 2 →
      timing survives, no dialog; re-run Part 1 → confirm appears, and on accept downstream
      clears/rebuilds.

## Phase 7 — Final verification & cleanup
- [ ] Full manual matrix (Phase 5 + 6 lists) passes with zero console errors.
- [ ] **Dormant routes:** delete `/api/ai/auto-time`, `/api/ai/word-meanings`,
      `/api/ai/romanize` and their now-unused lib exports (design §9), unless the owner
      defers. Grep to confirm nothing references them. Assess `/api/ai/word-timings`
      separately.
- [ ] Remove any scratch/dev-only wiring and now-unused imports (TS-server diagnostics catch
      unused imports; eslint here does not).
- [ ] **Final CHECK:** `npm run test` ✅ `npm run lint` ✅ `npm run build` ✅ + full manual
      click-through. Report: files changed, new functions/routes, tests added, deviations.

---

## Rollback
Each phase is self-contained and behaviour-preserving until Phase 5. If a CHECK fails and
can't be fixed quickly, `git restore` the files touched in that phase back to the last
green boundary and retry — do not carry red into the next phase. Phases 1–4 can be shipped
without Phase 5 (the UI switch) with zero user-visible change, so they can land
incrementally.

## Validation reference (commands)
- `npm run test` · `npm run lint` · `npm run build` — must be green at every phase close.
- `npm run dev` — manual smoke; the Phase-0 single-button run is your behavioural baseline.
- Key suites to watch: `lib/ai/openai-lyrics.test.js`, `lib/word-meanings.test.js`,
  `lib/autosave.test.js`, `components/editor-state.test.js`.

## Notes / deviations (fill in as you go)
- **Handoff state (2026-07-01):** Phase 0 done — baseline verified green (test 186/186,
  lint clean, build compiled). **No implementation code written yet** (docs only). A fresh
  agent picks up at Phase 1. The manual `npm run dev` smoke (Phase 0 last box) is still owed.
- **Deviation #1 (Phase 1) — safe decomposition instead of literal recompose.** See the
  CRITICAL CAVEAT under Phase 1. Word-meanings runs *after* timing in the current
  `runLyricTimingPipeline`, so a literal "recompose from the three functions" (design §3.1)
  would reorder it and change output. Instead: extract `transcribeAndCleanLyrics` and have
  `buildCanonicalLyricSet` delegate to it (identical output); add `enrichLyricLines` +
  `timeLyricLinesFromAudio` as new standalone functions composed from existing primitives;
  leave `runLyricTimingPipeline`'s body untouched until Phase 7 consolidation. Confirmed by
  reading the real function bodies (`buildCanonicalLyricSet`, `runLyricTimingPipeline`,
  `fillTimingGaps`, `attachWordMeaningsCoverage`, `requestLyricTranslations`).
- _(record further departures here as you go)_
