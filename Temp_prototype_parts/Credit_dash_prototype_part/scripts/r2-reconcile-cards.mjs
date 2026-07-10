import {
  connectToDatabase,
  disconnectFromDatabase,
  hasMongoUri,
} from "../lib/db/mongoose.mjs";
import { Card } from "../lib/models/Card.mjs";
import {
  createCardPlaceholderObject,
  deleteCardPlaceholderObject,
} from "../lib/r2/card-r2-lifecycle.mjs";
import { isR2Enabled } from "../lib/r2/r2-env.mjs";
import { loadEnvLocal } from "./load-env-local.mjs";

loadEnvLocal();

if (!hasMongoUri()) {
  console.error("MONGODB_URI is missing. Add it to this project root .env.local.");
  process.exit(1);
}

const summary = {
  r2Enabled: isR2Enabled(),
  createRetried: 0,
  createSucceeded: 0,
  createSkipped: 0,
  createFailed: 0,
  deleteRetried: 0,
  deleteSucceeded: 0,
  deleteFailed: 0,
  permanentlyDeleted: 0,
};

try {
  await connectToDatabase();

  const createCandidates = await Card.find({
    $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    r2Status: { $in: ["pending_create", "create_failed"] },
  }).lean();

  for (const card of createCandidates) {
    summary.createRetried += 1;
    const result = await createCardPlaceholderObject({ card });

    if (result.ok && result.skipped) {
      summary.createSkipped += 1;
    } else if (result.ok) {
      summary.createSucceeded += 1;
    } else {
      summary.createFailed += 1;
    }
  }

  const deleteCandidates = await Card.find({
    deletedAt: { $ne: null },
  }).lean();

  for (const card of deleteCandidates) {
    summary.deleteRetried += 1;
    const result = await deleteCardPlaceholderObject({ card });

    if (result.ok) {
      summary.deleteSucceeded += 1;
      await Card.deleteOne({ _id: card._id });
      summary.permanentlyDeleted += 1;
    } else {
      summary.deleteFailed += 1;
    }
  }

  console.log(JSON.stringify(summary));
} finally {
  await disconnectFromDatabase();
}
