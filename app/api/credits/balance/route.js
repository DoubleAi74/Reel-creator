import { NextResponse } from "next/server";

import { getBalance } from "@/lib/credits/credit-service";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getBalance());
  } catch (error) {
    return NextResponse.json(
      {
        error: "credits_unavailable",
        message: error instanceof Error ? error.message : "Credits are unavailable.",
      },
      { status: 500 },
    );
  }
}
