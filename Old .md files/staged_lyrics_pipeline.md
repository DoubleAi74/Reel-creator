# Staged lyric pipeline — design & implementation plan

Split the current single "Generate & time lyrics" action into **three independently
runnable parts**, each becoming a discrete, resumable job with its own progress and
its own point at which the user can review/edit before continuing.

> Companion doc: **`staged_lyrics_pipeline_progress.md`** — the ordered, checkbox
> implementation guide a fresh agent follows. Read this design doc first, then work
> that one top-to-bottom.

---

## 1. Goal & locked UX decisions

The lyric AI flow decomposes naturally into three parts:

| Part | Name | Produces (per line) | Models |
|---|---|---|---|
| **1** | **Transcribe & clean** | `original` text, split into lines, with stable `id`s | `gpt-4o-transcribe` (content) → `gpt-4o` (line breaks) → `gpt-5.4-mini` (source repair) |
| **2** | **Translate & enrich** | `translation`, `romanization`, per-word `gloss`/`roman` ("get words") | `gpt-5.4-mini` (translate) → `gpt-5.4` (polish) → `gpt-5.4-mini` (word meanings) |
| **3** | **Time** | per-line `start`/`end`, per-word `start`/`end`, `confidence`, `quality` | `whisper-1` (timing + gap fill) + `gpt-4o-mini` (quality audit) |

**Decisions locked with the product owner (do not re-litigate):**

- **Gating = manual, guided by presets.** Underneath, any part is runnable whenever
  its data prerequisites are met. The UI guides with presets: **All three** / **First
  two** / **First one**. (Manual mode technically allows 1→3 skipping 2, because Part 3
  only needs the lyric text — see §4.)
- **Controls = toggles + a single Run button**, in the initiation button area (the
  Audio tab's Auto-lyrics card). Toggles pick which parts to run; Run executes the
  selected parts **in sequence**.
- **Editing between parts is first-class.** Each part reads the *current* editor state,
  so anything the user edits between parts is honoured. This is the core payoff.
- **Re-run policy = silent when safe, one confirm when destructive** (see §6).
- **Architecture = stateless phases.** The client holds the intermediate state (in
  `projectState.lines`); each part sends the current lines + `audioAssetId` and returns
  only its own slice, which the client merges back. No server-side pipeline state
  between parts.

**Why this is worth doing:** a bad transcription silently poisons everything
downstream (timing aligns to the wrong words; translation translates the wrong
lyrics). Letting the user fix lyrics after Part 1, and translations after Part 2,
before the expensive Whisper timing pass, is the real quality win — not cost.

---

## 2. Current architecture (what exists today)

All client AI traffic is one job flow driven from
[components/editor-shell.js](../components/editor-shell.js):

- **UI trigger:** Audio tab → single **"Generate & time lyrics"** button
  ([components/tabs/audio-tab.js](../components/tabs/audio-tab.js), `onGenerate`).
- `handleGenerateAutoLyrics` → `startTranscriptionJob` → `POST /api/ai/transcribe`
  (one `mode: "lyrics"` job) → `beginTranscriptionTracking(jobId, "lyrics")`.
- A poll effect (grep `runPoll` near `fetch(\`/api/ai/transcribe/${jobId}\`)`) drives
  the job to completion, then applies via `applyAutoLyricsResult` (replace all lines)
  or `applyAutoTimingResult` (merge timing by id) depending on `transcription.mode`.
- Server: [app/api/ai/transcribe/route.js](../app/api/ai/transcribe/route.js) →
  `runTranscribeJob` ([lib/ai/transcribe-job.js](../lib/ai/transcribe-job.js)) →
  **`runLyricTimingPipeline`** ([lib/ai/openai-lyrics.js](../lib/ai/openai-lyrics.js))
  which runs **all nine steps** in one pass with `includeWordMeanings: true`.
- Jobs live in [lib/ai/transcribe-store.js](../lib/ai/transcribe-store.js) (in-memory,
  queue → running → done/error, 24h retention, resilient client recovery).
- The active-job pointer (`transcription` state) is persisted via
  [lib/autosave.js](../lib/autosave.js) (`normalizeTranscription`, `mode` currently
  `"lyrics" | "timing"`), so a reload/sleep resumes the job.

### The monolith to decompose

`runLyricTimingPipeline` (grep `export async function runLyricTimingPipeline`) is the
single function that does everything, in this exact order:

```
buildCanonicalLyricSet:                         ── PART 1 material ──
  requestContentTranscriptionResilient (gpt-4o-transcribe)   stage canonical-lyrics
  requestLyricLineBreaks               (gpt-4o)               stage formatting
  repairGeneratedSourceLines           (gpt-5.4-mini)         stage source-repair
  requestLyricTranslations             (gpt-5.4-mini)         stage translating   ← belongs to PART 2
polishCanonicalLyricSet                (gpt-5.4)              stage polishing      ← belongs to PART 2
requestTimestampedTranscriptionFromChunks (whisper-1)        stage timing-pass-1  ── PART 3 ──
alignLyricLinesToWordTimings           (local)
fillTimingGaps → transcribeGapWindows  (whisper-1)           stage timing-pass-N
runQualityAudit                        (gpt-4o-mini)
attachWordMeaningsCoverage → generateWordMeanings (gpt-5.4-mini) stage word-meanings ← belongs to PART 2
```

**Note the mismatch:** the code does *not* execute in the three clean blocks. Translate
lives inside Part 1's function; polish runs before timing; word-meanings runs last. The
refactor's job is to regroup these into three composable functions with clean contracts.

### What already exists and should be reused (big de-risk)

- **Part 3's apply path is already written.** `applyAutoTimingResult` (grep it) merges
  returned timing into existing lines by `id` and preserves gloss via
  `mergeMeaningWordsWithTiming`. The `mode: "timing"` path is dormant *only because
  nothing starts a timing job* — the apply logic is complete.
- **Part 2's merge helper exists.** `applyWordMeaningsToLines`
  ([lib/word-meanings.js](../lib/word-meanings.js)) merges per-word gloss into lines
  while preserving timing.
- **Dormant routes are half-built phases** (not currently called by any client):
  `/api/ai/auto-time` (times provided lines), `/api/ai/word-meanings`, `/api/ai/romanize`.
  We will *not* revive them as sync routes (they die on disconnect); instead we fold
  their logic into the resilient job flow. They can be deleted in cleanup (§9).

---

## 3. Target architecture

### 3.1 Three composable server functions (lib/ai/openai-lyrics.js)

Refactor the monolith into three exported functions, each behaviour-preserving relative
to the corresponding slice of `runLyricTimingPipeline`. **`runLyricTimingPipeline` must
be recomposed from these three so the existing single-button flow stays byte-for-byte
equivalent** (regression safety — see progress Phase 1).

1. **`transcribeAndCleanLyrics({ fileBuffer, fileName, contentType, sourceLanguage, onProgress, onTranscriptDelta })`**
   → returns `{ lines: [{ id, original }], sourceRepairSummary, ... }`.
   = `buildCanonicalLyricSet` **minus** its final `requestLyricTranslations` call.
   Assigns stable `id`s here so Parts 2/3 can key on them.

2. **`enrichLyricLines({ lines, sourceLanguage, includeRomanization, onProgress })`**
   → returns per-line `{ id, translation, romanization, words: [{ text, gloss, roman }] }`.
   = `requestLyricTranslations` + `polishCanonicalLyricSet` (**scoped: no `original`
   edits** — see §6/D2) + `generateWordMeanings`. Pure LLM, no audio.

3. **`timeLyricLinesFromAudio({ lines, fileBuffer, fileName, contentType, audio, sourceLanguage, onProgress })`**
   → returns per-line `{ id, start, end, words: [{ text, start, end }], confidence, matchRatio, quality }`
   plus `{ duration, words, language }`.
   = the timing tail of `runLyricTimingPipeline`: `requestTimestampedTranscriptionFromChunks`
   → `alignLyricLinesToWordTimings` → `fillTimingGaps` → `runQualityAudit`. Needs only
   the lyric **text** + audio (independent of Part 2).

### 3.2 Phase-aware job (one route, one store)

Keep the resilient job machinery; make it phase-aware rather than adding sync routes.

- `POST /api/ai/transcribe` accepts a new `phase: "transcribe" | "enrich" | "time"`
  (default/absent = today's full run, for backward compat during the transition) plus
  the current `lines` (needed for `enrich`/`time`).
- `runTranscribeJob` ([lib/ai/transcribe-job.js](../lib/ai/transcribe-job.js)) dispatches
  on `phase` to the matching function above. The store, queue, poll, recovery, and
  session-keepalive are unchanged.
- The `[jobId]` status route and `toTranscribeJobResponse` are unchanged (the `result`
  shape differs per phase; the client applies per phase).

### 3.3 Client: phase-aware tracking + apply

- Generalise the job pointer: `transcription.mode` → **`transcription.phase`**
  (`"transcribe" | "enrich" | "time"`). Update `normalizeTranscription`
  ([lib/autosave.js](../lib/autosave.js)) to accept the three values (map legacy
  `"lyrics"`→`"transcribe"`, `"timing"`→`"time"`; bump `AUTOSAVE_VERSION` if cleaner).
- Three apply paths (two already exist):
  - **transcribe** → reuse `applyAutoLyricsResult` (replace all lines; its defensive
    field mapping already tolerates missing translation/timing).
  - **enrich** → **new** `applyEnrichResult`: merge `translation`/`romanization` by id
    and fold per-word gloss via `applyWordMeaningsToLines` (preserves any existing
    timing words). Does **not** touch `start`/`end`.
  - **time** → reuse `applyAutoTimingResult` (already merges by id, preserves gloss).

### 3.4 Client: Run orchestration + selection

- New selection state (transient, not persisted): which parts are toggled on, plus the
  active preset.
- `handleRunPipeline`: runs the selected parts **sequentially** — start part job → poll
  to done → apply → start next part job (each part re-reads current `projectState.lines`).
  Reuses `startTranscriptionJob` (now phase-parameterised) + the existing poll effect.
- Gating (`canRun` per part) derived from line data (§5). Presets set the toggles.
- Re-run confirm gate (§6) fires before running when Part 1 is selected and downstream
  data exists.

### 3.5 UI (Audio tab)

Replace the single button (grep `onGenerate` / "Generate & time lyrics" in
[components/tabs/audio-tab.js](../components/tabs/audio-tab.js)) with:

- **Preset chips:** All three · First two · First one (set the toggles).
- **Three toggles:** `1 · Transcribe & clean`, `2 · Translate & enrich`, `3 · Time`
  (disabled when prerequisites unmet).
- **One Run button** (label reflects selection, e.g. "Run 2 parts"); disabled when
  nothing selected or a job is in flight.
- **Per-part status** readout. Reuse the `autoLyricsState`/`autoTimingState` status
  pattern; consider a single `pipelineState` with a sub-status per part for clarity
  (implementer's call — see progress Phase 5).

---

## 4. Dependency & gating model

Prerequisites (derived, see §5):

- **Part 1** available when **audio is uploaded**. (Also effectively "already satisfied"
  if the user typed/imported lyrics — lines with `original` exist.)
- **Part 2** available when **lines with `original` text exist** (from Part 1, manual, or import).
- **Part 3** available when **lines with `original` text exist**. *Does not require Part 2.*

Presets are just toggle presets over the above:

- **All three** = 1 + 2 + 3.
- **First two** = 1 + 2.
- **First one** = 1.

Because gating is manual, `1 + 3` (skip translation) is allowed. That's intentional and
harmless — timing only needs the lyric text.

---

## 5. Data model — no schema change required

Part completion is **derived from line data**, not stored as flags (single source of
truth, avoids schema churn):

- Part 1 done ⇔ `lines.length > 0` and lines have non-empty `original`.
- Part 2 done ⇔ lines have `translation` (and/or words carrying `gloss`).
- Part 3 done ⇔ lines have finite `start` (timing).

The only persisted addition is the job pointer already stored by autosave, extended to
carry `phase` (§3.3). The selection/preset UI state is transient (not persisted).

The line schema ([lib/project.js](../lib/project.js), `createLine`) already carries
`original`, `romanization`, `translation`, `words[]` (each `{ text, start, end, gloss,
roman }`), `start`, `end`, `confidence`, `matchRatio`, `timingSource`, `quality` — every
field each part writes already has a home.

---

## 6. Re-run policy — silent when safe, one confirm when destructive

The damage from re-running a part is **asymmetric**, so the policy is per-part but
surfaced with the minimum UI (no persistent "stale" badges in v1):

| Re-run | Downstream impact | Behaviour |
|---|---|---|
| **Part 3 (time)** | none (timing is terminal) | **silent** — just re-times |
| **Part 2 (enrich)** | none, *given D2* (polish won't rewrite `original`, so timing stays valid) | **silent** — re-translates/re-glosses; timing preserved |
| **Part 1 (transcribe)** or **line add/delete/reorder** | rebuilds the line set → new `id`s → all Part 2/3 data orphaned | **one confirm**: *"This rebuilds your lyric set and clears the translation and timing below. Continue?"* |

- **Mental model (one sentence):** *"Running a part only changes that part's own data —
  except re-doing Part 1, which rebuilds everything."*
- **Manual edits stay silent** (no keystroke nagging). If the user wants to re-time after
  editing, they re-run Part 3.

**Decision D2 (implement to keep the invariant true):** when `enrichLyricLines` runs the
polish step standalone, **scope polish so it does not rewrite the source `original`
text** (it refines `translation`/`romanization`/`gloss` only). Correcting the *source*
is a Part 1 concern. This is a slight change from today's `runLyricTimingPipeline`, where
polish can edit originals (grep `allowOriginalChanges`). The recomposed full-run path may
keep today's behaviour; only the standalone Part 2 path is scoped. Confirm with owner if
ambiguous.

---

## 7. Non-goals (out of scope for this pass)

- Cost/credits, YT→mp3, mongo/dashboard work (separate docs:
  `a_yt-mp3_initial.md`, `credit_dash_initial.md`, `Public_imp_plan.md`).
- Persistent "stale" badges (kept as a possible v2 softening of the confirm).
- Changing render/export, waveform, preview, or the Word Board internals.
- Reducing total model cost for "run all" — same total; the win is optionality.

---

## 8. Risks & watch-items

- **Regression risk in the lib decomposition.** Mitigate by recomposing
  `runLyricTimingPipeline` from the three new functions and keeping its existing tests
  green ([lib/ai/openai-lyrics.test.js](../lib/ai/openai-lyrics.test.js)) before touching
  any route/client code (progress Phase 1 is a pure refactor).
- **`id` continuity.** Part 1 must assign stable line `id`s; Parts 2/3 key on them. The
  stateless design relies on the client applying Part 1 *before* starting Part 2/3 so the
  ids exist in `projectState`.
- **Word `words[]` co-ownership.** Part 2 owns `gloss`/`roman` on each word; Part 3 owns
  `start`/`end`. Both merge paths (`applyWordMeaningsToLines`, `mergeMeaningWordsWithTiming`)
  already handle either order — verify with a "3 then 2" and a "2 then 3" test.
- **Autosave version.** If `normalizeTranscription` can't cleanly map legacy `mode`,
  bump `AUTOSAVE_VERSION` (old in-progress envelopes are discarded — acceptable for a dev
  app) rather than shipping a half-tolerant decoder.
- **Sequential jobs re-read audio 2–3×** (Part 1 content transcription, Part 3 whisper).
  Expected and acceptable; keep the per-part in-flight guard (`findInFlightTranscribeForSession`)
  intact — sequential execution means only one job is ever in flight.

---

## 9. Cleanup / follow-ups

- After the job flow covers all three parts, **delete the dormant sync routes**
  `/api/ai/auto-time`, `/api/ai/word-meanings`, `/api/ai/romanize` and their now-unused
  lib exports (or leave with a deprecation note — owner's call). `/api/ai/word-timings`
  is a lower-level helper; assess separately.
- Update this doc's status and the progress log's deviations section as you go.

---

## 10. Open decisions for the implementer (raise if blocking)

1. **D2 confirmation:** is scoping standalone-Part-2 polish to *not* edit `original`
   acceptable? (Recommended yes.)
2. **Status UI shape:** one combined `pipelineState` with per-part sub-status vs. reusing
   the two existing `autoLyricsState`/`autoTimingState` slices plus a third. (Recommended:
   one `pipelineState`.)
3. **Autosave:** tolerant `mode`→`phase` mapping vs. `AUTOSAVE_VERSION` bump. (Recommended:
   bump — cleaner.)
4. **Dormant routes:** delete now vs. defer to a later cleanup PR. (Recommended: delete in
   Phase 7.)
