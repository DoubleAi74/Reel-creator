import { NextResponse } from "next/server";

import { isR2SessionAssetsEnabled } from "../../../../../lib/r2/session-asset-lifecycle.js";
import {
  ALLOWED_VIDEO_EXTENSIONS,
  ALLOWED_VIDEO_MIME_TYPES,
  getMaxBackgroundVideoR2Bytes,
  getMaxVideoBytes,
} from "../../../../../lib/upload-limits.js";

export const runtime = "nodejs";

export async function GET() {
  const r2Mode = isR2SessionAssetsEnabled();

  return NextResponse.json({
    backgroundVideo: {
      acceptExtensions: ALLOWED_VIDEO_EXTENSIONS,
      acceptMimeTypes: ALLOWED_VIDEO_MIME_TYPES,
      maxBytes: r2Mode ? getMaxBackgroundVideoR2Bytes() : getMaxVideoBytes(),
      mode: r2Mode ? "r2" : "local",
    },
  });
}
