import { NextResponse } from "next/server";

import { isCreditsEnabled } from "../../../../lib/credits/flags.js";
import { connectToDatabase } from "../../../../lib/db/mongoose.js";
import { Generation } from "../../../../lib/models/Generation.js";
import { serializeDashboardCard } from "../../../../lib/generations/serialize-generation.js";
import {
  buildGenerationVisibilityFilter,
  getSessionIdFromRequest,
} from "../../../../lib/generations/visibility.js";

export const runtime = "nodejs";

export async function GET(request) {
  // REP-402: inert empty dashboard when credits layer is disabled.
  if (!isCreditsEnabled()) {
    return NextResponse.json({ enabled: false, generations: [] });
  }

  try {
    await connectToDatabase();

    const sessionId = getSessionIdFromRequest(request);
    const generations = await Generation.find({
      deletedAt: null,
      // Reference-only saves use not_required (no MP3). Audio saves use created.
      r2Status: { $in: ["created", "not_required"] },
      saved: true,
      ...buildGenerationVisibilityFilter(sessionId),
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return NextResponse.json({
      generations: generations
        .map((generation) => serializeDashboardCard(generation, { sessionId }))
        .filter(Boolean),
    });
  } catch (error) {
    console.error("GET /api/dashboard/state error:", {
      kind: error?.name ?? "unknown_error",
    });

    return NextResponse.json(
      { error: "Dashboard is unavailable." },
      { status: 500 },
    );
  }
}
