import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import { Generation } from "../models/Generation.js";
import {
  deleteR2Object,
  headR2Object,
  putR2Object,
  toSafeR2ErrorCode,
} from "./r2-client.js";
import { isR2Enabled } from "./r2-env.js";

const R2_STATUSES_WITHOUT_OBJECT = new Set([
  "not_required",
  "skipped",
  "deleted",
]);

function resolveGenerationId(generation) {
  return generation?._id?.toString?.() ?? generation?.id ?? null;
}

export function buildGenerationAudioObjectKey(generationId) {
  return `generations/${generationId}/audio.mp3`;
}

async function markGeneration(generationId, fields, { countAttempt = false } = {}) {
  const update = { $set: fields };

  if (countAttempt) {
    update.$inc = { r2AttemptCount: 1 };
  }

  try {
    await Generation.updateOne({ _id: generationId }, update);
  } catch {
    console.error("R2 generation status update failed:", {
      generationId,
      kind: "MONGO_UPDATE_FAILED",
    });
  }
}

async function markCreateFailure({ errorCode, generationId, key, now }) {
  console.error("R2 generation audio create failed:", {
    generationId,
    key,
    kind: errorCode,
  });

  await markGeneration(
    generationId,
    {
      r2ErrorCode: errorCode,
      r2LastAttemptAt: now,
      r2Status: "create_failed",
    },
    { countAttempt: true },
  );

  return { errorCode, key, ok: false };
}

export async function putGenerationAudioObject({
  contentType = "audio/mpeg",
  filePath,
  generation,
  generationId: explicitGenerationId,
}) {
  const generationId = explicitGenerationId ?? resolveGenerationId(generation);
  const key = generation?.r2ObjectKey ?? buildGenerationAudioObjectKey(generationId);
  const now = new Date();

  if (!generationId) {
    return { errorCode: "GENERATION_ID_MISSING", key, ok: false };
  }

  if (generation?.deletedAt) {
    return { key, ok: true, skipped: true };
  }

  if (!isR2Enabled()) {
    return markCreateFailure({
      errorCode: "R2_DISABLED",
      generationId,
      key,
      now,
    });
  }

  try {
    const fileStats = await stat(filePath);

    await putR2Object({
      body: createReadStream(filePath),
      contentLength: fileStats.size,
      contentType,
      key,
      metadata: {
        generationid: generationId,
      },
    });

    await markGeneration(
      generationId,
      {
        r2CreatedAt: now,
        r2ErrorCode: null,
        r2LastAttemptAt: now,
        r2ObjectKey: key,
        r2Status: "created",
      },
      { countAttempt: true },
    );

    return { key, ok: true };
  } catch (error) {
    return markCreateFailure({
      errorCode: toSafeR2ErrorCode(error),
      generationId,
      key,
      now,
    });
  }
}

export async function reconcileGenerationAudio({ filePath = null, generation }) {
  const generationId = resolveGenerationId(generation);
  const key = generation?.r2ObjectKey ?? buildGenerationAudioObjectKey(generationId);
  const now = new Date();

  if (!generationId) {
    return { errorCode: "GENERATION_ID_MISSING", key, ok: false };
  }

  if (generation?.deletedAt || R2_STATUSES_WITHOUT_OBJECT.has(generation?.r2Status)) {
    return { key, ok: true, skipped: true };
  }

  if (!isR2Enabled()) {
    return markCreateFailure({
      errorCode: "R2_DISABLED",
      generationId,
      key,
      now,
    });
  }

  try {
    const headResult = await headR2Object({ key });

    if (headResult.exists) {
      await markGeneration(
        generationId,
        {
          r2CreatedAt: generation?.r2CreatedAt ?? now,
          r2ErrorCode: null,
          r2LastAttemptAt: now,
          r2ObjectKey: key,
          r2Status: "created",
        },
        { countAttempt: true },
      );

      return { key, ok: true, reconciled: true };
    }

    if (filePath) {
      return putGenerationAudioObject({ filePath, generation });
    }

    return markCreateFailure({
      errorCode: "R2_OBJECT_NOT_FOUND",
      generationId,
      key,
      now,
    });
  } catch (error) {
    return markCreateFailure({
      errorCode: toSafeR2ErrorCode(error),
      generationId,
      key,
      now,
    });
  }
}

export async function deleteGenerationAudioObject({ generation }) {
  const generationId = resolveGenerationId(generation);
  const key = generation?.r2ObjectKey ?? null;
  const now = new Date();

  if (!generationId) {
    return { errorCode: "GENERATION_ID_MISSING", key, ok: false };
  }

  if (!key || R2_STATUSES_WITHOUT_OBJECT.has(generation?.r2Status)) {
    return { key, ok: true, skipped: true };
  }

  if (!isR2Enabled()) {
    const errorCode = "R2_DISABLED";

    console.error("R2 generation audio delete failed:", {
      generationId,
      key,
      kind: errorCode,
    });

    await markGeneration(
      generationId,
      {
        r2ErrorCode: errorCode,
        r2LastAttemptAt: now,
        r2Status: "delete_failed",
      },
      { countAttempt: true },
    );

    return { errorCode, key, ok: false };
  }

  try {
    const result = await deleteR2Object({ key });

    await markGeneration(
      generationId,
      {
        r2DeletedAt: now,
        r2ErrorCode: null,
        r2LastAttemptAt: now,
        r2Status: "deleted",
      },
      { countAttempt: true },
    );

    return { alreadyMissing: result.alreadyMissing === true, key, ok: true };
  } catch (error) {
    const errorCode = toSafeR2ErrorCode(error);

    console.error("R2 generation audio delete failed:", {
      generationId,
      key,
      kind: errorCode,
    });

    await markGeneration(
      generationId,
      {
        r2ErrorCode: errorCode,
        r2LastAttemptAt: now,
        r2Status: "delete_failed",
      },
      { countAttempt: true },
    );

    return { errorCode, key, ok: false };
  }
}
