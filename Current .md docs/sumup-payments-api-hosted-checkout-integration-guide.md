# SumUp Payments API — Hosted Checkout Integration Guide

> **For an AI coding agent**
>
> Recommended integration: **SumUp Online Payments — Hosted Checkout**  
> Primary scenario: a UK business accepting one-off online payments into its own SumUp merchant account  
> Verified against official SumUp documentation: **1 July 2026**
>
> SumUp Developer Portal: <https://developer.sumup.com/>  
> Hosted Checkout guide: <https://developer.sumup.com/online-payments/checkouts/hosted-checkout/>  
> API reference: <https://developer.sumup.com/api/>

---

## 1. Objective

Implement a secure server-side SumUp payment integration that:

1. Creates an internal order before contacting SumUp.
2. Creates a SumUp Hosted Checkout for the exact server-authoritative amount.
3. Redirects the customer to SumUp’s hosted payment page.
4. Receives checkout-status webhook notifications.
5. independently retrieves the checkout from SumUp to verify its current state;
6. marks the order paid only after authoritative server-side verification.
7. Handles retries, duplicate requests, expired sessions, refunds, and reconciliation.
8. Keeps API credentials and sensitive payment logic out of browser code.

The recommended first version uses **Hosted Checkout**, not a custom card form.

Hosted Checkout is the quickest and lowest-compliance-burden online integration because SumUp hosts the payment page, payment collection, wallet interface, and customer-facing payment result screens.

---

## 2. Integration choice

### Use Hosted Checkout when

Use Hosted Checkout for the initial implementation when:

- payments are one-off;
- a redirect to a SumUp-hosted page is acceptable;
- the business uses its own SumUp merchant account;
- the application does not need to directly handle card data;
- the goal is the simplest reliable production launch.

The core flow is:

```text
Your application
    |
    | POST /v0.1/checkouts
    v
SumUp API
    |
    | returns checkout id + hosted_checkout_url
    v
Customer redirected to SumUp
    |
    | customer completes or abandons payment
    v
SumUp sends webhook and/or customer returns
    |
    | application retrieves checkout from SumUp
    v
Application updates internal order
```

### Do not use raw card-entry API code by default

SumUp also documents direct checkout completion with customer-entered card details. Do not choose that path unless the product explicitly requires a custom payment form and the team has reviewed:

- PCI DSS implications;
- 3-D Secure handling;
- browser security;
- payment-data handling;
- SumUp’s current eligibility requirements.

Prefer Hosted Checkout or SumUp’s Payment Widget.

### Use Payment Widget when

Use the Payment Widget instead when:

- the payment form must remain embedded in the site;
- the product requires a more integrated visual flow;
- the team is prepared to implement the SumUp client widget correctly.

Official guide:

<https://developer.sumup.com/online-payments/checkouts/card-widget/>

### Use OAuth 2.0 instead of an API key when

Use OAuth when the application acts on behalf of **other SumUp merchants**, such as a SaaS platform or marketplace integration.

Official OAuth guide:

<https://developer.sumup.com/tools/authorization/oauth/>

Do not use one merchant’s secret API key to process payments for unrelated merchants.

### Use terminal/card-reader APIs when

Hosted Checkout is for online payments. For physical card-present payments, use one of SumUp’s terminal integrations:

- Cloud API: <https://developer.sumup.com/terminal-payments/cloud-api/>
- Payment Switch: <https://developer.sumup.com/terminal-payments/payment-switch/>
- terminal SDK overview: <https://developer.sumup.com/terminal-payments/>

Do not treat an online Hosted Checkout as a card-reader integration.

---

## 3. Current UK pricing

As of **1 July 2026**, SumUp’s UK pricing page lists:

```text
Monthly cost for standard pay-as-you-go online payments: £0
Online payment transaction fee: 2.50%
```

Official UK pricing:

<https://www.sumup.com/en-gb/pricing/>

Example fee estimates:

| Customer payment | 2.50% fee | Approximate net before other adjustments |
|---:|---:|---:|
| £1.00 | £0.025 | £0.975 |
| £5.00 | £0.125 | £4.875 |
| £10.00 | £0.25 | £9.75 |
| £20.00 | £0.50 | £19.50 |
| £50.00 | £1.25 | £48.75 |
| £100.00 | £2.50 | £97.50 |

These are simple percentage calculations and should not be used as accounting records.

The coding agent must:

1. treat fees as country- and product-specific;
2. not hard-code `2.50%` into payment correctness logic;
3. not subtract an estimated fee from the checkout amount;
4. verify current pricing before a production commercial decision;
5. use SumUp reports, transaction data, and payout reconciliation for actual fees.

Pricing links:

- UK pricing: <https://www.sumup.com/en-gb/pricing/>
- UK online payments: <https://www.sumup.com/en-gb/online-payments/>
- UK pricing support: <https://help.sumup.com/en-GB/articles/4oI3qHHji2I2S9dyvRfec3-pricing-fees>

---

## 4. SumUp account and sandbox setup

### Create or access a SumUp account

Open:

<https://me.sumup.com/>

Complete any identity, business, bank-account, and merchant verification SumUp requires before attempting live payments.

### Create a sandbox merchant

SumUp provides sandbox merchant accounts that do not move real money.

1. Sign in to the SumUp Dashboard.
2. Open **Developer Settings**.
3. Open the **Sandboxes** tab.
4. Create a sandbox merchant account.
5. Switch into that sandbox account before creating test credentials.
6. Record the sandbox merchant code.

Developer settings:

<https://me.sumup.com/settings/developer>

Online Payments overview:

<https://developer.sumup.com/online-payments/>

Important documented sandbox behavior:

- sandbox transactions do not process real funds;
- sandbox and live merchant accounts have different identifiers;
- a sandbox checkout amount of **11 in any currency is designed to fail**, which is useful for testing failure handling;
- SumUp introduced dedicated online-payment test cards in March 2026.

Testing documentation:

<https://developer.sumup.com/online-payments/testing/>

Test-card update:

<https://developer.sumup.com/changelog/online-payments-test-cards/>

Never use real card details in automated tests.

---

## 5. Create API credentials

### API-key flow for a single merchant

Use an API key when the application processes payments for the business’s own SumUp merchant account.

Official instructions:

<https://developer.sumup.com/tools/authorization/api-keys/>

Current dashboard steps:

1. Sign in to <https://me.sumup.com/>.
2. Open the profile menu and select **Settings**.
3. Go to **For Developers → Toolkit**.
4. Select **API Keys**.
5. Do not use the displayed public key as the server API secret.
6. Select **Create**.
7. Give the key a clear environment-specific name, such as:

   ```text
   my-app-sandbox-server
   my-app-production-server
   ```

8. Copy or download the key immediately.
9. Store it in a password manager or managed secret store.
10. Never commit it to Git.

SumUp’s current API reference describes test and live secret-key prefixes such as:

```text
sk_test_...
sk_live_...
```

The exact dashboard presentation may evolve. Use the credential generated for the selected sandbox or live account and confirm it works against the current API reference.

### Authorization header

Server requests use:

```http
Authorization: Bearer YOUR_SUMUP_SECRET_KEY
```

Never expose this key in:

- client-side JavaScript;
- mobile application bundles;
- public environment variables;
- HTML;
- browser network requests;
- logs;
- screenshots;
- analytics;
- source control.

### OAuth for multi-merchant applications

For an integration installed by other merchants, implement OAuth 2.0:

<https://developer.sumup.com/tools/authorization/oauth/>

The coding agent must not silently substitute an API-key architecture for a multi-merchant platform.

---

## 6. Retrieve and record the merchant code

A checkout requires a `merchant_code`.

The merchant code can be obtained from the merchant profile via the SumUp API or dashboard. It differs between sandbox and live merchants.

Store separate environment values:

```bash
SUMUP_API_KEY=
SUMUP_MERCHANT_CODE=
SUMUP_API_BASE_URL=https://api.sumup.com
SUMUP_CURRENCY=GBP
SUMUP_WEBHOOK_URL=https://example.com/api/webhooks/sumup
SUMUP_CHECKOUT_RETURN_URL=https://example.com/payment/return
```

For local development:

```bash
# .env.local
SUMUP_API_KEY=sk_test_replace_me
SUMUP_MERCHANT_CODE=replace_me
SUMUP_API_BASE_URL=https://api.sumup.com
SUMUP_CURRENCY=GBP
SUMUP_WEBHOOK_URL=https://your-public-dev-domain.example/api/webhooks/sumup
SUMUP_CHECKOUT_RETURN_URL=https://your-public-dev-domain.example/payment/return
```

Example file:

```bash
# .env.example
SUMUP_API_KEY=
SUMUP_MERCHANT_CODE=
SUMUP_API_BASE_URL=https://api.sumup.com
SUMUP_CURRENCY=GBP
SUMUP_WEBHOOK_URL=
SUMUP_CHECKOUT_RETURN_URL=
```

Add local secrets to `.gitignore`:

```gitignore
.env
.env.local
.env*.local
```

Validate configuration at application startup.

```ts
import { z } from "zod";

const sumupEnvironmentSchema = z.object({
  SUMUP_API_KEY: z.string().min(1),
  SUMUP_MERCHANT_CODE: z.string().min(1),
  SUMUP_API_BASE_URL: z.string().url().default("https://api.sumup.com"),
  SUMUP_CURRENCY: z.literal("GBP"),
  SUMUP_WEBHOOK_URL: z.string().url(),
  SUMUP_CHECKOUT_RETURN_URL: z.string().url(),
});

export const sumupEnvironment = sumupEnvironmentSchema.parse({
  SUMUP_API_KEY: process.env.SUMUP_API_KEY,
  SUMUP_MERCHANT_CODE: process.env.SUMUP_MERCHANT_CODE,
  SUMUP_API_BASE_URL:
    process.env.SUMUP_API_BASE_URL ?? "https://api.sumup.com",
  SUMUP_CURRENCY: process.env.SUMUP_CURRENCY ?? "GBP",
  SUMUP_WEBHOOK_URL: process.env.SUMUP_WEBHOOK_URL,
  SUMUP_CHECKOUT_RETURN_URL:
    process.env.SUMUP_CHECKOUT_RETURN_URL,
});
```

---

## 7. Core API endpoints

Base URL:

```text
https://api.sumup.com
```

### Create checkout

```http
POST /v0.1/checkouts
```

Official API reference:

<https://developer.sumup.com/api/checkouts/create>

### Retrieve checkout

```http
GET /v0.1/checkouts/{checkout_id}
```

Use this to verify the current state after:

- a webhook;
- a browser return;
- a reconciliation job;
- an uncertain network response.

### Deactivate checkout

Use the checkout deactivation endpoint when a pending checkout should no longer be payable. Confirm the exact current method and path in the live API reference before implementation.

### Retrieve/list transactions

Transactions are the authoritative payment records after checkout processing. Use transaction endpoints for reconciliation, reporting, and refunds.

API reference:

<https://developer.sumup.com/api/>

### Refund transaction

Official refund guide:

<https://developer.sumup.com/online-payments/guides/refund/>

---

## 8. Hosted Checkout creation request

The application must create an internal order first.

Never accept a final price directly from the browser.

### Server-authoritative sequence

```text
1. Authenticate user or establish a secure guest session.
2. Load product/plan/order details from the database.
3. Calculate amount on the server.
4. Persist an internal order with status PAYMENT_PENDING.
5. Generate a unique checkout reference.
6. Create SumUp checkout.
7. Store SumUp checkout id and hosted URL.
8. Return only the hosted URL or a safe internal redirect response.
```

### SumUp request

```bash
curl -X POST https://api.sumup.com/v0.1/checkouts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SUMUP_API_KEY" \
  -d '{
    "amount": 12.00,
    "checkout_reference": "order_01J2EXAMPLE",
    "currency": "GBP",
    "description": "Order order_01J2EXAMPLE",
    "merchant_code": "YOUR_MERCHANT_CODE",
    "return_url": "https://example.com/api/webhooks/sumup",
    "redirect_url": "https://example.com/payment/return",
    "hosted_checkout": {
      "enabled": true
    }
  }'
```

Relevant fields:

| Field | Purpose |
|---|---|
| `amount` | Amount in major currency units |
| `checkout_reference` | Unique merchant-defined reference, maximum currently documented as 90 characters |
| `currency` | ISO 4217 currency, such as `GBP` |
| `merchant_code` | SumUp merchant receiving the payment |
| `description` | Human-readable checkout description |
| `return_url` | Backend webhook destination |
| `redirect_url` | Customer-facing return link |
| `hosted_checkout.enabled` | Requests SumUp-hosted payment page |

Expected response includes:

```json
{
  "id": "sumup-checkout-id",
  "status": "PENDING",
  "hosted_checkout_url": "https://checkout.sumup.com/pay/..."
}
```

The exact response must be validated against the current API schema.

SumUp currently documents Hosted Checkout sessions as available for approximately **30 minutes**. Do not assume a pending link remains usable indefinitely.

---

## 9. Recommended TypeScript client

Create:

```text
lib/payments/sumup-client.ts
```

Install Zod if not already present:

```bash
npm install zod
```

```ts
import { z } from "zod";
import { sumupEnvironment } from "./sumup-env";

const checkoutStatusSchema = z.enum([
  "PENDING",
  "FAILED",
  "PAID",
  "EXPIRED",
]);

const sumupCheckoutSchema = z
  .object({
    id: z.string().min(1),
    checkout_reference: z.string().optional(),
    amount: z.number().optional(),
    currency: z.string().optional(),
    merchant_code: z.string().optional(),
    status: checkoutStatusSchema,
    hosted_checkout_url: z.string().url().optional(),
    transactions: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type SumUpCheckout = z.infer<typeof sumupCheckoutSchema>;

export type CreateHostedCheckoutInput = {
  amount: number;
  currency: "GBP";
  checkoutReference: string;
  description: string;
  returnUrl: string;
  redirectUrl: string;
};

export class SumUpApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "SumUpApiError";
  }
}

function getHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${sumupEnvironment.SUMUP_API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  let body: unknown = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { unparsedBody: text };
    }
  }

  if (!response.ok) {
    throw new SumUpApiError(
      `SumUp returned HTTP ${response.status}`,
      response.status,
      body,
    );
  }

  return body;
}

export async function createHostedCheckout(
  input: CreateHostedCheckoutInput,
): Promise<SumUpCheckout> {
  const response = await fetch(
    `${sumupEnvironment.SUMUP_API_BASE_URL}/v0.1/checkouts`,
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        amount: input.amount,
        currency: input.currency,
        checkout_reference: input.checkoutReference,
        merchant_code: sumupEnvironment.SUMUP_MERCHANT_CODE,
        description: input.description,
        return_url: input.returnUrl,
        redirect_url: input.redirectUrl,
        hosted_checkout: {
          enabled: true,
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    },
  );

  const checkout = sumupCheckoutSchema.parse(
    await readJsonResponse(response),
  );

  if (!checkout.hosted_checkout_url) {
    throw new Error(
      "SumUp created a checkout without hosted_checkout_url",
    );
  }

  return checkout;
}

export async function retrieveCheckout(
  checkoutId: string,
): Promise<SumUpCheckout> {
  const response = await fetch(
    `${sumupEnvironment.SUMUP_API_BASE_URL}/v0.1/checkouts/${encodeURIComponent(
      checkoutId,
    )}`,
    {
      method: "GET",
      headers: getHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    },
  );

  return sumupCheckoutSchema.parse(
    await readJsonResponse(response),
  );
}
```

The coding agent must compare this schema with the current SumUp OpenAPI reference and tighten it where possible.

---

## 10. Money handling

### Do not use floating-point arithmetic for business calculations

The SumUp API expresses checkout amounts in major units, but application pricing calculations should use integer minor units.

Correct internal representation:

```ts
type Money = {
  amountMinor: number;
  currency: "GBP";
};

const price: Money = {
  amountMinor: 1299,
  currency: "GBP",
};
```

Convert only at the SumUp boundary:

```ts
function minorToMajor(amountMinor: number): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new Error("Invalid minor-unit amount");
  }

  return amountMinor / 100;
}
```

For complex currencies or multi-currency support, use a decimal/money library and explicit ISO currency metadata.

### Never trust browser prices

The browser may send:

```json
{
  "productId": "pro-plan"
}
```

The server must load the current price and currency from trusted storage.

Do not accept:

```json
{
  "amount": 0.01
}
```

as an authoritative customer-selected price unless the product intentionally supports donations or custom amounts and validates them server-side.

---

## 11. Internal database model

Suggested schema:

```ts
type PaymentOrderStatus =
  | "PAYMENT_PENDING"
  | "PAID"
  | "PAYMENT_FAILED"
  | "PAYMENT_EXPIRED"
  | "REFUND_PENDING"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED"
  | "CANCELLED";

type PaymentOrder = {
  id: string;
  userId: string | null;
  status: PaymentOrderStatus;

  amountMinor: number;
  currency: "GBP";
  description: string;

  sumupCheckoutReference: string;
  sumupCheckoutId: string | null;
  sumupCheckoutStatus: string | null;
  sumupTransactionId: string | null;

  paidAt: Date | null;
  fulfilledAt: Date | null;
  expiresAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
};
```

Recommended database constraints:

```text
UNIQUE(sumupCheckoutReference)
UNIQUE(sumupCheckoutId) where not null
UNIQUE(sumupTransactionId) where not null
```

Do not use the customer-facing success redirect as proof of payment.

---

## 12. Application routes

Recommended Next.js-style routes:

```text
POST /api/payments/sumup/checkout
POST /api/webhooks/sumup
GET  /api/payments/sumup/orders/{orderId}
GET  /payment/return
POST /api/payments/sumup/orders/{orderId}/refund
```

### Create checkout route

Request:

```json
{
  "orderId": "internal-order-id"
}
```

Or create the order from a server-authoritative product selection:

```json
{
  "productId": "pro-plan"
}
```

Response:

```json
{
  "orderId": "internal-order-id",
  "checkoutUrl": "https://checkout.sumup.com/pay/..."
}
```

Validate that `checkoutUrl` is an HTTPS SumUp-hosted URL before returning or redirecting.

### Status route

Return internal state, not raw secret provider data.

```json
{
  "orderId": "internal-order-id",
  "status": "PAID"
}
```

### Customer return page

The return page should say something like:

```text
We are confirming your payment.
```

It should request the internal order status from the server.

It must not grant purchased access solely because the URL contains:

```text
?success=true
```

---

## 13. Webhook implementation

Official guide:

<https://developer.sumup.com/online-payments/webhooks/>

To subscribe to checkout status changes, include `return_url` when creating the checkout.

SumUp currently documents a webhook payload similar to:

```json
{
  "event_type": "CHECKOUT_STATUS_CHANGED",
  "id": "id-of-the-changed-checkout"
}
```

### Critical verification rule

The webhook body is only a notification.

After receiving it:

1. validate the basic payload shape;
2. acknowledge promptly;
3. retrieve the checkout from SumUp using the server API key;
4. compare it with the stored order;
5. update state transactionally;
6. fulfil only when the retrieved checkout is genuinely paid.

SumUp explicitly instructs integrations to call the relevant API after receiving a webhook to verify that the event occurred.

### Webhook handler example

```ts
import { z } from "zod";
import { retrieveCheckout } from "@/lib/payments/sumup-client";

const webhookSchema = z
  .object({
    event_type: z.string(),
    id: z.string().min(1),
  })
  .passthrough();

export async function POST(request: Request): Promise<Response> {
  let payload: z.infer<typeof webhookSchema>;

  try {
    payload = webhookSchema.parse(await request.json());
  } catch {
    return new Response(null, { status: 400 });
  }

  // SumUp may add event types. Unknown events should be ignored safely.
  if (payload.event_type !== "CHECKOUT_STATUS_CHANGED") {
    return new Response(null, { status: 204 });
  }

  // For robust production systems, enqueue this work and acknowledge quickly.
  // The queue worker must retrieve the checkout from SumUp and update the DB.
  await enqueueSumUpCheckoutVerification(payload.id);

  return new Response(null, { status: 204 });
}
```

### Webhook acknowledgement

Return an empty `2xx` response quickly.

SumUp currently documents retries after failed delivery at approximately:

```text
1 minute
5 minutes
20 minutes
2 hours
```

Therefore, webhook processing must be idempotent.

### Unknown event types

SumUp states that new event types may be introduced.

Silently acknowledge and ignore unknown event types unless the application has implemented them.

### Webhook authenticity

Do not invent an HMAC-signature verification scheme unless SumUp’s current documentation provides one for this specific webhook product.

The required protection in the documented flow is authoritative server-side retrieval of the checkout after the notification.

Additional hardening may include:

- a high-entropy unguessable webhook URL path;
- strict payload and size limits;
- HTTPS only;
- rate limiting that does not block legitimate retries;
- logging checkout IDs without storing sensitive payloads;
- optional source controls only if officially documented and operationally reliable.

---

## 14. Checkout-state mapping

Current high-level SumUp checkout states include:

```text
PENDING
PAID
FAILED
EXPIRED
```

Suggested mapping:

| SumUp status | Internal order status | Fulfil? |
|---|---|---:|
| `PENDING` | `PAYMENT_PENDING` | No |
| `PAID` | `PAID` | Yes, exactly once |
| `FAILED` | `PAYMENT_FAILED` | No |
| `EXPIRED` | `PAYMENT_EXPIRED` | No |
| unknown | keep current safe state and investigate | No |

Do not assume a checkout’s status field is the only useful payment information. Transactions are the authoritative resulting payment records and should be stored/reconciled when present.

### Exactly-once fulfilment

Payment notifications are at-least-once in practice. Your fulfilment must be idempotent.

Use a database transaction:

```text
1. Lock order.
2. Check current state.
3. Verify amount, currency, merchant, reference, and checkout ID.
4. If already fulfilled, do nothing.
5. Mark paid.
6. create an outbox/fulfilment event;
7. Commit.
8. Process fulfilment event idempotently.
```

Never send two entitlements, credits, downloads, or shipments because two webhooks arrived.

---

## 15. Verification checks before marking paid

When retrieving a checkout, verify all of:

```text
checkout.id === stored sumupCheckoutId
checkout.checkout_reference === stored checkout reference
checkout.merchant_code === configured merchant code
checkout.currency === internal order currency
checkout.amount === internal order amount
checkout.status === PAID
```

Use appropriate decimal handling for amount comparison.

Where transaction data is available, also verify:

- successful transaction state;
- transaction ID has not been attached to another order;
- payment type is expected;
- transaction amount and currency match;
- transaction belongs to the expected merchant.

If any field conflicts, do not fulfil automatically. Record a reconciliation error for manual review.

---

## 16. Redirect handling

Hosted Checkout can receive a `redirect_url`.

After payment, SumUp’s customer-facing page may offer a route back to the application.

The redirect is for user experience only.

On return:

1. read an internal, unguessable order reference from the application state or URL;
2. request the current internal order status;
3. optionally trigger a server-side SumUp verification if still pending;
4. show paid, pending, failed, or expired UI;
5. never mark paid based on redirect query parameters.

Recommended user states:

```text
Confirming payment…
Payment received
Payment still processing
Payment unsuccessful
Payment session expired
We could not confirm this payment
```

---

## 17. Idempotency and duplicate prevention

The agent must prevent duplicate SumUp checkouts caused by:

- double-clicking;
- page refresh;
- client retries;
- network timeouts;
- serverless retries;
- repeated job execution.

### Internal idempotency strategy

Create the order first and use a unique checkout reference derived from it:

```text
order_<internal-order-id>
```

Before creating a checkout:

1. load the order;
2. check whether it already has a usable pending SumUp checkout;
3. reuse that checkout if appropriate;
4. otherwise create exactly one replacement under a database lock;
5. persist the SumUp checkout ID before responding.

Do not automatically retry an ambiguous `POST /checkouts` failure without first checking whether a checkout was created. Use the unique checkout reference to reconcile via supported listing/retrieval methods.

---

## 18. Retry and timeout policy

Use explicit request timeouts:

```ts
signal: AbortSignal.timeout(20_000)
```

Retry selectively:

- network connection failures;
- `408`;
- `429`, respecting retry guidance;
- selected `5xx` responses.

Do not blindly retry:

- `400`;
- `401`;
- `403`;
- malformed checkout requests;
- payment failures;
- an ambiguous checkout-creation request without idempotency/reconciliation.

Suggested backoff:

```text
Attempt 1: immediate
Attempt 2: after 1 second
Attempt 3: after 2 seconds
Attempt 4: after 4 seconds
```

Use jitter.

Limit retries to prevent accidental duplicate payment sessions and provider overload.

---

## 19. Error mapping

Suggested application error codes:

```text
INVALID_ORDER
ORDER_ALREADY_PAID
ORDER_NOT_PAYABLE
SUMUP_CONFIGURATION_ERROR
SUMUP_AUTHENTICATION_FAILED
SUMUP_RATE_LIMITED
SUMUP_REQUEST_REJECTED
SUMUP_UNAVAILABLE
SUMUP_TIMEOUT
SUMUP_MALFORMED_RESPONSE
CHECKOUT_EXPIRED
PAYMENT_FAILED
PAYMENT_NOT_CONFIRMED
REFUND_FAILED
RECONCILIATION_REQUIRED
```

Suggested HTTP mapping:

| Situation | Application response |
|---|---:|
| Invalid input/order | `400` |
| Not authenticated | `401` |
| Not allowed to pay/refund order | `403` |
| Order not found | `404` |
| Duplicate/conflicting order action | `409` |
| Local rate limit | `429` |
| SumUp auth failure | `502` and operational alert |
| SumUp rate limit | `503` or `429` |
| SumUp validation rejection | `422` or safe mapped response |
| SumUp timeout/unavailable | `502`/`504` |
| Reconciliation mismatch | `409` or internal review state |

Do not return raw SumUp responses, credentials, or stack traces to the browser.

---

## 20. Refunds

Official refund guide:

<https://developer.sumup.com/online-payments/guides/refund/>

Support refunds only through authenticated, authorized server routes.

Required sequence:

```text
1. Load paid internal order.
2. Retrieve authoritative transaction.
3. Verify refund eligibility.
4. Create internal refund request.
5. Call SumUp refund endpoint.
6. Record provider response.
7. Re-retrieve/reconcile transaction.
8. update order/refund state;
9. revoke or adjust fulfilment where applicable;
10. maintain an audit log.
```

Support:

- full refunds;
- partial refunds only where SumUp and the product rules support them;
- cumulative-refund checks so the total never exceeds the captured amount.

Never let the browser provide an arbitrary transaction ID without matching it to an order the operator is authorized to refund.

Suggested internal refund statuses:

```text
REQUESTED
PROCESSING
SUCCEEDED
FAILED
REQUIRES_REVIEW
```

---

## 21. Reconciliation

Webhooks can be delayed, duplicated, or missed.

Run a scheduled reconciliation job for:

- pending orders older than a few minutes;
- ambiguous API failures;
- paid orders without transaction IDs;
- refund requests not yet final;
- checkout amount/reference mismatches.

Suggested schedule:

```text
Every 5 minutes:
  reconcile recent pending and ambiguous orders

Daily:
  reconcile the prior several days of transactions and refunds
```

The job should retrieve SumUp data and safely update internal state.

Do not notify or fulfil twice.

---

## 22. Security requirements

Implement all of the following:

- API key only in server-side secret storage.
- Separate sandbox and production credentials.
- No `NEXT_PUBLIC_` prefix for secret keys.
- Strict server-side amount calculation.
- Authentication and authorization around orders and refunds.
- HTTPS production webhook and redirect URLs.
- Input validation with bounded string lengths.
- Request-body size limits.
- Rate limiting for checkout creation.
- Database uniqueness constraints.
- Idempotent webhook handling.
- Authoritative checkout retrieval after webhook.
- Redacted logs.
- Dependency and secret scanning.
- Audit logging for refunds and manual payment changes.
- Content Security Policy appropriate to the chosen checkout method.
- No card details stored by the application.
- No raw card details passed through the application when using Hosted Checkout.

### Logging rules

Safe fields to log:

```text
internal order ID
SumUp checkout ID
checkout reference
normalized state
HTTP status
request correlation ID
timing
```

Do not log:

```text
API key
authorization header
full payment instrument/card data
customer secrets
unredacted personal data
complete raw provider payloads by default
```

---

## 23. Production architecture

Recommended modules:

```text
lib/payments/
  sumup-env.ts
  sumup-client.ts
  sumup-types.ts
  sumup-errors.ts
  order-service.ts
  payment-verification.ts
  refund-service.ts
  reconciliation.ts

app/api/payments/sumup/checkout/route.ts
app/api/payments/sumup/orders/[orderId]/route.ts
app/api/payments/sumup/orders/[orderId]/refund/route.ts
app/api/webhooks/sumup/route.ts
app/payment/return/page.tsx
```

Recommended separation:

```ts
interface PaymentProvider {
  createCheckout(
    input: CreatePaymentCheckoutInput,
  ): Promise<CreatedPaymentCheckout>;

  retrieveCheckout(
    providerCheckoutId: string,
  ): Promise<ProviderCheckout>;

  refund(
    input: RefundPaymentInput,
  ): Promise<ProviderRefund>;
}
```

Do not spread raw SumUp response shapes throughout UI and business logic.

---

## 24. Example checkout service

```ts
import crypto from "node:crypto";
import { createHostedCheckout } from "./sumup-client";

export async function beginOrderPayment(orderId: string) {
  return database.transaction(async (transaction) => {
    const order = await transaction.orders.lockForUpdate(orderId);

    if (!order) {
      throw new Error("Order not found");
    }

    if (order.status === "PAID") {
      throw new Error("Order is already paid");
    }

    if (
      order.status === "PAYMENT_PENDING" &&
      order.sumupCheckoutId &&
      order.sumupHostedCheckoutUrl &&
      order.expiresAt &&
      order.expiresAt > new Date()
    ) {
      return {
        orderId: order.id,
        checkoutUrl: order.sumupHostedCheckoutUrl,
      };
    }

    const checkoutReference =
      order.sumupCheckoutReference ??
      `order_${order.id}_${crypto.randomUUID()}`;

    const checkout = await createHostedCheckout({
      amount: order.amountMinor / 100,
      currency: "GBP",
      checkoutReference,
      description: `Order ${order.id}`,
      returnUrl: process.env.SUMUP_WEBHOOK_URL!,
      redirectUrl:
        `${process.env.SUMUP_CHECKOUT_RETURN_URL!}` +
        `?order=${encodeURIComponent(order.publicReference)}`,
    });

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await transaction.orders.update(order.id, {
      status: "PAYMENT_PENDING",
      sumupCheckoutReference: checkoutReference,
      sumupCheckoutId: checkout.id,
      sumupCheckoutStatus: checkout.status,
      sumupHostedCheckoutUrl: checkout.hosted_checkout_url!,
      expiresAt,
    });

    return {
      orderId: order.id,
      checkoutUrl: checkout.hosted_checkout_url!,
    };
  });
}
```

Adapt this example to the actual database ORM and avoid performing a long external API call inside a database transaction if the database cannot safely support that pattern.

A robust alternative is a reservation/outbox state machine:

```text
CHECKOUT_CREATION_RESERVED
CHECKOUT_CREATING
PAYMENT_PENDING
```

---

## 25. Webhook verification worker

```ts
import { retrieveCheckout } from "./sumup-client";

export async function verifySumUpCheckout(
  sumupCheckoutId: string,
): Promise<void> {
  const checkout = await retrieveCheckout(sumupCheckoutId);

  await database.transaction(async (transaction) => {
    const order =
      await transaction.orders.lockBySumUpCheckoutId(sumupCheckoutId);

    if (!order) {
      await transaction.paymentAnomalies.insert({
        type: "UNKNOWN_SUMUP_CHECKOUT",
        providerReference: sumupCheckoutId,
      });
      return;
    }

    assertCheckoutMatchesOrder(checkout, order);

    if (checkout.status === "PAID") {
      if (order.status === "PAID") {
        return;
      }

      await transaction.orders.update(order.id, {
        status: "PAID",
        sumupCheckoutStatus: "PAID",
        paidAt: new Date(),
      });

      await transaction.outbox.insert({
        type: "ORDER_PAID",
        aggregateId: order.id,
        idempotencyKey: `order-paid:${order.id}`,
      });

      return;
    }

    const nextStatus = {
      PENDING: "PAYMENT_PENDING",
      FAILED: "PAYMENT_FAILED",
      EXPIRED: "PAYMENT_EXPIRED",
    }[checkout.status];

    if (nextStatus) {
      await transaction.orders.update(order.id, {
        status: nextStatus,
        sumupCheckoutStatus: checkout.status,
      });
    }
  });
}
```

---

## 26. Testing requirements

### Unit tests

Test:

- minor-unit to major-unit conversion;
- server-side price lookup;
- checkout-reference generation;
- SumUp response parsing;
- status mapping;
- amount/currency/reference validation;
- duplicate checkout prevention;
- exactly-once fulfilment;
- error mapping;
- refund cumulative limits.

### API integration tests with mocked SumUp

Mock:

- checkout created successfully;
- missing `hosted_checkout_url`;
- `400` validation response;
- `401` invalid key;
- `403`;
- `429`;
- `500`;
- timeout;
- malformed JSON;
- malformed successful response;
- checkout `PENDING`;
- checkout `PAID`;
- checkout `FAILED`;
- checkout `EXPIRED`;
- unknown future status/event.

### Webhook tests

Verify:

- invalid JSON returns safely;
- unknown event is acknowledged;
- known event enqueues verification;
- duplicate webhook is harmless;
- event does not directly mark order paid;
- SumUp retrieval is required before fulfilment;
- mismatched amount blocks fulfilment;
- mismatched merchant blocks fulfilment;
- already-paid order is not fulfilled twice;
- handler responds quickly.

### Browser/end-to-end tests

Verify:

- checkout button creates one order;
- double-click creates one checkout;
- customer is redirected only to expected SumUp HTTPS URL;
- return page displays pending while verification runs;
- successful sandbox payment grants exactly one entitlement;
- failed payment grants none;
- expired checkout can be replaced safely;
- refresh does not create a duplicate checkout.

---

## 27. Mandatory sandbox smoke tests

Complete all of these before live mode:

1. Normal successful GBP payment.
2. Documented sandbox failure using amount `11.00 GBP`.
3. Dedicated declined test card.
4. 3-D Secure success scenario.
5. 3-D Secure failure/cancellation scenario.
6. Customer abandons Hosted Checkout.
7. Hosted Checkout expires after its validity window.
8. Webhook delivered once.
9. Identical webhook delivered repeatedly.
10. Webhook arrives before browser redirect.
11. Browser redirect arrives before webhook.
12. Webhook endpoint temporarily returns `500`, followed by retry.
13. SumUp retrieval temporarily times out.
14. Checkout amount mismatch in a mocked test.
15. Checkout merchant mismatch in a mocked test.
16. Double-click checkout creation.
17. Refund of a successful payment.
18. Partial refund, if the product will expose it.
19. Production key cannot be loaded in test environment.
20. Secret key does not appear in browser bundles or logs.

---

## 28. Live-mode rollout

Before switching to live credentials:

- finish SumUp merchant verification;
- confirm live merchant code;
- create a dedicated live API key;
- store it in the production secret manager;
- configure production HTTPS webhook URL;
- configure production redirect URL;
- verify UK pricing and settlement terms;
- confirm product/service eligibility under SumUp’s terms;
- enable operational alerting;
- enable reconciliation jobs;
- enable refund access controls;
- document customer-support procedures;
- prepare a rollback/disable-payment switch.

Begin with a low-value real payment using an authorized card and immediately reconcile:

```text
internal order
SumUp checkout
SumUp transaction
SumUp Dashboard
expected fee
payout/reporting
refund behavior
```

Do not use live mode for automated test suites.

---

## 29. Operational alerts

Alert on:

- API authentication failures;
- webhook verification backlog;
- provider `5xx` spike;
- repeated `429` responses;
- paid checkout with no matching order;
- amount/currency/merchant mismatch;
- orders pending beyond expected duration;
- refund failures;
- reconciliation drift;
- duplicate transaction association;
- secret detection.

Track metrics:

```text
checkout creation success rate
checkout creation latency
payment completion rate
webhook delivery-to-verification latency
pending-order age
refund success rate
provider error rate
reconciliation corrections
```

---

## 30. Compliance and product restrictions

The coding agent must not claim that integrating Hosted Checkout alone satisfies every legal, regulatory, tax, privacy, or accounting obligation.

The product owner must review:

- SumUp merchant and acceptable-use terms;
- business eligibility;
- refund policy;
- privacy notice;
- customer terms;
- VAT/tax treatment;
- digital-content cancellation rights where relevant;
- record retention;
- chargeback handling;
- prohibited products/services;
- countries from which payments will be accepted.

SumUp terms and legal pages vary by country. Use the correct UK/current terms for the merchant account.

---

## 31. Useful official links

### Core developer resources

- Developer portal:  
  <https://developer.sumup.com/>

- Getting started:  
  <https://developer.sumup.com/getting-started/>

- Online Payments overview:  
  <https://developer.sumup.com/online-payments/>

- API reference:  
  <https://developer.sumup.com/api/>

- Checkouts API:  
  <https://developer.sumup.com/api/checkouts/create>

- Hosted Checkout:  
  <https://developer.sumup.com/online-payments/checkouts/hosted-checkout/>

- Payment Widget:  
  <https://developer.sumup.com/online-payments/checkouts/card-widget/>

- Webhooks:  
  <https://developer.sumup.com/online-payments/webhooks/>

- Testing online payments:  
  <https://developer.sumup.com/online-payments/testing/>

- Refunds:  
  <https://developer.sumup.com/online-payments/guides/refund/>

### Authentication

- Authorization overview:  
  <https://developer.sumup.com/tools/authorization/>

- API keys:  
  <https://developer.sumup.com/tools/authorization/api-keys/>

- OAuth 2.0:  
  <https://developer.sumup.com/tools/authorization/oauth/>

### Account and commercial information

- SumUp Dashboard:  
  <https://me.sumup.com/>

- Developer settings:  
  <https://me.sumup.com/settings/developer>

- UK pricing:  
  <https://www.sumup.com/en-gb/pricing/>

- UK online payments:  
  <https://www.sumup.com/en-gb/online-payments/>

- SumUp system status:  
  <https://status.sumup.com/>

### Card-present alternatives

- Terminal Payments overview:  
  <https://developer.sumup.com/terminal-payments/>

- Cloud API:  
  <https://developer.sumup.com/terminal-payments/cloud-api/>

- Payment Switch:  
  <https://developer.sumup.com/terminal-payments/payment-switch/>

---

## 32. Agent completion criteria

The integration is complete only when:

- a sandbox merchant exists;
- a sandbox API key is stored server-side;
- live and sandbox configuration are separate;
- the merchant code is verified;
- internal orders use integer minor units;
- the server calculates payment amounts authoritatively;
- Hosted Checkout is created server-side;
- the SumUp checkout ID and unique reference are persisted;
- the customer is redirected to `hosted_checkout_url`;
- webhook notifications are acknowledged quickly;
- every webhook triggers authoritative SumUp retrieval;
- payment fulfilment is exactly-once;
- amount, currency, merchant, reference, and checkout ID are verified;
- duplicate checkout creation is prevented;
- expired and abandoned checkouts are handled;
- refunds are authorized and audited;
- reconciliation exists for missed/ambiguous events;
- all required tests pass;
- sandbox success, failure, 3DS, duplicate webhook, expiry, and refund flows pass;
- no secret appears in client code, logs, tests, fixtures, screenshots, or source control;
- the first live payment is manually reconciled before broad rollout.

---

## 33. Final implementation directive

Build the first version using **SumUp Hosted Checkout with an API key for one merchant**.

Do not:

- collect raw card details in the application;
- trust amounts sent by the browser;
- mark an order paid from a redirect;
- mark an order paid directly from an unverified webhook body;
- create duplicate checkouts on retries;
- expose the SumUp secret key;
- assume webhooks are delivered exactly once;
- assume the current UK fee applies forever or in every country;
- implement OAuth unless the application is acting for multiple merchants;
- implement card-reader APIs unless the requirement is explicitly card-present.

Keep SumUp behind a provider adapter so the application can change payment providers without rewriting order, entitlement, refund, and reconciliation logic.
