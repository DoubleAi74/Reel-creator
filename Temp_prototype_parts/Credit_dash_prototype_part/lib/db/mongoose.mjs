import mongoose from "mongoose";

export const DEFAULT_DATABASE_NAME = "credit_dashboard_prototype";

const globalForMongoose = globalThis;

if (!globalForMongoose.mongooseConnectionCache) {
  globalForMongoose.mongooseConnectionCache = {
    connection: null,
    promise: null,
  };
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

  const cache = globalForMongoose.mongooseConnectionCache;

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

export async function disconnectFromDatabase() {
  const cache = globalForMongoose.mongooseConnectionCache;
  cache.connection = null;
  cache.promise = null;
  await mongoose.disconnect();
}
