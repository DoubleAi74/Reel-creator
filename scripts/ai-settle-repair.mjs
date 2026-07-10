import {
  applyManualAdjustment,
  runAiSettleRepair,
  scanUnresolvedAiSettlementCandidates,
} from "../lib/credits/ai-settle-repair.js";
import {
  disconnectFromDatabase,
  getConfiguredDatabaseName,
  hasMongoUri,
} from "../lib/db/mongoose.js";
import { loadEnvLocal } from "./load-env-local.mjs";

function printHelp() {
  console.log(`Usage: npm run credits:ai-settle-repair -- [options]

Remediate transient-error unresolved AI accounting (REP-202 / D-B).
Dry-run by default — pass --apply to re-settle.

Scans:
  - UsageRecord rows with attemptFinal:true, charged:false, rawCostMicros>0
    (failed settlePhase after work completed; not clamp write-offs)
  - Generation documents with accountingStatus:"unresolved"

Re-settle uses settlePhase + idempotency key ai_debit:{jobId}:{phase}
(never double-debits). Clamp write-offs (charged:true + writeOffMinor) are
left alone.

Options:
  --apply                         Write changes (default is dry-run)
  --job-id=<id>                   Limit to one jobId
  --phase=transcribe|enrich|time  Limit to one billing phase
  --limit=<n>                     Max candidates (default 500)
  --manual-adjustment-minor=<n>   Also apply MANUAL_ADJUSTMENT (signed pence)
  --reason=<text>                 Required with manual adjustment
  --idempotency-key=<key>         Optional deterministic key for manual adj
  -h, --help                      Show this help

Required env:
  MONGODB_URI
  (CREDITS_ENABLED is forced on only for re-settle calls; app flag stays yours)

Examples:
  npm run credits:ai-settle-repair
  npm run credits:ai-settle-repair -- --apply
  npm run credits:ai-settle-repair -- --apply --job-id=abc --phase=transcribe
  npm run credits:ai-settle-repair -- --apply --manual-adjustment-minor=-5 --reason="write-off correction"
`);
}

function readArgValue(prefix) {
  const match = process.argv.find((arg) => arg.startsWith(`${prefix}=`));

  if (!match) {
    return null;
  }

  return match.slice(prefix.length + 1);
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

if (hasFlag("--help") || hasFlag("-h")) {
  printHelp();
  process.exit(0);
}

loadEnvLocal();

if (!hasMongoUri()) {
  console.error("MONGODB_URI is missing. Add it to this project root .env.local.");
  process.exit(1);
}

const apply = hasFlag("--apply");
const jobId = readArgValue("--job-id");
const phase = readArgValue("--phase");
const limitRaw = readArgValue("--limit");
const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 500;
const manualAmountRaw = readArgValue("--manual-adjustment-minor");
const reason = readArgValue("--reason");
const idempotencyKey = readArgValue("--idempotency-key");

if (manualAmountRaw != null && (reason == null || !reason.trim())) {
  console.error("--reason is required when using --manual-adjustment-minor.");
  process.exit(1);
}

if (Number.isNaN(limit) || limit < 1) {
  console.error("--limit must be a positive integer.");
  process.exit(1);
}

let manualAdjustment = null;

if (manualAmountRaw != null) {
  const amountMinor = Number.parseInt(manualAmountRaw, 10);

  if (!Number.isInteger(amountMinor) || amountMinor === 0) {
    console.error("--manual-adjustment-minor must be a non-zero integer pence value.");
    process.exit(1);
  }

  manualAdjustment = {
    amountMinor,
    idempotencyKey,
    reason,
  };
}

const summary = {
  apply,
  database: null,
  tool: "ai-settle-repair",
};

try {
  summary.database = getConfiguredDatabaseName();

  // Scan-only path when no manual adj and we only want listing is covered by
  // runAiSettleRepair; always go through the same runner for consistent JSON.
  const result = await runAiSettleRepair({
    apply,
    jobId,
    limit,
    manualAdjustment,
    phase,
  });

  console.log(
    JSON.stringify(
      {
        ...summary,
        ...result,
        // Avoid dumping full usage payloads in CLI output.
        candidates: result.candidates,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
} finally {
  await disconnectFromDatabase();
}

// Re-export helpers for focused unit tests that import the script module.
export {
  applyManualAdjustment,
  runAiSettleRepair,
  scanUnresolvedAiSettlementCandidates,
};
