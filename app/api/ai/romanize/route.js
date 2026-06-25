import { NextResponse } from "next/server";

import {
  normalizeSourceLanguage,
  romanizeLyricLines,
} from "@/lib/ai/openai-lyrics";

export const runtime = "nodejs";

function getPublicErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Romanizing lyrics failed unexpectedly.";
}

function normalizeLines(lines) {
  if (!Array.isArray(lines)) {
    return [];
  }

  return lines
    .map((line) => ({
      id: typeof line?.id === "string" ? line.id : "",
      original: typeof line?.original === "string" ? line.original : "",
    }))
    .filter((line) => line.id && line.original.trim());
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

  const lines = normalizeLines(payload?.lines);

  if (lines.length === 0) {
    return NextResponse.json(
      { error: "Add lyric lines before romanizing." },
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

  try {
    const romanizations = await romanizeLyricLines({ lines, sourceLanguage });

    return NextResponse.json({
      romanizations,
      sourceLanguage: sourceLanguage.label,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getPublicErrorMessage(error) },
      { status: 500 },
    );
  }
}
