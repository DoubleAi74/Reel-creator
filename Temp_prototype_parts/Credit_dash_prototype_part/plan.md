# Plan — Credit Dashboard Prototype

## 1. Goal & summary
A small standalone web app: a single shared **credit dashboard** with a grid of
simple cards the user can add and remove (persisted in MongoDB), and a **GBP
balance shown top-right**. A **🔥 fire button** next to the balance flashes the
header red, adds a random card, and subtracts **2p** per press. A separate **"Add
money"** button opens a **SumUp Hosted Checkout** so the user pays real money
(sandbox first) to top up the on-screen balance — credited only after
**server-verified** payment, in integer pence, exactly once. Built to be merged
later into the main `reel-creator` Next.js app as a separate dashboard page.

## 2. Scope
### In scope (v1)
- Single **shared** dashboard, **no login** (one global balance, one shared card list).
- **Add / remove cards**, persisted in MongoDB Atlas.
- **Cards carry random data**: a random title, a random number, and a random colour.
- **Balance** stored server-side in **integer pence**, shown top-right as `£x.xx` (GBP).
- **Fire button**: header flashes red (~600ms, fades back), adds one random card,
  subtracts 2p. **Blocks at £0** (refused when balance < 2p).
- **Dev-only "Set balance" control** for testing, gated by an env flag (hidden in
  production), server-clamped — a testing convenience, **not** a payment path.
- **Add money**: **custom amount** entry (£1.00–£100.00), **server-authoritative**,
  via **SumUp Hosted Checkout** in **sandbox**.
- **Fulfilment via both** a **webhook** and a **return-page status check**, each doing
  authoritative server-side checkout retrieval before crediting.
- **Exactly-once crediting** with idempotency / duplicate-webhook protection.
- **Step-by-step SumUp sandbox setup instructions** for the user.

### Out of scope (v1)
- **Refunds** — no refund route (guide §20). Noted as a merge/future follow-up.
- **Reconciliation job** — no scheduled re-check job (guide §21). Follow-up.
- **Multi-user / accounts / auth** — single shared dashboard only.
- **Live mode** — sandbox only; live rollout is a documented later step (guide §28).
- **MP3 / file storage** — deferred to Cloudflare post-merge (per user).
- **Card editing** — cards are add/remove only in v1.

## 3. Stack & rationale
- **Framework:** Next.js **App Router**, **JavaScript** (no TypeScript) — identical
  to the merge target `reel-creator`, so merging is close to copy-paste. (The SumUp
  guide's sample code is TypeScript; we port it to plain JS.)
- **Styling:** **Tailwind CSS** — matches the main app's intended styling and keeps
  the small UI quick to build.
- **Database:** **MongoDB Atlas + Mongoose** (schema models for clarity; user handles
  Atlas setup).
- **Payments:** **SumUp Hosted Checkout**, server-authoritative, via `app/api/*`
  routes exactly as the SumUp guide prescribes. Sandbox first.
- **Tooling (mirrors main app):** npm, ESLint (`eslint`), Vitest (`vitest run`).
- **Money:** integer **pence** everywhere internally; convert to major units only at
  the SumUp boundary.

## 4. User flows (step by step)
**Add card**
1. User clicks "Add card". 2. `POST /api/dashboard/cards`; server generates random
title/number/colour and inserts a Card. 3. UI shows the new card.

**Remove card**
1. User clicks a card's remove control. 2. `DELETE /api/dashboard/cards/[id]`.
3. Card disappears; DB row removed.

**Fire button (header red + add random card + −2p)**
1. User presses 🔥. 2. `POST /api/dashboard/fire`. 3. Server atomically checks
`balance ≥ 2p`; if yes, decrements 2p **and** inserts one random card in one step; if
no, returns a "balance too low" response and makes **no** change. 4. On success the
client flashes the header red for ~600ms (CSS transition fades back), the new card
appears, and the balance re-renders. 5. **Below-zero rule:** when balance < 2p the
fire button is disabled and the server refuses the press (never goes negative).

**Dev "Set balance" (testing only)**
1. Visible only when `ENABLE_TEST_CONTROLS` is on. 2. User enters an amount;
`POST /api/dashboard/balance` sets `amountMinor` (server clamps to sane bounds).
3. Route returns 404/hidden when the flag is off, so it can't be used in production.

**Add money (SumUp top-up)**
1. User clicks "Add money", enters a **custom amount** (£1–£100). 2. Client sends the
requested amount to `POST /api/payments/sumup/checkout`; **the server re-validates the
amount against the £1–£100 bounds** and is the sole authority on the price. 3. Server
creates an internal **order** (`PAYMENT_PENDING`, integer pence, unique reference),
then creates a SumUp Hosted Checkout for that amount, persists the SumUp checkout id +
hosted URL, and returns `{ orderId, checkoutUrl }`. 4. Server validates `checkoutUrl`
is an HTTPS SumUp URL, then the browser is redirected to it. 5. User pays on SumUp's
hosted page. 6. **Two fulfilment paths run:**
   - **Webhook** (`POST /api/webhooks/sumup`): validates payload shape, acknowledges
     quickly (2xx), then **retrieves the checkout from SumUp** and, if genuinely
     `PAID` and matching the order, marks the order paid and **credits the balance
     exactly once**.
   - **Return page** (`GET /payment/return?order=<publicRef>`): shows "Confirming your
     payment…", polls `GET /api/payments/sumup/orders/[orderId]`; if still pending it
     can trigger a server-side verification. It **never** credits based on URL params.
7. Balance re-renders once credited. Cancelled/failed/expired payments credit nothing.

## 5. UI & layout
- **Dashboard page** (`/`): responsive **card grid** with an "Add card" control; each
  card shows its title, number, and colour, plus a remove control.
- **Header (top-right):** the GBP balance `£x.xx`, the **🔥 fire button**, and the
  **"Add money"** button. Dev "Set balance" control appears here (or in a small dev
  bar) only when the test flag is on.
- **States:** loading (fetching state), empty (no cards yet), error (DB/network),
  **header flash red** (fire press), checkout **redirecting**, and the **return page**
  states: confirming / received / still processing / unsuccessful / expired /
  could-not-confirm.

## 6. Data model (Mongoose)
- **Card** — `{ title: String, number: Number, colour: String, createdAt: Date }`.
  Shared list, no owner in v1. (`_id` is the card id.)
- **Balance (singleton account doc)** — `{ amountMinor: Number (integer pence),
  currency: 'GBP', updatedAt: Date }`. Exactly one document; seeded to **500** (£5.00)
  on first run.
- **PaymentOrder (checkout/top-up record)** —
  `{ status: 'PAYMENT_PENDING'|'PAID'|'PAYMENT_FAILED'|'PAYMENT_EXPIRED'|'CANCELLED',
  amountMinor: Number (integer), currency: 'GBP', description: String,
  publicReference: String, sumupCheckoutReference: String, sumupCheckoutId: String|null,
  sumupCheckoutStatus: String|null, sumupTransactionId: String|null,
  balanceCredited: Boolean (default false), paidAt: Date|null, expiresAt: Date|null,
  createdAt, updatedAt }`.
  **Indexes (exactly-once):** `unique(sumupCheckoutReference)`,
  `unique(sumupCheckoutId)` sparse, `unique(sumupTransactionId)` sparse,
  `unique(publicReference)`. The `balanceCredited` flag guards against double-credit.

## 7. Payments design (SumUp Hosted Checkout)
- **Server-authoritative amount.** The browser's requested amount is re-validated
  against £1–£100 on the server; the server sets the checkout price. Never trust the
  browser price.
- **Routes:**
  - `POST /api/payments/sumup/checkout` — create order + SumUp checkout, return
    `{ orderId, checkoutUrl }` (validate it's an HTTPS SumUp URL).
  - `GET /api/payments/sumup/orders/[orderId]` — return internal order status only
    (never raw provider/secret data).
  - `POST /api/webhooks/sumup` — validate shape, ack 2xx fast, then authoritative
    retrieval + verify + credit-once.
  - `GET /payment/return` — customer return page; polls internal status.
- **Provider adapter.** SumUp lives behind a small client module
  (`createHostedCheckout`, `retrieveCheckout`) ported from the guide §9 to JS, so order
  / credit logic never touches raw SumUp shapes directly.
- **Verification before crediting (guide §15):** confirm `checkout.id`,
  `checkout_reference`, `merchant_code`, `currency`, `amount`, and `status === PAID`
  all match the stored order. Any mismatch → do **not** credit; flag for review.
- **Exactly-once + idempotency (guide §14, §17):**
  - One order → one unique `checkout_reference` (`order_<id>`), created before calling
    SumUp; reuse an existing usable pending checkout instead of creating duplicates.
  - Credit the balance only via a **guarded atomic transition**: flip the order to
    `PAID` **only if** `status !== 'PAID'` **and** `balanceCredited === false`, set
    `balanceCredited = true`, and `$inc` the balance in the same
    unit-of-work (Atlas multi-document transaction / session, or a
    conditional `findOneAndUpdate` guard). Duplicate/late webhooks and the return-page
    check therefore never double-credit.
  - Unknown/future event types and unknown checkouts are acknowledged safely and
    ignored (guide §13).
- **Sandbox first; live-mode note.** All work is against the SumUp sandbox. Live
  rollout (verified merchant, live key, production HTTPS webhook/redirect URLs) is a
  documented later step (guide §28) and out of scope for v1.
- **Webhook reachability:** SumUp must reach the webhook over HTTPS. In local dev, use
  a tunnel (e.g. cloudflared / ngrok) and set `SUMUP_WEBHOOK_URL` to the public URL.
  Use a high-entropy webhook path (guide §13).

## 8. External service setup (for the user)
**MongoDB Atlas** — user-managed. Create a free cluster, a database user, allow your IP,
and copy the connection string into `MONGODB_URI`. (User already knows how to do this.)

**SumUp sandbox — step by step** (from the guide §4–§6):
1. Sign in at <https://me.sumup.com/> (create an account if needed).
2. Open **Developer Settings** → **Sandboxes** tab → **create a sandbox merchant**.
3. **Switch into** the sandbox account.
4. **Record the sandbox merchant code** → `SUMUP_MERCHANT_CODE`.
5. Go to **For Developers → Toolkit → API Keys** → **Create** a key named e.g.
   `credit-dash-sandbox-server`. Do **not** use the public key as the secret. Copy the
   secret key (`sk_test_…`) → `SUMUP_API_KEY`. Store it in a secret manager; never commit it.
6. Set `SUMUP_API_BASE_URL=https://api.sumup.com`, `SUMUP_CURRENCY=GBP`.
7. Set `SUMUP_WEBHOOK_URL` (public HTTPS, via a dev tunnel locally) and
   `SUMUP_CHECKOUT_RETURN_URL` (your return page URL).
8. **Sandbox test notes:** an amount of **11.00 GBP is designed to fail** (test failure
   handling); dedicated online-payment **test cards** exist (guide §4). Never use real
   card details in tests.

## 9. Environment variables (names + purpose only — never values)
- `MONGODB_URI` — MongoDB Atlas connection string.
- `SUMUP_API_KEY` — SumUp **secret** server key (sandbox `sk_test_…`). Server-only.
- `SUMUP_MERCHANT_CODE` — sandbox merchant receiving the payment.
- `SUMUP_API_BASE_URL` — SumUp API base (default `https://api.sumup.com`).
- `SUMUP_CURRENCY` — `GBP`.
- `SUMUP_WEBHOOK_URL` — public HTTPS webhook (SumUp `return_url`); high-entropy path.
- `SUMUP_CHECKOUT_RETURN_URL` — customer-facing return page (SumUp `redirect_url`).
- `APP_BASE_URL` — base URL used to build absolute redirect/return links.
- `ENABLE_TEST_CONTROLS` — when true, exposes the dev "Set balance" control/route;
  off/absent in production.

## 10. Money handling & correctness rules
- **Integer pence everywhere**; convert to major units only when calling SumUp
  (`amountMinor / 100`). No floating-point money maths.
- Fire button subtracts exactly `2` pence; guarded so the balance never goes below 0.
- **Credit the balance only on a verified `PAID` checkout retrieved from SumUp** — never
  on a bare browser redirect or an unverified webhook body.
- **Exactly-once:** the `balanceCredited` flag + unique indexes prevent double-credit.
- **Never log** secrets, the Authorization header, or card data. Log only safe fields
  (order id, checkout id, reference, normalized state, HTTP status).

## 11. Error & failure handling
- **Payment declined / cancelled / abandoned:** order stays not-`PAID`; balance
  unchanged; return page shows unsuccessful/pending appropriately.
- **Checkout expired** (~30 min window): mark `PAYMENT_EXPIRED`; a fresh press creates a
  new checkout under the idempotency rules.
- **Webhook missing / late / retried:** return-page verification and (optionally) a
  manual re-check cover a missed webhook; retries are idempotent (no double-credit).
- **SumUp API errors/timeouts:** explicit request timeouts; retry only safe cases
  (network/408/429/selected 5xx), never blindly retry ambiguous checkout creation; map
  to safe internal error codes; never leak raw SumUp responses to the browser.
- **DB errors:** surface a friendly error state; the fire/add operations are atomic so a
  failure leaves no partial change.
- **Below-zero fire press:** button disabled + server refusal; no change, clear message.

## 12. Validation & smoke tests (how we'll know it works)
- [ ] Add/remove card persists in MongoDB (survives refresh).
- [ ] Header shows the balance as `£x.xx` from the DB.
- [ ] Fire button flashes header red, adds a random card, subtracts exactly 2p (integer).
- [ ] Fire button is refused at balance < 2p (never negative).
- [ ] Dev "Set balance" works only when `ENABLE_TEST_CONTROLS` is on; route 404s when off.
- [ ] Custom top-up is server-validated to £1–£100; out-of-range rejected.
- [ ] **Sandbox checkout → verified `PAID` → balance credited exactly once.**
- [ ] **Duplicate/late webhook does not double-credit.**
- [ ] Sandbox `11.00 GBP` fails as expected and credits nothing.
- [ ] Cancelled/abandoned/expired checkout credits nothing.
- [ ] Return page shows "confirming" then the correct final state; never credits on URL params.
- [ ] No secret appears in client bundles, logs, or source control.

## 13. Merge notes (into the main reel-creator project)
- **Target stack:** Next.js App Router / JavaScript. Adds **Mongoose** and **SumUp**
  (Hosted Checkout) as **new** dependencies + their env vars — the main app has neither today.
- **Placement:** the dashboard is a **separate page** from the main functional page
  (which stays the landing page users see first). Likely home: a new dashboard route
  under `app/`, `app/api/*` payment + dashboard routes, and `lib/` for the Mongoose
  connection + models + SumUp adapter, matching the app's `app/ · lib/ · components/`
  layout.
- **Card meaning at merge:** in the real app, dashboard "cards" will represent **saved
  lyric-set metadata** — when a user translates/processes a lyric set, they'll get the
  option to **save it to the dashboard** (metadata stored). The prototype's random
  title/number/colour cards are a stand-in for that saved-item shape; the Card model
  will grow real fields (e.g. lyric-set id, title, language) at merge.
- **Money/credits at merge:** the shared single balance becomes the account/credit model
  the main app uses; keep it integer pence and server-authoritative.
- **Deferred:** **MP3 / file storage** will be handled via **Cloudflare** after this
  feature set merges — not part of this prototype.
- **Merge follow-ups:** wire real env vars + production HTTPS webhook URL; add
  Mongoose + SumUp deps; reconsider auth (per-user balances vs shared) if the main app
  has accounts; revisit refunds + reconciliation; go through SumUp live-mode rollout.

## 14. Assumptions & open questions
- **A1 — Single shared global state.** One balance doc + one card list for everyone (no
  auth). *Risk if wrong:* concurrent users share/overwrite state; fine for a prototype,
  revisited at merge.
- **A2 — Balance seeded to £5.00 (500p)** on first run; blocks at £0. *Risk:* low.
- **A3 — Custom top-up bounds £1.00–£100.00**, enforced server-side. *Risk:* low; easy to adjust.
- **A4 — Both fulfilment paths** (webhook + return-page verification) implemented; the
  webhook is the primary crediting path, the return page is the user-facing confirm.
  *Risk:* webhook needs a public HTTPS URL in dev (tunnel) — a setup step, not a design risk.
- **A5 — Refunds & reconciliation deferred.** *Risk:* no automatic recovery for missed
  webhooks in v1; mitigated by the return-page verification and manual re-check.
- **A6 — Atlas transactions available.** Exactly-once crediting assumes MongoDB Atlas
  (replica set) supports multi-document transactions; if not, the guarded conditional
  `findOneAndUpdate` fallback still ensures single credit. *Risk:* low.
- **Open:** exact SumUp response/field names to be confirmed against the current API
  reference at build time (guide notes schemas may evolve).
