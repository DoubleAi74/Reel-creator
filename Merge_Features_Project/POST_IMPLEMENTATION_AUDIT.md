# Post-Implementation Audit — Merge Features Project (Phase 1 + Phase 2)

**Auditor role**: Independent post-implementation audit agent (did not plan or implement).
**Date**: 2026-07-09
**Branch audited**: `codex/phase-2-credit-dashboard` @ HEAD `d31ebfd` (Phase 1 `36d5fd8`, Phase 2 stages `0d47c43`…`28858e1`).
**Authorisation**: Read-only audit. No production code, tests, schemas, or planning docs were modified. This file is the sole deliverable.
**Scope**: The combined Phase 1 (YouTube audio import) + Phase 2 (credit dashboard / metering / payments / persistence / dashboard) application.

---

## 1. Overall Verdict

**PASS WITH NON-BLOCKING ISSUES.**

The combined system is coherent, feature-flagged off by default (`CREDITS_ENABLED=false`), and passes its own quality gates (independently reproduced: `npm test` 53 files / 331 tests, `npm run lint` exit 0, `npm run build` exit 0 compiling all Phase 1 + Phase 2 routes). No confirmed money-corrupting defect, crash, or unguarded never-negative violation was found. The append-only ledger, exactly-once top-up path, per-phase settlement idempotency, SSRF hardening, and R2 reconcile logic are well-built and well-tested against mocks.

Sandbox E2E **may begin**. However, several **design/financial and operational issues should be repaired before *live* (real-money) enablement** — chiefly (a) work that is delivered and persisted even when it cannot be charged, (b) no remediation tooling for `accountingStatus: "unresolved"`, (c) an unauthenticated/unthrottled checkout route that drives an external paid API, and (d) a bounded-cleanup sweeper that was implemented but never wired in. None of these block sandbox validation; all are listed as pre-live gates.

Missing real-service E2E validation (RapidAPI, SumUp, Atlas replica-set, R2, OpenAI usage/pricing) is **not** counted as a code defect but is retained as an explicit release gate (§18, §22).

---

## 2. Executive Summary

Phase 1 delivers a first-class "From YouTube" audio path that ingests a trimmed MP3 into the existing session-asset system (`storeAudioAssetFromPath`), indistinguishable downstream from a manual upload, gated by a server-only RapidAPI key and hidden when unconfigured. The SSRF redirect hardening, path-ingestion safety, sweep exemption, cleanup 409, and idempotent per-`(jobId, sessionId)` ingestion are all present and match the corrected plan. Manual upload behaviour is preserved.

Phase 2 layers usage metering, an append-only GBP ledger with never-negative enforcement and idempotency keys, per-billing-phase settlement (`ai_debit:{jobId}:{phase}`), SumUp dual-path exactly-once top-ups, MongoDB `Generation`/`UsageRecord` persistence, R2 audio promotion with two-way reconcile, a read-only public dashboard, and a password + rate-limit gate on generation start. The whole layer is inert unless `CREDITS_ENABLED=true`.

The core accounting primitives are sound. The main risks are at the edges of the money model: because per-run cost is unknown up front and the start gate only checks a floor (default 1p), a generation whose real cost exceeds the available balance still **completes, returns its full result, and persists** — settlement fails closed (never-negative holds), the job is flagged `unresolved`, but the user has received uncharged work, and there is no operational tool to reconcile it. Combined with an unauthenticated checkout route, these are the items to close before charging real customers. The public dashboard also exposes the uploaded MP3 filename as the card title, which is a privacy consideration for a world-readable page.

---

## 3. Evidence Reviewed

**Mandatory documents (read in full):** `PROJECT_OVERVIEW.md`; `REPOSITORY_INTEGRITY_CHECK.md`; `PHASE_1_COMMIT_EXECUTION.md`, `PHASE_1_COMMIT_PREPARATION.md` (Phase 1 completion/handoff records); `Merge_1_YT/{INFORMATION_BANK,IMPLEMENTATION_PLAN,PROGRESS,PLAN_VERIFICATION}.md`; `Merge_2_Credit_dash/{INFORMATION_BANK,IMPLEMENTATION_PLAN,PROGRESS,PLAN_VERIFICATION}.md`; `CREDITS_SETUP.md`; `README.md`; `.env.example`.

**Live source inspected (primary):**
- Phase 1: `lib/youtube-audio/{job-store,media-fetcher,storage,server-config}.js`, `app/api/youtube-audio-segments/route.js`, `app/api/youtube-audio-segments/[jobId]/route.js`, `app/api/youtube-audio/config/route.js` (via build), `app/api/cleanup/route.js`, `lib/files.js`.
- Phase 2 money core: `lib/money.js`, `lib/ledger/balance-ledger.js`, `lib/credits/{credit-service,flags,billing-phases,rate-limit,unlock-cookie}.js`, `lib/ai/{openai-pricing,openai-usage,transcribe-job}.js`, `lib/ai/openai-lyrics.js` (8 usage call sites).
- Phase 2 models: `lib/models/{Balance,CreditLedger,Generation,UsageRecord,PaymentOrder}.js`; `lib/db/{mongoose,bootstrap}.js`.
- Phase 2 payments/R2/persistence: `lib/payments/{payment-verification,sumup-client,sumup-env,payment-orders,payment-urls}.js`, `app/api/webhooks/sumup/route.js`, `app/api/credits/{checkout,orders/[orderId],unlock,balance}/route.js`, `lib/r2/{r2-client,r2-env,audio-r2-lifecycle}.js`, `lib/generations/{persist-generation,serialize-generation}.js`, `app/api/media/generations/[id]/route.js`, `app/api/dashboard/{state,generations/[id]}/route.js`.
- Client: `components/credit-chrome.jsx`, `components/editor-shell.js` (credit chrome + pipelineRunId/save wiring), `app/api/ai/transcribe/route.js`.
- Ops: `scripts/{ledger-repair,r2-reconcile,payment-audit,db-smoke}.mjs`, `package.json`, `vitest.config.mjs`, `eslint.config.mjs`, `next.config.mjs`.

**Commands run (non-destructive):** `git rev-parse/log/status/branch`; `npm test` → **53 files / 331 tests passed (exit 0)**; `npm run lint` → **exit 0, clean**; `npm run build` → **exit 0**, all Phase 1 + Phase 2 routes compiled; `grep`/`ls` inspection. No external/paid/stateful service was contacted; no MongoDB/R2/SumUp/OpenAI mutation. mongodb-memory-server (dev dependency) provides the in-test replica set.

**Repository integrity note:** The session's initial `gitStatus` snapshot (HEAD `28858e1`, Phase 1 uncommitted) was **stale**. The actual live state is HEAD `d31ebfd` with Phase 1 committed in `36d5fd8` and a clean tree except `Merge_Features_Project/REPOSITORY_INTEGRITY_CHECK.md` (a pre-existing working-tree change I did not touch). `REPOSITORY_INTEGRITY_CHECK.md`'s "SELF-CONTAINED" verdict is accurate for the current HEAD.

---

## 4. Release Blockers

**None at code level for *sandbox* E2E.** The layer ships disabled and passes all local gates.

The single unavoidable **release gate** (not a code defect, per audit principles) before *live* enablement: **real-service E2E has never been run.** RapidAPI (Phase 1), SumUp checkout/webhook/return, MongoDB Atlas replica-set transactions, R2, and real OpenAI usage/pricing are all mock-validated only. This is documented as the operator runbook step in `CREDITS_SETUP.md`. See §18/§22 for the required checklist additions.

The high-severity items in §5 are **pre-live gates**, not sandbox blockers.

---

## 5. High-Severity Defects

### H1 — Delivered/persisted work can go unbilled when run cost exceeds balance (revenue integrity)
**Category:** design risk / financial. **Files:** `lib/credits/credit-service.js:85-111,238-244`; `lib/ai/transcribe-job.js:58-88,314-335`; `app/api/ai/transcribe/route.js:141-171`.
The start gate only checks `balance >= MIN_GENERATION_BALANCE_MINOR` (default **1p**, `flags.js:7-21`); per-run cost is unknown up front (plan D6 acknowledges this). Settlement occurs *after* the AI work. If the conditional debit cannot cover the real cost, `applyLedgeredBalanceChange` returns null → `INSUFFICIENT_BALANCE` (`balance-ledger.js:192-194`), re-thrown by `settlePhase`. `settleCompletedUsage` **catches** it, marks the job `accountingStatus:"unresolved"`, and `runTranscribeJob` then still calls `persistCompletedGeneration` and `markTranscribeJobComplete(jobId, result)` (`transcribe-job.js:76-87,314-335`). Net effect: never-negative holds (good), but the user receives — and can save to the public dashboard — work that was not charged. In the live separate-job flow each phase re-hits the 1p floor, so the leak is bounded to roughly one phase's cost per gate-pass, but it is repeatable within the rate-limit window and leaves no ledger entry.
**Not a sandbox blocker** (no real money at stake in sandbox) but a **pre-live gate**.

### H2 — No remediation path for `accountingStatus: "unresolved"`
**Category:** operational gap / financial. **Files:** `lib/ai/transcribe-job.js:76-87`; `scripts/ledger-repair.mjs`; absence of `app/api/admin/*`.
Plan §16 states unresolved accounting is recovered by "an admin path re-runs `settlePhase` idempotently or applies `MANUAL_ADJUSTMENT`." No such route or script exists. `ledger-repair.mjs` only backfills missing `top_up:{orderId}` entries (`ledger-repair.mjs:51-92`); it does not re-settle AI debits. `ENABLE_ADMIN_TOOLS` is unused and `sumup-refunds.js` is ported but unwired (grep confirms). Consequently any `unresolved` job (from H1, a divergence, or a transient DB error at settlement) accumulates real unbilled work with no supported reconciliation tool other than hand-editing MongoDB.

### H3 — `/api/credits/checkout` is unauthenticated and unthrottled while driving a paid external API
**Category:** security / abuse. **Files:** `app/api/credits/checkout/route.js:59-134`.
The route validates the amount and reuses a pending order within a 10-minute window (`payment-orders.js:35-60`), and amounts are server-authoritative — good. But it has **no password gate and no rate limit**, and each non-reused request calls SumUp `createHostedCheckout` (an external, billable/quota-bearing API) plus writes a `PaymentOrder`. Because the reuse window keys on `(amountMinor, currency)`, an attacker can defeat it by iterating the 1–10000p amount space, forcing up to ~10,000 SumUp checkout creations and order rows per window. Plan §17 claims checkout is "protected" but lists only bounds/reuse-window. Add a per-IP/session rate limit (the `checkGenerationRateLimit` limiter can be reused with a distinct key namespace) before live.

---

## 6. Medium-Severity Defects

### M1 — `sweepStaleYoutubeAudioResults` is implemented but never invoked
**Category:** operational gap / plan deviation. **Files:** `lib/youtube-audio/storage.js:91-129` (only referenced by its own unit test; repo-wide grep finds no runtime caller).
Plan §8.6 requires this stale-result-dir sweeper "called from the YT POST/status routes before/after normal job pruning," and PROGRESS.md/acceptance criteria claim "Job result temp files are pruned on expiry/stale sweep." The live-job cleanup path (`deleteStoredResult` on `deleteJob`/`markJobFailed`/`pruneExpiredJobs`, `job-store.js:185-205,409-432`) works, but jobs are in-memory only. After a server restart the in-memory job map is lost while result `.mp3` files remain on disk, and **nothing sweeps them** — the one function designed to catch orphans is dead code. Result: unbounded orphaned-MP3 accumulation in `<tmp>/reel-creator-youtube-audio/results` across restarts.

### M2 — Generation-unlock cookie omits the `Secure` flag
**Category:** security / plan deviation. **Files:** `lib/credits/unlock-cookie.js:87-95`; `app/api/credits/unlock/route.js:33-36`.
Plan §5.1 specifies the unlock cookie be "`Secure` in production." `buildGenerationUnlockSetCookie` sets `HttpOnly; SameSite=Lax` but never `Secure`. Over a plain-HTTP hop the signed unlock token (which authorises paid generation) can be captured and replayed until TTL expiry. (The pre-existing session cookie in `app/api/ai/transcribe/route.js:97-102` is likewise non-Secure, but that predates the merge.) Add `Secure` when not on localhost/production.

### M3 — Public dashboard leaks the uploaded MP3 filename (and `sourceType`)
**Category:** privacy / plan deviation. **Files:** `lib/generations/serialize-generation.js:30-49`; `lib/generations/persist-generation.js:47-63` (`inferTitle`).
`/dashboard` is world-readable (D2). The card `title` defaults to `assetMetadata.name` — i.e. the user's original upload filename (or the YouTube video title). A private draft named `personal-demo-v3.mp3` becomes a public card title. Additionally, `serializePublicCard` returns `sourceType`, which plan §10.2 explicitly said must **never** be exposed ("never `pipelineRunId`, jobIds, finalJobId, ledger keys, usage, r2 internals, sourceType…"). Neither leaks credentials, but both diverge from the intended public contract. Consider a sanitised/opaque default title and dropping `sourceType` from the public projection.

### M4 — Master kill-switch (`CREDITS_ENABLED`) is not enforced uniformly across routes
**Category:** design risk. **Files:** `app/api/credits/checkout/route.js`, `app/api/credits/orders/[orderId]/route.js`, `app/api/webhooks/sumup/route.js`, `app/api/dashboard/state/route.js`, `app/api/dashboard/generations/[id]/route.js`, `app/api/media/generations/[id]/route.js` (none call `isCreditsEnabled()`).
Plan §14/§23 present `CREDITS_ENABLED=false` as a master switch after which "no new read/write path executes." In reality only the generation-charging gate (`transcribe/route.js:142`), `balance`, and `unlock` routes check the flag. If a deployment has Mongo/SumUp/R2 configured but `CREDITS_ENABLED=false`, the checkout, webhook (which can credit the balance), orders, dashboard, and media routes remain fully live. Practically they fail closed only because their backends are usually unconfigured when the flag is off, but the guarantee is not structural. Gate the payment/persistence mutation routes on the flag as well.

---

## 7. Low-Severity Defects and Polish

- **L1 — Phantom cost recorded for failed OpenAI audio calls.** `recordOpenAiCallUsage` runs *before* the `if (!response.ok) throw` at each audio site (`openai-lyrics.js:1672-1683,1817-1826`). A failed transcription still writes a `UsageRecord` with `rawCostMicros` = full audio-minute cost. It is never charged (the phase fails → `recordUnsettledUsage` marks `charged:false`), so no financial impact, but it pollutes the audit spine. Record usage only on `response.ok`.
- **L2 — SSRF DNS-rebinding/TOCTOU residual.** `media-fetcher.js:410-446` resolves the hostname and rejects private IPs, then `fetch()` (line 84) re-resolves independently. A provider-supplied hostname with low-TTL rebinding could pass validation then connect to a private IP. Providers are semi-trusted RapidAPI endpoints, lowering likelihood. Robust fix: resolve once, pin the IP, send `Host` header.
- **L3 — Webhook is not truly "quick-ack".** `app/api/webhooks/sumup/route.js:106` awaits the full SumUp re-query + credit before returning 200. Plan D11 said "quick-ack + verification." The return-page poll makes exactly-once robust regardless, but a slow SumUp call can delay the ack and trigger SumUp retries. Consider acking first, then verifying.
- **L4 — `/api/credits/orders/[orderId]` public re-query.** `orders/[orderId]/route.js:26-46` re-queries SumUp for any guessable `order_<ObjectId>` reference and returns amount/status. Minor info disclosure + external-API amplification.
- **L5 — Audio-seconds fallback is not the full 4-level chain from plan §11.1.** Call sites pass `audioSeconds = getPositiveDurationSeconds(audio.duration)` (`openai-lyrics.js:1124,2032`), plus whisper's own `data.duration` (`openai-usage.js:74-83`). The documented `metadata.durationSec → server ffprobe` fallbacks are not used at the call site. Benign because project/segment duration is normally present (covers upload `durationSec:null` and YouTube alike), but a direct API call with `audio.duration=0` would record `usageType:"none", cost 0`.
- **L6 — `Generation.finalJobId` is not unique-indexed.** `persist-generation.js:278-333` guards duplicates with an in-transaction `findOne({finalJobId})`, but two concurrent persists for the same `finalJobId` could each miss the other's uncommitted doc and create two. Single-call-per-job in practice; add a unique partial index for defence in depth.
- **L7 — `ledger-repair.mjs` stamps `balanceAfterMinor` = current balance for historical entries** (`ledger-repair.mjs:78`), which is imprecise for a backfilled row and identical across multiple repaired rows. It does not change the balance, so it is safe, but the audit value is approximate.
- **L8 — Rate limiter is in-memory/per-process** (`rate-limit.js:4-9`). In a multi-instance deployment the effective limit is `max × instances`; the store also grows unboundedly with unique IP/session keys (no eviction). Acceptable for single-instance; document the assumption.
- **L9 — `getRequestIp` trusts the first `x-forwarded-for` hop** (`transcribe/route.js:104-112`) — spoofable unless a trusted proxy is guaranteed.

---

## 8. Phase 1 Audit Findings

| Area | Finding | Evidence |
|---|---|---|
| YouTube URL flow / validation | Correct. Hand-written validator (no zod), auto-provider only, session cookie created like `/api/upload`, `FEATURE_DISABLED` when unconfigured. | `youtube-audio-segments/route.js:19-56`, `validation.js`, `server-config.js` |
| Local-upload coexistence | Preserved. `storeUploadedAsset` unchanged except additive `sourceType:"upload"`. | `lib/files.js:315-384` |
| Provider adapters & fallback | Automatic fallback + per-attempt tracking retained; `publicJob` strips `downloadUrl`. | `job-store.js:207-281,300-327` |
| Job creation/polling/expiry/reuse | Fingerprint dedup, `JOB_TTL_MS=1h`, `REUSABLE_JOB_MS=10m`, in-memory global store. | `job-store.js:17-112,516-522` |
| Admission caps | `RESOURCE_LIMIT_REACHED` (429) on queue depth / per-session caps. | `job-store.js:524-540` |
| FFmpeg/FFprobe | System binaries (D1), no static deps, no `next.config` change. | `audio-ffmpeg.js`, `next.config.mjs` |
| Remote download / SSRF | Strong: `redirect:"manual"`, per-hop protocol/credential/DNS/private-IP checks (v4+v6, incl. IPv4-mapped), redirect depth ≤3, JSON indirection ≤3, byte-limit stream, HTML/image rejection. Residual TOCTOU rebinding = L2. | `media-fetcher.js:72-446` |
| Media limits | source ≤ configured max; final ≤ `MAX_AUDIO_BYTES` at ingest. | `media-fetcher.js:254-271`, `files.js:422-425` |
| Trusted-path ingestion / assetId handoff | `storeAudioAssetFromPath` realpath-contained to trusted root, `isFile`, size cap, MP3 sniff, finite+positive duration, atomic temp→rename, cleanup on failure. Returns normal `{assetId,durationSec,name,kind,sizeBytes}`. | `files.js:386-468`, `[jobId]/route.js:56-69` |
| Real duration metadata | `outputDurationSec` from final probe is authoritative on the asset. | `job-store.js:150-183`, `[jobId]/route.js:61` |
| Session ownership / idempotent ingest | Idempotent per `(jobId, sessionId)` via `ingestedBySession`; cross-session reuse ingests per-session. | `job-store.js:329-352`, `[jobId]/route.js:47-64` |
| Sweep exemption & cleanup 409 | Active YT sessions exempt from sweep; explicit `/api/cleanup` returns 409 while a YT job is active. | `files.js:202-207`, `cleanup/route.js:58-63` |
| Job-result cleanup | Live path OK; **stale-dir sweeper never invoked** → orphan risk after restart. | **M1** |
| Waveform / preview / timing / transcribe / render / export parity | Handoff mirrors `handleAudioFile`; asset served via `/api/assets/{id}`; no browser `File`/blob required. Downstream tests pass. | PROGRESS Stage 4; test run |
| Feature-disabled state | `/config` boolean hides UI; POST returns `FEATURE_DISABLED` (503). | `youtube-audio-segments/route.js:19-21` |
| Diagnostics & secret isolation | `diagnostics.js` redaction; attempts/quota preserved server-side, not surfaced in UI (D7). | `job-store.js:499-514` |

Phase 1 is faithful to its corrected plan; the three original PLAN_VERIFICATION blockers (redirect SSRF, result cleanup ownership, executable test gate) are resolved in code, **except** that the stale-result sweep half of the cleanup design is not wired (M1).

---

## 9. Phase 2 Audit Findings

| Area | Finding | Evidence |
|---|---|---|
| Credit balance | Singleton `_id:"shared"`, min 0, integer validator, seeded 500p. | `Balance.js`, `bootstrap.js:27-45` |
| Append-only ledger | Immutable `createdAt`, unique `idempotencyKey`, `balanceAfterMinor` stamped post-update, corrections only via `MANUAL_ADJUSTMENT`. | `CreditLedger.js`, `balance-ledger.js:150-197` |
| Never-negative | Conditional `findOneAndUpdate({amountMinor:{$gte:|debit|}})` → null → `INSUFFICIENT_BALANCE`; in-transaction so the pre-created ledger row rolls back. | `balance-ledger.js:167-194` |
| Idempotency keys | Exact-replay match check (type/amount/currency/reason/ids/metadata via stable JSON) → `applied:false`; divergence → `LEDGER_REPLAY_DIVERGENCE`. | `balance-ledger.js:82-148` |
| Concurrent debits/credits | `withTransaction` retries transient write conflicts; verification path adds an explicit 5× retry loop. Tested. | `credit-service.js:140-153`, `payment-verification.js:115-140` |
| OpenAI usage capture | Collector threaded into all 8 call sites after `tryParseJson`; Responses `input/output/total`, audio `tokens`/`duration`/`none`+fallback. | `openai-usage.js`, `openai-lyrics.js` (8 sites) |
| Endpoint-specific handling | `responses` vs `audio` differentiated; per-chunk duration billed correctly. | `openai-usage.js:46-102`, `openai-lyrics.js:1743-1760` |
| Retries / attempt accounting | Only the final `fetchOpenAiWithRetry` response is recorded (not per internal retry); job-level replay reuses deterministic `callId` sequence (in-memory counter). | `openai-usage.js:210-249` |
| Pricing versioning / units / rounding | Micro-pence integer table, `PRICE_TABLE_VERSION` (marked user-review-required), env override, BigInt multiply + half-up; per-phase round once. | `openai-pricing.js` |
| Internal cost vs customer debit | Raw sub-penny kept in `UsageRecord.rawCostMicros`; ledger stores integer pence + version + callIds. | `UsageRecord.js:84-94`, `credit-service.js:194-236` |
| Successful-phase-only / partial failure | On error, `recordUnsettledUsage` marks usage `charged:false`, only completed phases settle. | `transcribe-job.js:41-56,300-319` |
| Phase settlement / fail-closed price precheck | `assertModelsPricedForPhase` blocks (500) if any required model unpriced; missing price = fail closed. | `credit-service.js:44-64,85-111` |
| Accounting failure recovery | Job flagged `unresolved`, result preserved — **but no admin re-settle tool** (H2). | `transcribe-job.js:76-87` |
| Mongo models & indexes | Unique `idempotencyKey`/`callId`/`publicReference`/`sumupCheckoutId`; partial unique `r2ObjectKey`. | model files |
| Transactions / replica-set | `assertTransactionsSupported()` no-op probe throws `TRANSACTIONS_UNSUPPORTED` on standalone; cached. | `mongoose.js:68-116` |
| Shared-password gate / direct-API bypass | Gate in the single transcribe entry route for new jobs; 409 re-adopt skips (authorised original). No alternate start path. | `transcribe/route.js:141-265` |
| Feature flags | `isCreditsEnabled()` list-based; layer inert when off (chrome returns null, collector null, no persist). | `flags.js`, `credit-chrome.jsx:24-26` |
| Persistent generations / save toggle | One `Generation` per run; `save` default true, `saveOnCompletion` only on final phase; toggle off ⇒ no persistence, debits stand. | `editor-shell.js:2680-2735`, `transcribe-job.js:90-136` |
| Generation/Card design (D9) | Single doc; public card is a serializer projection (no separate Card model). | `serialize-generation.js` |
| R2 upload/serve/delete/reconcile | Stream put with content-length; both failure directions handled; media route serves only public+created+saved+non-deleted. | `audio-r2-lifecycle.js`, `media/generations/[id]/route.js:37-43` |
| SumUp checkout / return / webhook / exactly-once | Server-authoritative amount, `isSafeHostedCheckoutUrl` allowlist, dual-path re-query, `balanceCredited:false` atomic claim + `top_up:{orderId}` key, amount/currency/merchant verified. | `checkout/route.js`, `payment-verification.js:48-249` |
| Dashboard exposure / public mutation | `/dashboard` + state/generations/media are read-only; no DELETE/POST handlers exist. | grep (no mutation handlers) |
| Card deletion authorization | **No deletion route** — deletion is manual (`deletedAt` in DB) + `r2-reconcile`. | §7 (deviation) |
| Admin / repair routes | No admin routes; `ENABLE_ADMIN_TOOLS`/`ENABLE_TEST_CONTROLS` unused; `sumup-refunds.js` unwired. | grep |
| Editor reopen | `/?generation={id}` fetches editor snapshot, imports via `importProjectValue`, points playback at media route. | `editor-shell.js` (Stage 7 notes) |
| Ops scripts / env / docs | `db-smoke/r2-smoke/sumup-smoke/r2-reconcile/payment-audit/ledger-repair`; `r2-reconcile` `--dry-run`, `ledger-repair` requires `--apply`. `.env.example` + `CREDITS_SETUP.md` present. | scripts, docs |

---

## 10. Cross-Phase Integration Findings

- **Equivalent downstream behaviour (upload vs YouTube):** Confirmed. Both produce a normal session asset via `lib/files.js`; the transcribe/persist paths read them identically through `getAssetFilePath`/`readAssetMetadata`. `sourceType` (`"upload"`/`"youtube"`) is the only intentional divergence and is used only for provenance.
- **Duration-based costing for both:** Works. YouTube assets carry a real `durationSec`; uploads (`durationSec:null`) fall back to project `audio.duration`, which the client provides. Minor gap vs the documented 4-level fallback (L5).
- **Generation jobs consume both sources:** Yes — `runTranscribeJob` is source-agnostic; `persistGeneration` reads `sourceType` from metadata and promotes the same MP3 bytes to R2.
- **Phase 2 reads Phase 1 assets:** Confirmed via `readAssetMetadata`/`getAssetFilePath` (both post-Phase-1 shapes).
- **R2 vs Phase-1 cleanup race:** Low risk. The job keeps the session warm (`touchSession` keepalive every 30s, `transcribe-job.js:29-30,185-195`), and persistence + R2 promotion happen at completion. Residual: if the asset is swept between commit and `getAssetFilePath`, R2 promotion records `create_failed` with **no source to reconcile from** (`persist-generation.js:346-353`, `audio-r2-lifecycle.js:168-177`). Narrow window.
- **Session TTL vs persistence/retry:** Active transcribe/render/YT sessions are all sweep-exempt (`files.js:202-207`), so assets survive while work runs.
- **Retries do not duplicate:** audio assets (idempotent `(jobId,sessionId)` ingest ✓), usage records (unique `callId`, upsert ✓), ledger debits (idempotent `ai_debit:{jobId}:{phase}` ✓), generation records (in-txn `finalJobId` guard ✓, but not unique-indexed — L6), cards (no separate model ✓), R2 objects (deterministic key, idempotent put ✓).
- **Reload/recovery:** In-memory jobs are lost on restart; the client surfaces `RESULT_EXPIRED`/re-posts (new jobId). Consistent for both sources. This also underlies M1 (orphaned YT result files) and the "completed-but-not-ingested is unrecoverable after restart" accepted limitation.
- **Editor reopen from saved generations:** Implemented (`/?generation={id}` → snapshot import).
- **Phase 2 did not regress Phase 1:** No Phase-1 regressions in the test suite/build; the only Phase-2 touch to Phase-1 files is additive `sourceType` metadata in `lib/files.js`.
- **Feature-disabled parity:** With `CREDITS_ENABLED=false`, credit chrome hides, collector is null, no persistence runs, and the transcribe gate is skipped — externally observable behaviour matches pre-Phase-2 (subject to M4 for the non-generation routes).

---

## 11. Financial Correctness Findings

- **Sound:** integer-pence everywhere; sub-penny retained only in `rawCostMicros`; BigInt multiply-then-half-up avoids float drift (`openai-pricing.js:174-183`); balance is a side-effect of an append-only ledger; never-negative is enforced atomically; idempotency keys are deterministic per `(job, phase)` and per `(order)`; replay divergence is surfaced, not silently accepted.
- **Rounding model:** per-phase round-once half-up (D10). Because the live client runs phases as separate jobs, a "run all" flow rounds three times independently — intentional and documented; it can round marginally higher than a single aggregate round, which is a deliberate, disclosed tradeoff.
- **Primary risk (H1):** the money model charges *after* delivery with only a floor precheck, so work whose cost exceeds the balance is delivered free and flagged `unresolved`. This is the dominant financial-integrity concern.
- **Pricing accuracy (deferred by design):** the seed table version is literally `openai-seed-2026-07-09-user-review-required`; values (esp. `gpt-5.4*`, `gpt-4o-transcribe`, `whisper-1`) must be reconciled against live OpenAI pricing before charging (`CREDITS_SETUP.md` §3). The precheck model list in `credit-service.js:26-52` must also stay in sync with the models actually invoked in `openai-lyrics.js`, or a run can either over-block (priced-but-unused) or fail-closed mid-run (used-but-unpriced).
- **Audit polish:** phantom cost on failed audio calls (L1) is uncharged but should be excluded from audit records.

---

## 12. Payment and SumUp Findings

- **Exactly-once:** correctly implemented. Both webhook and return page call `refreshPaymentOrderFromSumUp`, which always re-queries SumUp, verifies `checkout_id`/`checkout_reference`/`merchant_code`/`currency`/`amount`/`status=PAID`, then credits once via `balanceCredited:false` atomic claim + `top_up:{orderId}` ledger key (`payment-verification.js:142-249`). Duplicate webhook, webhook/return race, amount/currency/merchant mismatch, and missing checkout id are all handled and tested.
- **No body-trust:** neither webhook nor return trusts amounts from the request body; amounts are server-owned on the order and re-fetched from SumUp. Webhook stores safe identifiers only, never the raw body (`webhooks/sumup/route.js:74-115`).
- **Checkout hardening:** `isSafeHostedCheckoutUrl` restricts to `*.checkout.sumup.com` HTTPS (`sumup-client.js:41-53`); `sumup-env.js` enforces server-secret key shape and blocks temporary/local live URLs unless `ALLOW_TEMP_LIVE_PAYMENT_URLS`.
- **Gaps:** checkout unauthenticated/unthrottled (**H3**); webhook not truly quick-ack (**L3**); public order re-query (**L4**); `redirect_url`/`return_url` semantics unverified against live SumUp (**§18**) — but dual-path re-query makes crediting correct regardless of which URL SumUp treats as the trigger.

---

## 13. MongoDB and Transaction Findings

- **Replica-set requirement enforced:** `assertTransactionsSupported()` runs a no-op `withTransaction` probe and throws an actionable `TRANSACTIONS_UNSUPPORTED` on standalone; cached per process (`mongoose.js:68-116`). `CREDITS_SETUP.md` documents Atlas/replica-set.
- **Transaction usage:** ledger debits, top-up crediting, and generation persistence all run inside `withTransaction`; ledger requires an in-transaction session (`balance-ledger.js:118-123`).
- **Indexes:** appropriate unique/partial-unique indexes on ledger key, usage `callId`, order references, `Generation.r2ObjectKey`. **Gap:** `Generation.finalJobId` not unique (L6).
- **Connection:** cached global connection, `bufferCommands:false`, 10s server-selection timeout; `initializeDatabaseIndexes` calls `model.init()` (idempotent).
- **Dev/CI parity:** transactions exercised via `mongodb-memory-server` replica set — real Atlas transaction behaviour remains a staging gate (§18).

---

## 14. R2 and Persistence Findings

- **Lifecycle:** `putGenerationAudioObject` streams the MP3 with a known content-length after the Mongo commit (fire-pattern), then advances `r2Status` to `created`; failures set `create_failed`; `reconcileGenerationAudio` repairs both directions (object exists but status stale → `created`; object missing + source available → re-put); deletion removes the R2 object before hard-deleting the doc (`audio-r2-lifecycle.js`).
- **Serving:** `/api/media/generations/[id]` serves only `public:true, saved:true, r2Status:"created", deletedAt:null` docs; 302 to `R2_PUBLIC_BASE_URL` if set, else proxies (never exposes R2 creds) (`media/generations/[id]/route.js:37-79`).
- **Env:** `r2-env.js` validates required vars and derives the endpoint; `R2_ENABLED` gate.
- **Gaps:** no deletion route triggers the delete lifecycle (deletion is manual DB + `r2-reconcile`); R2-create-after-sweep is unrecoverable if the source asset expired (§10). `putR2Object` with a single `PutObject` assumes ≤25 MB (plan A5) — fine for the audio cap.

---

## 15. Security Findings

- **Password gate:** env secret, timing-safe compare, HMAC-SHA256 signed short-TTL cookie with expiry validation (`unlock-cookie.js`). Gates only generation start (D2). **Missing `Secure` (M2).** No brute-force lockout on `/api/credits/unlock`, but the rate limiter does not cover the unlock route itself — password-guessing against unlock is unthrottled (low risk given a strong shared secret, but worth a limiter).
- **SSRF:** strong per-hop validation in `media-fetcher.js`; residual rebinding TOCTOU (L2). Payment/webhook URLs validated in `sumup-env.js`.
- **Public mutation:** none reachable from the dashboard (read-only routes; no DELETE/POST). Good.
- **Checkout abuse / webhook replay:** replay handled (exactly-once); checkout abuse open (H3).
- **Secret exposure:** all secrets server-side; media proxy avoids R2 credential exposure; serializers strip internal ids (leak test passes). Logs use safe error codes, not raw bodies.
- **Path traversal:** `storeAudioAssetFromPath` realpath-contained (Phase 1, solid); `findSessionIdForAsset` charset-validates assetIds. **Pre-existing consideration:** `readAssetMetadata(sessionId, assetId)`/`getAssetFilePath` join raw `assetId`/`storedFileName` without an explicit containment check; the transcribe route does not charset-validate `audioAssetId` before the first metadata read (`transcribe/route.js:185-186,75-95`). Traversal would need a matching `<x>.json` on disk and falls through to the charset-validated `findSessionIdForAsset`; this is pre-existing main-app behaviour, not introduced by the merge, but is worth hardening.
- **Resource exhaustion:** YT admission caps present; generation rate limit present; **checkout has none (H3)**; rate-limit map unbounded (L8).
- **Dev controls in production:** none shipped (`ENABLE_TEST_CONTROLS` unused — no dev "set balance" route), which is safer than the prototype.

---

## 16. Test and Validation Findings

**Reproduced independently:** `npm test` = 53 files / 331 tests passed; `npm run lint` exit 0; `npm run build` exit 0 (all routes). `vitest.config.mjs`/`eslint.config.mjs` exclude `Temp_prototype_parts/**` and `mockup_integration_project/**` — a legitimate, documented change that makes the gate usable (the previously "out-of-scope" prototype/jsdom/word-board failures are no longer collected; word-board expectations were updated to the committed constants).

**Well-covered (real invariants, not just status codes):** ledger never-negative, idempotent replay, replay-divergence rejection, concurrent debit overdraw prevention; per-phase settlement completed-only + no double-charge under retry/re-adopt; pricing sub-penny accumulation + half-up + missing-model fail-closed; per-endpoint usage parsing; top-up exactly-once across webhook/return race + duplicate + amount/currency mismatch; R2 both-direction reconcile; `sourceType` detection; dashboard serializer leak; password/rate-limit gating + disabled parity + partial-config fail-closed; Phase-1 SSRF (initial + redirect + nested + malformed + private IP), path-ingestion safety, sweep exemption, cleanup 409, idempotent double-poll.

**Gaps / caveats:**
- **Mocked infrastructure:** replica-set transactions via `mongodb-memory-server` (not Atlas); SumUp, R2, OpenAI all mocked. No real-service E2E (explicit gate).
- **H1 is not asserted as a guarded invariant** — there is no test proving that a job whose settlement fails is *withheld or flagged distinctly to the user*; current tests confirm it settles-completed-only and flags `unresolved`, but not that delivery/persistence of unbilled work is acceptable/guarded.
- **M1 not caught by tests** because `sweepStaleYoutubeAudioResults` is tested as a unit but its *absence from any runtime caller* is not asserted anywhere.
- **No test** for the checkout-abuse vector (H3), the unlock-route brute-force surface, or multi-instance rate-limit behaviour.
- **Concurrency interleavings** are covered for ledger debits/top-ups; not for concurrent `persistGeneration` on the same `finalJobId` (L6).

Mapping of critical claims → tests: ledger/idempotency → `lib/ledger/balance-ledger.test.js`; settlement → `lib/credits/credit-service.test.js`; pricing → `lib/ai/openai-pricing.test.js`; usage capture → `lib/ai/openai-usage.test.js` + `openai-lyrics.test.js`; top-ups → `lib/payments/payment-verification.test.js` + route tests; R2 → `lib/r2/*.test.js`; leak → dashboard route tests; Phase-1 SSRF/ingest → `lib/youtube-audio/*.test.js` + `lib/files.test.js`.

---

## 17. Operational and Documentation Findings

- **Env/flags:** `.env.example` and `CREDITS_SETUP.md` are accurate and thorough (Mongo replica-set, pricing override + micro-pence explanation, password/rate-limit, SumUp sandbox/live, R2, enablement checklist, rollback). README points to them. `GEN_RATE_MAX`/`WINDOW` defaults differ between `.env.example` (20/3600) and code fallback (10/60) — env wins, but note the divergence.
- **Fail-open vs fail-closed:** paid paths fail closed on missing pricing/config; the disabled flag is the intended kill-switch but is not enforced on all routes (M4).
- **Scripts:** safe defaults — `r2-reconcile --dry-run`, `ledger-repair` dry-run unless `--apply`, `payment-audit` read-only. Good.
- **Reconcile coverage gap:** no script/route re-settles `unresolved` AI accounting (H2); `ledger-repair` covers only top-ups.
- **Deletion/rollback:** master rollback = `CREDITS_ENABLED=false` (documented). Generation deletion has no route (manual DB + reconcile).
- **Observability:** structured, secret-free logs at the key events; `UsageRecord`+`CreditLedger` audit spine. No metrics/alerting wired (expected at this stage).
- **Deployment order / backup/recovery:** documented at the runbook level in `CREDITS_SETUP.md`; Mongo backup/PITR and R2 lifecycle policies are not covered (operator responsibility).

---

## 18. Unverified Live-Service Behaviour (Release Gate — not code defects)

1. RapidAPI YouTube-MP3 providers (Phase 1) — mock-validated only; needs a real `RAPIDAPI_YOUTUBE_MP3_KEY` run.
2. SumUp Hosted Checkout create/retrieve, and the **`redirect_url` vs `return_url` semantics** (which one SumUp actually calls as the webhook) — unverified (L3/§12).
3. SumUp webhook delivery + webhook/return race + duplicate webhook in a real sandbox.
4. MongoDB Atlas (or production replica set) real transaction commit/retry behaviour under load.
5. Cloudflare R2 real put/head/delete + public URL / proxy streaming of multi-MB audio.
6. Real OpenAI `usage` shapes per model/endpoint and **actual pence pricing** vs the seed table (marked `user-review-required`).
7. End-to-end: top-up → generate → phase charges → save → dashboard → open-in-editor with all services live.

These are the operator runbook steps; they must pass in sandbox/staging before flipping `CREDITS_ENABLED=true`.

---

## 19. Plan Deviations

| Plan reference | Deviation | Severity |
|---|---|---|
| §8.6 / acceptance "pruned on expiry/stale sweep" | `sweepStaleYoutubeAudioResults` implemented but never invoked | M1 |
| §5.1 "Secure in production" | Unlock cookie omits `Secure` | M2 |
| §10.2 / §11.6 "never `sourceType`" in public serializer | `serializePublicCard` returns `sourceType` | M3 |
| §14 / §23 "no new read/write path executes" when off | Several routes don't check `isCreditsEnabled()` | M4 |
| §16 "admin path re-runs settlePhase / MANUAL_ADJUSTMENT" | No admin route or AI re-settle script | H2 |
| §5.1 / §9 admin surface, refund route; §14 `ENABLE_ADMIN_TOOLS`/`ENABLE_TEST_CONTROLS` | Not shipped (`sumup-refunds.js` unwired, flags unused) — optional in plan | Accepted / Low |
| §11.4 deletion "acts on the single doc" | No deletion route; deletion is manual DB + reconcile | Low |
| §11.1 audio-seconds 4-level fallback | Only project-duration + whisper `data.duration` used | L5 |
| §11.1 `Generation` public fields include `durationSeconds` | Field named `audioDurationSeconds` (cosmetic) | Trivial |

All other confirmed decisions (D1–D12) are implemented as specified. The Phase-1 corrected-plan blockers are resolved except M1.

---

## 20. Required Repairs

Each item: severity · evidence · affected modules · expected behaviour · recommended correction · required tests · user input.

**R1 (H1) — Do not deliver/persist uncharged work; pre-estimate cost.**
- Evidence: `credit-service.js:238-244`, `transcribe-job.js:76-87,314-335`.
- Modules: `credit-service`, `transcribe-job`, `transcribe/route.js`.
- Expected: a generation the balance cannot cover is either pre-blocked or its result withheld/marked so it is not silently free.
- Correction: at start, estimate a floor cost from audio duration × the priciest per-minute model and require `balance ≥ estimate` (or hold a soft reservation); on settlement `INSUFFICIENT_BALANCE`, do not persist and surface a distinct terminal state to the client.
- Tests: low-balance long-audio run is blocked at start; if settlement still fails, no `Generation` is persisted and the job status is unambiguously "unbilled".
- User input: **yes** — product decision on estimate model / whether to withhold results.

**R2 (H2) — Provide `unresolved` remediation tooling.**
- Evidence: absence of admin route; `ledger-repair.mjs` scope.
- Modules: new `scripts/ai-settle-repair.mjs` (dry-run default) and/or admin route.
- Expected: an operator can idempotently re-run `settlePhase` for `accountingStatus:"unresolved"` jobs or apply `MANUAL_ADJUSTMENT`.
- Tests: re-settle is idempotent; balance moves correctly; no double debit.
- User input: **yes** — whether admin route vs script; auth model for admin.

**R3 (H3) — Rate-limit/authenticate `/api/credits/checkout`.**
- Evidence: `checkout/route.js:59-134`.
- Modules: `checkout/route.js`, reuse `rate-limit.js`.
- Expected: bounded checkout creation per IP/session.
- Tests: burst of distinct amounts is throttled; legitimate single top-up passes.
- User input: no (limits can default; confirm thresholds).

**R4 (M1) — Wire the stale-result sweeper.**
- Evidence: `storage.js:91` (no caller).
- Modules: `youtube-audio-segments/route.js` (POST) and/or `[jobId]` route, or a periodic hook.
- Expected: orphaned result MP3s older than `JOB_TTL_MS + grace` are removed even after restart.
- Tests: assert the sweeper is invoked from a route; orphan file older than cutoff is deleted; fresh file retained.
- User input: no.

**R5 (M2) — Add `Secure` to the unlock cookie in production.**
- Evidence: `unlock-cookie.js:87-95`. Tests: cookie string includes `Secure` when not localhost. User input: no.

**R6 (M3) — Sanitise public card title; drop `sourceType` from public projection.**
- Evidence: `serialize-generation.js:30-49`, `persist-generation.js:47-63`. Expected: no raw upload filename or provenance on the world-readable card. User input: **yes** (default title policy).

**R7 (M4) — Gate payment/persistence mutation routes on `CREDITS_ENABLED`.**
- Evidence: checkout/webhook/orders/dashboard/media routes. Tests: routes return disabled/404 when flag off. User input: no.

**R8 (L1) — Record usage only on `response.ok`.** `openai-lyrics.js` (8 sites). Test: failed audio call writes no phantom-cost `UsageRecord`.

**R9 (L2) — Pin resolved IP in `media-fetcher` to close rebinding TOCTOU.** `media-fetcher.js:410-446,84`.

**R10 (L3) — Ack webhook before verifying.** `webhooks/sumup/route.js`.

**R11 (L6) — Add unique partial index on `Generation.finalJobId`.** `Generation.js`.

**R12 (L8/L9) — Bound the rate-limit map; document proxy trust for `x-forwarded-for`.**

---

## 21. Recommended Repair Order

1. **R1** (revenue integrity — needs product decision; longest lead time).
2. **R2** (reconciliation tooling — pairs with R1).
3. **R3** (checkout abuse — quick, external-cost protection).
4. **R7, R5** (kill-switch + Secure cookie — small, high-assurance).
5. **R4** (stale sweeper wiring — small).
6. **R6** (public title/sourceType — product input).
7. **R8, R10, R11** (audit/idempotency polish).
8. **R9, R12** (defence-in-depth hardening).
9. Then run the §22 sandbox E2E checklist; reconcile the pricing seed table; only then enable in staging.

---

## 22. Sandbox E2E Checklist Amendments

`CREDITS_SETUP.md` §7 is a good baseline (lint, test, db/r2/sumup smoke, top-up, generate+save, dashboard, payment-audit). Add before live:

- **Top-up:** verify exactly-once when **both** webhook and return fire (and when they race); duplicate webhook credits once; wrong amount/currency/merchant is rejected; a checkout for a **different merchant** is rejected.
- **Charging:** run a generation and assert `CreditLedger` debits == summed `UsageRecord` for completed phases; verify **partial failure** (kill `enrich`) charges `transcribe` only; verify retry/re-adopt does not double-debit.
- **H1 scenario:** set balance to floor, run a **long** audio generation, and record what happens — this is the explicit go/no-go for real money (should be blocked or withheld after R1).
- **Insufficient balance:** generation start returns 402 at/below floor; unlock 403 without cookie; rate-limit 429.
- **Persistence/R2:** saved gen appears on `/dashboard` with playable audio + open-in-editor; toggle-off persists nothing; force an R2 put failure and confirm `r2-reconcile` repairs both directions.
- **Deletion:** exercise the (currently manual) delete + `r2-reconcile` path and confirm R2 object + Mongo doc removal ordering; add a route if R6/deletion is productised.
- **Kill-switch:** with `CREDITS_ENABLED=false` but backends configured, confirm checkout/webhook/dashboard/media behave as intended (after R7).
- **Standalone Mongo:** confirm `TRANSACTIONS_UNSUPPORTED` fail-closed.
- **Pricing:** confirm every model in `getConfiguredOpenAiModelsByPhase` and every model actually called in `openai-lyrics.js` is priced; missing-model fails closed at start.
- **Orphan cleanup:** confirm YT result files are cleaned after restart (after R4).

---

## 23. Final Recommendation

**PASS WITH NON-BLOCKING ISSUES — sandbox E2E may begin.** The merge is well-engineered, disabled-by-default, and green on tests/lint/build; its accounting and payment cores are correct and well-tested against mocks. Proceed to sandbox/staging E2E now.

Before **live, real-money** enablement, treat **H1, H2, H3** (and the quick wins **M1, M2, M4**) as gates, reconcile the OpenAI price seed table, and complete the §22 real-service validation. A focused repair plan (R1–R3 need product input) is warranted; the remaining items are contained, low-risk hardening. Nothing found requires re-architecting the merge.

---

*Prepared read-only. No application code, tests, schemas, migrations, or planning/progress documents were modified; no remote service was mutated; nothing was committed or pushed. The only file created is this report.*
