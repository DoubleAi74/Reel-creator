import mongoose from "mongoose";
import { NextResponse } from "next/server";

import { isCreditsEnabled } from "../../../../../lib/credits/flags.js";
import {
  getGenerationUnlockCookieValueFromRequest,
  isGenerationUnlockCookieValid,
} from "../../../../../lib/credits/unlock-cookie.js";
import { connectToDatabase } from "../../../../../lib/db/mongoose.js";
import { Generation } from "../../../../../lib/models/Generation.js";
import {
  serializeDashboardCard,
  serializeEditorPayload,
} from "../../../../../lib/generations/serialize-generation.js";
import {
  buildGenerationVisibilityFilter,
  getSessionIdFromRequest,
} from "../../../../../lib/generations/visibility.js";
import { deleteGenerationAudioObject } from "../../../../../lib/r2/audio-r2-lifecycle.js";

export const runtime = "nodejs";

function getLockedResponse() {
  return NextResponse.json({ error: "locked" }, { status: 401 });
}

function hasEditUnlock(request) {
  return isGenerationUnlockCookieValid(
    getGenerationUnlockCookieValueFromRequest(request),
  );
}

function getGenerationIdResponse(id) {
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Generation not found." }, { status: 404 });
  }

  return null;
}

function normalizeDashboardTitle(value) {
  const title = typeof value === "string" ? value.trim() : "";

  if (!title) {
    throw new Error("Enter a generation title.");
  }

  if (title.length > 180) {
    throw new Error("Generation title must be 180 characters or fewer.");
  }

  return title;
}

function buildSnapshotWithTitle(snapshot, title) {
  const nextSnapshot =
    snapshot && typeof snapshot === "object" ? structuredClone(snapshot) : snapshot;

  if (nextSnapshot?.project && typeof nextSnapshot.project === "object") {
    nextSnapshot.project.meta = {
      ...(nextSnapshot.project.meta && typeof nextSnapshot.project.meta === "object"
        ? nextSnapshot.project.meta
        : {}),
      title,
    };
  }

  return nextSnapshot;
}

async function findVisibleGeneration({ id, request }) {
  const sessionId = getSessionIdFromRequest(request);
  const generation = await Generation.findOne({
    _id: id,
    deletedAt: null,
    r2Status: { $in: ["created", "not_required"] },
    saved: true,
    ...buildGenerationVisibilityFilter(sessionId),
  }).lean();

  return { generation, sessionId };
}

export async function GET(_request, context) {
  if (!isCreditsEnabled()) {
    return NextResponse.json({ enabled: false, error: "credits_disabled" }, { status: 404 });
  }

  const { id } = await context.params;
  const idResponse = getGenerationIdResponse(id);

  if (idResponse) {
    return idResponse;
  }

  try {
    await connectToDatabase();

    const { generation } = await findVisibleGeneration({
      id,
      request: _request,
    });

    if (!generation) {
      return NextResponse.json({ error: "Generation not found." }, { status: 404 });
    }

    return NextResponse.json({
      generation: serializeEditorPayload(generation),
    });
  } catch (error) {
    console.error("GET /api/dashboard/generations/[id] error:", {
      kind: error?.name ?? "unknown_error",
    });

    return NextResponse.json(
      { error: "Generation is unavailable." },
      { status: 500 },
    );
  }
}

export async function PATCH(request, context) {
  if (!isCreditsEnabled()) {
    return NextResponse.json({ enabled: false, error: "credits_disabled" }, { status: 404 });
  }

  const { id } = await context.params;
  const idResponse = getGenerationIdResponse(id);

  if (idResponse) {
    return idResponse;
  }

  if (!hasEditUnlock(request)) {
    return getLockedResponse();
  }

  let title;

  try {
    const payload = await request.json();
    title = normalizeDashboardTitle(payload?.title);
  } catch (error) {
    return NextResponse.json(
      {
        error: "invalid_title",
        message: error instanceof Error ? error.message : "Invalid title.",
      },
      { status: 400 },
    );
  }

  try {
    await connectToDatabase();

    const { generation, sessionId } = await findVisibleGeneration({
      id,
      request,
    });

    if (!generation) {
      return NextResponse.json({ error: "Generation not found." }, { status: 404 });
    }

    const snapshot = buildSnapshotWithTitle(generation.snapshot, title);
    const updatedGeneration = await Generation.findOneAndUpdate(
      {
        _id: id,
        deletedAt: null,
        saved: true,
      },
      {
        $set: {
          public: true,
          snapshot,
          title,
          userTitled: true,
        },
      },
      {
        returnDocument: "after",
        runValidators: true,
      },
    ).lean();

    if (!updatedGeneration) {
      return NextResponse.json({ error: "Generation not found." }, { status: 404 });
    }

    return NextResponse.json({
      generation: serializeDashboardCard(updatedGeneration, { sessionId }),
    });
  } catch (error) {
    console.error("PATCH /api/dashboard/generations/[id] error:", {
      kind: error?.name ?? "unknown_error",
    });

    return NextResponse.json(
      { error: "Generation title could not be updated." },
      { status: 500 },
    );
  }
}

export async function DELETE(request, context) {
  if (!isCreditsEnabled()) {
    return NextResponse.json({ enabled: false, error: "credits_disabled" }, { status: 404 });
  }

  const { id } = await context.params;
  const idResponse = getGenerationIdResponse(id);

  if (idResponse) {
    return idResponse;
  }

  if (!hasEditUnlock(request)) {
    return getLockedResponse();
  }

  try {
    await connectToDatabase();

    const { generation } = await findVisibleGeneration({
      id,
      request,
    });

    if (!generation) {
      return NextResponse.json({ error: "Generation not found." }, { status: 404 });
    }

    const now = new Date();

    await Generation.updateOne(
      {
        _id: id,
        deletedAt: null,
        saved: true,
      },
      {
        $set: {
          deletedAt: now,
          deleteRequestedAt: now,
          public: false,
          saved: false,
        },
      },
    );

    await deleteGenerationAudioObject({ generation }).catch((error) => {
      console.error("Dashboard generation audio delete failed:", {
        generationId: id,
        kind: error?.name ?? "unknown_error",
      });
    });

    return NextResponse.json({ deleted: true, id });
  } catch (error) {
    console.error("DELETE /api/dashboard/generations/[id] error:", {
      kind: error?.name ?? "unknown_error",
    });

    return NextResponse.json(
      { error: "Generation could not be deleted." },
      { status: 500 },
    );
  }
}
