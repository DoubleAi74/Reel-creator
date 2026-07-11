import { NextResponse } from "next/server";

import { isCreditsEnabled } from "../../../../lib/credits/flags.js";
import { persistGeneration } from "../../../../lib/generations/persist-generation.js";
import { isValidGenerationAudioSavePassword } from "../../../../lib/generations/save-audio-password.js";
import { serializeDashboardCard } from "../../../../lib/generations/serialize-generation.js";
import { normalizeSourceReference } from "../../../../lib/generations/source-reference.js";
import { getSessionIdFromRequest } from "../../../../lib/generations/visibility.js";
import { toProjectJsonValue } from "../../../../lib/project.js";

export const runtime = "nodejs";

function asTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTitle(value) {
  const title = asTrimmedString(value);

  if (title.length > 180) {
    throw new Error("Generation title must be 180 characters or fewer.");
  }

  return title;
}

function buildSnapshotFromPayload(payload) {
  const snapshot = payload?.snapshot;
  const sourceReference = normalizeSourceReference(
    payload?.source ?? payload?.sourceReference ?? snapshot?.source ?? {},
  );

  if (snapshot?.project && typeof snapshot.project === "object") {
    return {
      ...snapshot,
      project: toProjectJsonValue(snapshot.project),
      source: sourceReference,
    };
  }

  if (payload?.project && typeof payload.project === "object") {
    return {
      project: toProjectJsonValue(payload.project),
      source: sourceReference,
    };
  }

  return null;
}

function messageForR2Failure(errorCode) {
  if (errorCode === "SOURCE_AUDIO_UNAVAILABLE" || errorCode === "R2_OBJECT_NOT_FOUND") {
    return "The MP3 is no longer on the server (common after refresh on this host). Uncheck Save MP3 to store the YouTube link and lyrics only, or re-import the audio and try again.";
  }

  if (errorCode === "R2_DISABLED") {
    return "Cloud audio storage is not enabled. Uncheck Save MP3 to save lyrics and source reference only.";
  }

  return "Generation metadata was created, but the MP3 could not be uploaded. Uncheck Save MP3 to save without audio, or try again while the track is available.";
}

export async function POST(request) {
  if (!isCreditsEnabled()) {
    return NextResponse.json(
      {
        enabled: false,
        error: "credits_disabled",
        message: "Credits are disabled, so dashboard save is unavailable.",
      },
      { status: 404 },
    );
  }

  const sessionId = getSessionIdFromRequest(request);

  if (!sessionId) {
    return NextResponse.json(
      {
        error: "session_required",
        message: "Upload or convert audio in this browser first, then save.",
      },
      { status: 400 },
    );
  }

  let payload;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const assetId = asTrimmedString(payload?.assetId);
  const finalJobId = asTrimmedString(payload?.finalJobId);
  const pipelineRunId = asTrimmedString(payload?.pipelineRunId);
  const includeMp3 = payload?.includeMp3 === true || payload?.storeAudio === true;
  let title;

  try {
    title = normalizeTitle(payload?.title);
  } catch (error) {
    return NextResponse.json(
      {
        error: "invalid_title",
        message: error instanceof Error ? error.message : "Invalid title.",
      },
      { status: 400 },
    );
  }

  if (!finalJobId || !pipelineRunId) {
    return NextResponse.json(
      {
        error: "pipeline_required",
        message:
          "Save needs a project id. Keep lyrics and audio on this page, or run generate/time once, then save.",
      },
      { status: 400 },
    );
  }

  if (includeMp3) {
    if (!isValidGenerationAudioSavePassword(payload?.audioPassword)) {
      return NextResponse.json(
        {
          error: "audio_password_invalid",
          message: "Incorrect audio password. Uncheck Save MP3 or enter the correct password.",
        },
        { status: 403 },
      );
    }

    if (!assetId) {
      return NextResponse.json(
        {
          error: "asset_required",
          message:
            "Audio asset is required to save the MP3. Uncheck Save MP3 to store lyrics and the YouTube link only.",
        },
        { status: 400 },
      );
    }
  }

  const snapshot = buildSnapshotFromPayload(payload);

  if (!snapshot) {
    return NextResponse.json(
      {
        error: "snapshot_required",
        message: "Project snapshot is required to save.",
      },
      { status: 400 },
    );
  }

  const sourceReference = normalizeSourceReference(
    payload?.source ?? payload?.sourceReference ?? snapshot.source ?? {},
  );
  const audioDurationSeconds = Number.isFinite(payload?.audioDurationSeconds)
    ? payload.audioDurationSeconds
    : snapshot.project?.audio?.duration ?? null;

  try {
    const result = await persistGeneration({
      assetId: assetId || null,
      audioDurationSeconds,
      finalJobId,
      jobIds: Array.isArray(payload?.jobIds)
        ? payload.jobIds.map((id) => asTrimmedString(id)).filter(Boolean)
        : [finalJobId],
      pipelineRunId,
      save: true,
      sessionId,
      snapshot,
      sourceReference,
      sourceType: sourceReference.type,
      storeAudio: includeMp3,
      title,
    });

    if (!result?.saved || !result?.generation) {
      return NextResponse.json(
        {
          error: "save_failed",
          message:
            "Generation could not be saved. Try again, or uncheck Save MP3 and save lyrics only.",
        },
        { status: 500 },
      );
    }

    if (includeMp3 && result.promoted !== true) {
      const r2Error =
        result.r2?.errorCode && typeof result.r2.errorCode === "string"
          ? result.r2.errorCode
          : "AUDIO_UPLOAD_FAILED";

      return NextResponse.json(
        {
          error: "audio_upload_failed",
          message: messageForR2Failure(r2Error),
          r2ErrorCode: r2Error,
          // Card may still exist without MP3 — client can treat as partial.
          id: result.generation._id?.toString?.() ?? result.generation.id ?? null,
          savedWithoutAudio: true,
        },
        { status: 502 },
      );
    }

    const generation = result.generation;
    const card = serializeDashboardCard(generation, { sessionId });
    const alreadyExisted = result.alreadyExisted === true;

    return NextResponse.json(
      {
        alreadyExisted,
        audioStored: result.audioStored === true,
        generation: card,
        id: generation._id?.toString?.() ?? generation.id ?? null,
        saved: true,
      },
      { status: alreadyExisted ? 200 : 201 },
    );
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Generation could not be saved.";

    console.error("POST /api/dashboard/generations error:", {
      kind: error?.name ?? "unknown_error",
      message: message.slice(0, 300),
    });

    if (
      message.includes("pipelineRunId is required") ||
      message.includes("finalJobId is required")
    ) {
      return NextResponse.json(
        { error: "pipeline_required", message },
        { status: 400 },
      );
    }

    if (
      message.includes("Transactions") ||
      message.includes("transaction") ||
      message.includes("replica set")
    ) {
      return NextResponse.json(
        {
          error: "db_transactions",
          message:
            "Database is not ready for saves (transactions required). Check MongoDB configuration.",
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        error: "save_failed",
        message:
          message.length > 0 && message.length < 220
            ? message
            : "Generation could not be saved. Try again, or uncheck Save MP3 and save lyrics only.",
      },
      { status: 500 },
    );
  }
}
