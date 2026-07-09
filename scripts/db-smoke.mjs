import mongoose from "mongoose";

import { ensureSharedBalance, initializeDatabaseIndexes } from "../lib/db/bootstrap.js";
import {
  assertTransactionsSupported,
  disconnectFromDatabase,
  getConfiguredDatabaseName,
  hasMongoUri,
} from "../lib/db/mongoose.js";
import { Balance } from "../lib/models/Balance.js";
import { CreditLedger } from "../lib/models/CreditLedger.js";
import { Generation } from "../lib/models/Generation.js";
import { PaymentOrder } from "../lib/models/PaymentOrder.js";
import { RefundRecord } from "../lib/models/RefundRecord.js";
import { UsageRecord } from "../lib/models/UsageRecord.js";
import { WebhookEvent } from "../lib/models/WebhookEvent.js";
import { loadEnvLocal } from "./load-env-local.mjs";

function printHelp() {
  console.log(`Usage: npm run credits:db-smoke

Loads .env.local, connects to MongoDB, initializes Phase 2 indexes, verifies
transaction support, and seeds the shared balance if needed.

Required env:
  MONGODB_URI

Optional env:
  MONGODB_DB_NAME
  INITIAL_BALANCE_MINOR`);
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
  await initializeDatabaseIndexes();
  await assertTransactionsSupported();
  const balance = await ensureSharedBalance();

  console.log(
    JSON.stringify(
      {
        balanceAmountMinor: balance.amountMinor,
        balanceSeeded: balance.currency === "GBP",
        collections: {
          balances: Balance.collection.name,
          creditLedger: CreditLedger.collection.name,
          generations: Generation.collection.name,
          paymentOrders: PaymentOrder.collection.name,
          refunds: RefundRecord.collection.name,
          usageRecords: UsageRecord.collection.name,
          webhookEvents: WebhookEvent.collection.name,
        },
        connected: true,
        currency: balance.currency,
        database: getConfiguredDatabaseName(),
        mongooseDatabase: mongoose.connection.name,
        transactionsSupported: true,
      },
      null,
      2,
    ),
  );
} finally {
  await disconnectFromDatabase();
}
