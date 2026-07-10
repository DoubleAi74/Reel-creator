/**
 * Read-only payment failure diagnostics.
 *
 * Lists recent PaymentOrders + related WebhookEvents, then (when possible)
 * re-fetches the SumUp checkout so you can compare Mongo vs live API status
 * and transaction-level fields (status, codes) without exposing secrets.
 *
 * Usage:
 *   npm run credits:payment-inspect
 *   npm run credits:payment-inspect -- --limit 10
 *   npm run credits:payment-inspect -- --order order_xxxxxxxx
 *   npm run credits:payment-inspect -- --checkout <sumupCheckoutId>
 *   npm run credits:payment-inspect -- --status PAYMENT_FAILED
 *   npm run credits:payment-inspect -- --no-sumup   # Mongo only
 *
 * Required env (from .env.local or process):
 *   MONGODB_URI
 *   SumUp keys only needed unless --no-sumup
 */

import {
  connectToDatabase,
  disconnectFromDatabase,
  hasMongoUri,
} from "../lib/db/mongoose.js";
import { PaymentOrder } from "../lib/models/PaymentOrder.js";
import { WebhookEvent } from "../lib/models/WebhookEvent.js";
import { formatGbpFromMinor } from "../lib/money.js";
import {
  mapCheckoutStatusToOrderStatus,
  majorAmountToMinor,
  verifyPaidCheckout,
} from "../lib/payments/payment-verification.js";
import { retrieveCheckout, SumUpApiError } from "../lib/payments/sumup-client.js";
import { getSumUpEnvironment } from "../lib/payments/sumup-env.js";
import { loadEnvLocal } from "./load-env-local.mjs";

function printHelp() {
  console.log(`Usage: npm run credits:payment-inspect [options]

Read-only inspection of recent top-up orders, webhooks, and live SumUp checkout.

Options:
  --limit N              How many recent orders to list (default 15)
  --order <ref|id>       Inspect one order (publicReference or Mongo _id)
  --checkout <id>        Find order by sumupCheckoutId and refresh from SumUp
  --tx <code>            Find order by sumupTransactionId / code if stored
  --status <STATUS>      Filter list (PAYMENT_FAILED, PAYMENT_PENDING, PAID, ...)
  --no-sumup             Skip SumUp API (Mongo only)
  --json                 Print machine-readable JSON only
  -h, --help             Show this help

Examples:
  npm run credits:payment-inspect
  npm run credits:payment-inspect -- --status PAYMENT_FAILED --limit 5
  npm run credits:payment-inspect -- --order order_665...`);
}

function parseArgs(argv) {
  const options = {
    checkoutId: null,
    json: false,
    limit: 15,
    noSumup: false,
    orderRef: null,
    status: null,
    transactionCode: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--no-sumup") {
      options.noSumup = true;
      continue;
    }

    if (arg === "--limit") {
      options.limit = Math.max(1, Number.parseInt(argv[index + 1] ?? "15", 10) || 15);
      index += 1;
      continue;
    }

    if (arg === "--order") {
      options.orderRef = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === "--checkout") {
      options.checkoutId = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === "--tx") {
      options.transactionCode = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === "--status") {
      options.status = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    console.error(`Unknown argument: ${arg}`);
    printHelp();
    process.exit(1);
  }

  return options;
}

function redactUrl(value) {
  if (typeof value !== "string" || !value) {
    return null;
  }

  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname}${url.pathname}`;
  } catch {
    return "[unparseable-url]";
  }
}

function summarizeEnvironment(environment) {
  return {
    allowTempLiveUrls: environment.ALLOW_TEMP_LIVE_PAYMENT_URLS === true,
    apiBaseHost: new URL(environment.SUMUP_API_BASE_URL).hostname,
    apiKeySource: environment.SUMUP_API_KEY_SOURCE,
    currency: environment.SUMUP_CURRENCY,
    merchantCodePresent: Boolean(environment.SUMUP_MERCHANT_CODE),
    mode: environment.SUMUP_MODE,
    returnUrl: redactUrl(environment.SUMUP_CHECKOUT_RETURN_URL),
    webhookUrl: redactUrl(environment.SUMUP_WEBHOOK_URL),
  };
}

function serializeOrder(order) {
  if (!order) {
    return null;
  }

  return {
    amountDisplay: formatGbpFromMinor(order.amountMinor),
    amountMinor: order.amountMinor,
    balanceCredited: Boolean(order.balanceCredited),
    createdAt: order.createdAt ?? null,
    currency: order.currency,
    description: order.description ?? null,
    expiresAt: order.expiresAt ?? null,
    mongoId: order._id?.toString?.() ?? null,
    orderId: order.publicReference,
    paidAt: order.paidAt ?? null,
    status: order.status,
    sumupCheckoutId: order.sumupCheckoutId ?? null,
    sumupCheckoutReference: order.sumupCheckoutReference ?? null,
    sumupCheckoutStatus: order.sumupCheckoutStatus ?? null,
    sumupHostedCheckoutHost: order.sumupHostedCheckoutUrl
      ? redactUrl(order.sumupHostedCheckoutUrl)
      : null,
    sumupTransactionId: order.sumupTransactionId ?? null,
    updatedAt: order.updatedAt ?? null,
  };
}

function serializeWebhook(event) {
  return {
    checkoutId: event.checkoutId ?? null,
    checkoutReference: event.checkoutReference ?? null,
    createdAt: event.createdAt ?? null,
    eventType: event.eventType ?? null,
    mongoId: event._id?.toString?.() ?? null,
    paymentOrderId: event.paymentOrderId?.toString?.() ?? null,
    processingStatus: event.processingStatus,
    provider: event.provider,
    safeErrorCode: event.safeErrorCode ?? null,
  };
}

function summarizeSumUpCheckout(checkout) {
  if (!checkout) {
    return null;
  }

  const transactions = Array.isArray(checkout.transactions)
    ? checkout.transactions.map((transaction) => ({
        amount: transaction.amount ?? null,
        currency: transaction.currency ?? null,
        entryMode: transaction.entry_mode ?? transaction.entryMode ?? null,
        id: transaction.id ?? null,
        // Common SumUp / acquirer fields when present (passthrough on schema).
        paymentType: transaction.payment_type ?? transaction.paymentType ?? null,
        status: transaction.status ?? null,
        transactionCode:
          transaction.transaction_code ?? transaction.transactionCode ?? null,
        // Keep raw keys (minus huge blobs) for unexpected decline fields.
        extraKeys: Object.keys(transaction).filter(
          (key) =>
            ![
              "amount",
              "currency",
              "id",
              "status",
              "transaction_code",
              "transactionCode",
              "payment_type",
              "paymentType",
              "entry_mode",
              "entryMode",
              "merchant_code",
            ].includes(key),
        ),
      }))
    : [];

  return {
    amount: checkout.amount ?? null,
    amountMinor: majorAmountToMinor(checkout.amount),
    checkoutReference: checkout.checkout_reference ?? null,
    currency: checkout.currency ?? null,
    hostedCheckoutHost: checkout.hosted_checkout_url
      ? redactUrl(checkout.hosted_checkout_url)
      : null,
    id: checkout.id,
    mappedOrderStatus: mapCheckoutStatusToOrderStatus(checkout.status),
    merchantCode: checkout.merchant_code ?? null,
    status: checkout.status,
    transactions,
    validUntil: checkout.valid_until ?? null,
  };
}

async function findOrder(options) {
  if (options.orderRef) {
    const byReference = await PaymentOrder.findOne({
      publicReference: options.orderRef,
    }).lean();

    if (byReference) {
      return byReference;
    }

    if (/^[a-f0-9]{24}$/i.test(options.orderRef)) {
      return PaymentOrder.findById(options.orderRef).lean();
    }

    return null;
  }

  if (options.checkoutId) {
    return PaymentOrder.findOne({
      sumupCheckoutId: options.checkoutId,
    }).lean();
  }

  if (options.transactionCode) {
    return PaymentOrder.findOne({
      sumupTransactionId: options.transactionCode,
    }).lean();
  }

  return null;
}

async function loadWebhooksForOrder(order) {
  if (!order) {
    return [];
  }

  const clauses = [{ paymentOrderId: order._id }];

  if (order.sumupCheckoutId) {
    clauses.push({ checkoutId: order.sumupCheckoutId });
  }

  if (order.sumupCheckoutReference) {
    clauses.push({ checkoutReference: order.sumupCheckoutReference });
  }

  return WebhookEvent.find({ $or: clauses })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();
}

async function inspectOrderAgainstSumUp(order, environment) {
  if (!order?.sumupCheckoutId) {
    return {
      error: "Order has no sumupCheckoutId yet (checkout may never have been attached).",
      liveCheckout: null,
      verification: null,
    };
  }

  try {
    const checkout = await retrieveCheckout(order.sumupCheckoutId);
    const verification =
      checkout.status === "PAID"
        ? verifyPaidCheckout({
            checkout,
            merchantCode: environment.SUMUP_MERCHANT_CODE,
            order,
          })
        : {
            failures: ["status"],
            ok: false,
            note: "Checkout is not PAID — credits must not be granted.",
          };

    return {
      error: null,
      liveCheckout: summarizeSumUpCheckout(checkout),
      verification,
    };
  } catch (error) {
    if (error instanceof SumUpApiError) {
      return {
        error: {
          kind: "sumup_api",
          message: error.message,
          status: error.status,
          bodyKeys:
            error.body && typeof error.body === "object"
              ? Object.keys(error.body)
              : [],
        },
        liveCheckout: null,
        verification: null,
      };
    }

    return {
      error: {
        kind: error?.name ?? "unknown_error",
        message: error instanceof Error ? error.message : String(error),
      },
      liveCheckout: null,
      verification: null,
    };
  }
}

function printHumanReport(report) {
  console.log("=== SumUp environment (no secrets) ===");
  console.log(JSON.stringify(report.environment, null, 2));
  console.log("");

  if (report.focus) {
    console.log("=== Focus order ===");
    console.log(JSON.stringify(report.focus.order, null, 2));
    console.log("");
    console.log("=== Related webhook events ===");
    console.log(JSON.stringify(report.focus.webhooks, null, 2));
    console.log("");
    console.log("=== Live SumUp checkout ===");
    console.log(JSON.stringify(report.focus.sumup, null, 2));
    console.log("");
  }

  console.log("=== Recent payment orders ===");
  console.log(JSON.stringify(report.recentOrders, null, 2));
  console.log("");
  console.log("=== Recent webhook events ===");
  console.log(JSON.stringify(report.recentWebhooks, null, 2));
  console.log("");
  console.log("=== Hints ===");
  for (const hint of report.hints) {
    console.log(`- ${hint}`);
  }
}

const options = parseArgs(process.argv.slice(2));
loadEnvLocal();

if (!hasMongoUri()) {
  console.error("MONGODB_URI is missing. Add it to this project root .env.local.");
  process.exit(1);
}

let environmentSummary = null;
let environment = null;

if (!options.noSumup) {
  try {
    environment = getSumUpEnvironment();
    environmentSummary = summarizeEnvironment(environment);
  } catch (error) {
    console.error(
      "SumUp env could not be loaded:",
      error instanceof Error ? error.message : String(error),
    );
    console.error("Re-run with --no-sumup for Mongo-only inspection.");
    process.exit(1);
  }
} else {
  environmentSummary = {
    mode: "skipped (--no-sumup)",
    note: "Live SumUp re-fetch disabled.",
  };
}

try {
  await connectToDatabase();

  const orderFilter = {};

  if (options.status) {
    orderFilter.status = options.status;
  }

  const recentOrders = await PaymentOrder.find(orderFilter)
    .sort({ createdAt: -1 })
    .limit(options.limit)
    .lean();

  const recentWebhooks = await WebhookEvent.find({})
    .sort({ createdAt: -1 })
    .limit(options.limit)
    .lean();

  let focus = null;
  const wantsFocus =
    options.orderRef || options.checkoutId || options.transactionCode;

  if (wantsFocus) {
    const order = await findOrder(options);

    if (!order) {
      console.error("No PaymentOrder matched the given --order/--checkout/--tx.");
      process.exit(2);
    }

    const webhooks = await loadWebhooksForOrder(order);
    const sumup =
      !options.noSumup && environment
        ? await inspectOrderAgainstSumUp(order, environment)
        : {
            error: null,
            liveCheckout: null,
            verification: null,
            skipped: true,
          };

    focus = {
      order: serializeOrder(order),
      sumup,
      webhooks: webhooks.map(serializeWebhook),
    };
  }

  const hints = [];

  if (environmentSummary?.mode === "live") {
    hints.push("SUMUP_MODE is live — use a real card; test cards will fail.");
  } else if (environmentSummary?.mode === "sandbox") {
    hints.push("SUMUP_MODE is sandbox — use SumUp test cards, not a real bank card / Apple Pay wallet card.");
  }

  hints.push(
    "Credits are only granted when live checkout status is PAID and verifyPaidCheckout passes.",
  );
  hints.push(
    "If SumUp dashboard shows Unsuccessful/FAILED, the app must leave balanceCredited=false.",
  );
  hints.push(
    "Apple Pay declines often appear only on SumUp transaction fields; check liveCheckout.transactions[].",
  );
  hints.push(
    "After your £1 test: npm run credits:payment-inspect -- --limit 5",
  );

  const failedRecent = recentOrders.filter(
    (order) =>
      order.status === "PAYMENT_FAILED" ||
      order.sumupCheckoutStatus === "FAILED",
  );

  if (failedRecent.length > 0) {
    hints.push(
      `Found ${failedRecent.length} failed order(s) in this page — re-run with --order ${failedRecent[0].publicReference} for detail.`,
    );
  }

  const report = {
    environment: environmentSummary,
    focus,
    generatedAt: new Date().toISOString(),
    hints,
    recentOrders: recentOrders.map(serializeOrder),
    recentWebhooks: recentWebhooks.map(serializeWebhook),
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report);
  }
} finally {
  await disconnectFromDatabase();
}
