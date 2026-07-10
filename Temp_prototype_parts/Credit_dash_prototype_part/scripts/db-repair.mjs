import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import mongoose from "mongoose";

import { Balance } from "../lib/models/Balance.mjs";
import { Card } from "../lib/models/Card.mjs";
import { PaymentOrder } from "../lib/models/PaymentOrder.mjs";
import {
  connectToDatabase,
  disconnectFromDatabase,
  getConfiguredDatabaseName,
  hasMongoUri,
} from "../lib/db/mongoose.mjs";

const LEGACY_DATABASE_NAME = "test";

const collectionMigrations = [
  {
    legacyName: "cards",
    model: Card,
  },
  {
    legacyName: "balances",
    model: Balance,
  },
  {
    legacyName: "paymentorders",
    model: PaymentOrder,
  },
];

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

async function collectionExists(database, collectionName) {
  const collections = await database
    .listCollections({ name: collectionName }, { nameOnly: true })
    .toArray();

  return collections.length > 0;
}

async function countIfExists(database, collectionName) {
  if (!(await collectionExists(database, collectionName))) {
    return 0;
  }

  return database.collection(collectionName).countDocuments({});
}

async function copyLegacyCollectionIfNeeded({
  legacyDatabase,
  legacyName,
  targetDatabase,
  targetName,
}) {
  const targetCount = await countIfExists(targetDatabase, targetName);
  const sourceCount = await countIfExists(legacyDatabase, legacyName);

  if (targetCount > 0 || sourceCount === 0) {
    return {
      copied: 0,
      sourceCount,
      targetCount,
      targetName,
    };
  }

  const sourceDocuments = await legacyDatabase
    .collection(legacyName)
    .find({})
    .toArray();

  if (sourceDocuments.length > 0) {
    await targetDatabase.collection(targetName).insertMany(sourceDocuments, {
      ordered: false,
    });
  }

  return {
    copied: sourceDocuments.length,
    sourceCount,
    targetCount,
    targetName,
  };
}

async function replaceOptionalUniqueIndex(collection, fieldName) {
  const indexName = `${fieldName}_1`;
  const indexes = await collection.indexes().catch(() => []);
  const existingIndex = indexes.find((index) => index.name === indexName);
  const expectedFilter = {
    [fieldName]: {
      $type: "string",
    },
  };

  if (existingIndex) {
    const currentFilter = JSON.stringify(existingIndex.partialFilterExpression);
    const nextFilter = JSON.stringify(expectedFilter);

    if (currentFilter !== nextFilter || existingIndex.sparse) {
      await collection.dropIndex(indexName);
    }
  }

  await collection.createIndex(
    {
      [fieldName]: 1,
    },
    {
      name: indexName,
      partialFilterExpression: expectedFilter,
      unique: true,
    },
  );
}

async function repairPaymentOrderNullsAndIndexes() {
  const collection = PaymentOrder.collection;

  await PaymentOrder.createCollection();

  const unsetCheckoutIds = await collection.updateMany(
    { sumupCheckoutId: null },
    { $unset: { sumupCheckoutId: "" } },
  );
  const unsetTransactionIds = await collection.updateMany(
    { sumupTransactionId: null },
    { $unset: { sumupTransactionId: "" } },
  );

  await replaceOptionalUniqueIndex(collection, "sumupCheckoutId");
  await replaceOptionalUniqueIndex(collection, "sumupTransactionId");

  await Promise.all([Card.init(), Balance.init(), PaymentOrder.init()]);

  return {
    unsetCheckoutIds: unsetCheckoutIds.modifiedCount,
    unsetTransactionIds: unsetTransactionIds.modifiedCount,
  };
}

loadEnvLocal();

if (!hasMongoUri()) {
  console.error("MONGODB_URI is missing. Add it to this project root .env.local.");
  process.exit(1);
}

try {
  await connectToDatabase();

  const targetDatabase = mongoose.connection.db;
  const targetDatabaseName = getConfiguredDatabaseName();
  const legacyDatabase = mongoose.connection.client.db(LEGACY_DATABASE_NAME);
  const migratedCollections = [];

  if (targetDatabaseName !== LEGACY_DATABASE_NAME) {
    for (const migration of collectionMigrations) {
      migratedCollections.push(
        await copyLegacyCollectionIfNeeded({
          legacyDatabase,
          legacyName: migration.legacyName,
          targetDatabase,
          targetName: migration.model.collection.name,
        }),
      );
    }
  }

  const repairedPaymentOrders = await repairPaymentOrderNullsAndIndexes();

  console.log(
    JSON.stringify({
      connected: true,
      migratedCollections,
      repairedPaymentOrders,
      targetCollections: {
        balance: Balance.collection.name,
        cards: Card.collection.name,
        paymentOrders: PaymentOrder.collection.name,
      },
      targetDatabase: targetDatabaseName,
    }),
  );
} finally {
  await disconnectFromDatabase();
}
