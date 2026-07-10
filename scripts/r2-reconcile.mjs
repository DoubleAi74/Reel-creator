import {
  connectToDatabase,
  disconnectFromDatabase,
  hasMongoUri,
} from "../lib/db/mongoose.js";
import { Generation } from "../lib/models/Generation.js";
import {
  deleteGenerationAudioObject,
  reconcileGenerationAudio,
} from "../lib/r2/audio-r2-lifecycle.js";
import { isR2Enabled } from "../lib/r2/r2-env.js";
import { loadEnvLocal } from "./load-env-local.mjs";

function getLimit() {
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));

  if (!limitArg) {
    return 100;
  }

  const parsedLimit = Number(limitArg.slice("--limit=".length));

  if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
    throw new Error("--limit must be a positive integer.");
  }

  return parsedLimit;
}

function printHelp() {
  console.log(`Usage: npm run credits:r2-reconcile -- [--limit=100] [--dry-run]

Retries generation audio R2 status transitions:
  - pending_create/create_failed: HEADs the expected object and marks created
    when the object exists, or records a safe create_failed code.
  - deletedAt generations: deletes the R2 object first, then hard-deletes the
    Mongo document only after R2 deletion succeeds or is safely skipped.

Required env:
  MONGODB_URI

R2 env is required only when R2_ENABLED=true:
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME`);
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

const dryRun = process.argv.includes("--dry-run");
const limit = getLimit();
const summary = {
  createFailed: 0,
  createRetried: 0,
  createSkipped: 0,
  createSucceeded: 0,
  deleteFailed: 0,
  deleteRetried: 0,
  deleteSucceeded: 0,
  dryRun,
  limit,
  permanentlyDeleted: 0,
  r2Enabled: isR2Enabled(),
};

try {
  await connectToDatabase();

  const createCandidates = await Generation.find({
    $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    r2Status: { $in: ["pending_create", "create_failed"] },
    saved: true,
  })
    .sort({ r2LastAttemptAt: 1, createdAt: 1 })
    .limit(limit)
    .lean();

  for (const generation of createCandidates) {
    summary.createRetried += 1;

    if (dryRun) {
      summary.createSkipped += 1;
      continue;
    }

    const result = await reconcileGenerationAudio({ generation });

    if (result.ok && result.skipped) {
      summary.createSkipped += 1;
    } else if (result.ok) {
      summary.createSucceeded += 1;
    } else {
      summary.createFailed += 1;
    }
  }

  const deleteCandidates = await Generation.find({
    deletedAt: { $ne: null },
  })
    .sort({ deleteRequestedAt: 1, createdAt: 1 })
    .limit(limit)
    .lean();

  for (const generation of deleteCandidates) {
    summary.deleteRetried += 1;

    if (dryRun) {
      continue;
    }

    const result = await deleteGenerationAudioObject({ generation });

    if (result.ok) {
      summary.deleteSucceeded += 1;
      await Generation.deleteOne({ _id: generation._id });
      summary.permanentlyDeleted += 1;
    } else {
      summary.deleteFailed += 1;
    }
  }

  console.log(JSON.stringify(summary, null, 2));
} finally {
  await disconnectFromDatabase();
}
