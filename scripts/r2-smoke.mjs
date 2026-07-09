import { randomUUID } from "node:crypto";

import {
  deleteR2Object,
  headR2Object,
  putR2Object,
  toSafeR2ErrorCode,
} from "../lib/r2/r2-client.js";
import { getR2Environment, isR2Enabled } from "../lib/r2/r2-env.js";
import { loadEnvLocal } from "./load-env-local.mjs";

function printHelp() {
  console.log(`Usage: npm run credits:r2-smoke

Creates, HEADs, and deletes a tiny object in the configured R2 bucket.

Required env when R2_ENABLED=true:
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME`);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  printHelp();
  process.exit(0);
}

loadEnvLocal();

if (!isR2Enabled()) {
  console.error(
    JSON.stringify({
      ok: false,
      r2Enabled: false,
      reason:
        "R2_ENABLED is not true. Add R2 credentials to .env.local before running the smoke test.",
    }),
  );
  process.exit(1);
}

const key = `smoke/${Date.now()}-${randomUUID()}/phase-2-credit-dashboard.txt`;
const summary = {
  bucket: null,
  delete: false,
  head: false,
  key,
  ok: false,
  put: false,
  r2Enabled: true,
};

try {
  summary.bucket = getR2Environment().bucketName;

  await putR2Object({
    body: "Reel Creator Phase 2 R2 smoke test",
    contentType: "text/plain; charset=utf-8",
    key,
    metadata: {
      app: "reel-creator",
      createdby: "credits-r2-smoke",
    },
  });
  summary.put = true;

  const headResult = await headR2Object({ key });
  summary.head = headResult.exists === true;

  const deleteResult = await deleteR2Object({ key });
  summary.delete = deleteResult.ok === true;

  summary.ok = summary.put && summary.head && summary.delete;
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.ok ? 0 : 1);
} catch (error) {
  summary.errorCode = toSafeR2ErrorCode(error);

  if (summary.put && !summary.delete) {
    try {
      await deleteR2Object({ key });
      summary.cleanedUp = true;
    } catch {
      summary.cleanedUp = false;
    }
  }

  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}
