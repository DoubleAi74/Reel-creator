import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  removeSessionAssets,
  SESSION_COOKIE_NAME,
  sweepExpiredSessions,
} from "@/lib/files";
import {
  findInFlightRenderForSession,
  removeRenderJobsForSessions,
} from "@/lib/render/store";

export const runtime = "nodejs";

function badRequest(message, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function resolveRequestedSessionId(payload) {
  if (typeof payload?.sessionId !== "string") {
    return null;
  }

  const trimmedSessionId = payload.sessionId.trim();

  return trimmedSessionId.length > 0 ? trimmedSessionId : null;
}

export async function POST(request) {
  try {
    const cookieStore = await cookies();
    const cookieSessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
    const payload = await request.json().catch(() => ({}));
    const requestedSessionId = resolveRequestedSessionId(payload);
    const sessionId = cookieSessionId ?? requestedSessionId;

    if (!sessionId) {
      return badRequest("No session is available to clean up.");
    }

    if (
      cookieSessionId &&
      requestedSessionId &&
      cookieSessionId !== requestedSessionId
    ) {
      return badRequest("sessionId does not match the current session cookie.");
    }

    if (findInFlightRenderForSession(sessionId)) {
      return badRequest(
        "A render is still queued or running for this session. Wait for it to finish before cleaning up.",
        409,
      );
    }

    await removeSessionAssets(sessionId);
    removeRenderJobsForSessions([sessionId], {
      includeInFlight: true,
    });

    const sweptSessionIds = await sweepExpiredSessions();

    removeRenderJobsForSessions(sweptSessionIds);

    const response = NextResponse.json({ ok: true });

    if (cookieSessionId === sessionId) {
      response.cookies.set(SESSION_COOKIE_NAME, "", {
        httpOnly: true,
        maxAge: 0,
        path: "/",
        sameSite: "lax",
      });
    }

    return response;
  } catch (error) {
    return badRequest(
      error instanceof Error ? error.message : "Session cleanup failed.",
      500,
    );
  }
}
