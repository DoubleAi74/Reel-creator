# Repository & Commit Integrity Check — Pre-Audit

**Scope:** Read-only pre-audit verification of branch `codex/phase-2-credit-dashboard`.
**Date:** 2026-07-09
**Question answered:** Would a fresh checkout of the current Phase 2 branch contain the
complete **Phase 1 + Phase 2** application required for the reported tests and runtime behavior?

---

## 1. Verdict

**NOT SELF-CONTAINED.**

The committed Phase 2 branch builds and runs *on its own*, but the entire **Phase 1 (YouTube
Audio) feature is uncommitted** — every Phase 1 module is an untracked working-tree file, and
the code that wires Phase 1 into the shared app files exists only as **unstaged modifications**.
A fresh checkout of `HEAD` would contain Phase 2 but would be **missing all of Phase 1**.

Nuance worth stating precisely:
- **Committed Phase 2 code does NOT import or depend on any uncommitted file** — Phase 2 in
  isolation is self-contained.
- **The combined "Phase 1 + Phase 2 application" is NOT self-contained** — Phase 1 is entirely
  absent from Git.
- **Several reported validation/test/build results depended on uncommitted code** (see §6).

---

## 2. Current branch and commit

- **Branch:** `codex/phase-2-credit-dashboard`
- **HEAD commit:** `28858e1` — "Phase 2 stage 8 enablement hardening"
- **Staged changes:** none (`git diff --cached --name-status` is empty; HEAD == index).
- **Branch base:** `a95999f` ("before merge", also `origin/mockup-integration-mobile` /
  `mockup-integration-mobile`). `git merge-base a95999f HEAD` = `a95999f`, so the entire Phase 2
  series (`0d47c43` … `28858e1`, stages 0–8) sits linearly on top of that base.
- **Merge-base with `main`:** `6ac31470…`.

Phase 2 commit series (newest first):
```
28858e1 Phase 2 stage 8 enablement hardening   (HEAD)
35aedcf Phase 2 stage 7 dashboard chrome
0c37493 Phase 2 stage 6 SumUp top ups
fb7d488 Phase 2 stage 5 generation persistence
8815820 Phase 2 stage 4 generation gates
63b1a7c Phase 2 stage 3 credit settlement
8609f37 Phase 2 stage 2 usage metering
6898e11 Phase 2 stage 1 credit ledger foundation
0d47c43 Phase 2 stage 0 scaffold
a95999f before merge                            (branch base)
```

---

## 3. Pre-existing working-tree changes

`git status --short` shows a dirty tree that the implementation report attributes to
"pre-existing Phase 1 / YouTube work left unstaged." That attribution is factually accurate —
but it is precisely why the branch is not self-contained.

**Modified, unstaged (tracked files, Phase 1 wiring hunks):**
```
 M app/api/cleanup/route.js          (adds import of untracked lib/youtube-audio/job-store)
 M app/globals.css                   (YouTube modal styling)
 M components/editor-shell.js        (imports untracked components/youtube-segment-modal)
 M components/tabs/audio-tab.js      (YouTube tab wiring)
 M lib/files.js                      (adds import of untracked lib/youtube-audio/job-store)
 M lib/files.test.js                 (adds tests importing untracked youtube-audio/job-store)
 M Merge_Features_Project/Merge_1_YT/IMPLEMENTATION_PLAN.md
 M Merge_Features_Project/Merge_1_YT/PROGRESS.md
```

**Untracked (Phase 1 modules, tests, docs, assets — not in any commit):**
```
?? app/api/cleanup/route.test.js
?? app/api/youtube-audio/config/route.js            (+ route.test.js)
?? app/api/youtube-audio-segments/route.js          (+ [jobId]/route.js, route.test.js)
?? components/youtube-segment-modal.js
?? lib/youtube-audio/    (job-store, processing, provider-runner, media-fetcher, storage,
                          segment-builder, validation, youtube-url, audio-ffmpeg, diagnostics,
                          provider-options, rapidapi-quota, server-config, providers/*, + *.test.js)
?? Merge_Features_Project/Merge_1_YT/PLAN_VERIFICATION.md
?? Merge_Features_Project/Merge_1_YT/YOUTUBE_AUDIO_SETUP.md
?? Merge_Features_Project/Merge_1_YT/ui-checks/   (desktop/mobile modal screenshots)
```

---

## 4. Phase 1 commit status

**Which Phase 1 files are committed:** **None.**
`git log --all --oneline -- lib/youtube-audio/job-store.js`,
`… -- components/youtube-segment-modal.js`, and
`… -- app/api/youtube-audio/config/route.js` all return **zero commits** across **all branches
and all history**. `git ls-files lib/youtube-audio/` returns nothing — the directory exists on
disk but is untracked.

**Which are only uncommitted:** **All of them** — every module, route, component, test, doc,
and screenshot listed in §3, plus the wiring hunks inside the four shared tracked files.

**Committed HEAD versions of the shared files contain no Phase 1 wiring:**
- `git grep -E "youtube-audio|youtube-segment-modal|youtube-audio-segments" HEAD` → **no matches.**
- `HEAD:lib/files.js` line 19 is **empty**; the working tree adds
  `import { getActiveYoutubeAudioSessionIds } from "./youtube-audio/job-store";`.
  (Committed `lib/files.js` mentions `"youtube"` only as a `sourceType` **string literal** —
  Phase 2's additive metadata seam — not as a module import.)
- `HEAD:app/api/cleanup/route.js` has no youtube reference; the working tree adds
  `import { findInFlightYoutubeAudioForSession } from ".../lib/youtube-audio/job-store";`.
- `HEAD:components/editor-shell.js` has no youtube reference; the working tree adds
  `import { YoutubeSegmentModal } from "@/components/youtube-segment-modal";` plus render/handlers.

**Do Phase 1 completion records match Git history? — No.**
- `Merge_1_YT/PROGRESS.md` states: *"Phase 1 implementation complete, all stages Validated,
  completion accepted by user … Ready for git/PR/handoff."* Its Stage 0 checklist marks
  `[x] Port active lib/youtube-audio/* modules` and the config route as done.
  **These deliverables are not in Git** — they remain untracked. "Accepted-complete" is recorded
  in the doc but **never committed** as code.
- `Merge_2_Credit_dash/PROGRESS.md` Gate **G2** claims *"Phase 1 accepted and recorded under
  Merge_Features_Project/Merge_1_YT/."* Recorded in documentation — **not committed** as code.

The Phase 1 completion narrative is therefore **inconsistent with the commit graph**: Phase 1 is
"done and accepted" on paper but exists only in one dirty working tree.

---

## 5. Phase 2 commit contents

Phase 2 (`a95999f..HEAD`) is fully committed and cohesive — ~90 files including:
- **Credit/ledger core:** `lib/money.js`, `lib/ledger/balance-ledger.js`, `lib/credits/*`
  (credit-service, billing-phases, rate-limit, unlock-cookie, flags), `lib/models/*`
  (Balance, CreditLedger, Generation, PaymentOrder, RefundRecord, UsageRecord, WebhookEvent).
- **Payments/R2/DB:** `lib/payments/*` (sumup-client/env/refunds, payment-orders/urls/verification),
  `lib/r2/*`, `lib/db/mongoose.js`, `lib/db/bootstrap.js`.
- **AI metering:** `lib/ai/openai-pricing.js`, `lib/ai/openai-usage.js`, plus edits to
  `openai-lyrics.js`, `transcribe-job.js`, `transcribe-store.js`.
- **Generations:** `lib/generations/persist-generation.js`, `serialize-generation.js`.
- **API routes:** `app/api/credits/*`, `app/api/dashboard/*`, `app/api/media/generations/*`,
  `app/api/webhooks/sumup/*`, edits to `app/api/ai/transcribe/route.js`.
- **UI:** `app/dashboard/page.js`, `app/payment/return/page.js`, `components/DashboardView.jsx`,
  `components/PaymentReturnClient.jsx`, `components/credit-chrome.jsx`, and **Phase-2-only** hunks
  of `components/editor-shell.js` (`pipelineRunId` / `saveOnCompletion`) and `lib/files.js`
  (`sourceType`).
- **Ops/config/tests:** `scripts/*.mjs`, `vitest.config.mjs`, `.env.example`, `CREDITS_SETUP.md`,
  `README.md`, `eslint.config.mjs`, and the Phase 2 `*.test.js` suite.

The Phase 2 PROGRESS notes explicitly acknowledge the split (line ~132: *"Only those two small
hunks were staged from components/editor-shell.js; pre-existing Phase 1 YouTube editor changes
remain unstaged"*; line ~171: the *"Phase 1 active-YouTube-session sweep remains an unstaged
pre-existing change"*). So the committed shared files are deliberately the **Phase-2-only**
versions.

---

## 6. Dependency check

**(a) Committed Phase 2 code importing/relying on uncommitted files:** **None found.**
A committed-tree grep for `youtube-audio` / `youtube-segment-modal` / `youtube-audio-segments`
across `app/**`, `components/**`, `lib/**` at `HEAD` returns no matches. Phase 2 does not
`import` any untracked module. **Phase 2 in isolation would build and run.**

The cross-file references into the untracked YouTube modules exist **only in the working tree**:
```
app/api/cleanup/route.js:13   import … from ".../lib/youtube-audio/job-store"   (unstaged)
components/editor-shell.js:16  import { YoutubeSegmentModal } from "@/components/youtube-segment-modal" (unstaged)
lib/files.js:19               import { getActiveYoutubeAudioSessionIds } from "./youtube-audio/job-store" (unstaged)
lib/files.test.js:27          import … from "./youtube-audio/job-store"          (unstaged)
app/api/cleanup/route.test.js import … from "…/lib/youtube-audio/job-store"      (untracked)
```
Each of these importers is itself uncommitted, and each target is uncommitted — a closed loop of
working-tree-only code. None of it is reachable from `HEAD`.

**(b) Test/build results likely dependent on uncommitted code:** **Yes.**
The Phase 2 PROGRESS.md records validation runs that executed working-tree/untracked code:
- Stage 0: `npx vitest run lib/files.test.js app/api/youtube-audio-segments/route.test.js` →
  *"Test Files 2 passed, Tests 11 passed."* Both inputs are uncommitted (untracked
  `youtube-audio-segments/route.test.js`; working-tree `lib/files.test.js` that imports the
  untracked `job-store`). On a fresh checkout these tests **do not exist / differ** — the
  untracked file is absent and `HEAD:lib/files.test.js` has no youtube imports.
- Stage 5: `npx vitest run lib/files.test.js lib/files-source-type.test.js` →
  *"Test Files 2 passed, Tests 12 passed."* Same dependency on the untracked `job-store`.
- Repo-wide baseline `npm test` reported counts (`43` test files / `304` tests) that **include**
  the untracked YouTube test files; a fresh checkout would collect fewer.
- The Stage 8 *"full unit suite/lint/build pass"* claim was produced against a working tree in
  which `components/editor-shell.js` imports the untracked `youtube-segment-modal.js` and
  `lib/files.js` imports the untracked `job-store`. The `next build` therefore compiled Phase 1
  wiring that is not in any commit.

Conclusion: the reported green results were **partly obtained from the dirty working tree, not
from the committed tree**, so they cannot be assumed reproducible from `HEAD` alone.

---

## 7. Fresh-checkout assessment

Assuming `git clone` / `git checkout` of `28858e1` into a clean tree (no untracked files):

**What would exist:**
- The complete Phase 2 credit/dashboard/payments/metering system (§5).
- The Phase-2-only versions of `editor-shell.js`, `lib/files.js`, `app/api/cleanup/route.js`
  (no YouTube wiring; `sourceType` string handling present but the `job-store` importer absent).
- The Phase 2 test suite.

**What would be missing:**
- The **entire** `lib/youtube-audio/` module tree.
- `app/api/youtube-audio/config` and `app/api/youtube-audio-segments/*` routes.
- `components/youtube-segment-modal.js` and its `globals.css` / `audio-tab.js` wiring.
- All Phase 1 tests (`app/api/cleanup/route.test.js`, the youtube `*.test.js` files) and the
  YouTube-import additions inside `lib/files.test.js`.
- Phase 1 docs `PLAN_VERIFICATION.md`, `YOUTUBE_AUDIO_SETUP.md`, and `ui-checks/` evidence.

**Would it build and run as reported?**
- **Phase 2 alone:** Yes — it should build/lint and its committed tests should pass, because no
  committed file references the missing modules (no dangling imports at `HEAD`).
- **As the reported "Phase 1 + Phase 2" app:** **No.** The YouTube feature (URL input, segment
  modal, provider fetch/trim, ingest, session sweep-exemption) would be entirely absent, and the
  Phase 1 test counts / build surface reported during validation would not reproduce.

---

## 8. Blocking issues

1. **Phase 1 is 100% uncommitted** (untracked modules + unstaged wiring across four shared files),
   and is absent from every branch in history. A fresh checkout is not the full application.
2. **Completion records contradict Git history.** `Merge_1_YT/PROGRESS.md` ("complete, validated,
   accepted, ready for handoff") and `Merge_2` gate G2 ("Phase 1 accepted and recorded") describe
   code that was never committed.
3. **Reported validation is not reproducible from `HEAD`.** Multiple recorded passing runs and the
   Stage 8 build/lint depended on untracked/working-tree code (§6b).
4. **Single-copy risk.** Because the Phase 1 work exists only in this one dirty working tree with
   no commit and no stash, any clean/reset/checkout would destroy it irrecoverably.

---

## 9. Required next action

Before a code-quality audit of the *combined* application can be meaningful, the working tree must
be reconciled with Git. Recommended (owner's decision — not performed here):

1. **Preserve first:** back up or commit the untracked/unstaged Phase 1 work (a dedicated commit,
   branch, or stash) so it cannot be lost.
2. **Commit Phase 1 as its own change set** (modules + routes + component + wiring hunks in
   `editor-shell.js` / `lib/files.js` / `cleanup/route.js` / `audio-tab.js` / `globals.css` +
   its tests + docs), ideally beneath or merged with the Phase 2 series, so `HEAD` contains both
   phases.
3. **Re-run the full test/lint/build against the committed tree** and reconcile the counts with
   the PROGRESS records.
4. **Then** audit — either (a) audit Phase 2 alone against `HEAD` now (valid, since Phase 2 is
   self-contained), explicitly excluding YouTube, or (b) wait until Phase 1 is committed to audit
   the combined app the report describes.

Decision needed from the owner: audit **Phase 2 only at HEAD now**, or **commit Phase 1 first** and
audit the combined tree.

---

## 10. Working-tree safety confirmation

This check was strictly read-only. **No files, tests, planning docs, configuration, Git history,
index/staging state, branch, or checkout were modified.** Only inspection commands were run
(`git status`, `git log`, `git show`, `git diff`, `git grep`, `git cat-file -e`, `git ls-files`,
`git merge-base`, and read-only `grep`/`ls`/`sed -n` inspection). No `add`, `commit`, `stash`,
`restore`, `reset`, `clean`, `checkout`, or branch operation was performed. The only new file
created is this report: `Merge_Features_Project/REPOSITORY_INTEGRITY_CHECK.md`. The untracked
Phase 1 work remains exactly as found and is **at risk** until the owner preserves it (§8.4).
