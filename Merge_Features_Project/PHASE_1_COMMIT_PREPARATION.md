# Phase 1 Commit Preparation — YouTube Audio Merge

**Scope:** Read-only preparation + external backup. Prepare a precise, safe commit
proposal for the uncommitted Phase 1 (YouTube Audio) implementation so the branch becomes a
reproducible **Phase 1 + Phase 2** application.
**Date:** 2026-07-09
**Branch:** `codex/phase-2-credit-dashboard`  **HEAD:** `28858e1` ("Phase 2 stage 8 enablement hardening")
**Status of this document:** PROPOSAL ONLY. **Nothing was staged, committed, deleted, restored, or
reset.** The only writes performed were (a) this report and (b) external backup artifacts (§2).

> **Do not execute the staging/commit commands in §13 until you explicitly approve the file list
> and strategy.**

---

## 1. Current repository state

Recorded read-only at preparation time.

- **Branch:** `codex/phase-2-credit-dashboard`
- **HEAD:** `28858e149d51033284a8fabfa31d44e47ec8b097`
- **Index / staged:** empty (`git diff --cached --name-status` returns nothing; HEAD == index).

### `git status --short`
```
 M Merge_Features_Project/Merge_1_YT/IMPLEMENTATION_PLAN.md
 M Merge_Features_Project/Merge_1_YT/PROGRESS.md
 M app/api/cleanup/route.js
 M app/globals.css
 M components/editor-shell.js
 M components/tabs/audio-tab.js
 M lib/files.js
 M lib/files.test.js
?? Merge_Features_Project/Merge_1_YT/PLAN_VERIFICATION.md
?? Merge_Features_Project/Merge_1_YT/YOUTUBE_AUDIO_SETUP.md
?? Merge_Features_Project/Merge_1_YT/ui-checks/
?? Merge_Features_Project/REPOSITORY_INTEGRITY_CHECK.md
?? app/api/cleanup/route.test.js
?? app/api/youtube-audio-segments/
?? app/api/youtube-audio/
?? components/youtube-segment-modal.js
?? lib/youtube-audio/
```

### `git diff --numstat` (tracked, unstaged)
```
165  63  Merge_Features_Project/Merge_1_YT/IMPLEMENTATION_PLAN.md
222  46  Merge_Features_Project/Merge_1_YT/PROGRESS.md
 10   2  app/api/cleanup/route.js
427   0  app/globals.css
137   0  components/editor-shell.js
 31   0  components/tabs/audio-tab.js
  2   0  lib/files.js
146   1  lib/files.test.js
```
Total tracked diff: **8 files, 1140 insertions, 112 deletions.** (`git diff --cached` is empty.)

### Untracked (`git ls-files --others --exclude-standard`) — 34 files
- `Merge_Features_Project/Merge_1_YT/PLAN_VERIFICATION.md`
- `Merge_Features_Project/Merge_1_YT/YOUTUBE_AUDIO_SETUP.md`
- `Merge_Features_Project/Merge_1_YT/ui-checks/desktop-youtube-modal.png`
- `Merge_Features_Project/Merge_1_YT/ui-checks/mobile-youtube-modal.png`
- `Merge_Features_Project/REPOSITORY_INTEGRITY_CHECK.md`  ← audit output, not Phase 1
- `app/api/cleanup/route.test.js`
- `app/api/youtube-audio-segments/route.js`, `.../route.test.js`, `.../[jobId]/route.js`
- `app/api/youtube-audio/config/route.js`, `.../config/route.test.js`
- `components/youtube-segment-modal.js`
- `lib/youtube-audio/` — 24 files (18 modules + 5 `*.test.js` + `providers/` subdir):
  `audio-ffmpeg.js`, `diagnostics.js`, `job-store.js`, `job-store.test.js`, `media-fetcher.js`,
  `media-fetcher.test.js`, `processing.js`, `provider-options.js`, `provider-runner.js`,
  `providers/index.js`, `providers/provider-utils.js`, `providers/rapidapi-client.js`,
  `providers/youtube-mp3-2025.js`, `providers/youtube-mp36.js`, `rapidapi-quota.js`,
  `segment-builder.js`, `server-config.js`, `storage.js`, `storage.test.js`, `validation.js`,
  `validation.test.js`, `youtube-url.js`.

### Ignored files relevant to Phase 1
None require inclusion. `git status --ignored` shows the standard ignore set:
`.env.local`, `.next/`, `node_modules/`, `.DS_Store`, `.claude/`, and the
`Temp_prototype_parts/**` caches/`.env` files. **No Phase 1 source lives under an ignore rule.**
There is **no** `.env.example` at the repo root (Phase 1 uses `YOUTUBE_AUDIO_SETUP.md` instead), so
no env file needs committing.

### Empty-directory noise (not committable, not Phase 1)
`git ls-files --others --directory` additionally listed six **empty** directories
(`app/api/ai/auto-time`, `app/api/ai/romanize`, `app/api/ai/word-meanings`,
`app/api/ai/word-timings`, `app/debug/sample`, `app/debug/sample-audio`) and `.claude/`.
Direct inspection confirmed the six `app/**` directories contain **0 files** (Git cannot commit
empty directories — they are inert) and `.claude/` contains only the ignored
`settings.local.json`. None are Phase 1 content and none can or should be committed.

---

## 2. Backup created and verification

A recoverable backup was created **before any Git mutation** (none has occurred). Two independent
copies exist.

### Primary (durable, outside the repository)
Repo root is `…/Main version ` (confirmed via `git rev-parse --show-toplevel`); the backup sits in
the **parent** folder, outside the working tree, so it is immune to `git clean`/`reset`/`checkout`:

```
/Users/adamaldridge/Desktop/Reel Creator Transcribe 2/Main current/phase1-backup-20260709-180749/
├── phase1-working-tree.tar.gz     (263,719 bytes — 42 files, paths + permissions preserved)
├── phase1-tracked-changes.patch   ( 77,627 bytes — 1656 lines; `git diff` of the 8 tracked files)
├── MANIFEST.txt                   (per-file permission + size listing)
├── FILELIST.txt                   (42 backed-up paths)
├── git-state-snapshot.txt         (status --short + HEAD/branch at backup time)
├── _tracked_modified.txt          (git diff --name-only)
└── _untracked.txt                 (git ls-files --others --exclude-standard)
```

### Secondary (redundant, isolated scratchpad)
```
/private/tmp/claude-501/-Users-adamaldridge-…-Main-version-/0675c21a-…/scratchpad/phase1-backup-20260709-180749/
  phase1-working-tree.tar.gz, phase1-tracked-changes.patch, MANIFEST.txt, FILELIST.txt, git-state-snapshot.txt
```

### What the backup captures
- **All 8 tracked unstaged changes** — captured both as working-tree file bytes (in the archive)
  and as an apply-able unified diff (`phase1-tracked-changes.patch`, 1656 lines, non-empty).
- **All 34 untracked non-ignored files** (33 Phase 1 files + `REPOSITORY_INTEGRITY_CHECK.md`),
  including the two binary `ui-checks/*.png` screenshots.
- File paths and permissions (tar preserves both; see `MANIFEST.txt`).

### Exclusions honored
No secrets, `.env*`, `node_modules`, `.next`, build output, `.DS_Store`, `.claude/`, or large
generated artifacts are in the archive (the file set is derived from
`git diff --name-only` + `git ls-files --others --exclude-standard`, which excludes all ignored
paths by construction).

### Verification performed
- `gzip -t` → **valid** on both copies.
- `tar -tzf … | wc -l` → **42 entries** on both copies; spot-checked that
  `components/editor-shell.js`, `lib/youtube-audio/job-store.js`, the two `ui-checks/*.png`, and
  `REPOSITORY_INTEGRITY_CHECK.md` are present.
- Patch is **non-empty** (1656 lines, first line
  `diff --git a/Merge_Features_Project/Merge_1_YT/IMPLEMENTATION_PLAN.md …`).
- Grep of the archive listing for `.env|node_modules|.next/|.claude/|.DS_Store` → **no matches**.

**To fully reconstruct the dirty state from the backup:** extract `phase1-working-tree.tar.gz` over
a clean checkout of `28858e1`, or `git checkout 28858e1` then `git apply
phase1-tracked-changes.patch` and copy the untracked files from the archive.

---

## 3. Complete dirty / untracked file inventory

42 files total (8 tracked-modified + 34 untracked). One (`REPOSITORY_INTEGRITY_CHECK.md`) is
audit output; the remaining 41 are Phase 1.

| # | Path | Git state |
|---|------|-----------|
| 1 | `Merge_Features_Project/Merge_1_YT/IMPLEMENTATION_PLAN.md` | modified |
| 2 | `Merge_Features_Project/Merge_1_YT/PROGRESS.md` | modified |
| 3 | `app/api/cleanup/route.js` | modified |
| 4 | `app/globals.css` | modified |
| 5 | `components/editor-shell.js` | modified |
| 6 | `components/tabs/audio-tab.js` | modified |
| 7 | `lib/files.js` | modified |
| 8 | `lib/files.test.js` | modified |
| 9 | `Merge_Features_Project/Merge_1_YT/PLAN_VERIFICATION.md` | untracked |
| 10 | `Merge_Features_Project/Merge_1_YT/YOUTUBE_AUDIO_SETUP.md` | untracked |
| 11 | `Merge_Features_Project/Merge_1_YT/ui-checks/desktop-youtube-modal.png` | untracked |
| 12 | `Merge_Features_Project/Merge_1_YT/ui-checks/mobile-youtube-modal.png` | untracked |
| 13 | `Merge_Features_Project/REPOSITORY_INTEGRITY_CHECK.md` | untracked (**audit output — excluded**) |
| 14 | `app/api/cleanup/route.test.js` | untracked |
| 15 | `app/api/youtube-audio-segments/route.js` | untracked |
| 16 | `app/api/youtube-audio-segments/route.test.js` | untracked |
| 17 | `app/api/youtube-audio-segments/[jobId]/route.js` | untracked |
| 18 | `app/api/youtube-audio/config/route.js` | untracked |
| 19 | `app/api/youtube-audio/config/route.test.js` | untracked |
| 20 | `components/youtube-segment-modal.js` | untracked |
| 21 | `lib/youtube-audio/audio-ffmpeg.js` | untracked |
| 22 | `lib/youtube-audio/diagnostics.js` | untracked |
| 23 | `lib/youtube-audio/job-store.js` | untracked |
| 24 | `lib/youtube-audio/job-store.test.js` | untracked |
| 25 | `lib/youtube-audio/media-fetcher.js` | untracked |
| 26 | `lib/youtube-audio/media-fetcher.test.js` | untracked |
| 27 | `lib/youtube-audio/processing.js` | untracked |
| 28 | `lib/youtube-audio/provider-options.js` | untracked |
| 29 | `lib/youtube-audio/provider-runner.js` | untracked |
| 30 | `lib/youtube-audio/providers/index.js` | untracked |
| 31 | `lib/youtube-audio/providers/provider-utils.js` | untracked |
| 32 | `lib/youtube-audio/providers/rapidapi-client.js` | untracked |
| 33 | `lib/youtube-audio/providers/youtube-mp3-2025.js` | untracked |
| 34 | `lib/youtube-audio/providers/youtube-mp36.js` | untracked |
| 35 | `lib/youtube-audio/rapidapi-quota.js` | untracked |
| 36 | `lib/youtube-audio/segment-builder.js` | untracked |
| 37 | `lib/youtube-audio/server-config.js` | untracked |
| 38 | `lib/youtube-audio/storage.js` | untracked |
| 39 | `lib/youtube-audio/storage.test.js` | untracked |
| 40 | `lib/youtube-audio/validation.js` | untracked |
| 41 | `lib/youtube-audio/validation.test.js` | untracked |
| 42 | `lib/youtube-audio/youtube-url.js` | untracked |

---

## 4. Classification of every file

Categories: **P1-impl** (Phase 1 implementation), **P1-test**, **P1-doc**, **P2-related**,
**audit** (repository-integrity output), **unrelated**, **generated**, **uncertain**.

| Path | Category | Evidence |
|------|----------|----------|
| `app/api/cleanup/route.js` | P1-impl | Diff adds `import { findInFlightYoutubeAudioForSession }` + a 409 guard while a YT job is queued/processing — plan §8.5, PROGRESS Stage 3. Also switches two existing imports from `@/…` to relative (`../../../…`), matching the documented Vitest-import deviation. |
| `app/globals.css` | P1-impl | +427/−0, all rules under `.youtube-import` / `.youtube-modal*` / `.youtube-timeline*` / `.youtube-hidden-player` — plan §12, PROGRESS Stage 5. Purely additive. |
| `components/editor-shell.js` | P1-impl | +137/−0: imports `YoutubeSegmentModal`, adds YT state, a `/api/youtube-audio/config` fetch effect, `handleOpenYoutubeModal`/`handleYoutubeSegmentComplete`, `audio.youtube` props, modal render — plan §8.7, PROGRESS Stage 4. **Zero deletions ⇒ no Phase 2 hunk reverted.** |
| `components/tabs/audio-tab.js` | P1-impl | +31/−0: `youtube = {}` prop + URL input and "Choose segment" button gated on `youtube.enabled`, below "Choose MP3" — plan §8.8/§9.2 (D9). |
| `lib/files.js` | P1-impl | +2/−0 **only**: import `getActiveYoutubeAudioSessionIds` and spread it into the `sweepExpiredSessions` exemption loop — plan §8.5. **See §7: the `storeAudioAssetFromPath` ingestion function this file also needs is already committed at HEAD** (Phase 2 stage 5), so it is not part of the dirty change. |
| `lib/files.test.js` | P1-test | +146/−1 (the −1 only extends the `node:fs/promises` import). Adds YT sweep-exemption + `storeAudioAssetFromPath` path-safety/duration/mp3 tests importing `./youtube-audio/job-store` — plan §16. |
| `Merge_Features_Project/Merge_1_YT/IMPLEMENTATION_PLAN.md` | P1-doc | The Phase 1 executable plan (ACCEPTED-COMPLETE 2026-07-09). |
| `Merge_Features_Project/Merge_1_YT/PROGRESS.md` | P1-doc | Phase 1 stage-by-stage progress + acceptance record. |
| `Merge_Features_Project/Merge_1_YT/PLAN_VERIFICATION.md` | P1-doc | Phase 1 plan-verification record (reproducibility of the acceptance narrative). |
| `Merge_Features_Project/Merge_1_YT/YOUTUBE_AUDIO_SETUP.md` | P1-doc | RapidAPI/enablement setup doc — plan §9.1/§19 (D6). Required config documentation. |
| `Merge_Features_Project/Merge_1_YT/ui-checks/desktop-youtube-modal.png` | P1-doc (asset) | Stage 5 desktop modal evidence referenced in PROGRESS §Stage 5. |
| `Merge_Features_Project/Merge_1_YT/ui-checks/mobile-youtube-modal.png` | P1-doc (asset) | Stage 5 mobile (390px) modal evidence referenced in PROGRESS §Stage 5. |
| `app/api/cleanup/route.test.js` | P1-test | Tests the cleanup 409 while a YT job is active — PROGRESS Stage 3. Imports `…/lib/youtube-audio/job-store`. |
| `app/api/youtube-audio-segments/route.js` | P1-impl | POST route: session cookie, validation, auto provider, `runtime="nodejs"` — plan §8.1. |
| `app/api/youtube-audio-segments/route.test.js` | P1-test | POST→poll→complete integration + fallback + caps — plan §16. |
| `app/api/youtube-audio-segments/[jobId]/route.js` | P1-impl | GET status + ingest-on-complete via `storeAudioAssetFromPath`; idempotent per `(jobId,sessionId)` — plan §8.3. |
| `app/api/youtube-audio/config/route.js` | P1-impl | GET `{ enabled: Boolean(key) }` gating (D6) — plan §9.1. |
| `app/api/youtube-audio/config/route.test.js` | P1-test | `{enabled:false}` with no key — PROGRESS Stage 0. |
| `components/youtube-segment-modal.js` | P1-impl | Ported timeline + polling modal, tokenized, no provider select/diagnostics (D4/D7) — plan §8.8. |
| `lib/youtube-audio/*.js` (18 modules) | P1-impl | Ported backend: job-store, processing, provider-runner, providers/*, segment-builder, media-fetcher (redirect-hardened), audio-ffmpeg (system-binary), storage, server-config, provider-options, youtube-url, rapidapi-quota, diagnostics, validation — plan §9.1. No credits/ledger/mongoose/sumup/r2/generation/dashboard/zod/@aws-sdk references (grep-verified). |
| `lib/youtube-audio/{job-store,media-fetcher,storage,validation}.test.js` (5 files) | P1-test | Unit/integration coverage per plan §16. |
| `Merge_Features_Project/REPOSITORY_INTEGRITY_CHECK.md` | **audit** | Pre-audit integrity report (this task's input). Not Phase 1 implementation; **excluded** (§6). |

**No file classified as P2-related, unrelated, generated, or uncertain.** Phase 2's committed
lines in the two shared files (`editor-shell.js`, `lib/files.js`) are untouched by these diffs
(zero deletions there).

---

## 5. Proposed Phase 1 commit file list (41 files)

Add exactly these; nothing else.

**Tracked, modified (8)**
```
app/api/cleanup/route.js
app/globals.css
components/editor-shell.js
components/tabs/audio-tab.js
lib/files.js
lib/files.test.js
Merge_Features_Project/Merge_1_YT/IMPLEMENTATION_PLAN.md
Merge_Features_Project/Merge_1_YT/PROGRESS.md
```

**Untracked, new (33)**
```
app/api/cleanup/route.test.js
app/api/youtube-audio-segments/route.js
app/api/youtube-audio-segments/route.test.js
app/api/youtube-audio-segments/[jobId]/route.js
app/api/youtube-audio/config/route.js
app/api/youtube-audio/config/route.test.js
components/youtube-segment-modal.js
lib/youtube-audio/audio-ffmpeg.js
lib/youtube-audio/diagnostics.js
lib/youtube-audio/job-store.js
lib/youtube-audio/job-store.test.js
lib/youtube-audio/media-fetcher.js
lib/youtube-audio/media-fetcher.test.js
lib/youtube-audio/processing.js
lib/youtube-audio/provider-options.js
lib/youtube-audio/provider-runner.js
lib/youtube-audio/providers/index.js
lib/youtube-audio/providers/provider-utils.js
lib/youtube-audio/providers/rapidapi-client.js
lib/youtube-audio/providers/youtube-mp3-2025.js
lib/youtube-audio/providers/youtube-mp36.js
lib/youtube-audio/rapidapi-quota.js
lib/youtube-audio/segment-builder.js
lib/youtube-audio/server-config.js
lib/youtube-audio/storage.js
lib/youtube-audio/storage.test.js
lib/youtube-audio/validation.js
lib/youtube-audio/validation.test.js
lib/youtube-audio/youtube-url.js
Merge_Features_Project/Merge_1_YT/PLAN_VERIFICATION.md
Merge_Features_Project/Merge_1_YT/YOUTUBE_AUDIO_SETUP.md
Merge_Features_Project/Merge_1_YT/ui-checks/desktop-youtube-modal.png
Merge_Features_Project/Merge_1_YT/ui-checks/mobile-youtube-modal.png
```

Breakdown (41 = 27 implementation + 8 tests + 6 docs/assets):
- **Implementation (27):** `app/api/cleanup/route.js`, `app/globals.css`,
  `components/editor-shell.js`, `components/tabs/audio-tab.js`, `lib/files.js` (5 modified) +
  `components/youtube-segment-modal.js` + 3 route files (`youtube-audio-segments/route.js`,
  `youtube-audio-segments/[jobId]/route.js`, `youtube-audio/config/route.js`) + 18
  `lib/youtube-audio` non-test modules.
- **Tests (8):** `lib/files.test.js` (modified) + `app/api/cleanup/route.test.js`,
  `app/api/youtube-audio-segments/route.test.js`, `app/api/youtube-audio/config/route.test.js`,
  and 4 `lib/youtube-audio/*.test.js` (`job-store`, `media-fetcher`, `storage`, `validation`).
- **Docs/assets (6):** `IMPLEMENTATION_PLAN.md`, `PROGRESS.md` (modified) + `PLAN_VERIFICATION.md`,
  `YOUTUBE_AUDIO_SETUP.md`, and 2 `ui-checks/*.png`.

---

## 6. Explicit exclusion list

Deliberately **not** in the Phase 1 commit:

| Path | Why excluded |
|------|--------------|
| `Merge_Features_Project/REPOSITORY_INTEGRITY_CHECK.md` | Repository-integrity **audit** output, not Phase 1 implementation. Commit separately (a docs/audit commit) if you want it in history; do not bundle it into the Phase 1 change set. |
| `Merge_Features_Project/PHASE_1_COMMIT_PREPARATION.md` (this file) | Preparation output; same rationale — separate docs commit or leave untracked. |
| `app/api/ai/{auto-time,romanize,word-meanings,word-timings}`, `app/debug/{sample,sample-audio}` | **Empty directories** (0 files). Git cannot commit them; inert. |
| `.claude/settings.local.json` | Ignored local editor/agent config. |
| `.env.local`, `.next/`, `node_modules/`, `.DS_Store`, `Temp_prototype_parts/**` caches | Ignored; secrets/caches/build output/generated. |

**Never use a bare `git add -A`/`git add .`** — that would sweep in
`REPOSITORY_INTEGRITY_CHECK.md` and this preparation file. Use the explicit pathspecs in §13.

---

## 7. Missing or uncertain files

**Missing files: none.** The proposed set is closed under its import graph.

**Uncertain files: none.**

**One important entanglement to record (not a gap):**
`storeAudioAssetFromPath` — the Phase 1 ingestion helper the plan (§8.4) attributes to `lib/files.js`
— **is already committed at HEAD.** It was absorbed into the **Phase 2 stage 5** commit `fb7d488`
("Phase 2 stage 5 generation persistence"), together with the `sourceType`/`normalizeAssetSourceType`
provenance machinery, because Phase 2 was implemented while the Phase 1 edits were live in the same
working-tree file. Consequences:
- The working-tree `lib/files.js` diff is therefore only **+2 lines** (the sweep exemption); the
  `git diff -U0` hunks touch only line 19 (import) and line 205 (spread), **not** the function body.
- The untracked `app/api/youtube-audio-segments/[jobId]/route.js` imports `storeAudioAssetFromPath`
  from `lib/files.js` — that import **resolves against HEAD**, so the Phase 1 commit does not need to
  add the function.
- **The integrity check's phrasing "Phase 1 is 100% uncommitted / no Phase 1 commit exists" is
  slightly imprecise**: this one Phase-1-authored function already lives inside a Phase 2 commit.
  This is benign for the combined app (the function is present and correct at HEAD) and does **not**
  require action. Cleanly re-homing it into a "pure" Phase 1 commit would require rewriting Phase 2
  history — **out of scope and explicitly disallowed** (do not alter Phase 2 committed files).

**Accidental dependencies on ignored/generated files: none.** Import-source scan of every untracked
Phase 1 file resolves only to (a) other files in the proposed set, (b) `lib/files.js` (in the set /
HEAD), or (c) framework/runtime (`next/*`, `node:*`, `react`, `vitest`). No `.next`, no generated
artifact, no new npm dependency.

**References to files outside the proposed commit: none problematic.** The only outward references
are to already-tracked HEAD modules (`lib/files.js`, `lib/ai/transcribe-store.js`, `lib/render/store.js`).

---

## 8. Dependency and completeness assessment

| Completeness dimension | Result | Evidence |
|---|---|---|
| Every imported module present | ✅ | Import graph of untracked files resolves within the set + HEAD; `job-store.js` exports `getActiveYoutubeAudioSessionIds`, `findInFlightYoutubeAudioForSession`, `createOrReuseJob`, `markJobStored`, `__resetYoutubeAudioJobsForTests` (all consumed by the wiring/tests). |
| Every route present | ✅ | POST + `[jobId]` GET segments routes, `config` GET route — all in set. |
| Every UI component present | ✅ | `youtube-segment-modal.js` (imported by `editor-shell.js`) + audio-tab controls + globals.css. |
| Every test present | ✅ | 8 test files; the modified `lib/files.test.js` imports `./youtube-audio/job-store` (in set). |
| Asset-ingestion change | ✅ | `storeAudioAssetFromPath` already at HEAD (see §7); status route ingests via it. |
| Cleanup / expiry behavior | ✅ | Sweep exemption (`lib/files.js` +2), cleanup 409 (`app/api/cleanup/route.js`), `lib/youtube-audio/storage.js` result pruning. |
| Env / config documentation | ✅ | `YOUTUBE_AUDIO_SETUP.md`; no root `.env.example` needed. |
| Progress / completion records | ✅ | `IMPLEMENTATION_PLAN.md`, `PROGRESS.md`, `PLAN_VERIFICATION.md`. |
| No unrelated work mixed in | ✅ | No non-YouTube edits; the only non-additive code change is the `@/`→relative import switch in `cleanup/route.js` (documented Phase 1 deviation). |
| No Phase 2 changes embedded in dirty files | ✅ | `editor-shell.js` and `lib/files.js` diffs are +137/−0 and +2/−0 respectively — no committed Phase 2 line is modified or reverted. No credits/ledger/sumup/r2 symbols in the untracked modules. |
| No new npm dependency / config change | ✅ | `package.json`, `package-lock.json`, `next.config.mjs`, `vitest.config.mjs`, `eslint.config.mjs`, `jsconfig.json` are **not** dirty. |

**Reproducibility note:** committing this set on top of `28858e1` reproduces exactly the combined
working tree against which Phase 2 Stage 8 recorded `npm test` = **53 files / 331 tests passed**,
`npm run lint` passed, and `npm run build` passed. That green baseline depends on Phase-2-committed
`vitest.config.mjs` and the word-board test update (already in HEAD), so the post-commit validation
in §11 should reproduce it.

---

## 9. Recommended commit strategy

**Recommendation: one atomic Phase 1 commit on top of the current Phase 2 branch (`28858e1`).**

Rationale:
- **Preserves Phase 2 `28858e1`** unchanged and yields a single linear combined branch containing
  both phases — the stated objective.
- The two phases are **already entangled at HEAD** (a Phase 1 function lives in Phase 2 commit
  `fb7d488`, §7). Attempting to reconstruct a "pure" Phase 1 history — e.g., branching from the
  Phase 2 base `a95999f` and replaying only Phase 1 — is **not clean**: it would collide with
  `storeAudioAssetFromPath` now owned by a Phase 2 commit, and the untracked modules were authored
  and validated against the Phase 2 tree. It would produce a history that never actually existed and
  risks breaking the validated state.
- A **separate Phase 1 branch + merge** buys nothing here (no independent Phase-1-only base to merge
  from) and only adds a merge commit; the entanglement remains. **Not recommended.**
- The dirty tree is small, cohesive, and fully additive on the shared files, so a single commit is
  safe and auditable.

**Placement:** directly on top of `codex/phase-2-credit-dashboard` @ `28858e1` (no branch switch, no
rebase, no merge). Optionally cut a **lightweight safety ref first** (`git branch`/`git tag` at HEAD;
pointer only, no checkout) in addition to the filesystem backup.

**Optional refinement (only if you want the audit trail in history):** a **second, separate** docs
commit for `REPOSITORY_INTEGRITY_CHECK.md` + `PHASE_1_COMMIT_PREPARATION.md`. Keep it out of the
Phase 1 implementation commit either way.

Do **not** split Phase 1 into multiple ordered commits — the change set is a single feature and its
tests/docs; splitting would risk intermediate states where a committed importer references a
not-yet-committed module.

---

## 10. Proposed commit message

```
Phase 1: YouTube audio segment import

Add the "From YouTube" acquisition path: paste a URL, pick a 1s-6min
segment in a modal, fetch/trim/convert to a 128 kbps MP3 via the ported
multi-provider fallback pipeline, and ingest it as a first-class session
audio asset indistinguishable from a manual MP3 upload. Manual upload is
unchanged; the feature is hidden/disabled unless the server RapidAPI key
is set.

Backend (lib/youtube-audio/*): ported job store, queue/processing,
provider runner with automatic fallback, redirect-hardened SSRF-guarded
media fetcher, system-ffmpeg (no ffmpeg-static) trim/convert, hand-written
segment validation, bounded job-result cleanup, and diagnostics.
- app/api/youtube-audio-segments: POST (session-aware, auto provider) and
  [jobId] GET (ingest-on-complete, idempotent per (jobId, sessionId)).
- app/api/youtube-audio/config: GET { enabled } gating.
- lib/files.js: exempt sessions with active YT jobs from the sweep
  (storeAudioAssetFromPath ingestion helper already landed in the Phase 2
  stage 5 commit).
- app/api/cleanup: 409 while a YT job is queued/processing.

Client: components/youtube-segment-modal.js (tokenized timeline + polling),
audio-tab URL controls below "Choose MP3", and an editor-shell completion
handoff mirroring handleAudioFile; modal styles in app/globals.css.

Tests: youtube-audio unit/integration, storeAudioAssetFromPath path safety,
sweep exemption, cleanup 409, and redirect SSRF coverage.

Docs: Merge_1_YT plan/progress/verification and YOUTUBE_AUDIO_SETUP.md
(RapidAPI enablement), plus desktop/mobile modal screenshots.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

(Optional separate audit-docs commit message, if you choose the §9 refinement:)
```
docs: repository integrity + Phase 1 commit preparation records

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## 11. Validation to run after committing

Run from the repo root after the commit, and reconcile counts with the PROGRESS records:

1. **Clean-state check** — only the excluded audit/prep docs remain untracked:
   `git status --short` → expect just `?? Merge_Features_Project/REPOSITORY_INTEGRITY_CHECK.md`
   (and `?? …/PHASE_1_COMMIT_PREPARATION.md`) if you did not commit them.
2. **Scoped Phase 1 suite** (PROGRESS Stage 6 command, expect 14 files / 90 tests):
   ```
   npx vitest run lib/youtube-audio/validation.test.js lib/youtube-audio/job-store.test.js \
     lib/youtube-audio/media-fetcher.test.js lib/youtube-audio/storage.test.js lib/files.test.js \
     app/api/youtube-audio/config/route.test.js app/api/youtube-audio-segments/route.test.js \
     app/api/cleanup/route.test.js lib/autosave.test.js lib/preview-sync.test.js \
     lib/waveform-sync.test.js lib/export-flow.test.js lib/timing.test.js components/editor-state.test.js
   ```
3. **Full suite** — expect `Test Files 53 passed`, `Tests 331 passed` (matches Phase 2 Stage 8):
   `npm test`
4. **Lint** — expect pass (relies on committed `eslint.config.mjs` ignores): `npm run lint`
5. **Build** — expect pass, compiling the YT routes/modal: `npm run build`
6. **Reconcile** the observed counts against `Merge_1_YT/PROGRESS.md` (Stage 6) and
   `Merge_2_Credit_dash/PROGRESS.md` (Stage 8); note any delta. The reported green results are now
   reproducible from a fresh checkout of the new HEAD (they previously were not — integrity check §6).
7. Optionally `git diff --stat 28858e1 HEAD` to confirm the commit contains exactly the 41 files.

---

## 12. Risks and rollback

**Risks**
- **Over-staging** the audit/prep docs or empty dirs → mitigated by explicit pathspecs (§13) and a
  pre-commit `git diff --cached --name-only | wc -l` == **41** check. Never `git add -A`.
- **Import-style change** in `cleanup/route.js` (`@/`→relative) modifies existing lines; it is
  intentional Phase 1 (Vitest-import deviation) but is the one non-additive code edit — confirm it is
  acceptable.
- **Entanglement** (§7): `storeAudioAssetFromPath` sits in a Phase 2 commit. Accepted as-is; do not
  rewrite Phase 2 history to "fix" it.
- **Line-ending / whitespace**: PROGRESS records `git diff --check` clean; re-run before commit.

**Rollback procedure**
- Before commit: unstage with `git restore --staged <paths>` (or `git reset` of the index only) —
  returns to the exact current dirty state; the working tree is untouched.
- After commit, to undo but keep all work staged: `git reset --soft HEAD~1`.
  To undo and return to the current unstaged dirty state: `git reset --mixed HEAD~1`.
  **Do not** use `git reset --hard` — it would discard the working tree.
- Full reconstruction from backup if anything is lost: extract
  `phase1-backup-20260709-180749/phase1-working-tree.tar.gz` over a clean `28858e1`, or
  `git apply phase1-tracked-changes.patch` + copy untracked files from the archive (§2).

---

## 13. Exact commands recommended for the later approved commit step

> **Do not run these until the file list and strategy above are approved.** They are the proposal,
> not an action taken by this preparation pass.

```bash
cd "/Users/adamaldridge/Desktop/Reel Creator Transcribe 2/Main current/Main version "

# 0) Optional safety ref at current HEAD (pointer only; no checkout, no history change)
git tag pre-phase1-commit 28858e1
git branch phase1-preflight-backup 28858e1

# 1) Stage EXACTLY the Phase 1 set via explicit pathspecs (no `git add -A`).
#    Whole-directory adds below contain only Phase 1 files; Merge_1_YT/ excludes the
#    root-level REPOSITORY_INTEGRITY_CHECK.md and PHASE_1_COMMIT_PREPARATION.md by design.
git add \
  app/api/cleanup/route.js \
  app/globals.css \
  components/editor-shell.js \
  components/tabs/audio-tab.js \
  lib/files.js \
  lib/files.test.js \
  app/api/cleanup/route.test.js \
  app/api/youtube-audio/ \
  app/api/youtube-audio-segments/ \
  components/youtube-segment-modal.js \
  lib/youtube-audio/ \
  Merge_Features_Project/Merge_1_YT/

# 2) VERIFY the staged set before committing (must be exactly 41 files; audit/prep docs absent).
git diff --cached --name-only | sort
git diff --cached --name-only | wc -l          # expect: 41
git status --short                              # expect only REPOSITORY_INTEGRITY_CHECK.md
                                                #  (+ PHASE_1_COMMIT_PREPARATION.md) still ?? 
git diff --cached --check                       # whitespace clean

# 3) Commit (message in §10; use a file to preserve formatting)
git commit -F - <<'MSG'
Phase 1: YouTube audio segment import

Add the "From YouTube" acquisition path: paste a URL, pick a 1s-6min
segment in a modal, fetch/trim/convert to a 128 kbps MP3 via the ported
multi-provider fallback pipeline, and ingest it as a first-class session
audio asset indistinguishable from a manual MP3 upload. Manual upload is
unchanged; the feature is hidden/disabled unless the server RapidAPI key
is set.

Backend (lib/youtube-audio/*): ported job store, queue/processing,
provider runner with automatic fallback, redirect-hardened SSRF-guarded
media fetcher, system-ffmpeg (no ffmpeg-static) trim/convert, hand-written
segment validation, bounded job-result cleanup, and diagnostics.
- app/api/youtube-audio-segments: POST (session-aware, auto provider) and
  [jobId] GET (ingest-on-complete, idempotent per (jobId, sessionId)).
- app/api/youtube-audio/config: GET { enabled } gating.
- lib/files.js: exempt sessions with active YT jobs from the sweep
  (storeAudioAssetFromPath ingestion helper already landed in the Phase 2
  stage 5 commit).
- app/api/cleanup: 409 while a YT job is queued/processing.

Client: components/youtube-segment-modal.js (tokenized timeline + polling),
audio-tab URL controls below "Choose MP3", and an editor-shell completion
handoff mirroring handleAudioFile; modal styles in app/globals.css.

Tests: youtube-audio unit/integration, storeAudioAssetFromPath path safety,
sweep exemption, cleanup 409, and redirect SSRF coverage.

Docs: Merge_1_YT plan/progress/verification and YOUTUBE_AUDIO_SETUP.md
(RapidAPI enablement), plus desktop/mobile modal screenshots.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
MSG

# 4) (Optional) separate commit for audit + preparation records
# git add Merge_Features_Project/REPOSITORY_INTEGRITY_CHECK.md \
#         Merge_Features_Project/PHASE_1_COMMIT_PREPARATION.md
# git commit -m "docs: repository integrity + Phase 1 commit preparation records" \
#   -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"

# 5) Validate the committed tree (see §11)
npm test
npm run lint
npm run build
git diff --stat 28858e1 HEAD                     # expect exactly the 41 Phase 1 files

# Rollback if needed (see §12): git reset --soft HEAD~1   (never --hard)
```

---

## 14. Safety confirmation

This preparation was performed under the stated absolute safety rules. **No `git add`, `commit`,
`reset`, `restore`, `clean`, `stash`, `rm`, `checkout`, branch switch, rebase, or merge was run.**
No application code, test, or documentation was modified; no untracked file was overwritten; no
Phase 2 committed file was altered. The only new artifacts created are:
- this report — `Merge_Features_Project/PHASE_1_COMMIT_PREPARATION.md`, and
- the external backup directory `…/Main current/phase1-backup-20260709-180749/` (plus its scratchpad
  copy).

The untracked/unstaged Phase 1 work remains exactly as found and is now additionally preserved in two
independent backups. Awaiting your approval of the §5 file list and §9 strategy before any staging or
commit.
