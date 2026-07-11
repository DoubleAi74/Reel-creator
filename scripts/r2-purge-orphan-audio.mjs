/**
 * Delete R2 objects that are not tied to a *visible dashboard card*.
 *
 * A visible card (global gallery definition, no session cookie) is a Generation with:
 *   deletedAt: null
 *   saved: true
 *   r2Status: "created" | "not_required"
 *   public: true
 *   userTitled: true
 *
 * Kept R2 keys:
 *   - generations/{id}/audio.mp3 (or generation.r2ObjectKey) for those cards only
 *
 * Deleted by default:
 *   - any other key under generations/
 *   - optionally session-assets/ (not linked to dashboard cards)
 *
 * Usage:
 *   npm run credits:r2-purge-orphans -- --dry-run
 *   npm run credits:r2-purge-orphans -- --execute
 *   npm run credits:r2-purge-orphans -- --execute --include-session-assets
 *
 * Required env (via .env.local or process):
 *   MONGODB_URI
 *   R2_ENABLED=true and R2 credentials (same as other r2 scripts)
 */

import {
  connectToDatabase,
  disconnectFromDatabase,
  hasMongoUri,
} from "../lib/db/mongoose.js";
import { Generation } from "../lib/models/Generation.js";
import { buildGenerationAudioObjectKey } from "../lib/r2/audio-r2-lifecycle.js";
import {
  deleteR2Object,
  listR2KeysByPrefix,
} from "../lib/r2/r2-client.js";
import { isR2Enabled } from "../lib/r2/r2-env.js";
import { loadEnvLocal } from "./load-env-local.mjs";

const GENERATIONS_PREFIX = "generations/";
const SESSION_ASSETS_PREFIX = "session-assets/";

function printHelp() {
  console.log(`Usage:
  npm run credits:r2-purge-orphans -- --dry-run
  npm run credits:r2-purge-orphans -- --execute
  npm run credits:r2-purge-orphans -- --execute --include-session-assets

Deletes R2 objects not associated with a visible dashboard card
(public + userTitled + saved + not deleted + r2Status created|not_required).

Flags:
  --dry-run                 List what would be deleted (default if --execute omitted)
  --execute                 Actually delete orphan keys
  --include-session-assets  Also delete all session-assets/* (background videos, etc.)
  --help                    Show this help

Required env:
  MONGODB_URI
  R2_ENABLED=true
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME`);
}

function parseArgs(argv) {
  const execute = argv.includes("--execute");
  const dryRun = !execute || argv.includes("--dry-run");
  const includeSessionAssets = argv.includes("--include-session-assets");

  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  // If only --execute, dryRun is false; if neither, dry-run mode.
  return {
    dryRun: !execute,
    execute,
    includeSessionAssets,
  };
}

function generationIdFromKey(key) {
  // generations/{id}/audio.mp3  or  generations/{id}/...
  const match = String(key).match(/^generations\/([^/]+)\//);

  return match?.[1] ?? null;
}

function collectKeepKeys(visibleGenerations) {
  const keep = new Set();

  for (const generation of visibleGenerations) {
    const id =
      generation._id?.toString?.() ??
      (typeof generation.id === "string" ? generation.id : null);

    if (typeof generation.r2ObjectKey === "string" && generation.r2ObjectKey.trim()) {
      keep.add(generation.r2ObjectKey.trim());
    }

    if (id) {
      keep.add(buildGenerationAudioObjectKey(id));
    }
  }

  return keep;
}

loadEnvLocal();

const { dryRun, execute, includeSessionAssets } = parseArgs(process.argv.slice(2));

if (!hasMongoUri()) {
  console.error("MONGODB_URI is missing. Add it to this project root .env.local.");
  process.exit(1);
}

if (!isR2Enabled()) {
  console.error("R2 is not enabled. Set R2_ENABLED=true and R2 credentials in .env.local.");
  process.exit(1);
}

const summary = {
  deleted: 0,
  dryRun: !execute,
  failed: 0,
  generationKeysListed: 0,
  keepKeys: 0,
  orphanGenerationKeys: 0,
  orphanSessionKeys: 0,
  sessionKeysListed: 0,
  visibleCards: 0,
};

try {
  await connectToDatabase();

  const visibleCards = await Generation.find({
    deletedAt: null,
    public: true,
    r2Status: { $in: ["created", "not_required"] },
    saved: true,
    userTitled: true,
  })
    .select({ _id: 1, r2ObjectKey: 1, r2Status: 1, title: 1 })
    .lean();

  summary.visibleCards = visibleCards.length;
  const keepKeys = collectKeepKeys(visibleCards);
  summary.keepKeys = keepKeys.size;

  console.log("\n=== Visible dashboard cards (public + titled) ===");
  if (visibleCards.length === 0) {
    console.log("(none) — all generation/* objects will be treated as orphans");
  } else {
    for (const card of visibleCards) {
      const id = card._id.toString();
      const key = card.r2ObjectKey || buildGenerationAudioObjectKey(id);
      console.log(`  - ${id}  "${card.title}"  r2Status=${card.r2Status}  key=${key}`);
    }
  }

  console.log("\n=== Listing R2 keys ===");
  const generationKeys = await listR2KeysByPrefix({
    maxKeys: 1000,
    prefix: GENERATIONS_PREFIX,
  });
  summary.generationKeysListed = generationKeys.length;
  console.log(`  generations/* : ${generationKeys.length} object(s)`);

  let sessionKeys = [];
  if (includeSessionAssets) {
    sessionKeys = await listR2KeysByPrefix({
      maxKeys: 1000,
      prefix: SESSION_ASSETS_PREFIX,
    });
    summary.sessionKeysListed = sessionKeys.length;
    console.log(`  session-assets/* : ${sessionKeys.length} object(s)`);
  } else {
    console.log("  session-assets/* : skipped (pass --include-session-assets to purge)");
  }

  const orphanGenerationKeys = generationKeys.filter((key) => !keepKeys.has(key));
  summary.orphanGenerationKeys = orphanGenerationKeys.length;
  summary.orphanSessionKeys = sessionKeys.length;

  const toDelete = [...orphanGenerationKeys, ...sessionKeys];

  console.log("\n=== Orphans ===");
  console.log(`  keep (visible cards): ${keepKeys.size}`);
  console.log(`  delete generations/* orphans: ${orphanGenerationKeys.length}`);
  if (includeSessionAssets) {
    console.log(`  delete session-assets/*: ${sessionKeys.length}`);
  }
  console.log(`  total delete: ${toDelete.length}`);

  if (toDelete.length > 0) {
    console.log("\nKeys to delete:");
    for (const key of toDelete.slice(0, 200)) {
      const genId = generationIdFromKey(key);
      const kept = keepKeys.has(key);
      console.log(`  ${kept ? "KEEP?" : "DEL "} ${key}${genId ? `  (gen ${genId})` : ""}`);
    }
    if (toDelete.length > 200) {
      console.log(`  … and ${toDelete.length - 200} more`);
    }
  }

  if (!execute) {
    console.log("\nDry run only. Re-run with --execute to delete.");
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  }

  if (toDelete.length === 0) {
    console.log("\nNothing to delete.");
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  }

  console.log("\n=== Deleting ===");
  for (const key of toDelete) {
    try {
      await deleteR2Object({ key });
      summary.deleted += 1;
      console.log(`  deleted ${key}`);
    } catch (error) {
      summary.failed += 1;
      console.error(
        `  FAILED ${key}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  console.log("\n=== Done ===");
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.failed > 0 ? 1 : 0);
} catch (error) {
  console.error(
    "r2-purge-orphan-audio failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
} finally {
  await disconnectFromDatabase().catch(() => {});
}
