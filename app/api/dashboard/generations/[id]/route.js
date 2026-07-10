import mongoose from "mongoose";
import { NextResponse } from "next/server";

import { isCreditsEnabled } from "../../../../../lib/credits/flags.js";
import { connectToDatabase } from "../../../../../lib/db/mongoose.js";
import { Generation } from "../../../../../lib/models/Generation.js";
import { serializeEditorPayload } from "../../../../../lib/generations/serialize-generation.js";

export const runtime = "nodejs";

export async function GET(_request, context) {
  if (!isCreditsEnabled()) {
    return NextResponse.json({ enabled: false, error: "credits_disabled" }, { status: 404 });
  }

  const { id } = await context.params;

  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Generation not found." }, { status: 404 });
  }

  try {
    await connectToDatabase();

    const generation = await Generation.findOne({
      _id: id,
      deletedAt: null,
      public: true,
      saved: true,
      userTitled: true,
    }).lean();

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
