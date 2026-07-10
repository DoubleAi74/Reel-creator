import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  findSessionIdForAsset,
  readAssetMetadata,
  SESSION_COOKIE_NAME,
  storeUploadedAsset,
  touchSessionAndSweep,
} from "@/lib/files";
import { normalizeSourceLanguage } from "@/lib/ai/openai-lyrics";
import {
  normalizeTranscribePhase,
  runTranscribeJob,
  shouldRunTranscribeJobsSynchronously,
} from "@/lib/ai/transcribe-job";
import {
  createTranscribeJob,
  enqueueTranscribeJob,
  findInFlightTranscribeForSession,
  getTranscribeJob,
  markTranscribeJobFailed,
  toTranscribeJobResponse,
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
// Sync generate on Vercel awaits OpenAI in-request; Pro can honor higher caps.
export const maxDuration = 300;

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

function isUploadFileLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof value.arrayBuffer === "function" &&
      Number(value.size) > 0,
  );
}

/**
 * Accept JSON (existing clients) or multipart with:
 * - payload: JSON string (job fields)
 * - file: MP3 (reattach onto this isolate — required on multi-instance /tmp hosts)
 */
async function readTranscribeRequest(request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const rawPayload = formData.get("payload");
    const file = formData.get("file");
    let payload = {};

    if (typeof rawPayload === "string" && rawPayload.trim()) {
      try {
        payload = JSON.parse(rawPayload);
      } catch {
        const error = new Error("Request payload must be valid JSON.");
        error.status = 400;
        throw error;
      }
    } else if (rawPayload && typeof rawPayload === "object") {
      payload = rawPayload;
    }

    return {
      payload,
      reattachFile: isUploadFileLike(file) ? file : null,
    };
  }

  try {
    return {
      payload: await request.json(),
      reattachFile: null,
    };
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.status = 400;
    throw error;
  }
}

export async function POST(request) {
  let payload;
  let reattachFile;

  try {
    ({ payload, reattachFile } = await readTranscribeRequest(request));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Request body must be valid JSON.",
      },
      { status: error?.status || 400 },
    );
  }

  let audioAssetId =
    typeof payload?.audioAssetId === "string" ? payload.audioAssetId.trim() : "";

  if (!audioAssetId && !reattachFile) {
    return NextResponse.json(
      { error: "Upload an MP3 before generating lyrics." },
      { status: 400 },
    );
  }

  // REP-407: reject traversal-shaped asset ids at intake (when provided).
  if (audioAssetId && !/^[a-zA-Z0-9_-]+$/.test(audioAssetId)) {
    return NextResponse.json(
      { error: "Invalid audio asset id." },
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

  // REP-201a: a single "full" job settles only after all OpenAI work, so Block A
  // exhaustion cannot stop Block B mid-job. When credits are on, require the
  // two-step generate → time flow used by the client.
  if (isCreditsEnabled() && phase === "full") {
    return NextResponse.json(
      {
        error: "full_phase_disabled",
        message:
          "When credits are enabled, run Generate lyrics, then Time lyrics.",
      },
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
  let sessionId = null;
  let recovered = false;
  let reattached = false;

  if (reattachFile) {
    // Multi-isolate hosts (Vercel): /tmp is not shared. Re-store the client MP3
    // on this isolate so generate/time always have a local file.
    sessionId = sessionIdFromCookie || crypto.randomUUID();
    recovered = !sessionIdFromCookie;

    try {
      const stored = await storeUploadedAsset({
        file: reattachFile,
        kind: "audio",
        sessionId,
      });
      audioAssetId = stored.assetId;
      reattached = true;
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Could not re-attach the MP3 for generation.",
        },
        { status: 400 },
      );
    }
  } else {
    const resolved = await resolveSessionIdForAudioAsset(
      sessionIdFromCookie,
      audioAssetId,
    );
    recovered = resolved.recovered;
    sessionId = resolved.sessionId;
  }

  if (!sessionId || !audioAssetId) {
    return NextResponse.json(
      { error: "Your uploaded MP3 is no longer available. Upload it again." },
      { status: 404 },
    );
  }

  const sweptSessionIds = await touchSessionAndSweep(sessionId);
  removeRenderJobsForSessions(sweptSessionIds);

  // Reconnect to an already-running job for this exact session + asset + phase instead
  // of starting a duplicate (the client adopts the returned jobId).
  // When reattaching we get a fresh assetId, so in-flight match is by new id only.
  const inFlightJob = findInFlightTranscribeForSession(
    sessionId,
    audioAssetId,
    phase,
  );

  const respond = (body, status = 200) => {
    const response = NextResponse.json(body, { status });

    if (recovered || reattached) {
      appendSessionCookie(response, sessionId);
    }

    return response;
  };

  if (inFlightJob) {
    return respond(
      {
        jobId: inFlightJob.jobId,
        ...(reattached ? { audioAssetId } : {}),
      },
      409,
    );
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
  const title =
    typeof payload?.title === "string" ? payload.title.trim().slice(0, 180) : "";
  const job = createTranscribeJob({
    assetId: audioAssetId,
    phase,
    pipelineRunId,
    save,
    saveOnCompletion,
    sessionId,
  });

  const jobArgs = {
    audio: normalizeAudio(payload?.audio),
    audioAssetId,
    includeRomanization,
    jobId: job.jobId,
    lines: phase === "generate" ? [] : normalizeLines(payload?.lines),
    phase,
    pipelineRunId,
    save,
    saveOnCompletion,
    sessionId,
    sourceLanguage,
    title,
  };

  // Multi-isolate: in-memory job map is not shared. Await completion here and
  // return the finished payload so the client does not poll a cold isolate.
  if (shouldRunTranscribeJobsSynchronously()) {
    try {
      await runTranscribeJob(jobArgs);
    } catch (error) {
      markTranscribeJobFailed(
        job.jobId,
        error instanceof Error
          ? error.message
          : "Lyric timing failed unexpectedly.",
      );
    }

    const finished = getTranscribeJob(job.jobId);
    const body = {
      jobId: job.jobId,
      ...(reattached ? { audioAssetId } : {}),
      ...(toTranscribeJobResponse(finished) || {
        status: "error",
        error: "Transcription job failed.",
        phase,
      }),
    };

    return respond(body, finished?.status === "error" ? 500 : 200);
  }

  enqueueTranscribeJob(job.jobId, () => runTranscribeJob(jobArgs));

  return respond({
    jobId: job.jobId,
    ...(reattached ? { audioAssetId } : {}),
  });
}
