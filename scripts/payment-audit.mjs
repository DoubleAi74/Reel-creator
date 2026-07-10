import {
  connectToDatabase,
  disconnectFromDatabase,
  hasMongoUri,
} from "../lib/db/mongoose.js";
import { Balance } from "../lib/models/Balance.js";
import { CreditLedger } from "../lib/models/CreditLedger.js";
import { PaymentOrder } from "../lib/models/PaymentOrder.js";
import { RefundRecord } from "../lib/models/RefundRecord.js";
import { WebhookEvent } from "../lib/models/WebhookEvent.js";
import { loadEnvLocal } from "./load-env-local.mjs";

function printHelp() {
  console.log(`Usage: npm run credits:payment-audit

Runs a read-only payment/ledger consistency audit and prints JSON.

Required env:
  MONGODB_URI`);
}

function sumMinor(documents, fieldName) {
  return documents.reduce((sum, document) => {
    const value = document?.[fieldName];

    return sum + (Number.isInteger(value) ? value : 0);
  }, 0);
}

async function countByField(Model, fieldName) {
  const rows = await Model.aggregate([
    {
      $group: {
        _id: `$${fieldName}`,
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return Object.fromEntries(rows.map((row) => [row._id ?? "null", row.count]));
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  printHelp();
  process.exit(0);
}

loadEnvLocal();

if (!hasMongoUri()) {
  console.error("MONGODB_URI is missing. Add it to this project root .env.local.");
  process.exit(1);
}

try {
  await connectToDatabase();

  const [
    balance,
    creditedOrders,
    paidUncreditedOrders,
    creditedButNotPaidOrders,
    topUpLedgers,
    orphanTopUpLedgers,
    statusCounts,
    webhookStatusCounts,
    refundStatusCounts,
  ] = await Promise.all([
    Balance.findById("shared").lean(),
    PaymentOrder.find({ balanceCredited: true }).lean(),
    PaymentOrder.find({ balanceCredited: false, status: "PAID" }).lean(),
    PaymentOrder.find({ balanceCredited: true, status: { $ne: "PAID" } }).lean(),
    CreditLedger.find({ type: "TOP_UP" }).lean(),
    CreditLedger.find({ paymentOrderId: null, type: "TOP_UP" }).lean(),
    countByField(PaymentOrder, "status"),
    countByField(WebhookEvent, "processingStatus"),
    countByField(RefundRecord, "status"),
  ]);

  const topUpLedgerKeys = new Set(
    topUpLedgers.map((ledger) => ledger.idempotencyKey).filter(Boolean),
  );
  const creditedOrdersMissingLedger = creditedOrders.filter(
    (order) => !topUpLedgerKeys.has(`top_up:${order._id.toString()}`),
  );

  console.log(
    JSON.stringify(
      {
        anomalies: {
          creditedButNotPaidOrders: creditedButNotPaidOrders.length,
          creditedOrdersMissingLedger: creditedOrdersMissingLedger.length,
          orphanTopUpLedgers: orphanTopUpLedgers.length,
          paidUncreditedOrders: paidUncreditedOrders.length,
        },
        balanceMinor: balance?.amountMinor ?? null,
        ledger: {
          topUpCount: topUpLedgers.length,
          topUpMinor: sumMinor(topUpLedgers, "amountMinor"),
        },
        orders: {
          creditedCount: creditedOrders.length,
          creditedMinor: sumMinor(creditedOrders, "amountMinor"),
          statusCounts,
        },
        refunds: {
          statusCounts: refundStatusCounts,
        },
        webhookEvents: {
          statusCounts: webhookStatusCounts,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await disconnectFromDatabase();
}
