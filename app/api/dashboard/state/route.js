import { NextResponse } from "next/server";

import { connectToDatabase } from "../../../../lib/db/mongoose.js";
import { Generation } from "../../../../lib/models/Generation.js";
import { serializePublicCard } from "../../../../lib/generations/serialize-generation.js";

export const runtime = "nodejs";

export async function GET() {
  try {
    await connectToDatabase();

    const generations = await Generation.find({
      deletedAt: null,
      public: true,
      r2Status: "created",
      saved: true,
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return NextResponse.json({
      generations: generations.map(serializePublicCard).filter(Boolean),
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
