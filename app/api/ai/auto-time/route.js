import { readFile } from "node:fs/promises";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  findSessionIdForAsset,
  getAssetFilePath,
  readAssetMetadata,
  SESSION_COOKIE_NAME,
  touchSessionAndSweep,
} from "@/lib/files";
import {
  normalizeSourceLanguage,
  runLyricTimingPipeline,
} from "@/lib/ai/openai-lyrics";
import { removeRenderJobsForSessions } from "@/lib/render/store";

export const runtime = "nodejs";

const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24;

function getFallbackMimeType(metadata) {
  return metadata.mimeType || "audio/mpeg";
}

function getPublicErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Auto-timing failed unexpectedly.";
}

function normalizeLines(lines) {
  if (!Array.isArray(lines)) {
    return [];
  }

  return lines
    .map((line) => ({
      id: typeof line?.id === "string" ? line.id : "",
      original: typeof line?.original === "string" ? line.original : "",
      romanization:
        typeof line?.romanization === "string" ? line.romanization : "",
      translation:
        typeof line?.translation === "string" ? line.translation : "",
    }))
    .filter((line) => line.id && line.original.trim());
}

function normalizeAudio(audio) {
  return {
    duration: Number.isFinite(audio?.duration) ? audio.duration : 0,
    endOffset:
      audio?.endOffset == null || !Number.isFinite(audio.endOffset)
        ? null
        : audio.endOffset,
    startOffset: Number.isFinite(audio?.startOffset) ? audio.startOffset : 0,
  };
}

async function resolveSessionIdForAudioAsset(sessionIdFromCookie, audioAssetId) {
  if (sessionIdFromCookie) {
    try {
      await readAssetMetadata(sessionIdFromCookie, audioAssetId);

      return {
        recovered: false,
        sessionId: sessionIdFromCookie,
      };
    } catch {}
  }

  const recoveredSessionId = await findSessionIdForAsset(audioAssetId);

  return {
    recovered: Boolean(recoveredSessionId),
    sessionId: recoveredSessionId,
  };
}

function appendSessionCookie(response, sessionId) {
  response.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax`,
  );
}

export async function POST(request) {
  let payload;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const audioAssetId =
    typeof payload?.audioAssetId === "string" ? payload.audioAssetId.trim() : "";

  if (!audioAssetId) {
    return NextResponse.json(
      { error: "Upload an MP3 before auto-timing lyrics." },
      { status: 400 },
    );
  }

  const lines = normalizeLines(payload?.lines);

  if (lines.length === 0) {
    return NextResponse.json(
      { error: "Add lyric lines before auto-timing." },
      { status: 400 },
    );
  }

  let sourceLanguage;

  try {
    sourceLanguage = normalizeSourceLanguage(
      payload?.sourceLanguage,
      payload?.otherLanguage,
    );
  } catch (error) {
    return NextResponse.json(
      { error: getPublicErrorMessage(error) },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  const sessionIdFromCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const { recovered, sessionId } = await resolveSessionIdForAudioAsset(
    sessionIdFromCookie,
    audioAssetId,
  );

  if (!sessionId) {
    return NextResponse.json(
      { error: "Your uploaded MP3 is no longer available. Upload it again." },
      { status: 404 },
    );
  }

  try {
    const sweptSessionIds = await touchSessionAndSweep(sessionId);
    removeRenderJobsForSessions(sweptSessionIds);

    const metadata = await readAssetMetadata(sessionId, audioAssetId);

    if (metadata.kind !== "audio") {
      return NextResponse.json(
        { error: "Choose an uploaded MP3 before auto-timing lyrics." },
        { status: 400 },
      );
    }

    const filePath = await getAssetFilePath(sessionId, audioAssetId);
    const fileBuffer = await readFile(filePath);
    const result = await runLyricTimingPipeline({
      audio: normalizeAudio(payload?.audio),
      contentType: getFallbackMimeType(metadata),
      fileBuffer,
      fileName: metadata.name,
      lines,
      sourceLanguage,
    });
    const response = NextResponse.json(result);

    if (recovered) {
      appendSessionCookie(response, sessionId);
    }

    return response;
  } catch (error) {
    return NextResponse.json(
      { error: getPublicErrorMessage(error) },
      { status: 500 },
    );
  }
}
