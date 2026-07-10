# Credit Dashboard Merge — Phase 2 Information Bank

**Purpose**  
This document is the authoritative information bank for merging the Credit Dashboard prototype functionality (from `Temp_prototype_parts/Credit_dash_prototype_part/`) into the main Reel Creator app.

It supports the long-term goals:
- Record the exact cost of OpenAI API calls made during transcription/translate/timing functions.
- Deduct those costs from a GBP balance (using the same patterns as the prototype).
- Allow top-ups to the balance using the SumUp API (Hosted Checkout + verification).
- Introduce a separate public dashboard page showing "cards" that each represent a user in-app generation.
- Store lyric data in MongoDB (along with card metadata).
- Save the associated MP3 (from uploads or the Phase 1 YT feature) to the R2 bucket (currently used only for placeholder objects in the prototype).

This bank is intended to be handed to a fresh agent together with later Plan and Progress documents. It provides detailed, relevant context from both codebases plus integration considerations. It contains **no** implementation plan or progress tracking.

**Scope for this bank (Phase 2 focus)**  
- Cost tracking and deduction for OpenAI calls in the lyric pipeline.
- Balance management, top-ups via SumUp, and ledger-style exactly-once accounting.
- A new public dashboard page for generation cards.
- Data model and storage changes: Mongo for lyrics/generation metadata, R2 for MP3 assets (evolving from the prototype's current placeholder-only usage).
- Related admin, reconciliation, and operational patterns from the prototype.

**Out of scope for this bank**: Detailed user account/auth model (deferred per user direction; current plan uses public/shared access + later "shared password for generations"), full Phase 1 YT details (covered in the sibling bank), mobile UI pixel work (already in progress on main branch), exact pricing tables for OpenAI models.

**Deferred decisions (per user)**: 
- Core auth/tenancy/ownership model (currently everything is public and anonymous per browser session).
- Whether balance will be strictly per-user, shared, or use a "shared password for generations".
- Exact cost-calculation method (raw token counts + pricing table vs. other).
- Precise timing of moving from ephemeral session assets to durable R2/Mongo for MP3s and lyric snapshots.
- Authorization rules for the public generation dashboard.

References to user accounts, authentication, public access, shared generation passwords, ownership, and authorization are deliberately left open and must be resolved in the planning stage.

**Date of research**: 2026-07-08 (based on current codebase state on `mockup-integration-mobile`).

---

## 1. Main App — Relevant Architecture for AI Costs, Storage, and Future Dashboards

The main app currently has **no** payment, credit, balance, or persistent generation tracking. All relevant logic for Phase 2 must be added by adapting patterns from the prototype.

### 1.1 OpenAI / AI Call Sites (Primary Instrumentation Points for Cost Tracking)

AI work is concentrated in `lib/ai/` and driven from the editor shell and transcribe API.

Key files:
- `lib/ai/openai-lyrics.js` — core implementation of all phases.
- `lib/ai/transcribe-job.js` — orchestrates the job, calls the functions below in phases ("full", "transcribe", "enrich", "time").
- `app/api/ai/transcribe/route.js` and `app/api/ai/transcribe/[jobId]/route.js` — HTTP entry + polling.
- Supporting: `lib/ai/audio-chunks.js`, `lib/word-meanings.js`, `lib/lyric-timing.js`, `lib/lyric-quality.js`.

Important models and calls (from `openai-lyrics.js`):
- `CONTENT_TRANSCRIPTION_MODEL = "gpt-4o-transcribe"`
- `TIMESTAMP_TRANSCRIPTION_MODEL = "whisper-1"`
- `TRANSLATION_MODEL = "gpt-5.4-mini"`
- `LINE_BREAK_MODEL = "gpt-4o"`
- `LYRIC_POLISH_MODEL`, `QA_AUDIT_MODEL = "gpt-4o-mini"`, etc.
- Multiple `fetchOpenAiWithRetry(...)` calls for:
  - Content transcription (single call or chunked).
  - Line-break / cleaning.
  - Translation + word meanings.
  - Timing alignment support.
  - Quality audit verdicts.
- Many calls go through `fetchOpenAiWithRetry` (handles retries, timeouts, `OPENAI_MAX_ATTEMPTS`, `OPENAI_REQUEST_TIMEOUT_MS`).
- Environment-configurable models and limits (e.g. `OPENAI_QA_AUDIT_MODEL`, `OPENAI_TRANSCRIPTION_CHUNK_SECONDS`, hallucination thresholds).

Current responses are processed for text/timings/quality. **No usage or cost data is captured today.** 

For the Responses / chat-style calls (enrichment, polishing, quality audit, line breaks), the parsed JSON response body typically contains a `usage` object with `prompt_tokens`, `completion_tokens`, and `total_tokens`. Audio transcription endpoints (content + Whisper) may surface usage differently or not at all in the primary response; any cost recording will require inspecting the actual response shape per endpoint and model (or using official pricing + token counts).

The staged pipeline is defined in `lib/staged-lyrics.js`:
- `LYRIC_PIPELINE_PHASES = ["transcribe", "enrich", "time"]`
- Presets and selection logic.

Transcription jobs are long-running and resumable via the store + polling pattern (`lib/ai/transcribe-store.js`).

**For Phase 2**: The natural place to record cost is inside or immediately around `fetchOpenAiWithRetry` (or a thin wrapper around the fetch to OpenAI URLs) so every actual API call (including retries) can emit usage/cost. Deduction should happen after successful application of results, using the ledger pattern.

### 1.2 Job & Async Patterns

- `runTranscribeJob` in `lib/ai/transcribe-job.js` (reads asset via `getAssetFilePath` + `readAssetMetadata`, runs phases, marks progress/complete/error).
- Similar pattern exists for render jobs (`lib/render/render-job.js`, `lib/render/store.js`).
- In-memory global stores + client polling.
- Autosave in `lib/autosave.js` persists enough state to resume jobs after reload.

These patterns align closely with the job system in the credit prototype (and the YT prototype).

### 1.3 Current Storage & Asset Model (`lib/files.js` and related)

- Ephemeral only: per-session temp directories under OS tmp + `reel-creator/<sessionId>/`.
- Cookie: `SESSION_COOKIE_NAME = "reel-creator-session"`.
- Assets have metadata JSON + binary file.
- TTL sweep (`DEFAULT_ASSET_TTL_HOURS = 24`, `ASSET_TTL_HOURS` env, `sweepExpiredSessions`).
- Active jobs (transcribe/render) exempt sessions from sweeping.
- `storeUploadedAsset`, `getAssetFilePath`, `readAssetMetadata`, `touchSessionAndSweep`.
- Served via `app/api/assets/[assetId]/route.js`.
- Audio max 25 MB (`MAX_AUDIO_BYTES`).

For Phase 2 long-term vision:
- MP3s (and potentially other assets) will move to R2.
- The prototype already has R2 client + lifecycle code for card placeholders. This will be extended to real generation audio.

Render also produces output files (`app/api/render/[jobId]/file/route.js`).

### 1.4 UI, Pages, and State Patterns

- Single-page editor: `app/page.js` → `EditorShell`.
- Tabs and sections defined in `lib/editor-format.js` (`SECTIONS`).
- Shared cross-cutting state via `components/editor-state.js` (useReducer).
- New pages/routes can be added under `app/` (e.g. `app/dashboard/page.js` or `app/generations/...`).
- Design tokens live in `app/app_colours.css` + Tailwind usage.
- Current app is fully anonymous (browser session + cookie). No user model, no login.

The prototype dashboard is a completely separate small app; merging will require integrating its UI patterns (or a simplified version) into the main Next.js app while respecting the ongoing mobile sheet/transport redesign (`mockup_integration_project/`).

### 1.5 Other Relevant Areas

- Project model (`lib/project.js`) — will need to support linking a project/generation to a "card" or Mongo document.
- Export flow (`lib/export-flow.js`) and readiness checks — potential future gating by balance.
- **No persistent database today**: The main app has no MongoDB, no R2, and no durable storage for generations or assets beyond per-session temp files (see `lib/files.js`) + localStorage autosave + in-memory job stores. All Phase 2 Mongo + R2 work (and any generation tracking) will be entirely new.
- No existing references to SumUp, balances, Mongo, or R2 in runtime code (only planning docs).

---

## 2. Credit_dash_prototype_part — Complete Feature Inventory

Standalone Next.js app demonstrating the credit/balance + payments + card + R2 patterns intended for reuse.

### 2.1 High-Level Goals (from prototype plan.md)

- Shared (no-auth) dashboard with GBP balance and grid of cards.
- Cards: random title, number, colour. Add/remove persisted in Mongo.
- Fire button (🔥): flashes header, deducts fixed cost (2p), adds a random card. Atomic, blocks at zero.
- Add money: custom amount (£1–£100), server-authoritative, SumUp Hosted Checkout (sandbox).
- Exactly-once crediting via two paths (webhook + return page poll) + append-only ledger.
- R2 lifecycle for card placeholder objects (create on fire, soft-delete + remove object on card delete, reconcile script).
- Dev/test controls gated by env flags.
- Admin surface for orders/webhooks/audit/refunds (protected).

Money is **always integer pence** internally. Display only at the boundary.

### 2.2 Money Utilities (`lib/money.js`)

```js
export const FIRE_COST_MINOR = 2;
export const TOP_UP_MIN_MINOR = 1;
export const TOP_UP_MAX_MINOR = 10000;

formatGbpFromMinor(amountMinor)
canDebitMinor(balanceMinor, debitMinor)
debitMinor(...)
clampMinor(...)
parseGbpInputToMinor(input)
minorToMajorUnit(...)
isValidTopUpMinor(...)
```

### 2.3 Data Models (Mongoose, `lib/models/`)

- **Balance.mjs**: singleton document with `_id: "shared"`, `amountMinor` (integer >=0, validated), `currency: "GBP"`, `updatedAt`.
- **Card.mjs**: `_id`, title, number, colour, `createdAt`, `r2ObjectKey`, `r2Status` (enum including "pending_create", "created", "pending_delete", "deleted", etc.), `r2AttemptCount`, `deletedAt`, `deleteRequestedAt`, etc.
- **CreditLedger.mjs**: append-only collection. `CREDIT_LEDGER_TYPES = ["TOP_UP", "CARD_CREATE", "REFUND_ADJUSTMENT", "MANUAL_ADJUSTMENT"]`. Key fields: `type`, `amountMinor` (non-zero integer), `balanceAfterMinor`, `idempotencyKey` (unique index), `reason`, related ids (cardId, paymentOrderId), `createdAt`.
- **PaymentOrder.mjs**: `status` enum `["PAYMENT_PENDING", "PAID", "PAYMENT_FAILED", ...]`, `amountMinor`, `currency`, `publicReference`, `sumupCheckoutId`, `sumupHostedCheckoutUrl`, `balanceCredited` (boolean, used for atomic claim), `paidAt`, etc.
- Others: `RefundRecord`, `WebhookEvent`.

The append-only `CreditLedger` (with idempotencyKey) is the authoritative record of all balance changes. Balance documents are updated as a side-effect of ledger entries.

### 2.4 Ledger & Balance Logic (`lib/ledger/balance-ledger.mjs`)

- `applyLedgeredBalanceChange({ session, type, amountMinor, idempotencyKey, reason, cardId?, ... })`
- Uses Mongo transaction + session.
- Creates CreditLedger entry + updates Balance atomically.
- Idempotency via unique key on ledger entries.
- `isInsufficientBalanceError` helper.
- Balance is never allowed to go negative on debits.

`dashboardState.js` has a small client-side `applyFireToDashboardState` helper (prototype only).

### 2.5 Dashboard UI & Client State (`components/DashboardClient.jsx`)

- Uses useReducer.
- Loads initial state from `/api/dashboard/state`.
- Cards grid (add, remove).
- Header: balance display, 🔥 fire button (cost shown), "Add money" button.
- Dev-only set-balance control when `ENABLE_TEST_CONTROLS === "true"`.
- Modal/flow for entering top-up amount and redirecting to checkout.
- Return page handling (`app/payment/return/page.js` + `PaymentReturnClient.jsx`).
- Polling for order status after redirect.

### 2.6 Dashboard APIs (`app/api/dashboard/`)

- `GET /state` — returns current balance + non-deleted cards.
- `POST /cards` — create random card.
- `DELETE /cards/[id]` — marks deletedAt + (if applicable) pending_delete, invokes deleteCardPlaceholderObject (removes R2 object and updates status), then performs hard Mongo delete (only after successful R2 removal).
- `POST /fire` — atomic fire (ledger + card create in transaction). Returns new balance + card.
- `POST /balance` — dev-only set balance (gated).

Many routes call `connectToDatabase()` + `ensureSharedBalance()`.

### 2.7 Payments / SumUp Flow (`app/api/payments/sumup/`, `lib/payments/`)

**Checkout creation**:
- Client sends desired amount.
- Server validates bounds (`isValidTopUpMinor`).
- `createPendingPaymentOrder` (or reuses recent pending for same amount via `findReusablePendingPaymentOrder` — protects against double-click).
- Calls SumUp `createHostedCheckout`.
- Stores `sumupCheckoutId` + `sumupHostedCheckoutUrl` on the order.
- Returns `{ orderId: publicReference, checkoutUrl }` → browser redirect (via `onCheckoutRedirect`).

**Fulfilment (exactly-once)**:
- **Webhook** (`POST /api/webhooks/sumup`): quick ack, stores raw event (WebhookEvent), then calls verification.
- **Return page** (`/payment/return?order=...`): shows "Confirming...", polls `/api/payments/sumup/orders/[orderId]`.
- Verification (`payment-verification.mjs`): always re-fetches checkout from SumUp via `retrieveCheckout`. Uses `balanceCredited: false` atomic update on PaymentOrder + ledger idempotencyKey (`top_up:${orderId}`) to ensure credit happens at most once.
- Only on verified `PAID` + matching amount + not already credited → `applyLedgeredBalanceChange` with type `TOP_UP`.
- Duplicate protection via ledger unique index on idempotencyKey + order status checks.

Key modules:
- `sumup-client.mjs` — Zod schemas for checkout, `createHostedCheckout`, `retrieveCheckout`, error class.
- `payment-orders.mjs` — order creation + reusable pending lookup.
- `sumup-env.mjs` — key/host resolution (supports `SUMUP_API_KEY_TEST` / `LIVE`, `SUMUP_MODE`, etc.).
- Webhook also records `WebhookEvent`.

### 2.8 R2 Card Lifecycle (`lib/r2/`)

- `card-r2-lifecycle.mjs`: `createCardPlaceholderObject`, soft-delete path (mark deleted, remove object, then delete Mongo).
- `r2-client.mjs`: `putR2Object`, `deleteR2Object`, error classification.
- `card-placeholder.mjs`: builds the placeholder JSON/HTML content and key `cards/{cardId}/placeholder.json`.
- Reconcile script: `scripts/r2-reconcile-cards.mjs`.
- Controlled by `r2-env.mjs` (credentials, bucket).

On fire (inside transaction): Card document is created with `r2ObjectKey` and `r2Status: "pending_create"`. The actual R2 object write (`createCardPlaceholderObject`) happens after the transaction succeeds.

### 2.9 Database & Bootstrap (`lib/db/`)

- `mongoose.mjs`: connection (uses env).
- `bootstrap.mjs`: `ensureSharedBalance` (creates default 500p balance if missing), `initializeDatabaseIndexes`.
- Models registered on import.

Scripts exist for repair, smoke tests, ledger repair, payment audit, R2 reconcile.

### 2.10 Admin Tools

Protected by `proxy.js` Basic Auth when `ENABLE_ADMIN_TOOLS` is set.
Routes/pages under `app/api/admin/` and `app/admin/` for orders, webhooks, audit, refunds, refresh.

### 2.11 Dependencies & Configuration

- `@aws-sdk/client-s3`, `mongoose`, `zod`.
- Env flags: `ENABLE_TEST_CONTROLS`, `ENABLE_ADMIN_TOOLS`.
- SumUp: `SUMUP_*` keys (test/live split supported), merchant code.
- R2: standard S3-compatible creds + bucket.
- Mongo connection string.
- Prototype uses its own `next.config.mjs`, Tailwind 3, Vitest.

---

## 3. Integration Seams & Recommended Mapping

### 3.1 Cost Recording + Deduction

- Wrap or extend `fetchOpenAiWithRetry` (or the low-level fetch to OpenAI endpoints in `openai-lyrics.js`) to capture `response.usage` (or headers where available) after every successful call.
- Compute or look up cost in pence using model + token counts.
- After a successful phase (or full job), call the equivalent of `applyLedgeredBalanceChange` (type something like `AI_TRANSCRIBE`, `AI_ENRICH`, etc.) with a strong idempotency key (e.g. based on jobId + phase + attempt).
- Use MongoDB transactions (Mongoose `withTransaction` + session, as the prototype does for fire and verification) where a successful lyric phase result and the corresponding ledger debit must be atomic.
- Block or warn the lyric pipeline when balance is too low (similar to fire button).

The prototype's ledger + idempotency patterns are directly reusable.

### 3.2 Top-up / Balance Management

- Port the SumUp checkout + dual-path verification (webhook + return) with minimal change.
- The "balance" becomes the app-wide (or per-generation-owner) credit pool used for AI calls.
- Reuse `lib/money.js` helpers, order models, verification logic.
- Add a visible balance indicator somewhere in the main editor chrome (or a dedicated credit page).

### 3.3 Public Generation Dashboard

- New route/page (e.g. `/dashboard` or `/generations`).
- Each "card" represents one completed generation: title, some metadata, link to the lyric project data, link/play the MP3.
- Cards are created at generation time (after successful render or lyric pipeline completion).
- Display uses similar grid + serialize patterns from the prototype.

### 3.4 Storage Migration (Lyrics + MP3s)

- Lyric data / project snapshots + card metadata → MongoDB collections (modeled after prototype's Card + Ledger + new Generation doc).
- MP3 files (user uploads + YT-derived) → R2 objects (reusing/extending `r2-client.mjs` and lifecycle patterns). The bucket that currently holds only `cards/.../placeholder.json` will also hold generation audio.
- Reference in Mongo: `r2ObjectKey` or signed URL / asset id equivalent.
- Keep the existing ephemeral session asset system for active editing sessions (Phase 1 compatibility). Promote to R2 on "save generation" or export.
- Extend asset metadata or add new "generation" asset records.

### 3.5 Tying Generations to Cards

- When a user completes a meaningful generation (e.g. successful export or "save as card"), create a Card-like document + ledger entry if cost was deducted.
- The public dashboard lists these generation cards.
- Future: fire button or other actions could be tied to generation cards.

### 3.6 Job / Atomicity Patterns

- Reuse the prototype's transaction + ledger pattern inside `runTranscribeJob` or render completion.
- Idempotency keys are critical because jobs can be retried/polled across restarts.

---

## 4. Dependencies, Environment & Operational Notes

**New / expanded for main app**:
- `mongoose`, `@aws-sdk/client-s3`.
- MongoDB Atlas connection.
- SumUp credentials (test + live support as in prototype).
- R2 credentials + bucket (already partially planned per Public_imp_plan.md).
- New env flags mirroring prototype (`ENABLE_TEST_CONTROLS`, etc.).
- Possibly pricing config or a small cost lookup table for OpenAI models.

**Patterns to preserve**:
- Integer pence everywhere for money.
- Server-authoritative amounts and verification.
- Append-only ledger.
- Dual fulfilment paths for payments.
- R2 soft-delete + reconcile for durability.
- Dev-only gated controls.

**Scripts**: Plan to port/adapt repair, smoke, audit, reconcile scripts.

---

## 5. Mobile, Responsive & Current Polish Context

The main app is actively aligning narrow layouts to `mockup_integration_project/mobile-mockup.html` (fixed top transport, bottom sheet snaps, exclusive preview/board panes, Words tab special handling).

Any new dashboard page or balance UI elements must follow the same responsive rules and design tokens.

The prototype dashboard is desktop-oriented; its card grid and header will need responsive treatment on merge.

---

## 6. Existing Documentation & Reference Material

**Must-read**:
- `Temp_prototype_parts/Credit_dash_prototype_part/plan.md`
- `Temp_prototype_parts/Credit_dash_prototype_part/progress.md`
- `Temp_prototype_parts/Credit_dash_prototype_part/cloudflare-r2-card-lifecycle-*.md`
- `Temp_prototype_parts/Credit_dash_prototype_part/PHASE_7_DEV_PLAN.md`
- `Old .md files/sumup-payments-api-hosted-checkout-integration-guide.md` (detailed SumUp patterns)
- `Current .md docs/Public_imp_plan.md` (mentions integrating credit dash + R2 + Mongo + tracking £ credits)
- Main app: `lib/ai/openai-lyrics.js`, `lib/ai/transcribe-job.js`, `lib/files.js`, `lib/project.js`, `app/api/ai/transcribe/*`
- Prototype source for models, ledger, payments, r2.

Also useful: prototype's `lib/db/`, `lib/payments/`, `scripts/`, `OPERATIONS.md`, `SETUP.md`.

---

## 7. Important Considerations, Risks & Recommendations

### Strong Recommendations
- Instrument costs at the actual OpenAI fetch layer so every model call (content, timing, quality, retries) is captured.
- Adopt the prototype's ledger + transaction + idempotency pattern for **all** money movement (AI debits and top-ups).
- Keep the ephemeral asset system for active editing; promote completed generations' MP3s (and lyric snapshots) to Mongo + R2.
- Make the public generation dashboard a first-class separate page that can be linked from the editor.
- Port the dual-path (webhook + return) verification exactly — it is the key to exactly-once.
- Use the same R2 patterns for real audio objects as the prototype uses for placeholders.
- Gate expensive operations (full lyric pipeline, export) on sufficient balance where appropriate.

### Risks & Gotchas
- **Cost accuracy**: OpenAI pricing can change; usage objects give tokens but final cost may require a price table or API. Decide early whether to store raw usage or computed pence.
- **Atomicity across systems**: Lyric result + ledger debit + R2 write + Mongo generation doc must be coordinated (use transactions where possible; compensation on failure).
- **Idempotency keys**: Must be robust across job retries and page reloads.
- **Shared vs per-user balance**: Current prototype is single shared "shared" balance. The long-term vision mentions "user in-app generation" cards. Auth model is still deferred.
- **R2 for large audio**: MP3s are bigger than JSON placeholders. Handle upload/download, signed URLs or proxy serving, lifecycle (retention, deletion on generation removal).
- **Webhook reliability**: SumUp webhooks must be processed quickly and idempotently. Prototype stores raw events — good pattern.
- **No current auth**: Everything public now. Adding "shared password for generations" later will affect dashboard visibility and balance ownership.
- **Provider/price drift**: Like YT providers, OpenAI model names and pricing evolve.
- **Mobile dashboard**: Card grid + balance header must fit the sheet + transport model.

### Nice-to-haves for the merge
- Admin tools and repair scripts from the prototype.
- Balance low warning in the Audio tab / pipeline UI.
- Audit log surface (leveraging CreditLedger + new generation events).
- Reusable "credit service" module that both AI pipeline and future fire-like actions can use.
- Dev-only "add test credits" control in the main app during development.

---

## 8. Appendix — Quick Reference

**Main app instrumentation targets**:
- `lib/ai/openai-lyrics.js` + `fetchOpenAiWithRetry`
- `lib/ai/transcribe-job.js` (runTranscribeJob, phase handling)
- `lib/files.js` (future R2 promotion path)
- `components/editor-shell.js` and Audio tab (balance display + gating)

**Prototype patterns to lift**:
- Money + validation (`lib/money.js`)
- Ledger (`lib/ledger/balance-ledger.mjs`, CreditLedger model)
- Payments (`lib/payments/*`, SumUp client + verification)
- R2 lifecycle (`lib/r2/*`)
- Models and bootstrap
- Dashboard state + UI reducer
- Fire and top-up flows

**Key data handoff**:
- Successful OpenAI call → usage recorded → ledger debit (idempotent) → balance updated.
- Top-up → SumUp verified → ledger credit.
- Completed generation → Mongo document (lyrics snapshot + card metadata) + MP3 written to R2.
- Public dashboard reads from Mongo + R2 references.

**Prototype env / flags to map**:
- SumUp test/live keys
- R2 credentials
- `ENABLE_TEST_CONTROLS`
- Mongo connection

---

**End of Information Bank (Phase 2 — Credit Dashboard)**

All statements are based on direct inspection of the current codebases and the referenced project documents as of the research date. This document should be read alongside the actual source in `Temp_prototype_parts/Credit_dash_prototype_part/`, the main app `lib/ai/` and `lib/files.js` areas, and the planning documents listed in section 6.

When the Plan and Progress documents are created for this merge, this bank supplies the factual foundation. Core decisions around auth and exact cost pricing remain deferred.