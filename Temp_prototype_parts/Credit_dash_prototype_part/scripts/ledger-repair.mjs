import { ensureSharedBalance, initializeDatabaseIndexes } from "../lib/db/bootstrap.mjs";
import {
  disconnectFromDatabase,
  getConfiguredDatabaseName,
  hasMongoUri,
} from "../lib/db/mongoose.mjs";
import { Balance } from "../lib/models/Balance.mjs";
import { CreditLedger } from "../lib/models/CreditLedger.mjs";
import { PaymentOrder } from "../lib/models/PaymentOrder.mjs";
import { loadEnvLocal } from "./load-env-local.mjs";

loadEnvLocal();

if (!hasMongoUri()) {
  console.error("MONGODB_URI is missing. Add it to this project root .env.local.");
  process.exit(1);
}

try {
  await initializeDatabaseIndexes();
  await ensureSharedBalance();

  const balance = await Balance.findById("shared").lean();
  const paidOrders = await PaymentOrder.find({
    balanceCredited: true,
    status: "PAID",
  })
    .sort({ paidAt: 1, createdAt: 1 })
    .lean();

  let created = 0;
  let skipped = 0;

  for (const order of paidOrders) {
    const idempotencyKey = `top_up:${order._id.toString()}`;
    const existingLedger = await CreditLedger.exists({ idempotencyKey });

    if (existingLedger) {
      skipped += 1;
      continue;
    }

    await CreditLedger.create({
      amountMinor: order.amountMinor,
      balanceAfterMinor: balance.amountMinor,
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
      createdAt: order.paidAt ?? order.updatedAt ?? order.createdAt ?? new Date(),
    });

    created += 1;
  }

  console.log(
    JSON.stringify({
      collection: CreditLedger.collection.name,
      created,
      database: getConfiguredDatabaseName(),
      paidCreditedOrders: paidOrders.length,
      skipped,
    }),
  );
} finally {
  await disconnectFromDatabase();
}
