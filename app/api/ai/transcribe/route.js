import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  findSessionIdForAsset,
  readAssetMetadata,
  SESSION_COOKIE_NAME,
  touchSessionAndSweep,
} from "@/lib/files";
import { normalizeSourceLanguage } from "@/lib/ai/openai-lyrics";
import { runTranscribeJob } from "@/lib/ai/transcribe-job";
import {
  createTranscribeJob,
  enqueueTranscribeJob,
  findInFlightTranscribeForSession,
} from "@/lib/ai/transcribe-store";
import { removeRenderJobsForSessions } from "@/lib/render/store";

export const runtime = "nodejs";

const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24;

function getPublicErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Lyric timing failed unexpectedly.";
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
    .filter((line) => line.original.trim());
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

  // Narrowly scoped recovery: only used to re-associate a known assetId with its
  // owning session when the cookie was lost. Not a general cross-session lookup.
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
      { error: "Upload an MP3 before generating lyrics." },
      { status: 400 },
    );
  }

  const includeRomanization = payload?.includeRomanization === true;

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

  const sweptSessionIds = await touchSessionAndSweep(sessionId);
  removeRenderJobsForSessions(sweptSessionIds);

  // Reconnect to an already-running job for this exact session + asset instead
  // of starting a duplicate (the client adopts the returned jobId).
  const inFlightJob = findInFlightTranscribeForSession(sessionId, audioAssetId);

  const respond = (body, status = 200) => {
    const response = NextResponse.json(body, { status });

    if (recovered) {
      appendSessionCookie(response, sessionId);
    }

    return response;
  };

  if (inFlightJob) {
    return respond({ jobId: inFlightJob.jobId }, 409);
  }

  const job = createTranscribeJob({ assetId: audioAssetId, sessionId });

  enqueueTranscribeJob(job.jobId, () =>
    runTranscribeJob({
      audio: normalizeAudio(payload?.audio),
      audioAssetId,
      includeRomanization,
      jobId: job.jobId,
      lines: normalizeLines(payload?.lines),
      sessionId,
      sourceLanguage,
    }),
  );

  return respond({ jobId: job.jobId });
}
