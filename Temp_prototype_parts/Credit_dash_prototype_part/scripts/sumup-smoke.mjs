import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { minorToMajorUnit } from "../lib/money.js";
import {
  createHostedCheckout,
  retrieveCheckout,
} from "../lib/payments/sumup-client.mjs";
import { getSumUpEnvironment } from "../lib/payments/sumup-env.mjs";

function loadEnvLocal() {
  const envPath = resolve(process.cwd(), ".env.local");

  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const rawValue = trimmedLine.slice(separatorIndex + 1).trim();

    if (!key || process.env[key]) {
      continue;
    }

    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

loadEnvLocal();

const environment = getSumUpEnvironment();
const checkoutReference = `adapter_${Date.now()}_${randomUUID().slice(0, 8)}`;
const checkout = await createHostedCheckout({
  amount: minorToMajorUnit(100),
  checkoutReference,
  currency: "GBP",
  description: "Credit dashboard adapter smoke",
  redirectUrl: environment.SUMUP_CHECKOUT_RETURN_URL,
  returnUrl: environment.SUMUP_WEBHOOK_URL,
});
const retrievedCheckout = await retrieveCheckout(checkout.id);

console.log(
  JSON.stringify({
    checkoutIdPresent: Boolean(checkout.id),
    createdStatus: checkout.status,
    hostedCheckoutHost: new URL(checkout.hosted_checkout_url).hostname,
    referenceMatches: retrievedCheckout.checkout_reference === checkoutReference,
    retrievedStatus: retrievedCheckout.status,
    retrievedAmount: retrievedCheckout.amount,
    retrievedCurrency: retrievedCheckout.currency,
  }),
);
