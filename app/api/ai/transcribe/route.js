import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  findSessionIdForAsset,
  readAssetMetadata,
  SESSION_COOKIE_NAME,
  touchSessionAndSweep,
} from "@/lib/files";
import { normalizeSourceLanguage } from "@/lib/ai/openai-lyrics";
import {
  normalizeTranscribePhase,
  runTranscribeJob,
} from "@/lib/ai/transcribe-job";
import {
  createTranscribeJob,
  enqueueTranscribeJob,
  findInFlightTranscribeForSession,
} from "@/lib/ai/transcribe-store";
import { assertCanStartGeneration } from "@/lib/credits/credit-service";
import { isCreditsEnabled } from "@/lib/credits/flags";
import { checkGenerationRateLimit } from "@/lib/credits/rate-limit";
import {
  GENERATION_UNLOCK_COOKIE,
  isGenerationUnlockCookieValid,
} from "@/lib/credits/unlock-cookie";
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

function normalizePipelineRunId(value) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : crypto.randomUUID();
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

function getRequestIp(request) {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  return request.headers.get("x-real-ip")?.trim() ?? "";
}

function mapCreditGateError(error) {
  if (error?.code === "PRICING_UNAVAILABLE") {
    return NextResponse.json(
      { error: "pricing_unavailable", model: error.details?.model },
      { status: 500 },
    );
  }

  if (error?.code === "INSUFFICIENT_BALANCE") {
    return NextResponse.json(
      {
        balanceMinor: error.details?.balanceMinor,
        error: "insufficient_balance",
      },
      { status: 402 },
    );
  }

  return NextResponse.json(
    {
      error: "credits_unavailable",
      message: error instanceof Error ? error.message : "Credits are unavailable.",
    },
    { status: 500 },
  );
}

async function getCreditGateResponse({ cookieStore, phase, request, sessionId }) {
  if (!isCreditsEnabled()) {
    return null;
  }

  const unlockCookie = cookieStore.get(GENERATION_UNLOCK_COOKIE)?.value;

  if (!isGenerationUnlockCookieValid(unlockCookie)) {
    return NextResponse.json({ error: "locked" }, { status: 403 });
  }

  const rateLimit = checkGenerationRateLimit({
    ip: getRequestIp(request),
    sessionId,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfter: rateLimit.retryAfter },
      { status: 429 },
    );
  }

  try {
    await assertCanStartGeneration({ phase });
  } catch (error) {
    return mapCreditGateError(error);
  }

  return null;
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
  let phase;

  try {
    phase = normalizeTranscribePhase(payload?.phase);
  } catch (error) {
    return NextResponse.json(
      { error: getPublicErrorMessage(error) },
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

  const creditGateResponse = await getCreditGateResponse({
    cookieStore,
    phase,
    request,
    sessionId,
  });

  if (creditGateResponse) {
    return creditGateResponse;
  }

  const pipelineRunId = normalizePipelineRunId(payload?.pipelineRunId);
  const save = payload?.save !== false;
  const saveOnCompletion = payload?.saveOnCompletion === true;
  const job = createTranscribeJob({
    assetId: audioAssetId,
    pipelineRunId,
    save,
    saveOnCompletion,
    sessionId,
  });

  enqueueTranscribeJob(job.jobId, () =>
    runTranscribeJob({
      audio: normalizeAudio(payload?.audio),
      audioAssetId,
      includeRomanization,
      jobId: job.jobId,
      lines: normalizeLines(payload?.lines),
      phase,
      pipelineRunId,
      save,
      saveOnCompletion,
      sessionId,
      sourceLanguage,
    }),
  );

  return respond({ jobId: job.jobId });
}
