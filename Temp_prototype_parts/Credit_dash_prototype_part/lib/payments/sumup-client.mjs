import { z } from "zod";

import { getSumUpEnvironment } from "./sumup-env.mjs";

const checkoutStatusSchema = z.enum(["PENDING", "FAILED", "PAID", "EXPIRED"]);

const sumupTransactionSchema = z
  .object({
    id: z.string().optional(),
    transaction_code: z.string().optional(),
    amount: z.number().optional(),
    currency: z.string().optional(),
    status: z.string().optional(),
    merchant_code: z.string().optional(),
  })
  .passthrough();

const sumupCheckoutSchema = z
  .object({
    id: z.string().min(1),
    checkout_reference: z.string().optional(),
    amount: z.number().optional(),
    currency: z.string().optional(),
    merchant_code: z.string().optional(),
    status: checkoutStatusSchema,
    hosted_checkout_url: z.string().url().optional(),
    transactions: z.array(sumupTransactionSchema).optional(),
    valid_until: z.string().nullable().optional(),
  })
  .passthrough();

export class SumUpApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "SumUpApiError";
    this.status = status;
    this.body = body;
  }
}

export function isSafeHostedCheckoutUrl(url) {
  try {
    const parsedUrl = new URL(url);

    return (
      parsedUrl.protocol === "https:" &&
      (parsedUrl.hostname === "checkout.sumup.com" ||
        parsedUrl.hostname.endsWith(".checkout.sumup.com"))
    );
  } catch {
    return false;
  }
}

function getHeaders() {
  const environment = getSumUpEnvironment();

  return {
    Accept: "application/json",
    Authorization: `Bearer ${environment.SUMUP_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function readJsonResponse(response) {
  const text = await response.text();
  let body = null;

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

export async function createHostedCheckout(input) {
  const environment = getSumUpEnvironment();
  const response = await fetch(
    `${environment.SUMUP_API_BASE_URL}/v0.1/checkouts`,
    {
      body: JSON.stringify({
        amount: input.amount,
        checkout_reference: input.checkoutReference,
        currency: input.currency,
        description: input.description,
        hosted_checkout: {
          enabled: true,
        },
        merchant_code: environment.SUMUP_MERCHANT_CODE,
        redirect_url: input.redirectUrl,
        return_url: input.returnUrl,
      }),
      cache: "no-store",
      headers: getHeaders(),
      method: "POST",
      signal: AbortSignal.timeout(20000),
    },
  );

  const checkout = sumupCheckoutSchema.parse(await readJsonResponse(response));

  if (!checkout.hosted_checkout_url) {
    throw new Error("SumUp created a checkout without hosted_checkout_url.");
  }

  if (!isSafeHostedCheckoutUrl(checkout.hosted_checkout_url)) {
    throw new Error("SumUp returned an unexpected hosted checkout URL.");
  }

  return checkout;
}

export async function retrieveCheckout(checkoutId) {
  const environment = getSumUpEnvironment();
  const response = await fetch(
    `${environment.SUMUP_API_BASE_URL}/v0.1/checkouts/${encodeURIComponent(
      checkoutId,
    )}`,
    {
      cache: "no-store",
      headers: getHeaders(),
      method: "GET",
      signal: AbortSignal.timeout(20000),
    },
  );

  return sumupCheckoutSchema.parse(await readJsonResponse(response));
}
