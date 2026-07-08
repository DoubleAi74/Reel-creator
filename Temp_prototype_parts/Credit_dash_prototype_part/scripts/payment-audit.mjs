import {
  connectToDatabase,
  disconnectFromDatabase,
  hasMongoUri,
} from "../lib/db/mongoose.mjs";
import { getPaymentAuditSummary } from "../lib/admin/payment-audit.mjs";
import { loadEnvLocal } from "./load-env-local.mjs";

loadEnvLocal();

if (!hasMongoUri()) {
  console.error("MONGODB_URI is missing. Add it to this project root .env.local.");
  process.exit(1);
}

try {
  await connectToDatabase();
  console.log(JSON.stringify(await getPaymentAuditSummary()));
} finally {
  await disconnectFromDatabase();
}
