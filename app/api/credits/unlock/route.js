import { NextResponse } from "next/server";

import { isCreditsEnabled } from "@/lib/credits/flags";
import {
  buildGenerationUnlockSetCookie,
  createGenerationUnlockCookieValue,
  verifyGenerationPassword,
} from "@/lib/credits/unlock-cookie";

export const runtime = "nodejs";

export async function POST(request) {
  if (!isCreditsEnabled()) {
    return NextResponse.json({ enabled: false });
  }

  let payload;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  try {
    if (!verifyGenerationPassword(payload?.password)) {
      return NextResponse.json({ error: "locked" }, { status: 401 });
    }

    const cookieValue = createGenerationUnlockCookieValue();
    const response = NextResponse.json({ unlocked: true });
    response.headers.append("Set-Cookie", buildGenerationUnlockSetCookie(cookieValue));

    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error: "credits_not_configured",
        message: error instanceof Error ? error.message : "Credits are not configured.",
      },
      { status: 500 },
    );
  }
}
