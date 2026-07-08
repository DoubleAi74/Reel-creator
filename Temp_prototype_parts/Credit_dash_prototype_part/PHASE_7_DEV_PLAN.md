# Phase 7 Dev Plan — Real-Money Operational Safety

## Purpose

Phase 7 turns the working sandbox prototype into a safer real-money prototype. The
goal is not just to make live payments possible; it is to make every money movement
explainable, auditable, recoverable, and hard to double-apply.

Current baseline:

- SumUp Hosted Checkout creation works.
- `/payment/return` verifies checkouts server-side.
- `/api/webhooks/sumup` retrieves authoritative checkout state from SumUp.
- Balance is credited only after verified `PAID`.
- `balanceCredited: false` guards exactly-once crediting inside an Atlas transaction.
- Dashboard card creation spends 2p through `/api/dashboard/fire`.

## Non-Negotiables

- Money stays integer pence everywhere except the SumUp API boundary.
- Never credit from URL params, browser redirects, or unverified webhook payloads.
- Never log secrets, authorization headers, webhook raw bodies with sensitive data, or card data.
- Live mode must be explicit. The app must not accidentally charge real money.
- Admin actions must be authenticated before deployment with live credentials.
- Every balance movement must have a ledger entry.

## Implementation Order

Work one section at a time. After each section:

```bash
npm run lint
npm run test
npm run build
```

Run DB/payment smokes where listed.

---

## P7-01 — Add Explicit SumUp Mode Guard

### Goal

Make sandbox/live mode explicit so live credentials cannot be used accidentally.

### Files

- `lib/payments/sumup-env.mjs`
- `lib/payments/sumup-env.test.js`
- `.env.example`
- `SETUP.md`
- `PHASE_7_DEV_PLAN.md` if notes change

### Steps

1. Add env var:

   ```env
   SUMUP_MODE=sandbox
   ```

2. Update `.env.example`:

   ```env
   SUMUP_MODE=
   ```

3. Update `sumup-env.mjs` schema:

   - Accept only `sandbox` or `live`.
   - In `sandbox`, accept sandbox/test server-secret key shapes only.
   - In `live`, accept live server-secret key shapes only.
   - Reject public/affiliate keys in all modes.

4. Add production URL checks when `SUMUP_MODE=live`:

   - `APP_BASE_URL` must be HTTPS.
   - `SUMUP_CHECKOUT_RETURN_URL` must be HTTPS.
   - `SUMUP_WEBHOOK_URL` must be HTTPS.
   - No `localhost`, `127.0.0.1`, `::1`, or temporary tunnel unless an explicit override exists.

5. Optional override for controlled live tests:

   ```env
   ALLOW_TEMP_LIVE_PAYMENT_URLS=false
   ```

   Default should be false.

6. Add tests:

   - Sandbox mode rejects live keys.
   - Live mode rejects sandbox keys.
   - Live mode rejects localhost URLs.
   - Live mode accepts HTTPS production URLs.

### Acceptance

- App refuses unsafe live config at startup.
- Sandbox local dev still works.
- Tests cover the mode/key matrix.

---

## P7-02 — Add Append-Only Credit Ledger

### Goal

Make every balance movement auditable.

### Files

- `lib/models/CreditLedger.mjs`
- `lib/ledger/balance-ledger.mjs`
- `lib/ledger/balance-ledger.test.js`
- `scripts/ledger-repair.mjs`
- `package.json`

### Model

Create `CreditLedger` in collection `credit_ledger`.

Fields:

```js
{
  type: 'TOP_UP' | 'CARD_CREATE' | 'REFUND_ADJUSTMENT' | 'MANUAL_ADJUSTMENT',
  amountMinor: Number,          // positive or negative integer pence
  balanceAfterMinor: Number,
  currency: 'GBP',
  paymentOrderId: ObjectId|null,
  cardId: ObjectId|null,
  idempotencyKey: String,       // unique
  reason: String,
  metadata: Object,             // safe metadata only
  createdAt: Date
}
```

Indexes:

- `unique(idempotencyKey)`
- `{ createdAt: -1 }`
- `{ type: 1, createdAt: -1 }`
- `{ paymentOrderId: 1 }`

### Helper

Create `applyLedgeredBalanceChange({ session, type, amountMinor, idempotencyKey, paymentOrderId, cardId, reason, metadata })`.

Rules:

- Requires integer `amountMinor`.
- Uses the provided Mongo session.
- Updates `dashboard_balances` singleton with `$inc`.
- Inserts exactly one ledger row with unique `idempotencyKey`.
- If duplicate idempotency key exists, do not apply the balance change again.

### Migration Script

Add:

```bash
npm run ledger:repair
```

Script should:

1. Ensure `dashboard_balances` exists.
2. Create ledger indexes.
3. For existing `PAID` orders with `balanceCredited=true`, create missing `TOP_UP` ledger rows.
4. Do not invent historical `CARD_CREATE` rows unless card-spend history can be proven.
5. Report counts only.

### Acceptance

- Ledger collection exists.
- Existing paid orders have top-up ledger entries.
- Re-running `ledger:repair` does not duplicate rows.
- Balance can be reconciled from ledger for all ledgered events going forward.

---

## P7-03 — Wire Ledger Into Verified Top-Up Credit

### Goal

A successful payment credit creates both:

- a balance increment
- a `TOP_UP` ledger row

### Files

- `lib/payments/payment-verification.mjs`
- `lib/payments/payment-verification.test.js`
- `lib/ledger/balance-ledger.mjs`

### Steps

1. In `refreshPaymentOrderFromSumUp`, replace direct `Balance.findOneAndUpdate(... $inc ...)` with `applyLedgeredBalanceChange`.
2. Use idempotency key:

   ```text
   top_up:<paymentOrder._id>
   ```

3. Keep the existing `PaymentOrder.findOneAndUpdate({ balanceCredited: false })` guard.
4. Make ledger insert and order update part of the same transaction.
5. Add tests for:

   - paid checkout creates one ledger row
   - duplicate verification does not create a second ledger row
   - verification mismatch creates no ledger row

### Acceptance

- Paid top-up credits once.
- Repeat order-status poll does not duplicate the ledger row.
- Repeat webhook does not duplicate the ledger row.

---

## P7-04 — Wire Ledger Into Card Creation Spend

### Goal

Each paid card creation has a negative ledger row.

### Files

- `app/api/dashboard/fire/route.js`
- `lib/ledger/balance-ledger.mjs`
- tests for fire behavior

### Steps

1. In `/api/dashboard/fire`, keep the existing atomic `>= 2p` guard.
2. After creating the card inside the same transaction, call `applyLedgeredBalanceChange`.
3. Use idempotency key:

   ```text
   card_create:<card._id>
   ```

4. Ledger row:

   ```js
   {
     type: 'CARD_CREATE',
     amountMinor: -2,
     cardId: card._id,
     reason: 'Dashboard card creation'
   }
   ```

5. Ensure response still returns updated balance and card.

### Acceptance

- Visible Add card button subtracts exactly 2p.
- Ledger has one `CARD_CREATE` row.
- Balance never goes negative.
- Server refuses when balance < 2p.

---

## P7-05 — Add Admin Authentication

### Goal

Protect operational pages and admin APIs before real money.

### Files

- `middleware.js`
- `.env.example`
- `SETUP.md`

### Env

```env
ADMIN_USERNAME=
ADMIN_PASSWORD=
ENABLE_ADMIN_TOOLS=false
```

### Steps

1. Add middleware that protects:

   - `/admin/:path*`
   - `/api/admin/:path*`

2. Use HTTP Basic Auth for this prototype.
3. If `ENABLE_ADMIN_TOOLS !== "true"`, return 404 for admin pages/APIs.
4. Do not log credentials.
5. Add tests/helpers if route-level tests are already available; otherwise add manual smoke steps.

### Acceptance

- `/admin/orders` is not publicly reachable.
- Wrong credentials fail.
- Correct credentials work.
- Admin tools are disabled unless explicitly enabled.

---

## P7-06 — Build Admin Order View

### Goal

Inspect and repair payment orders without opening MongoDB.

### Files

- `app/admin/orders/page.js`
- `components/admin/OrdersTable.jsx`
- `app/api/admin/orders/route.js`
- `app/api/admin/orders/[orderId]/refresh/route.js`
- `lib/admin/serialize-admin-order.mjs`

### Admin API

`GET /api/admin/orders`

Query params:

- `status`
- `credited`
- `limit`

Return safe order fields only:

```js
{
  orderId,
  amountMinor,
  currency,
  status,
  checkoutStatus,
  balanceCredited,
  sumupCheckoutIdPresent,
  sumupTransactionIdPresent,
  createdAt,
  paidAt,
  updatedAt
}
```

`POST /api/admin/orders/[orderId]/refresh`

- Loads order.
- Calls `refreshPaymentOrderFromSumUp`.
- Returns serialized order.

### UI

Columns:

- Created
- Order id
- Amount
- Status
- Checkout status
- Credited
- Paid at
- Actions

Actions:

- Refresh from SumUp

### Acceptance

- Admin can see recent orders.
- Admin can manually refresh a stuck order.
- No raw SumUp payloads are shown.
- No secrets are shown.

---

## P7-07 — Add Webhook Event Logging

### Goal

Know whether SumUp webhooks are arriving and how they were handled.

### Files

- `lib/models/WebhookEvent.mjs`
- `app/api/webhooks/sumup/route.js`
- `app/api/admin/webhooks/route.js`
- `components/admin/WebhookEventsTable.jsx`

### Model

Collection: `webhook_events`

Fields:

```js
{
  provider: 'sumup',
  checkoutId: String|null,
  checkoutReference: String|null,
  paymentOrderId: ObjectId|null,
  eventType: String|null,
  processingStatus: 'IGNORED' | 'MATCHED' | 'VERIFIED_PAID' | 'ERROR',
  safeErrorCode: String|null,
  createdAt: Date
}
```

Do not store raw webhook body unless separately reviewed and scrubbed.

### Steps

1. Parse webhook body.
2. Extract safe identifiers.
3. Insert `WebhookEvent`.
4. Match order.
5. Retrieve checkout from SumUp.
6. Update event processing status.
7. Always return 2xx so SumUp does not retry forever on harmless unknown events.

### Acceptance

- Duplicate webhook creates multiple event records but only one credit.
- Unknown webhook is logged and ignored.
- Admin page can show webhook history.

---

## P7-08 — Add Refund Tracking

### Goal

Support real refunds safely without silently corrupting balance.

### SumUp Reference

SumUp supports refunds through the refund API. A transaction id is required. The app
already stores/retrieves transaction ids from successful checkouts when SumUp includes
them.

### Files

- `lib/models/RefundRecord.mjs`
- `lib/payments/sumup-refunds.mjs`
- `app/api/admin/orders/[orderId]/refund/route.js`
- `lib/ledger/balance-ledger.mjs`
- admin order UI

### Model

Collection: `refund_records`

Fields:

```js
{
  paymentOrderId: ObjectId,
  amountMinor: Number,
  currency: 'GBP',
  status: 'REQUESTED' | 'SUCCEEDED' | 'FAILED',
  sumupTransactionId: String,
  idempotencyKey: String,
  safeErrorCode: String|null,
  createdAt: Date,
  updatedAt: Date
}
```

Indexes:

- `unique(idempotencyKey)`
- `{ paymentOrderId: 1, createdAt: -1 }`

### Steps

1. Add SumUp refund adapter:

   ```js
   refundTransaction({ transactionId, amountMajor })
   ```

2. Admin refund endpoint:

   - Requires admin auth.
   - Loads order.
   - Requires order `PAID`.
   - Requires transaction id.
   - Validates refund amount in pence.
   - Calls SumUp refund endpoint.
   - Records refund result.

3. Decide credit policy:

   - Recommended v1: record refund and create `REFUND_ADJUSTMENT` ledger entry that subtracts refundable credits if current balance is sufficient.
   - If current balance is insufficient, mark refund as needing manual review instead of creating negative balance.

4. Ledger idempotency key:

   ```text
   refund:<paymentOrder._id>:<amountMinor>
   ```

   If multiple partial refunds are needed, include a refund record id.

### Acceptance

- Admin can record a full refund.
- Admin can record a partial refund.
- Refund does not double-adjust credits.
- Refund cannot silently create unexplained negative balance.

---

## P7-09 — Add Stuck Payment Monitor

### Goal

Find orders that need attention.

### Files

- `scripts/payment-audit.mjs`
- `app/api/admin/audit/payments/route.js`
- optional Vercel Cron later

### Audit Rules

Flag:

- `PAYMENT_PENDING` older than 30 minutes.
- SumUp says `PAID` but `balanceCredited=false`.
- Local order says `PAID` but no ledger `TOP_UP`.
- Checkout verification mismatch.
- Webhook received for unknown checkout/reference.

### Output

Safe JSON only:

```js
{
  stalePendingCount,
  uncreditedPaidCount,
  missingLedgerCount,
  mismatchCount
}
```

### Acceptance

- Script can be run locally and on Vercel.
- No secrets printed.
- Admin can see audit summary.

---

## P7-10 — Add Operations Runbook

### Goal

Document what to do when payments are real.

### File

- `OPERATIONS.md`

### Include

1. Sandbox vs live mode checklist.
2. How to deploy to Vercel.
3. How to verify env vars without printing values.
4. How to check a payment order.
5. How to refresh an order from SumUp.
6. How to inspect webhook events.
7. How to refund.
8. How to reconcile balance and ledger.
9. How to rotate SumUp keys.
10. What not to log.
11. Real-money launch checklist.

### Acceptance

- A non-author can follow the runbook.
- No secret values appear in the doc.
- Includes emergency steps for stuck paid/uncredited payments.

---

## P7-11 — Final Real-Money Smoke

### Goal

Prove the live path works with a tiny payment.

### Prerequisites

- Verified live SumUp merchant.
- `SUMUP_MODE=live`.
- Live secret key in Vercel env vars.
- Production HTTPS URL.
- Admin tools protected.
- Ledger enabled.
- Refund process documented.

### Steps

1. Deploy production.
2. Open production URL.
3. Confirm no sandbox banner if live mode.
4. Add money: `£1.00`.
5. Pay with a real card.
6. Confirm redirect to `/payment/return`.
7. Confirm dashboard balance increases by 100p.
8. Confirm Mongo:

   - `payment_orders.status = PAID`
   - `payment_orders.balanceCredited = true`
   - one `credit_ledger` row with `type = TOP_UP`
   - `dashboard_balances.amountMinor` increased once

9. Refresh order manually in admin.
10. Confirm balance does not increase again.
11. Trigger/replay webhook if possible.
12. Confirm duplicate webhook does not double-credit.

### Acceptance

- One real £1 payment credits exactly once.
- Admin view shows the order.
- Ledger explains the balance.
- Repeat checks are harmless.

---

## Suggested Task IDs

Add these to `progress.md` after T19 or as a new Phase 7 section:

- P7-01 — Explicit `SUMUP_MODE` live/sandbox guard.
- P7-02 — CreditLedger model + ledger repair script.
- P7-03 — Ledgered top-up credit.
- P7-04 — Ledgered card creation spend.
- P7-05 — Admin auth.
- P7-06 — Admin order view + refresh.
- P7-07 — Webhook event logging.
- P7-08 — Refund tracking + admin refund action.
- P7-09 — Stuck payment audit.
- P7-10 — `OPERATIONS.md`.
- P7-11 — Live £1 smoke test.

## Useful Commands

```bash
npm run lint
npm run test
npm run build
npm run db:smoke
npm run sumup:smoke
npm run db:repair
npm run ledger:repair
node scripts/payment-audit.mjs
```

## External References

- SumUp Hosted Checkout: https://developer.sumup.com/online-payments/checkouts/hosted-checkout/
- SumUp Webhooks: https://developer.sumup.com/online-payments/webhooks/
- SumUp Refunds: https://developer.sumup.com/online-payments/guides/refund/
- SumUp Checkouts API: https://developer.sumup.com/api/checkouts/create
- Vercel Environment Variables: https://vercel.com/docs/environment-variables
- Vercel Next.js deployments: https://vercel.com/docs/frameworks/full-stack/nextjs
