import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  SESSION_COOKIE_NAME,
  storeUploadedAsset,
  sweepExpiredSessions,
} from "@/lib/files";
import { removeRenderJobsForSessions } from "@/lib/render/store";

export async function POST(request) {
  try {
    const cookieStore = await cookies();
    const formData = await request.formData();
    const file = formData.get("file");
    const kind = formData.get("kind");
    const sessionId =
      cookieStore.get(SESSION_COOKIE_NAME)?.value ?? crypto.randomUUID();
    const asset = await storeUploadedAsset({
      file,
      kind: typeof kind === "string" ? kind : "audio",
      sessionId,
    });
    const sweptSessionIds = await sweepExpiredSessions({
      excludeSessionIds: [sessionId],
    });

    removeRenderJobsForSessions(sweptSessionIds);

    const response = NextResponse.json({
      assetId: asset.assetId,
      durationSec: asset.durationSec,
      kind: asset.kind,
      name: asset.name,
      sizeBytes: asset.sizeBytes,
    });

    if (!cookieStore.get(SESSION_COOKIE_NAME)?.value) {
      response.cookies.set(SESSION_COOKIE_NAME, sessionId, {
        httpOnly: true,
        maxAge: 60 * 60 * 24,
        path: "/",
        sameSite: "lax",
      });
    }

    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Upload failed unexpectedly.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
