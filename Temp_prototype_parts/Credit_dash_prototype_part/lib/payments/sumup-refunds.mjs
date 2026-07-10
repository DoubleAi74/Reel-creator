import { z } from "zod";

import { getSumUpEnvironment } from "./sumup-env.mjs";
import { SumUpApiError } from "./sumup-client.mjs";

const refundResponseSchema = z.object({}).passthrough();

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

  return body ?? {};
}

export async function refundTransaction({ amountMajor, transactionId }) {
  if (!transactionId || typeof transactionId !== "string") {
    throw new Error("transactionId is required.");
  }

  if (typeof amountMajor !== "number" || !Number.isFinite(amountMajor)) {
    throw new Error("amountMajor is required.");
  }

  const environment = getSumUpEnvironment();
  const response = await fetch(
    `${environment.SUMUP_API_BASE_URL}/v0.1/me/refund/${encodeURIComponent(
      transactionId,
    )}`,
    {
      body: JSON.stringify({ amount: amountMajor }),
      cache: "no-store",
      headers: getHeaders(),
      method: "POST",
      signal: AbortSignal.timeout(20000),
    },
  );

  return refundResponseSchema.parse(await readJsonResponse(response));
}
