import { NextResponse } from "next/server";

import { isYoutubeAudioConfigured } from "../../../../lib/youtube-audio/server-config";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    enabled: isYoutubeAudioConfigured(),
  });
}
