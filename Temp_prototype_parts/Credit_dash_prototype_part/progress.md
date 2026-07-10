# Progress — Credit Dashboard Prototype

## Tier
Simple (standalone prototype)

## Stack
Next.js App Router / JavaScript · Tailwind CSS · MongoDB Atlas + Mongoose · SumUp Hosted Checkout (sandbox) · npm · ESLint · Vitest

## Current State
T18 and Phase 7 implementation are complete. Verified SumUp top-ups and dashboard
card creation now move money only through the append-only `credit_ledger` collection.
`/api/payments/sumup/checkout` reuses a recent pending hosted checkout for the same
amount, so an accidental double-click does not create multiple payment attempts.
Admin tools are protected by `proxy.js` Basic Auth and gated by `ENABLE_ADMIN_TOOLS`.
Admin order, webhook, refund, and audit endpoints/pages are in place. `npm run
ledger:repair` created 3 historical `TOP_UP` rows and is idempotent on rerun.
Post-repair audit: `missingLedgerCount=0`, `uncreditedPaidCount=0`,
`mismatchCount=0`, `unknownWebhookCount=0`, `stalePendingCount=6` old sandbox
pending orders. SumUp env resolution now supports split `SUMUP_API_KEY_TEST` /
`SUMUP_API_KEY_LIVE` and `SUMUP_MERCHANT_CODE_TEST` / `SUMUP_MERCHANT_CODE_LIVE`
names, with case-insensitive `SUMUP_MODE`; local `.env.local` resolves to live mode
via `SUMUP_API_KEY_LIVE`. Ready for T19 sandbox smoke scenarios and Phase 7 live
smoke when production/Vercel env vars are available.

Cloudflare R2 card lifecycle (R2-00 … R2-12) is complete and live-tested:
visible cards created via `POST /api/dashboard/fire` get a placeholder object
at `cards/{cardId}/placeholder.json` in one private R2 bucket; deletes
soft-delete first, remove the R2 object, then permanently delete Mongo;
failures are retryable via `npm run r2:reconcile-cards`; `npm run r2:smoke`
verifies credentials (passed with real credentials on 2026-07-07, and Mongo/R2
were verified fully consistent after a real create/delete test). Detailed
ledger: `cloudflare-r2-card-lifecycle-progress.md`.
Note: stale money test assertions were updated to match commit `ae60c6e`
("minimoney", `TOP_UP_MIN_MINOR` 100 → 1); app money behavior unchanged.

## Command Baseline
- Install: `npm install`
- Dev/Run: `npm run dev` (open http://localhost:3000)
- Lint: `npm run lint` (ESLint)
- Test: `npm run test` (Vitest — `vitest run`)
- Build: `npm run build`

## Tasks — Stage 1 (look & feel, placeholder data)
- [x] T01 — Scaffold Next.js (App Router, JS, Tailwind) + dashboard route shell — done when `npm run dev` serves a styled empty dashboard page
- [x] T02 — Card grid with hardcoded cards (title + number + colour) — done when several placeholder cards render in a responsive grid
- [x] T03 — Add/remove card in local React state — done when cards appear/disappear on click
- [x] T04 — Header (top-right): GBP balance `£x.xx` from local state + 🔥 fire button + "Add money" button — done when it shows `£5.00` and the buttons render
- [x] T05 — Fire button (client): flash header red ~600ms fade, add a random card, subtract 2p (integer pence), disabled below 2p — done when all three happen and it stops at £0
- [x] T06 — Dev-only "Set balance" control, gated by `ENABLE_TEST_CONTROLS` — done when it shows only with the flag on and updates local balance

## Tasks — Stage 2 (make it live: database)
- [x] T07 — Mongoose connection helper + models (Card, Balance singleton, PaymentOrder with unique indexes) — done when the app connects to Atlas and seeds Balance to 500p on first run
- [x] T08 — `GET /api/dashboard/state` + wire dashboard to load cards & balance from DB — done when a refresh shows persisted data
- [x] T09 — `POST /api/dashboard/cards` (random data server-side) + `DELETE /api/dashboard/cards/[id]` — done when add/remove survive refresh
- [x] T10 — `POST /api/dashboard/fire`: atomic check `≥2p` → decrement 2p + insert random card; refuse below 2p — done when balance & card persist and never go negative
- [x] T11 — `POST /api/dashboard/balance` (dev-only, env-gated, server-clamped) — done when it sets balance with the flag on and 404s when off

## Tasks — Stage 3 (make it live: payments)
- [x] T12 — SumUp client adapter in `lib/` (`createHostedCheckout`, `retrieveCheckout`, env validation) ported to JS from guide §9 — done when it can create & retrieve a sandbox checkout
- [x] T13 — `POST /api/payments/sumup/checkout`: server-validate custom amount (£1–£100), create PaymentOrder + SumUp checkout, persist ids, return `{ orderId, checkoutUrl }` (validated HTTPS SumUp URL) — done when clicking "Add money" opens a hosted checkout
- [x] T14 — "Add money" UI (custom amount entry) → redirect to `checkoutUrl` — done when a valid amount launches the hosted page and out-of-range is rejected
- [x] T15 — `GET /api/payments/sumup/orders/[orderId]` (internal status only) + `/payment/return` page that polls it — done when success/pending/failed are detected server-side (never from URL params)
- [x] T16 — `POST /api/webhooks/sumup`: validate shape, ack 2xx fast, authoritative retrieval, verify (id/ref/merchant/currency/amount/PAID) — done when a verified payment marks the order PAID
- [x] T17 — Exactly-once credit: guarded atomic PAID transition + `balanceCredited` flag `$inc` balance once (Atlas transaction or conditional `findOneAndUpdate` fallback) — done when a verified payment credits the balance exactly once
- [x] T18 — Idempotency / duplicate-webhook + duplicate-checkout protection (unique reference, reuse pending checkout) — done when a repeat webhook and a double-click do not double-credit or double-charge
- [ ] T19 — Sandbox smoke tests (plan §12): successful GBP top-up credits the counter; `11.00` fails & credits nothing; cancelled/expired credit nothing; duplicate webhook harmless — done when all pass and the £ balance rises after a real sandbox payment

## Tasks — Cloudflare R2 card lifecycle
- [x] R2-00 — Preflight, baseline lint/test/build, flow confirmation
- [x] R2-01 — R2 env contract (`lib/r2/r2-env.mjs`, `.env.example` names)
- [x] R2-02 — `@aws-sdk/client-s3` + R2 client wrapper (`lib/r2/r2-client.mjs`)
- [x] R2-03 — Card model R2 fields, statuses, and indexes
- [x] R2-04 — Placeholder key/content/metadata builder (`lib/r2/card-placeholder.mjs`)
- [x] R2-05 — Card R2 lifecycle service (`lib/r2/card-r2-lifecycle.mjs`)
- [x] R2-06 — `/api/dashboard/fire` creates placeholder after commit (2p ledger intact)
- [x] R2-07 — `/api/dashboard/state` hides soft-deleted cards
- [x] R2-08 — `DELETE /api/dashboard/cards/[id]` soft-delete → R2 delete → permanent delete
- [x] R2-09 — `npm run r2:reconcile-cards` retry/repair script
- [x] R2-10 — `npm run r2:smoke` credential smoke script
- [x] R2-11 — SETUP.md Part G, OPERATIONS.md R2 runbook, progress docs
- [x] R2-12 — Final manual test with real R2 credentials (smoke ✅, user-verified
      create/delete ✅, Mongo/R2 consistency verified ✅; failure simulation left
      optional)

## Tasks — Phase 7 (real-money operational safety)
- [x] P7-01 — Explicit `SUMUP_MODE=sandbox|live` guard with live HTTPS URL checks
- [x] P7-02 — Append-only `credit_ledger` model, helper, tests, and repair script
- [x] P7-03 — Verified top-up credits write `TOP_UP` ledger rows
- [x] P7-04 — Card creation spends write `CARD_CREATE` ledger rows
- [x] P7-05 — Admin Basic Auth gate via `proxy.js`
- [x] P7-06 — Admin order view and manual SumUp refresh
- [x] P7-07 — Scrubbed webhook event logging and admin webhook history
- [x] P7-08 — Refund tracking, SumUp refund adapter, and ledger refund adjustment
- [x] P7-09 — Stuck-payment audit script and admin audit API
- [x] P7-10 — Operations runbook
- [ ] P7-11 — Final real-money smoke on production HTTPS with a tiny live payment

## Notes & Blockers
- Webhook local dev uses the public tunnel in `SUMUP_WEBHOOK_URL`; if only the tunnel
  root is configured, checkout creation now targets `/api/webhooks/sumup` automatically.
- **Keys/accounts needed before Stage 3:** SumUp sandbox merchant code + secret API key
  (`sk_test_…`), and the sandbox setup from plan §8. Before Stage 2: MongoDB Atlas URI.
- **Money is integer pence everywhere**; convert only at the SumUp boundary. Never credit
  on a bare redirect or unverified webhook body. Never log secrets/card data.
- Sandbox test facts: amount `11.00 GBP` is designed to fail; use SumUp test cards only.
- Confirm SumUp response field names against the current API reference at build time.

## Build Handoff
- Start with (from the project root): `read Temp_prototype_parts/Credit_dash_prototype_part/plan.md and progress.md and build`
- Stack: Next.js App Router / JavaScript · Tailwind · MongoDB Atlas + Mongoose · SumUp Hosted Checkout (sandbox) · npm · ESLint · Vitest
- Start at: T01
- Keys/accounts the build needs, and when:
  - **MongoDB Atlas URI** — before Stage 2 (T07).
  - **SumUp sandbox merchant code + secret API key + webhook tunnel URL** — before Stage 3 (T12+); full setup in plan §8.
- Reference: `Current .md docs/sumup-payments-api-hosted-checkout-integration-guide.md` (authoritative for payments).
- Anything not already in plan.md: none — plan.md is self-contained.
