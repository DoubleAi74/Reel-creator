import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import mongoose from "mongoose";

import { ensureSharedBalance, initializeDatabaseIndexes } from "../lib/db/bootstrap.mjs";
import {
  disconnectFromDatabase,
  getConfiguredDatabaseName,
  hasMongoUri,
} from "../lib/db/mongoose.mjs";
import { Balance } from "../lib/models/Balance.mjs";
import { Card } from "../lib/models/Card.mjs";
import { CreditLedger } from "../lib/models/CreditLedger.mjs";
import { PaymentOrder } from "../lib/models/PaymentOrder.mjs";
import { RefundRecord } from "../lib/models/RefundRecord.mjs";
import { WebhookEvent } from "../lib/models/WebhookEvent.mjs";

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

if (!hasMongoUri()) {
  console.error("MONGODB_URI is missing. Add it to this project root .env.local.");
  process.exit(1);
}

try {
  await initializeDatabaseIndexes();
  const balance = await ensureSharedBalance();

  console.log(
    JSON.stringify({
      connected: true,
      balanceSeeded: balance.amountMinor === 500 && balance.currency === "GBP",
      balanceAmountMinor: balance.amountMinor,
      collections: {
        balance: Balance.collection.name,
        cards: Card.collection.name,
        creditLedger: CreditLedger.collection.name,
        paymentOrders: PaymentOrder.collection.name,
        refunds: RefundRecord.collection.name,
        webhookEvents: WebhookEvent.collection.name,
      },
      database: getConfiguredDatabaseName(),
      currency: balance.currency,
      mongooseDatabase: mongoose.connection.name,
    }),
  );
} finally {
  await disconnectFromDatabase();
}
