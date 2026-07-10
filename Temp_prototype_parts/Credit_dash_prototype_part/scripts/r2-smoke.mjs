import { randomUUID } from "node:crypto";

import {
  deleteR2Object,
  headR2Object,
  putR2Object,
  toSafeR2ErrorCode,
} from "../lib/r2/r2-client.mjs";
import { getR2Environment, isR2Enabled } from "../lib/r2/r2-env.mjs";
import { loadEnvLocal } from "./load-env-local.mjs";

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

const key = `smoke/${Date.now()}-${randomUUID()}/placeholder.json`;
const summary = {
  ok: false,
  r2Enabled: true,
  bucket: null,
  key,
  put: false,
  head: false,
  delete: false,
};

try {
  summary.bucket = getR2Environment().bucketName;

  await putR2Object({
    body: "<!doctype html><html><body><p>R2 smoke test object</p></body></html>",
    contentType: "text/html; charset=utf-8",
    key,
    metadata: {
      app: "credit-dashboard-prototype",
      createdby: "r2-smoke",
    },
  });
  summary.put = true;

  const headResult = await headR2Object({ key });
  summary.head = headResult.exists === true;

  const deleteResult = await deleteR2Object({ key });
  summary.delete = deleteResult.ok === true;

  summary.ok = summary.put && summary.head && summary.delete;
  console.log(JSON.stringify(summary));
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

  console.error(JSON.stringify(summary));
  process.exit(1);
}
