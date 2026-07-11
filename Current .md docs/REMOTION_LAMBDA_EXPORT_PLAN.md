# Remotion Lambda MP4 Export — Comprehensive Plan

**Status:** **DEFERRED — future work** (do not implement as current priority)  
**Audience:** Builder agent + human operator (AWS secrets) — when export reliability is prioritized again  
**Related progress checklist:** `Current .md docs/REMOTION_LAMBDA_EXPORT_PROGRESS.md`  
**Date:** 2026-07-11  
**Last product update:** 2026-07-11  

### Product deferral note (read first)

As of 2026-07-11, **full server/Lambda MP4 export is postponed**. Near-term usable path:

- **Interim:** desktop **screen capture** (or equivalent browser MediaRecorder / tab-capture of the preview stage) so users can get a video without Remotion Lambda, Chromium on Vercel, or credits-for-render.
- **This plan remains the long-term cloud export design** (Remotion Lambda + credits debit + 15m S3 TTL, etc.) when quality/reliability/billing matter more than ship speed.
- **Platform roadmap:** web app is intended to become **desktop-focused**; a future **React Native** app covers mobile. Export architecture should eventually split: **client-side / desktop browser encode or capture on web**, **native export pipeline on mobile** — see §18.

Do **not** start Phase 0 of the progress checklist unless product re-opens “production MP4 export.”

---

## 1. Problem statement

MP4 export works in local `next dev` but **fails on Vercel deployment**. Root causes:

1. Fire-and-forget render after `POST /api/render` (serverless freezes background work).
2. In-memory job store (`globalThis.__reelCreatorRenderStore`) is multi-isolate-unsafe.
3. Output files live on isolate-local disk; poll/download hit other isolates.
4. No Chromium / Playwright browser on Vercel for Remotion.
5. System `ffmpeg` video-background composite path is not available on Vercel functions.

**Goal:** Production-ready export via **Remotion Lambda (AWS)**, charged against the **existing credits balance**, with a clear path that **disables broken export on Vercel until Lambda is configured**.

---

## 2. Locked product decisions

| Decision | Choice |
|----------|--------|
| **v1 export scope** | **Standard MP4 + video backgrounds** via Remotion composition (`OffthreadVideo`). Transparent/chroma/ffmpeg-only paths stay **local-dev only** or deferred. |
| **Credits pricing** | **Duration formula in pence** (base + per-second), tuned to approximate real Lambda $ cost. Versioned price table. Log Remotion/AWS estimates for later calibration. |
| **Debit timing** | **Up-front, non-refundable** debit when user confirms export. Failures do **not** refund. |
| **Pre-confirm UX** | **Show estimated cost** and require explicit confirm before debit + start. |
| **AWS surface** | **Minimize:** use AWS only as Remotion requires (Lambda + S3 site/output). **15-minute TTL** on finished objects; delete aggressively. |
| **Session media** | Stay on existing session storage / **R2** where applicable. Pass **presigned HTTPS GET URLs** into Lambda (no cookie session URLs). |
| **Environments** | **Local:** keep existing `renderMedia` path when Lambda env is **not** configured. **Vercel:** **disable export** with clear message until Lambda env is fully set; then use Lambda only. |
| **Operator model** | Builder prepares **in-repo** scripts, IAM templates, env docs, app code. Human **creates AWS resources / pastes secrets** once. |

---

## 3. Goals and non-goals

### Goals (v1)

- Reliable **1080×1920 @ 30fps** MP4 export on production for:
  - Gradient / solid / image backgrounds
  - **Video backgrounds** through Remotion (`Background.jsx` / `OffthreadVideo`), not local `renderVideoBackgroundComposite` on Vercel
- **Credits gate + up-front debit** on the standard balance ledger
- **Cost estimate + confirm** modal before start
- Durable **job status** (not in-memory-only on multi-isolate hosts)
- **Download** finished MP4 within **15 minutes**, then cleanup
- Safe defaults: concurrency caps, auth/session required, no open Lambda spam

### Non-goals (v1)

- Transparent text-layer / chroma exports on Lambda
- Client-side (`@remotion/web-renderer`) encode
- Vercel Sandbox / dedicated Fly worker (alternatives rejected for this plan)
- Refunds for failed renders
- Long-term archival of every export in S3/R2
- Full parity with every local ffmpeg edge case

---

## 4. Current architecture (baseline)

```
Browser → POST /api/render
       → createRenderJob (memory) + enqueueRenderJob (background)
       → GET /api/render/:jobId (poll memory)
       → GET /api/render/:jobId/file (local disk)

runRenderJob:
  - resolve session audio/bg (local or R2 download)
  - video BG → spawn system ffmpeg composite  OR
  - gradient/image → Remotion bundle + local Chromium renderMedia
```

Key files today:

| Area | Path |
|------|------|
| Start export | `app/api/render/route.js` |
| Poll | `app/api/render/[jobId]/route.js` |
| Download | `app/api/render/[jobId]/file/route.js` |
| Job memory store | `lib/render/store.js` |
| Render orchestration | `lib/render/render-job.js` |
| Video BG ffmpeg | `lib/render/video-background-composite.js` |
| Remotion entry | `remotion/register.js`, `remotion/LyricVideo.jsx`, `remotion/Background.jsx` |
| Client export UX | `components/editor-shell.js`, `components/render-export-modal.js` |
| Credits ledger | `lib/models/CreditLedger.js`, balance debit patterns in AI settle |
| Credits flag | `lib/credits/flags.js` (`CREDITS_ENABLED`) |
| Section duration | `lib/timing.js` (`getSectionBounds`, max 360s) |

Composition already accepts:

```js
{ audioUrl, backgroundUrl, backgroundDurationSec, project, transparent, textLayerMode, audioPrimingCompensationFrames }
```

This is **Lambda-friendly** once URLs are public/presigned HTTPS.

---

## 5. Target architecture

```
┌──────────────────┐     estimate + confirm      ┌─────────────────────┐
│  Editor (client) │ ──────────────────────────► │ POST /api/render     │
│  Export modal    │                             │  · compute fee       │
└────────┬─────────┘                             │  · debit credits    │
         │ poll / download                       │  · presign media    │
         │                                       │  · start Lambda     │
         ▼                                       └──────────┬──────────┘
┌──────────────────┐                                        │
│ GET job status   │◄──── Mongo RenderJob doc ──────────────┤
│ GET download URL │                                        ▼
└──────────────────┘                             ┌─────────────────────┐
                                                 │ Remotion Lambda     │
                                                 │  · Chromium encode  │
                                                 │  · write S3 output  │
                                                 └──────────┬──────────┘
                                                            │ 15 min TTL
                                                            ▼
                                                 ┌─────────────────────┐
                                                 │ AWS S3 (minimal)    │
                                                 │ site bundle + outs  │
                                                 └─────────────────────┘
```

### Environment matrix

| Environment | Export behavior |
|-------------|-----------------|
| Local `next dev`, Lambda **not** configured | Existing local `renderMedia` / ffmpeg paths (no credit debit required unless credits enabled and product decides otherwise — **default: same as today for local**). |
| Local with full Lambda env (optional) | Can exercise Lambda against real AWS for smoke tests. |
| Vercel, Lambda **not** fully configured | **Hard disable** export UI + API: clear error *“Export is not available on this deployment yet.”* |
| Vercel, Lambda configured + credits on | Lambda path only; credits required. |

**Detection of “Lambda ready”:** all required env vars present and valid (see §10). Prefer a single helper `isRemotionLambdaConfigured()`.

---

## 6. Credits model

### 6.1 Principles

- Export draws down the **same** user balance as AI phases (`Balance` + `CreditLedger`).
- Charge is **up-front and non-refundable** at confirm.
- Fee is **deterministic from project section duration** (and BG complexity factor), not live AWS billing at charge time.
- Log estimated AWS cost when available for **rate tuning**, not for the debit amount in v1.

### 6.2 Price table (v1 — tune after first real renders)

Implement in something like `lib/render/export-pricing.js` with `EXPORT_PRICE_TABLE_VERSION = "export-v1"`.

**Proposed initial formula (pence, integer):**

```
sectionSeconds = ceil(sectionDuration)   // from getSectionBounds(project.audio)
baseMinor      = 3                       // fixed overhead (cold start, I/O)
perSecondMinor = 1                       // ~£0.01 per second of output
complexityMult = videoBackground ? 1.5 : 1.0
raw = (baseMinor + perSecondMinor * sectionSeconds) * complexityMult
feeMinor = max(MIN_EXPORT_FEE_MINOR, ceil(raw))
// Optional cap for abuse / UX:
feeMinor = min(feeMinor, MAX_EXPORT_FEE_MINOR)
```

Suggested defaults:

| Constant | Value | Notes |
|----------|-------|--------|
| `MIN_EXPORT_FEE_MINOR` | `5` | Floor so tiny clips still cover overhead |
| `MAX_EXPORT_FEE_MINOR` | `400` | £4 cap for max 360s section; adjust after calibration |
| Video BG multiplier | `1.5` | OffthreadVideo is heavier than gradient/image |

**Calibration loop (post-ship):**

1. On each Lambda complete, store `estimatedAwsCostUsd` / GB-seconds if Remotion returns it.
2. Weekly compare average AWS $ vs average debit GBP.
3. Bump `export-v2` rates without changing ledger history.

### 6.3 Ledger

Add ledger type:

```js
// CreditLedger CREDIT_LEDGER_TYPES
"EXPORT_RENDER"
```

Debit entry fields:

- `type: "EXPORT_RENDER"`
- `amountMinor: -feeMinor`
- `idempotencyKey: export_debit:{renderJobId}` (or `export_debit:{sessionId}:{clientRequestId}`)
- `metadata: { sectionSeconds, feeMinor, priceTableVersion, hasVideoBackground, remotionRenderId?, compositionId }`

**Idempotency:** never double-debit if client retries `POST /api/render` with same client request id after success.

### 6.4 Gate flow

1. Client requests **estimate** (`GET` or dry `POST` with `dryRun: true`) → `{ feeMinor, sectionSeconds, currency, priceTableVersion, breakdown }`.
2. User confirms in modal.
3. `POST /api/render` with `{ confirm: true, clientRequestId, ...project }`:
   - Recompute fee server-side (never trust client fee).
   - If balance &lt; fee → `402` / structured `insufficient_credits`.
   - Debit ledger + balance **before** calling Lambda.
   - Start Lambda; persist job.
4. If Lambda start fails after debit → job status `error`, **no refund** (product decision). Surface honest error; log for ops.

When `CREDITS_ENABLED` is false:

- Local: export may still work as today.
- Production Lambda path: **require credits** once Lambda is the prod export path (or treat credits-off as export-disabled on Vercel — prefer **require credits for Lambda**).

---

## 7. Media access for Lambda

Lambda cannot use cookie session routes.

### 7.1 Audio

- Session MP3 is typically **local `/tmp` session files** on Vercel (or R2 later).
- Before Lambda start:
  1. Resolve audio via `resolveAssetStorage`.
  2. If local: **upload to short-TTL S3 (or R2)** under `export-inputs/{jobId}/audio.mp3`, or stream upload to the Remotion-designated input location.
  3. If already R2: create **presigned GET** (TTL ≥ render time + buffer, e.g. 1h even if output is 15m).
  4. Pass `audioUrl` as HTTPS URL in `inputProps`.

**Minimize AWS:** prefer **R2 presigned GET** when asset is already on R2; only put inputs on S3 if required by Remotion tooling. If audio is only on local session disk of the API instance, that instance must upload once to S3/R2 before invoke.

### 7.2 Background

- Image/video BG: same pattern — presigned HTTPS URL.
- Video BG duration: pass `backgroundDurationSec` as today.
- **Do not** use `renderVideoBackgroundComposite` on Lambda/Vercel; Remotion composition already supports video BG.

### 7.3 Fonts

Already imported via `@fontsource/*` in `remotion/register.js` — included in site bundle when deployed to Lambda site. Verify Noto family renders on Lambda Linux after first smoke test.

---

## 8. Job persistence and API contract

### 8.1 Why not memory-only

Multi-isolate Vercel cannot share `Map` job state. Persist jobs in **MongoDB** (already used for credits/generations).

### 8.2 `RenderJob` model (new)

Suggested fields:

| Field | Purpose |
|-------|---------|
| `_id` / `jobId` | UUID |
| `sessionId` | Owner session |
| `status` | `queued` \| `rendering` \| `done` \| `error` |
| `progress` | 0–1 |
| `error` | Safe message |
| `feeMinor` | Debited amount |
| `priceTableVersion` | |
| `ledgerIdempotencyKey` | |
| `remotionRenderId` | AWS/Remotion id |
| `remotionBucketName` / `outKey` | For download + cleanup |
| `downloadUrl` / `downloadExpiresAt` | Presigned, ≤15 min |
| `sectionSeconds`, `hasVideoBackground` | Audit |
| `createdAt`, `updatedAt`, `expiresAt` | TTL index for cleanup |

### 8.3 API surface

| Method | Path | Behavior |
|--------|------|----------|
| `GET` | `/api/render/estimate` | Section duration + fee breakdown (no debit). Auth: session. |
| `POST` | `/api/render` | Confirm export: debit + start. Body includes project, asset ids, `clientRequestId`, `confirm: true`. |
| `GET` | `/api/render/[jobId]` | Status/progress; session must own job. |
| `GET` | `/api/render/[jobId]/file` | Redirect or stream via **short-lived presigned S3 URL**; 410 if expired/cleaned. |

**Vercel without Lambda config:** all of the above return **503/404** with stable error code `export_unavailable` (except local).

### 8.4 Polling

Client keeps existing poll UX. Server may:

- Proxy Remotion `getRenderProgress`, or
- Update Mongo from progress polls / optional webhook.

Prefer **on poll**: if status rendering, refresh from Remotion API and update Mongo (simple, no extra queue worker).

---

## 9. Remotion Lambda integration

### 9.1 Packages

Add (version-align with existing `^4.0.474`):

- `@remotion/lambda`

### 9.2 Deploy artifacts (human + scripts)

In-repo:

- `scripts/remotion-lambda/` or npm scripts:
  - `remotion:lambda:policies` — print/create IAM policy JSON
  - `remotion:lambda:functions` — deploy function
  - `remotion:lambda:sites` — deploy site from `remotion/register.js`
  - `remotion:lambda:smoke` — render fixed sample props
  - `remotion:lambda:cleanup` — delete expired outputs

Document exact CLI commands in progress doc (Remotion’s current CLI may be `npx remotion lambda functions deploy` etc. — builder must verify against installed Remotion 4 docs).

### 9.3 Runtime call (sketch)

```js
import { renderMediaOnLambda, getRenderProgress } from "@remotion/lambda/client";

await renderMediaOnLambda({
  region,
  functionName,
  serveUrl, // deployed site
  composition: REMOTION_COMPOSITION_ID, // "LyricVideo"
  inputProps: {
    audioUrl, // https
    backgroundUrl,
    backgroundDurationSec,
    project,
    transparent: false,
    textLayerMode: null,
    audioPrimingCompensationFrames,
  },
  codec: "h264",
  imageFormat: "jpeg",
  // privacy, maxRetries, framesPerLambda — choose cost/speed defaults
});
```

### 9.4 Output lifecycle (15 minutes)

1. On `done`, create presigned GET for output object, `downloadExpiresAt = now + 15m`.
2. Schedule cleanup:
   - S3 lifecycle rule on prefix `renders/` **expire 1 day** as safety net, **and**
   - App sweeper / on next status poll after expiry: `DeleteObject`.
3. UI: “Download expires in 15 minutes.”

### 9.5 Concurrency and abuse

- One in-flight export per session (keep existing 409 behavior).
- Global soft cap via env `EXPORT_MAX_CONCURRENT` (best-effort count of Mongo `rendering` jobs).
- Require valid session + credits.
- Max section already 360s.

---

## 10. Configuration (env)

### Required for Lambda-ready

| Variable | Purpose |
|----------|---------|
| `REMOTION_AWS_ACCESS_KEY_ID` | Or use role pattern documented by Remotion |
| `REMOTION_AWS_SECRET_ACCESS_KEY` | |
| `REMOTION_AWS_REGION` | e.g. `us-east-1` |
| `REMOTION_FUNCTION_NAME` | Deployed function |
| `REMOTION_SERVE_URL` | Deployed site URL |
| `REMOTION_BUCKET_NAME` | S3 bucket Remotion uses |

Optional:

| Variable | Purpose |
|----------|---------|
| `EXPORT_PRICE_*` | Override base/per-second/min/max without code change |
| `EXPORT_OUTPUT_TTL_SECONDS` | Default `900` (15 min) |
| `EXPORT_MAX_CONCURRENT` | Default e.g. `3` |
| `CREDITS_ENABLED` | Existing |

`isRemotionLambdaConfigured()` = all required present and non-empty.

### Vercel

- Set secrets only after AWS deploy smoke passes.
- Until then export stays disabled on Vercel.

---

## 11. Client UX changes

### 11.1 Export entry

- If production and Lambda not configured: Export button disabled + tooltip/modal message.
- If Lambda configured: open export flow → **estimate** → **confirm cost** → start.

### 11.2 Confirm modal (new or extend `RenderExportModal`)

Show:

- Section length
- Background type
- **Estimated cost** (`formatGbpFromMinor(feeMinor)`)
- Warning: **charge is non-refundable** even if render fails
- Balance after debit (if known)
- Confirm / Cancel

### 11.3 Progress / done

- Reuse progress UI.
- On done: auto-download if possible; show expiry countdown.
- On error: show message; no refund language.

### 11.4 Credits disabled

- Local: legacy behavior.
- Vercel Lambda: treat as unavailable or block (plan: **block Lambda without credits**).

---

## 12. Security and privacy

- Never expose AWS keys to the client.
- Presigned media URLs: short TTL, object keys unguessable (`export-inputs/{uuid}/…`).
- Job access: session cookie must match `job.sessionId`.
- Ledger metadata must not include raw secrets.
- Rate-limit export starts per session (existing in-flight lock + optional IP soft limit later).

---

## 13. Testing strategy

| Layer | Coverage |
|-------|----------|
| Unit | `export-pricing.js` fee math; `isRemotionLambdaConfigured`; debit idempotency |
| Integration | Mongo job create/update; ledger debit with memory Mongo |
| API | estimate 200; insufficient credits; Vercel-without-config → unavailable; confirm debit then mocked Lambda |
| Smoke (human/script) | Real Lambda render of sample props; video BG sample; download within 15m; object gone after cleanup |
| Regression | Local export still works without Lambda env |

Mock `@remotion/lambda/client` in CI — do not call AWS in unit tests.

---

## 14. Rollout plan

1. **Code complete + local path intact**; Vercel export **disabled** with message.
2. Human deploys AWS function/site; pastes env into Vercel preview.
3. Smoke render on preview.
4. Enable by presence of env (no separate feature flag required if `isRemotionLambdaConfigured()` is the gate).
5. Calibrate prices after 10–20 real exports.
6. Optional later: transparent layer, refunds policy change, R2 output mirror.

---

## 15. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Lambda cost &gt;&gt; debit | Log estimates; raise `perSecondMinor`; min fee |
| Debit then Lambda fail | Accepted; improve reliability; alert on high error rate |
| Presigned URL expired mid-render | Input URL TTL 1h; outputs 15m only after done |
| Video BG / MOV fail on Lambda | Prefer MP4/WebM; error message; test formats |
| Font missing glyphs | Smoke multi-script sample |
| Site bundle drift | Redeploy site on every composition change (CI script) |
| S3 cost creep | Lifecycle + 15m app delete |

---

## 16. Success criteria

- [ ] On Vercel **without** Lambda env: export clearly unavailable (no 404 job loops).
- [ ] On Vercel **with** Lambda env: standard MP4 and video-BG MP4 complete end-to-end.
- [ ] Credits: estimate shown; up-front debit; balance decreases; ledger `EXPORT_RENDER` row.
- [ ] Download works within 15 minutes; fails cleanly after expiry.
- [ ] Local `next dev` without AWS still exports (legacy path).
- [ ] No secrets in client bundles or git.

---

## 17. Document ownership

| Doc | Role |
|-----|------|
| **This file** | Architecture, decisions, contracts — update when decisions change |
| **`REMOTION_LAMBDA_EXPORT_PROGRESS.md`** | Ordered implementation checklist for the builder agent |

Builder agents should implement using the **progress doc** as the source of truth for sequencing, and this plan for intent/constraints.

**When deferred:** leave both docs in place; implement interim capture elsewhere; re-open this plan when cloud export is scheduled.

---

## 18. Future platform split (web desktop + React Native)

### Direction

| Surface | Role | Export direction (future) |
|---------|------|---------------------------|
| **Web** | Desktop editor only | Client-side capture and/or `@remotion/web-renderer` / local encode; optional Lambda later for “studio quality” |
| **React Native** | Mobile product | Native composition/export (or RN + ffmpeg/module); **not** Vercel `renderMedia` |

### Is “client desktop + native mobile” possible?

**Yes — and it’s a clean long-term split**, with caveats:

| Path | Feasibility | Notes |
|------|-------------|--------|
| **Desktop web: screen/tab capture (MediaRecorder)** | High for MVP | Fast to ship; quality depends on display, tab focus, browser; audio may need separate mix |
| **Desktop web: Remotion web-renderer / in-browser encode** | Medium | Better determinism than capture; experimental stack; Chrome/Edge first |
| **Desktop web: Remotion Lambda (this plan)** | High quality | Best for paid, consistent output; more ops |
| **Mobile RN: native export** | High if built for it | Reuse lyric/timing **data model**, not the Next.js render routes; may share project JSON schema |

Shared forever: **project snapshot**, lyric lines, timing, style tokens, credits account.  
Not shared: Vercel API render jobs, Playwright Chromium, in-memory render store.

### Cleanest path forward (recommended sequence)

1. **Now — ship usable video**  
   Desktop **screen/preview capture** (or record the Remotion Player region). Keep export **disabled/broken paths off Vercel** or hide “pro export.” **No Lambda build yet.**  
   Credits: optional later for capture (usually free or tiny flat fee).

2. **Soon — desktop-only web**  
   Stop treating mobile browser as first-class export. Optimize editor UX for desktop; point phones at “app coming” if needed.

3. **Next quality step (desktop web)**  
   Either improve capture (fixed resolution canvas capture from the composition, not whole screen) **or** trial `@remotion/web-renderer` for true client encode — still no AWS.

4. **When revenue/quality demand it**  
   Re-open **this Lambda plan** for paid, deterministic cloud MP4 + credits drawdown.

5. **Mobile app**  
   New RN export module; import same project JSON; do not port `lib/render/render-job.js` to phone.

### What not to do

- Don’t invest in Vercel serverless `renderMedia` — still multi-isolate / no Chrome.  
- Don’t block ship on Lambda if capture unblocks users.  
- Don’t assume RN can call the same `/api/render` Lambda flow without a mobile-auth and asset pipeline redesign (possible later, not required for v1 app).
