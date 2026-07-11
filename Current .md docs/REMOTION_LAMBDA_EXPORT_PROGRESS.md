# Remotion Lambda Export — Implementation Progress

**Pair with:** `Current .md docs/REMOTION_LAMBDA_EXPORT_PLAN.md`  
**Status:** **DEFERRED** (2026-07-11). Do **not** execute this checklist until product re-opens cloud/Lambda export.  
**Interim product path:** desktop screen/preview capture for usable video ASAP (separate workstream; not this checklist).  
**Future platforms:** web → desktop-focused; mobile → React Native with native export (see plan §18).

**How to use (when active):** Work top-to-bottom. Tick `- [ ]` → `- [x]` only when the step is done and verified. Do not skip phases unless a step is explicitly blocked on human AWS secrets (mark **BLOCKED** with reason).

**Locked decisions (do not re-litigate when this work resumes):**

- Scope: standard MP4 + video backgrounds (Remotion composition, not local ffmpeg composite on prod)
- Credits: duration formula; **up-front non-refundable** debit; estimate + confirm UI
- S3: minimal Remotion surface; **15 min** output TTL
- Vercel without Lambda config: **export disabled**
- Local without Lambda config: **legacy render path**
- Human pastes AWS secrets; agent prepares scripts/templates/code

---

## Progress legend

| Mark | Meaning |
|------|---------|
| `[ ]` | Not started |
| `[x]` | Done |
| `[~]` | In progress |
| `BLOCKED:` | Waiting on human / external |

---

## Phase 0 — Read and freeze scope

- [ ] **0.1** Read `REMOTION_LAMBDA_EXPORT_PLAN.md` end-to-end.
- [ ] **0.2** Skim current export code:
  - `app/api/render/route.js`
  - `app/api/render/[jobId]/route.js`
  - `app/api/render/[jobId]/file/route.js`
  - `lib/render/render-job.js`
  - `lib/render/store.js`
  - `lib/render/video-background-composite.js`
  - `remotion/register.js`, `LyricVideo.jsx`, `Background.jsx`
  - Client: `components/editor-shell.js` export handlers, `components/render-export-modal.js`
- [ ] **0.3** Skim credits patterns: `lib/models/CreditLedger.js`, `lib/models/Balance.js`, AI debit/settle usage, `lib/credits/flags.js`, `lib/money.js`.
- [ ] **0.4** Confirm composition id is `LyricVideo` (`REMOTION_COMPOSITION_ID`) and props shape includes `audioUrl`, `backgroundUrl`, `backgroundDurationSec`, `project`.
- [ ] **0.5** Note: do **not** implement refunds; do **not** implement transparent/chroma on Lambda in v1.

---

## Phase 1 — Feature flags and environment helpers

- [ ] **1.1** Create `lib/render/lambda-env.js` (or equivalent):
  - `getRemotionLambdaConfig()` — reads region, function name, serve URL, bucket, credentials presence
  - `isRemotionLambdaConfigured()` — boolean, all required non-empty
  - `getExportOutputTtlSeconds()` — default `900`
  - Never throw on missing env in this module (return structured null/false)
- [ ] **1.2** Unit tests for config detection (with/without env).
- [ ] **1.3** Create `lib/render/export-availability.js`:
  - `getExportMode()` → `"local_legacy" | "lambda" | "unavailable"`
  - Rules:
    - Lambda configured → `"lambda"`
    - Else if `process.env.VERCEL === "1"` (or equivalent) → `"unavailable"`
    - Else → `"local_legacy"`
- [ ] **1.4** Unit tests for export mode matrix.
- [ ] **1.5** Add `GET /api/render/config` (or fold into existing credits/config if cleaner) returning `{ mode, lambdaReady, creditsRequired }` for the client — **no secrets**.

---

## Phase 2 — Export pricing (credits)

- [ ] **2.1** Create `lib/render/export-pricing.js`:
  - `EXPORT_PRICE_TABLE_VERSION = "export-v1"`
  - Constants: `baseMinor`, `perSecondMinor`, `videoBackgroundMultiplier`, `MIN_EXPORT_FEE_MINOR`, `MAX_EXPORT_FEE_MINOR` (env overrides optional)
  - `computeExportFeeMinor({ sectionDurationSeconds, hasVideoBackground })` → integer pence
  - `buildExportFeeBreakdown(...)` → object for API/UI
- [ ] **2.2** Use `getSectionBounds(project.audio).sectionDuration` as source of truth (import from `lib/timing.js`).
- [ ] **2.3** Unit tests: 0s edge, 1s, 30s, 60s, 360s, with/without video BG, min/max clamps.
- [ ] **2.4** Document initial rates in a short comment header (tune later from real AWS $).

---

## Phase 3 — Ledger type and debit helper

- [ ] **3.1** Add `"EXPORT_RENDER"` to `CREDIT_LEDGER_TYPES` in `lib/models/CreditLedger.js`.
- [ ] **3.2** Ensure schema/enum validation still passes; migrate nothing if enum is app-level only.
- [ ] **3.3** Implement `lib/render/export-credits.js` (or under `lib/credits/`):
  - `debitExportRender({ sessionId or balance key, feeMinor, jobId, metadata, mongoSession? })`
  - Idempotency key: `export_debit:{jobId}` (preferred) or clientRequestId
  - Uses same balance collection pattern as AI/top-up (follow existing debit helpers — **do not invent a second balance system**)
  - Returns `{ ok, balanceMinor, ledgerEntry }` or structured error `insufficient_credits`
- [ ] **3.4** Integration test with Mongo memory server: debit once, retry same idempotency → no double debit.
- [ ] **3.5** Insufficient balance test.

---

## Phase 4 — Mongo `RenderJob` model

- [ ] **4.1** Create `lib/models/RenderJob.js` with fields from the plan (status, progress, fee, remotion ids, S3 keys, download expiry, sessionId, errors, timestamps).
- [ ] **4.2** Indexes: `{ sessionId: 1, createdAt: -1 }`, `{ status: 1 }`, optional TTL on `expiresAt` for auto-delete of job docs (careful: only after download window).
- [ ] **4.3** Helper module `lib/render/render-job-store.js` (Mongo-backed) with:
  - `createRenderJobRecord`
  - `getRenderJobForSession(jobId, sessionId)`
  - `updateRenderJobProgress`
  - `markRenderJobDone` / `markRenderJobFailed`
  - `findInFlightRenderForSession` (queued/rendering)
- [ ] **4.4** Keep or thin-wrap old `lib/render/store.js` for **local_legacy only** — do not use memory store for Lambda mode.
- [ ] **4.5** Tests for create + ownership + in-flight detection.

---

## Phase 5 — Hard-disable export when unavailable (Vercel)

Do this early so production stops spinning on dead jobs even before Lambda works.

- [ ] **5.1** `POST /api/render`: if mode `unavailable` → `503` JSON `{ error: "export_unavailable", message: "…" }`.
- [ ] **5.2** `GET /api/render/[jobId]` and file route: same for unavailable **or** unknown jobs.
- [ ] **5.3** Client: on load / export click, if mode unavailable:
  - Disable export controls
  - Show clear copy: export not available on this deployment yet
- [ ] **5.4** Manual check: simulate `VERCEL=1` without Lambda env in unit/integration test.
- [ ] **5.5** Ensure local without Vercel still reaches legacy path.

---

## Phase 6 — Estimate API + confirm UX (credits)

- [ ] **6.1** Implement `GET /api/render/estimate` (or `POST` with project snapshot if GET body is awkward):
  - Session required
  - Input: project audio section + background type (or full project)
  - Output: `{ feeMinor, sectionSeconds, hasVideoBackground, priceTableVersion, breakdown, balanceMinor? }`
  - Mode unavailable → 503
  - Lambda mode without credits enabled → define behavior per plan: **block** with clear error
- [ ] **6.2** Extend export modal / new confirm step:
  - Fetch estimate
  - Show `formatGbpFromMinor(feeMinor)`
  - Non-refundable warning
  - Confirm button disabled until estimate loaded
- [ ] **6.3** Wire editor: export flow = estimate → confirm → POST start.
- [ ] **6.4** Tests for estimate math match `computeExportFeeMinor`.

---

## Phase 7 — Presigned media for Lambda input

- [ ] **7.1** Implement `lib/render/export-media-urls.js`:
  - `resolveExportMediaUrls({ sessionId, audioAssetId, backgroundAssetId, project, jobId })`
  - Returns `{ audioUrl, backgroundUrl, backgroundDurationSec }`
  - Uses existing `resolveAssetStorage` / R2 presign helpers where possible
  - If asset is local-only: upload to short-lived prefix (R2 preferred if app R2 enabled; else Remotion bucket input prefix)
- [ ] **7.2** Input object TTL ≥ 1 hour (render may outlive download TTL).
- [ ] **7.3** Never pass `/api/assets/...?sessionId=` as Lambda `audioUrl` on lambda mode.
- [ ] **7.4** Unit tests with mocks for R2/local upload.
- [ ] **7.5** Video BG: ensure `OffthreadVideo` receives HTTPS URL; set `hasVideoBackground` for pricing when `project.background.type === "video"`.

---

## Phase 8 — Remotion Lambda client wrapper

- [ ] **8.1** Add dependency `@remotion/lambda` matching major/minor of existing Remotion `4.0.x`.
- [ ] **8.2** Create `lib/render/remotion-lambda.js`:
  - `startLyricVideoRenderOnLambda({ inputProps, jobId })` → `{ remotionRenderId, bucketName, ... }`
  - `fetchLyricVideoRenderProgress({ remotionRenderId, bucketName })` → `{ status, progress, outputFile, fatalError, estimatedCost? }`
  - `createOutputDownloadUrl({ bucket, key, expiresInSeconds })`
  - `deleteOutputObject({ bucket, key })`
- [ ] **8.3** Map composition id `LyricVideo`; codec h264; jpeg frames; no transparent mode in this path.
- [ ] **8.4** Mock module in tests; no real AWS in CI.
- [ ] **8.5** `serverExternalPackages` in `next.config.mjs`: add `@remotion/lambda` if needed.

---

## Phase 9 — POST /api/render (Lambda path)

- [ ] **9.1** Branch on `getExportMode()`:
  - `unavailable` → 503
  - `local_legacy` → existing enqueue + `runRenderJob` behavior (preserve)
  - `lambda` → new path below
- [ ] **9.2** Lambda path sequence:
  1. Validate session + audio asset
  2. Reject transparent export with clear 400 (“not supported on this deployment”)
  3. Check no in-flight job for session
  4. Compute fee server-side
  5. Create `jobId` + Mongo job `queued`
  6. **Debit credits** (fail → delete/cancel job, return insufficient)
  7. Resolve media URLs
  8. Call `startLyricVideoRenderOnLambda`
  9. Persist remotion ids; status `rendering`
  10. Return `{ jobId, feeMinor, balanceMinor }`
- [ ] **9.3** If step 8 fails after debit: mark job `error`, **do not refund**, return 502 with safe message.
- [ ] **9.4** Client `clientRequestId` optional for idempotency of entire start (document behavior).
- [ ] **9.5** Integration tests with mocked Lambda + real Mongo debit.

---

## Phase 10 — Poll + download (Lambda path)

- [ ] **10.1** `GET /api/render/[jobId]`:
  - Authz session ownership via Mongo
  - If rendering: refresh progress from Remotion; update Mongo
  - On done: set `fileUrl` to app route or indicate ready; set `downloadExpiresAt = now + 900s`
  - On error: surface fatal error message
- [ ] **10.2** `GET /api/render/[jobId]/file`:
  - If expired/cleaned → 410
  - Else redirect to presigned S3 GET or stream
- [ ] **10.3** Client: show expiry note when done; handle 410.
- [ ] **10.4** Tests for ownership 404 and expiry 410.

---

## Phase 11 — Cleanup sweeper

- [ ] **11.1** Implement `lib/render/export-cleanup.js`:
  - Delete S3 outputs with `downloadExpiresAt < now` or `createdAt + TTL`
  - Best-effort delete export-input prefixes for completed/failed jobs older than input TTL
- [ ] **11.2** Invoke cleanup:
  - On poll when expired, and/or
  - Lightweight call from existing session sweep hooks if safe
- [ ] **11.3** Document S3 **lifecycle rule** as belt-and-suspenders (1 day expire on `renders/` prefix) in operator notes.
- [ ] **11.4** Test cleanup with mocked S3 delete.

---

## Phase 12 — Local legacy path isolation

- [ ] **12.1** Ensure `runRenderJob` local path still used only for `local_legacy`.
- [ ] **12.2** Video BG on local: keep ffmpeg composite **or** Remotion path — either OK locally; do not require ffmpeg on Vercel.
- [ ] **12.3** On Lambda path, **never** call `renderVideoBackgroundComposite` or `findLocalBrowserExecutable`.
- [ ] **12.4** Smoke: `npm run dev` export still works without AWS env (manual or documented).

---

## Phase 13 — In-repo AWS operator kit (human runs)

Create files under e.g. `scripts/remotion-lambda/` and `Current .md docs/` or `docs/`:

- [ ] **13.1** `IAM_POLICY.example.json` — permissions Remotion needs (from current Remotion 4 Lambda docs).
- [ ] **13.2** `README_AWS_SETUP.md` with ordered human steps:
  1. Create AWS account / IAM user or role
  2. Install AWS CLI; configure profile
  3. Deploy Lambda function (exact CLI for pinned Remotion version)
  4. Deploy site from `remotion/register.js`
  5. Copy bucket name, function name, serve URL, region
  6. Paste into Vercel env + local `.env.local` for smoke
  7. Run smoke script
  8. Set S3 lifecycle 1-day on render prefix
- [ ] **13.3** npm scripts in `package.json`:
  - `remotion:lambda:sites`
  - `remotion:lambda:functions`
  - `remotion:lambda:smoke`
  - (wrappers calling remotion CLI with project entry)
- [ ] **13.4** `scripts/remotion-lambda/smoke.mjs` — render fixed short composition props (gradient, no user session); print cost estimate if available.
- [ ] **13.5** `.env.example` entries for all Remotion/export vars (placeholders only).
- [ ] **13.6** **BLOCKED (human):** Create AWS resources and paste secrets into Vercel.
- [ ] **13.7** **BLOCKED (human):** Confirm smoke script green.

---

## Phase 14 — Client polish and credits balance refresh

- [ ] **14.1** After successful debit response, refresh displayed credit balance in editor chrome.
- [ ] **14.2** Insufficient credits: CTA to top-up / dashboard.
- [ ] **14.3** Loading/error states for estimate fetch failures.
- [ ] **14.4** Disable double-submit on confirm.
- [ ] **14.5** Accessibility: confirm dialog focus trap if new modal.

---

## Phase 15 — Logging, observability, calibration hooks

- [ ] **15.1** Structured logs (no PII/secrets):
  - `[export:start]`, `[export:debit]`, `[export:lambda:start]`, `[export:done]`, `[export:fail]`, `[export:cleanup]`
- [ ] **15.2** Persist on job doc when available: Remotion estimated cost, duration ms, output bytes.
- [ ] **15.3** Add short note in plan or CREDITS doc: how to adjust `export-v1` rates after N renders.
- [ ] **15.4** Optional: admin-only script to average fee vs estimate (nice-to-have).

---

## Phase 16 — Test suite and CI

- [ ] **16.1** Unit: pricing, env, export mode.
- [ ] **16.2** Integration: debit + job lifecycle with mocks.
- [ ] **16.3** Route tests: unavailable, estimate, start insufficient funds, start success mocked.
- [ ] **16.4** Ensure `npm test` passes without AWS credentials.
- [ ] **16.5** Manual checklist in progress (below) completed on preview after human secrets.

---

## Phase 17 — Production cutover checklist

- [ ] **17.1** Vercel **without** secrets: export unavailable message verified on deployed URL.
- [ ] **17.2** **BLOCKED (human):** Add Lambda env to Vercel preview.
- [ ] **17.3** Preview: gradient export end-to-end; credits decrease; MP4 downloads.
- [ ] **17.4** Preview: video background export end-to-end.
- [ ] **17.5** Confirm download fails after 15 minutes (or forced expiry test).
- [ ] **17.6** Confirm S3 objects removed (console or script).
- [ ] **17.7** Promote env to production.
- [ ] **17.8** Watch first 24h error rate and AWS bill vs credits charged.
- [ ] **17.9** If AWS $ ≫ debit average, ship `export-v2` rate bump.

---

## Manual verification scripts (for agent or human)

### A. Mode matrix

| Env | Expected |
|-----|----------|
| Local, no AWS | Legacy export works |
| `VERCEL=1`, no AWS | Export unavailable |
| Lambda env set | Estimate + debit + Lambda (or mock in test) |

### B. Pricing examples (update if constants change)

| Section | Video BG? | Expected fee (export-v1 draft) |
|---------|-----------|--------------------------------|
| 10s | no | max(5, ceil(3+10×1)) = **13p** if min=5… use actual function |
| 30s | no | `3 + 30 = 33p` |
| 30s | yes | `ceil(33 × 1.5) = 50p` |
| 360s | yes | clamp to max if exceeds |

*(Agent: recompute with final constants and paste expected table into test cases.)*

### C. Credits

- Balance 10p, fee 33p → reject, no job, no debit.
- Balance 100p, fee 33p → balance 67p, ledger `EXPORT_RENDER` −33.

---

## Out of scope (do not tick as part of v1)

- [ ] Client-side web-renderer export
- [ ] Vercel Sandbox / Fly worker
- [ ] Transparent / chroma Lambda export
- [ ] Automatic refunds
- [ ] Long-term export gallery in R2
- [ ] Multi-region Lambda

---

## Definition of done (all must be true)

- [ ] Progress phases 1–12, 14–16 complete in code
- [ ] Phase 13 artifacts in-repo; human completed 13.6–13.7 when going live
- [ ] Phase 17 verified on preview/production as applicable
- [ ] `npm test` green
- [ ] Plan doc still matches behavior (update plan if implementation had to deviate — note deviations at bottom)

---

## Implementation deviations log

| Date | Deviation | Reason |
|------|-----------|--------|
| | | |

---

## Agent working notes

- Prefer small PRs / commits per phase when possible: (1) unavailable gate, (2) pricing+ledger, (3) Mongo jobs, (4) Lambda wire, (5) UI confirm, (6) cleanup+docs.
- Do not commit secrets or real AWS keys.
- When blocked on AWS, finish all code paths behind `isRemotionLambdaConfigured()` and leave smoke for human.
- Match existing code style; reuse `formatGbpFromMinor`, session cookies, and ledger patterns.
