import { ensureSharedBalance, initializeDatabaseIndexes } from "../lib/db/bootstrap.js";
import {
  disconnectFromDatabase,
  getConfiguredDatabaseName,
  hasMongoUri,
} from "../lib/db/mongoose.js";
import { Balance } from "../lib/models/Balance.js";
import { CreditLedger } from "../lib/models/CreditLedger.js";
import { PaymentOrder } from "../lib/models/PaymentOrder.js";
import { loadEnvLocal } from "./load-env-local.mjs";

function printHelp() {
  console.log(`Usage: npm run credits:ledger-repair -- [--apply]

Finds historical PAID + balanceCredited SumUp orders missing their top_up ledger
entry. By default this is a dry run. Pass --apply to insert missing audit ledger
entries without changing the already-credited balance.

Required env:
  MONGODB_URI`);
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

const apply = process.argv.includes("--apply");
const summary = {
  apply,
  created: 0,
  database: null,
  missing: 0,
  paidCreditedOrders: 0,
  skipped: 0,
};

try {
  await initializeDatabaseIndexes();
  await ensureSharedBalance();
  summary.database = getConfiguredDatabaseName();

  const balance = await Balance.findById("shared").lean();
  const paidOrders = await PaymentOrder.find({
    balanceCredited: true,
    status: "PAID",
  })
    .sort({ paidAt: 1, createdAt: 1 })
    .lean();

  summary.paidCreditedOrders = paidOrders.length;

  for (const order of paidOrders) {
    const idempotencyKey = `top_up:${order._id.toString()}`;
    const existingLedger = await CreditLedger.exists({ idempotencyKey });

    if (existingLedger) {
      summary.skipped += 1;
      continue;
    }

    summary.missing += 1;

    if (!apply) {
      continue;
    }

    await CreditLedger.create({
      amountMinor: order.amountMinor,
      balanceAfterMinor: balance.amountMinor,
      createdAt: order.paidAt ?? order.updatedAt ?? order.createdAt ?? new Date(),
      currency: order.currency,
      idempotencyKey,
      metadata: {
        checkoutId: order.sumupCheckoutId,
        checkoutReference: order.sumupCheckoutReference,
        repairedHistoricalEntry: true,
      },
      paymentOrderId: order._id,
      reason: "Historical verified top-up ledger repair",
      type: "TOP_UP",
    });

    summary.created += 1;
  }

  console.log(JSON.stringify(summary, null, 2));
} finally {
  await disconnectFromDatabase();
}
