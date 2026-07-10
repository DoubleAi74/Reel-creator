import mongoose from "mongoose";

import { PRICE_TABLE_VERSION, roundMicrosToPenceHalfUp } from "../ai/openai-pricing.js";
import { initializeDatabaseIndexes } from "../db/bootstrap.js";
import { assertTransactionsSupported, connectToDatabase } from "../db/mongoose.js";
import { getAssetFilePath, readAssetMetadata } from "../files";
import { CreditLedger } from "../models/CreditLedger.js";
import { Generation } from "../models/Generation.js";
import { UsageRecord } from "../models/UsageRecord.js";
import { toProjectJsonValue } from "../project.js";
import {
  buildGenerationAudioObjectKey,
  putGenerationAudioObject,
} from "../r2/audio-r2-lifecycle.js";

const AI_LEDGER_TYPES = ["AI_TRANSCRIBE", "AI_ENRICH", "AI_TIMING"];
const BILLING_PHASES = ["transcribe", "enrich", "time"];

function asTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeObject(value) {
  return value && typeof value === "object" ? value : {};
}

function normalizeSourceType(value) {
  return value === "upload" || value === "youtube" ? value : "unknown";
}

function normalizeFinitePositiveNumber(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeLines(lines) {
  return (Array.isArray(lines) ? lines : []).map((line) => ({
    id: asTrimmedString(line?.id) || crypto.randomUUID(),
    original: typeof line?.original === "string" ? line.original : "",
    quality: line?.quality ?? null,
    romanization: typeof line?.romanization === "string" ? line.romanization : "",
    start: Number.isFinite(line?.start) ? line.start : null,
    translation: typeof line?.translation === "string" ? line.translation : "",
    words: Array.isArray(line?.words) ? line.words : [],
  }));
}

function inferTitle({ assetMetadata, snapshot, title }) {
  const explicitTitle = asTrimmedString(title);

  if (explicitTitle) {
    return explicitTitle.slice(0, 180);
  }

  const snapshotTitle = asTrimmedString(snapshot?.project?.meta?.title);

  if (snapshotTitle) {
    return snapshotTitle.slice(0, 180);
  }

  const assetName = asTrimmedString(assetMetadata?.name).replace(/\.mp3$/i, "");

  return (assetName || "Untitled generation").slice(0, 180);
}

export function buildGenerationSnapshot({
  assetMetadata = {},
  audio = {},
  lines = [],
  result = {},
  sourceLanguage = null,
} = {}) {
  const resultObject = normalizeObject(result);
  const sourceLines = Array.isArray(resultObject.lines) ? resultObject.lines : lines;
  const duration =
    normalizeFinitePositiveNumber(audio?.duration) ??
    normalizeFinitePositiveNumber(assetMetadata?.durationSec) ??
    0;
  const project = toProjectJsonValue({
    audio: {
      duration,
      endOffset: Number.isFinite(audio?.endOffset) ? audio.endOffset : null,
      name: asTrimmedString(assetMetadata?.name),
      startOffset: Number.isFinite(audio?.startOffset) ? audio.startOffset : 0,
    },
    lines: normalizeLines(sourceLines),
  });

  return {
    project,
    result: resultObject,
    sourceLanguage:
      typeof sourceLanguage === "string"
        ? sourceLanguage
        : sourceLanguage?.id ?? sourceLanguage?.label ?? null,
  };
}

function emptyPhaseCosts() {
  return {
    enrich: null,
    time: null,
    transcribe: null,
  };
}

function addPhaseCost(phaseCostsMinor, phase, amountMinor) {
  if (!BILLING_PHASES.includes(phase) || !Number.isInteger(amountMinor)) {
    return;
  }

  phaseCostsMinor[phase] = (phaseCostsMinor[phase] ?? 0) + amountMinor;
}

function summarizeBilling({ ledgerEntries, usageRecords }) {
  const phaseCostsMinor = emptyPhaseCosts();
  const ledgerKeys = [];
  const priceTableVersions = new Set();

  for (const ledgerEntry of ledgerEntries) {
    const phase = ledgerEntry.metadata?.phase;
    const costMinor = Math.abs(ledgerEntry.amountMinor);

    addPhaseCost(phaseCostsMinor, phase, costMinor);

    if (ledgerEntry.idempotencyKey) {
      ledgerKeys.push(ledgerEntry.idempotencyKey);
    }

    if (ledgerEntry.metadata?.priceTableVersion) {
      priceTableVersions.add(ledgerEntry.metadata.priceTableVersion);
    }
  }

  for (const phase of BILLING_PHASES) {
    if (phaseCostsMinor[phase] != null) {
      continue;
    }

    const phaseUsageRecords = usageRecords.filter(
      (record) => record.phase === phase && record.charged === true,
    );

    if (phaseUsageRecords.length === 0) {
      continue;
    }

    const rawCostMicros = phaseUsageRecords.reduce(
      (sum, record) =>
        sum + (Number.isSafeInteger(record.rawCostMicros) ? record.rawCostMicros : 0),
      0,
    );
    phaseCostsMinor[phase] = roundMicrosToPenceHalfUp(rawCostMicros);
  }

  for (const usageRecord of usageRecords) {
    if (usageRecord.priceTableVersion) {
      priceTableVersions.add(usageRecord.priceTableVersion);
    }
  }

  const totalCostMinor = Object.values(phaseCostsMinor).reduce(
    (sum, amountMinor) => sum + (Number.isInteger(amountMinor) ? amountMinor : 0),
    0,
  );

  return {
    ledgerKeys,
    phaseCostsMinor,
    priceTableVersion: [...priceTableVersions][0] ?? PRICE_TABLE_VERSION,
    totalCostMinor,
  };
}

function getJobIds({ finalJobId, jobIds, ledgerEntries, usageRecords }) {
  const ids = new Set(Array.isArray(jobIds) ? jobIds.filter(Boolean) : []);

  for (const ledgerEntry of ledgerEntries) {
    if (ledgerEntry.metadata?.jobId) {
      ids.add(ledgerEntry.metadata.jobId);
    }
  }

  for (const usageRecord of usageRecords) {
    if (usageRecord.jobId) {
      ids.add(usageRecord.jobId);
    }
  }

  if (finalJobId) {
    ids.add(finalJobId);
  }

  return [...ids];
}

function getAccountingStatus({ ledgerEntries, totalCostMinor, usageRecords }) {
  if (ledgerEntries.length > 0 || totalCostMinor > 0) {
    return "settled";
  }

  if (usageRecords.some((record) => record.charged === true)) {
    return "settled";
  }

  return "none";
}

async function runTransaction(callback) {
  await connectToDatabase();
  const session = await mongoose.startSession();

  try {
    let result;
    await session.withTransaction(async () => {
      result = await callback(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export async function persistGeneration({
  assetId,
  audioDurationSeconds = null,
  finalJobId,
  jobIds = [],
  pipelineRunId,
  save = true,
  sessionId,
  snapshot,
  sourceType = null,
  title = "",
} = {}) {
  if (save === false) {
    return {
      generation: null,
      promoted: false,
      saved: false,
    };
  }

  const normalizedPipelineRunId = asTrimmedString(pipelineRunId);
  const normalizedFinalJobId = asTrimmedString(finalJobId);

  if (!normalizedPipelineRunId) {
    throw new Error("pipelineRunId is required to persist a generation.");
  }

  if (!normalizedFinalJobId) {
    throw new Error("finalJobId is required to persist a generation.");
  }

  const assetMetadata =
    sessionId && assetId ? await readAssetMetadata(sessionId, assetId) : null;
  const normalizedSourceType = normalizeSourceType(sourceType ?? assetMetadata?.sourceType);
  const normalizedAudioDurationSeconds =
    normalizeFinitePositiveNumber(audioDurationSeconds) ??
    normalizeFinitePositiveNumber(assetMetadata?.durationSec);
  const generationSnapshot = snapshot ?? {
    project: toProjectJsonValue({
      audio: {
        duration: normalizedAudioDurationSeconds ?? 0,
        name: asTrimmedString(assetMetadata?.name),
      },
      lines: [],
    }),
  };
  // REP-403 / D-C: only an explicit non-empty user title makes a card public.
  // Do not use upload filename / YouTube title as a public title.
  const userTitle = asTrimmedString(title);
  const userTitled = Boolean(userTitle);
  const generationTitle = userTitle || "Untitled generation";
  const isPublic = userTitled;

  await initializeDatabaseIndexes();
  await assertTransactionsSupported();

  // REP-502: keep the session warm and stage source bytes before commit so a
  // post-commit sweep cannot leave a saved generation without R2 audio.
  if (sessionId) {
    try {
      const { touchSession } = await import("../files.js");
      await touchSession(sessionId);
    } catch {
      // best-effort
    }
  }

  let stagedSourcePath = null;
  let stagedContentType = assetMetadata?.mimeType ?? "audio/mpeg";

  if (sessionId && assetId) {
    try {
      const sourcePath = await getAssetFilePath(sessionId, assetId);
      const { copyFile, mkdtemp } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const path = await import("node:path");
      const stageDir = await mkdtemp(path.join(tmpdir(), "reel-gen-audio-"));
      stagedSourcePath = path.join(stageDir, "audio.mp3");
      await copyFile(sourcePath, stagedSourcePath);
    } catch {
      stagedSourcePath = null;
    }
  }

  let generation;

  try {
    generation = await runTransaction(async (mongoSession) => {
      const existingGeneration = await Generation.findOne({
        finalJobId: normalizedFinalJobId,
      })
        .session(mongoSession)
        .lean();

      if (existingGeneration) {
        return existingGeneration;
      }

      const [ledgerEntries, usageRecords] = await Promise.all([
        CreditLedger.find({
          "metadata.pipelineRunId": normalizedPipelineRunId,
          type: { $in: AI_LEDGER_TYPES },
        })
          .sort({ createdAt: 1, _id: 1 })
          .session(mongoSession)
          .lean(),
        UsageRecord.find({ pipelineRunId: normalizedPipelineRunId })
          .sort({ createdAt: 1, _id: 1 })
          .session(mongoSession)
          .lean(),
      ]);
      const billing = summarizeBilling({ ledgerEntries, usageRecords });
      const generationId = new mongoose.Types.ObjectId();
      const r2ObjectKey = buildGenerationAudioObjectKey(generationId.toString());
      const [createdGeneration] = await Generation.create(
        [
          {
            _id: generationId,
            accountingStatus: getAccountingStatus({
              ledgerEntries,
              totalCostMinor: billing.totalCostMinor,
              usageRecords,
            }),
            audioDurationSeconds: normalizedAudioDurationSeconds,
            billing,
            finalJobId: normalizedFinalJobId,
            jobIds: getJobIds({
              finalJobId: normalizedFinalJobId,
              jobIds,
              ledgerEntries,
              usageRecords,
            }),
            pipelineRunId: normalizedPipelineRunId,
            public: isPublic,
            r2ObjectKey,
            r2Status: "pending_create",
            saved: true,
            snapshot: generationSnapshot,
            sourceType: normalizedSourceType,
            title: generationTitle,
            userTitled,
          },
        ],
        { session: mongoSession },
      );

      if (ledgerEntries.length > 0) {
        await CreditLedger.updateMany(
          { _id: { $in: ledgerEntries.map((entry) => entry._id) } },
          { $set: { generationId } },
          { session: mongoSession },
        );
      }

      return createdGeneration.toObject();
    });
  } catch (error) {
    // REP-501: concurrent persist for the same finalJobId — return existing.
    if (error?.code === 11000 || error?.codeName === "DuplicateKey") {
      const existing = await Generation.findOne({
        finalJobId: normalizedFinalJobId,
      }).lean();

      if (existing) {
        generation = existing;
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  }

  if (sessionId) {
    try {
      const { touchSession } = await import("../files.js");
      await touchSession(sessionId);
    } catch {
      // best-effort
    }
  }

  const promotePath =
    stagedSourcePath ??
    (sessionId && assetId ? await getAssetFilePath(sessionId, assetId).catch(() => null) : null);
  const r2Result = promotePath
    ? await putGenerationAudioObject({
        contentType: stagedContentType,
        filePath: promotePath,
        generation,
      })
    : { errorCode: "SOURCE_AUDIO_UNAVAILABLE", key: generation.r2ObjectKey, ok: false };

  if (stagedSourcePath) {
    try {
      const { rm } = await import("node:fs/promises");
      const path = await import("node:path");
      await rm(path.dirname(stagedSourcePath), { force: true, recursive: true });
    } catch {
      // ignore staged cleanup failures
    }
  }

  return {
    generation,
    promoted: r2Result.ok === true && !r2Result.skipped,
    r2: r2Result,
    saved: true,
  };
}
