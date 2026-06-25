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

const encoder = new TextEncoder();
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24;

function createStreamEvent(type, payload) {
  return encoder.encode(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function enqueueEvent(controller, type, payload) {
  controller.enqueue(createStreamEvent(type, payload));
}

function getFallbackMimeType(metadata) {
  return metadata.mimeType || "audio/mpeg";
}

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

  const stream = new ReadableStream({
    start(controller) {
      void (async () => {
        try {
          enqueueEvent(controller, "progress", {
            detail: "Loading the uploaded MP3 from this editing session.",
            stage: "loading-audio",
            title: "Loading audio",
          });

          const sweptSessionIds = await touchSessionAndSweep(sessionId);
          removeRenderJobsForSessions(sweptSessionIds);

          const metadata = await readAssetMetadata(sessionId, audioAssetId);

          if (metadata.kind !== "audio") {
            throw new Error("Choose an uploaded MP3 before generating lyrics.");
          }

          const filePath = await getAssetFilePath(sessionId, audioAssetId);
          const fileBuffer = await readFile(filePath);
          let lastTranscriptProgressAt = 0;
          let lastTranscriptProgressLength = 0;

          const result = await runLyricTimingPipeline({
            audio: normalizeAudio(payload?.audio),
            contentType: getFallbackMimeType(metadata),
            fileBuffer,
            fileName: metadata.name,
            includeRomanization,
            includeWordMeanings: true,
            lines: normalizeLines(payload?.lines),
            onProgress: (progress) => {
              enqueueEvent(controller, "progress", progress);
            },
            onTranscriptDelta: (_delta, transcriptText) => {
              const now = Date.now();

              if (
                now - lastTranscriptProgressAt < 750 &&
                transcriptText.length - lastTranscriptProgressLength < 400
              ) {
                return;
              }

              lastTranscriptProgressAt = now;
              lastTranscriptProgressLength = transcriptText.length;
              enqueueEvent(controller, "progress", {
                detail: `${transcriptText.length.toLocaleString()} transcript character${
                  transcriptText.length === 1 ? "" : "s"
                } received so far.`,
                stage: "transcribing",
                title: "Transcribing audio",
              });
            },
            sourceLanguage,
          });

          enqueueEvent(controller, "complete", result);
        } catch (error) {
          enqueueEvent(controller, "error", {
            message: getPublicErrorMessage(error),
          });
        } finally {
          controller.close();
        }
      })();
    },
  });

  const response = new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });

  if (recovered) {
    appendSessionCookie(response, sessionId);
  }

  return response;
}
