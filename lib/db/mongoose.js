import { randomUUID } from "node:crypto";

import mongoose from "mongoose";

export const DEFAULT_DATABASE_NAME = "reel_creator";

const globalForMongoose = globalThis;

if (!globalForMongoose.__reelCreatorMongooseCache) {
  globalForMongoose.__reelCreatorMongooseCache = {
    connection: null,
    promise: null,
    transactionProbePromise: null,
  };
}

function getCache() {
  return globalForMongoose.__reelCreatorMongooseCache;
}

export function hasMongoUri() {
  return Boolean(process.env.MONGODB_URI);
}

export function getConfiguredDatabaseName() {
  if (process.env.MONGODB_DB_NAME) {
    return process.env.MONGODB_DB_NAME;
  }

  try {
    const parsedUri = new URL(process.env.MONGODB_URI);
    const databaseName = decodeURIComponent(parsedUri.pathname.replace(/^\/+/, ""));

    return databaseName || DEFAULT_DATABASE_NAME;
  } catch {
    return DEFAULT_DATABASE_NAME;
  }
}

export async function connectToDatabase() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is required to connect to MongoDB.");
  }

  const cache = getCache();

  if (cache.connection) {
    return cache.connection;
  }

  if (!cache.promise) {
    cache.promise = mongoose.connect(process.env.MONGODB_URI, {
      bufferCommands: false,
      dbName: getConfiguredDatabaseName(),
      serverSelectionTimeoutMS: 10000,
    });
  }

  try {
    cache.connection = await cache.promise;
    return cache.connection;
  } catch (error) {
    cache.promise = null;
    throw error;
  }
}

export async function assertTransactionsSupported() {
  const cache = getCache();

  if (!cache.transactionProbePromise) {
    cache.transactionProbePromise = runTransactionProbe().catch((error) => {
      cache.transactionProbePromise = null;
      throw error;
    });
  }

  await cache.transactionProbePromise;

  return true;
}

async function runTransactionProbe() {
  const connection = await connectToDatabase();
  const database = connection.connection?.db;

  if (!database) {
    throw new Error("MongoDB connection did not expose a database handle.");
  }

  const session = await mongoose.startSession();
  const probeId = `txn-probe:${randomUUID()}`;

  try {
    await session.withTransaction(async () => {
      const collection = database.collection("__transaction_probes");
      await collection.insertOne(
        {
          _id: probeId,
          createdAt: new Date(),
        },
        { session },
      );
      await collection.deleteOne({ _id: probeId }, { session });
    });
  } catch (error) {
    const wrappedError = new Error(
      "MongoDB transactions are required for credits. Use MongoDB Atlas or a local replica set, not a standalone mongod.",
    );
    wrappedError.code = "TRANSACTIONS_UNSUPPORTED";
    wrappedError.cause = error;
    throw wrappedError;
  } finally {
    await session.endSession();
  }
}

export async function disconnectFromDatabase() {
  const cache = getCache();
  cache.connection = null;
  cache.promise = null;
  cache.transactionProbePromise = null;
  await mongoose.disconnect();
}
