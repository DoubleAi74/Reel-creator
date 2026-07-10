import { randomUUID } from "node:crypto";

import { minorToMajorUnit } from "../lib/money.js";
import {
  createHostedCheckout,
  retrieveCheckout,
} from "../lib/payments/sumup-client.js";
import { getSumUpEnvironment } from "../lib/payments/sumup-env.js";
import { loadEnvLocal } from "./load-env-local.mjs";

function printHelp() {
  console.log(`Usage: npm run credits:sumup-smoke

Creates and retrieves a GBP 1.00 hosted checkout through SumUp. Use sandbox
credentials unless you intentionally want a live checkout.

Required env:
  SUMUP_MODE
  SUMUP_API_KEY or SUMUP_API_KEY_TEST/SUMUP_API_KEY_LIVE
  SUMUP_MERCHANT_CODE or SUMUP_MERCHANT_CODE_TEST/SUMUP_MERCHANT_CODE_LIVE
  SUMUP_CHECKOUT_RETURN_URL
  SUMUP_WEBHOOK_URL`);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  printHelp();
  process.exit(0);
}

loadEnvLocal();

const environment = getSumUpEnvironment();
const checkoutReference = `reel_creator_smoke_${Date.now()}_${randomUUID().slice(0, 8)}`;
const checkout = await createHostedCheckout({
  amount: minorToMajorUnit(100),
  checkoutReference,
  currency: "GBP",
  description: "Reel Creator credit dashboard smoke",
  redirectUrl: environment.SUMUP_CHECKOUT_RETURN_URL,
  returnUrl: environment.SUMUP_WEBHOOK_URL,
});
const retrievedCheckout = await retrieveCheckout(checkout.id);

console.log(
  JSON.stringify(
    {
      checkoutIdPresent: Boolean(checkout.id),
      createdStatus: checkout.status,
      hostedCheckoutHost: new URL(checkout.hosted_checkout_url).hostname,
      referenceMatches: retrievedCheckout.checkout_reference === checkoutReference,
      retrievedAmount: retrievedCheckout.amount,
      retrievedCurrency: retrievedCheckout.currency,
      retrievedStatus: retrievedCheckout.status,
      sumupMode: environment.SUMUP_MODE,
    },
    null,
    2,
  ),
);
