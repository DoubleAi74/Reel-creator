# Progress — Credit Dashboard Prototype

## Tier
Simple (standalone prototype)

## Stack
Next.js App Router / JavaScript · Tailwind CSS · MongoDB Atlas + Mongoose · SumUp Hosted Checkout (sandbox) · npm · ESLint · Vitest

## Current State
Planning complete and approved. `plan.md` is the authoritative spec. No code yet —
build starts at T01. Build in three stages: (1) look & feel with placeholder data,
(2) database, (3) live SumUp payments.

## Command Baseline
- Install: `npm install`
- Dev/Run: `npm run dev` (open http://localhost:3000)
- Lint: `npm run lint` (ESLint)
- Test: `npm run test` (Vitest — `vitest run`)
- Build: `npm run build`

## Tasks — Stage 1 (look & feel, placeholder data)
- [ ] T01 — Scaffold Next.js (App Router, JS, Tailwind) + dashboard route shell — done when `npm run dev` serves a styled empty dashboard page
- [ ] T02 — Card grid with hardcoded cards (title + number + colour) — done when several placeholder cards render in a responsive grid
- [ ] T03 — Add/remove card in local React state — done when cards appear/disappear on click
- [ ] T04 — Header (top-right): GBP balance `£x.xx` from local state + 🔥 fire button + "Add money" button — done when it shows `£5.00` and the buttons render
- [ ] T05 — Fire button (client): flash header red ~600ms fade, add a random card, subtract 2p (integer pence), disabled below 2p — done when all three happen and it stops at £0
- [ ] T06 — Dev-only "Set balance" control, gated by `ENABLE_TEST_CONTROLS` — done when it shows only with the flag on and updates local balance

## Tasks — Stage 2 (make it live: database)
- [ ] T07 — Mongoose connection helper + models (Card, Balance singleton, PaymentOrder with unique indexes) — done when the app connects to Atlas and seeds Balance to 500p on first run
- [ ] T08 — `GET /api/dashboard/state` + wire dashboard to load cards & balance from DB — done when a refresh shows persisted data
- [ ] T09 — `POST /api/dashboard/cards` (random data server-side) + `DELETE /api/dashboard/cards/[id]` — done when add/remove survive refresh
- [ ] T10 — `POST /api/dashboard/fire`: atomic check `≥2p` → decrement 2p + insert random card; refuse below 2p — done when balance & card persist and never go negative
- [ ] T11 — `POST /api/dashboard/balance` (dev-only, env-gated, server-clamped) — done when it sets balance with the flag on and 404s when off

## Tasks — Stage 3 (make it live: payments)
- [ ] T12 — SumUp client adapter in `lib/` (`createHostedCheckout`, `retrieveCheckout`, env validation) ported to JS from guide §9 — done when it can create & retrieve a sandbox checkout
- [ ] T13 — `POST /api/payments/sumup/checkout`: server-validate custom amount (£1–£100), create PaymentOrder + SumUp checkout, persist ids, return `{ orderId, checkoutUrl }` (validated HTTPS SumUp URL) — done when clicking "Add money" opens a hosted checkout
- [ ] T14 — "Add money" UI (custom amount entry) → redirect to `checkoutUrl` — done when a valid amount launches the hosted page and out-of-range is rejected
- [ ] T15 — `GET /api/payments/sumup/orders/[orderId]` (internal status only) + `/payment/return` page that polls it — done when success/pending/failed are detected server-side (never from URL params)
- [ ] T16 — `POST /api/webhooks/sumup`: validate shape, ack 2xx fast, authoritative retrieval, verify (id/ref/merchant/currency/amount/PAID) — done when a verified payment marks the order PAID
- [ ] T17 — Exactly-once credit: guarded atomic PAID transition + `balanceCredited` flag `$inc` balance once (Atlas transaction or conditional `findOneAndUpdate` fallback) — done when a verified payment credits the balance exactly once
- [ ] T18 — Idempotency / duplicate-webhook + duplicate-checkout protection (unique reference, reuse pending checkout) — done when a repeat webhook and a double-click do not double-credit or double-charge
- [ ] T19 — Sandbox smoke tests (plan §12): successful GBP top-up credits the counter; `11.00` fails & credits nothing; cancelled/expired credit nothing; duplicate webhook harmless — done when all pass and the £ balance rises after a real sandbox payment

## Notes & Blockers
- **Webhook needs a public HTTPS URL** in local dev — use a tunnel (cloudflared/ngrok)
  and set `SUMUP_WEBHOOK_URL` to it (high-entropy path). Blocks T16/T19 until available.
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
