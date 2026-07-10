import { NextResponse } from "next/server";

import { isCreditsEnabled } from "../../../../lib/credits/flags.js";
import {
  checkUnlockRateLimit,
  getRequestIp,
} from "../../../../lib/credits/rate-limit.js";
import {
  buildGenerationUnlockSetCookie,
  createGenerationUnlockCookieValue,
  verifyGenerationPassword,
} from "../../../../lib/credits/unlock-cookie.js";

export const runtime = "nodejs";

export async function POST(request) {
  if (!isCreditsEnabled()) {
    return NextResponse.json({ enabled: false });
  }

  const rateLimit = checkUnlockRateLimit({
    ip: getRequestIp(request),
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfter: rateLimit.retryAfter },
      { status: 429 },
    );
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
