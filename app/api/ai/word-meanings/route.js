import { NextResponse } from "next/server";

import {
  generateWordMeanings,
  normalizeSourceLanguage,
} from "@/lib/ai/openai-lyrics";

export const runtime = "nodejs";

function getPublicErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Generating word meanings failed unexpectedly.";
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
      { error: "Add lyric lines before generating word meanings." },
      { status: 400 },
    );
  }

  const includeRomanization = payload?.includeRomanization !== false;

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
    const meanings = await generateWordMeanings({
      includeRomanization,
      lines,
      sourceLanguage,
    });

    return NextResponse.json({
      lines: meanings,
      sourceLanguage: sourceLanguage.label,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getPublicErrorMessage(error) },
      { status: 500 },
    );
  }
}
