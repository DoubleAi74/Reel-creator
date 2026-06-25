import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./audio-chunks", () => ({
  cutAudioWindow: vi.fn(async () => {
    throw new Error("window cutting disabled in tests");
  }),
  splitAudioIntoChunks: vi.fn(async () => {
    throw new Error("chunking disabled in tests");
  }),
}));

import { cutAudioWindow, splitAudioIntoChunks } from "./audio-chunks";

const ORIGINAL_API_KEY = process.env.OPENAI_API_KEY;
const ORIGINAL_POLISH_MODEL = process.env.OPENAI_LYRIC_POLISH_MODEL;

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json",
    },
    status: 200,
  });
}

function getFormValue(body, key) {
  return typeof body?.get === "function" ? body.get(key) : null;
}

function getJsonBody(body) {
  try {
    return JSON.parse(String(body ?? "{}"));
  } catch {
    return {};
  }
}

function getResponseFormatName(body) {
  return getJsonBody(body).text?.format?.name ?? "";
}

describe("runLyricTimingPipeline", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.OPENAI_LYRIC_POLISH_MODEL;
    cutAudioWindow.mockReset();
    cutAudioWindow.mockImplementation(async () => {
      throw new Error("window cutting disabled in tests");
    });
    splitAudioIntoChunks.mockReset();
    splitAudioIntoChunks.mockImplementation(async () => {
      throw new Error("chunking disabled in tests");
    });
  });

  afterEach(() => {
    process.env.OPENAI_API_KEY = ORIGINAL_API_KEY;
    if (ORIGINAL_POLISH_MODEL == null) {
      delete process.env.OPENAI_LYRIC_POLISH_MODEL;
    } else {
      process.env.OPENAI_LYRIC_POLISH_MODEL = ORIGINAL_POLISH_MODEL;
    }
    vi.restoreAllMocks();
  });

  it("locks user-supplied lyrics and skips lyric generation calls", async () => {
    const { normalizeSourceLanguage, runLyricTimingPipeline } = await import(
      "./openai-lyrics"
    );
    const requests = [];
    const fetchMock = vi.fn(async (url, options = {}) => {
      const bodyText = String(options.body ?? "");
      const jsonBody = bodyText.startsWith("{") ? JSON.parse(bodyText) : {};
      requests.push({
        body: bodyText,
        language: getFormValue(options.body, "language"),
        model: getFormValue(options.body, "model") ?? jsonBody.model,
        prompt: getFormValue(options.body, "prompt"),
        responseFormat: getFormValue(options.body, "response_format"),
        url,
      });

      if (bodyText.includes("reel_creator_lyric_polish_audit")) {
        const polishBody = JSON.parse(bodyText);
        const polishInput = JSON.parse(polishBody.input);
        expect(polishInput.x[0]).not.toHaveProperty("start");
        expect(polishInput.x[0]).not.toHaveProperty("end");
        expect(polishInput.x[0]).not.toHaveProperty("words");

        return jsonResponse({
          output_text: JSON.stringify({
            changes: [
              {
                change_type: "translation_error",
                confidence: "high",
                corrected_romanization: "",
                corrected_translation: "From today.",
                line_number: 1,
                reason: "Adds subtitle punctuation.",
              },
              {
                change_type: "romanization_error",
                confidence: "high",
                corrected_romanization: "merā ghar",
                corrected_translation: "",
                line_number: 2,
                reason: "Uses long vowel romanization.",
              },
            ],
          }),
        });
      }

      return jsonResponse({
        duration: 1.4,
        language: "hindi",
        segments: [
          {
            avg_logprob: -0.1,
            compression_ratio: 1,
            end: 1.4,
            no_speech_prob: 0,
            start: 0,
            text: "आज से मेरा घर",
          },
        ],
        text: "आज से मेरा घर",
        words: [
          { end: 0.2, start: 0, word: "आज" },
          { end: 0.34, start: 0.2, word: "से" },
          { end: 0.7, start: 0.52, word: "मेरा" },
          { end: 1.0, start: 0.7, word: "घर" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runLyricTimingPipeline({
      audio: { duration: 1.4, endOffset: null, startOffset: 0 },
      contentType: "audio/mpeg",
      fileBuffer: Buffer.from("fake mp3"),
      fileName: "sample.mp3",
      lines: [
        {
          id: "line-1",
          original: "आज से",
          translation: "From today",
        },
        {
          id: "line-2",
          original: "मेरा घर",
          romanization: "mera ghar",
        },
      ],
      sourceLanguage: normalizeSourceLanguage("auto"),
    });

    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.model)).toEqual([
      "gpt-5.4",
      "whisper-1",
    ]);
    const whisperRequest = requests.find((request) => request.model === "whisper-1");
    expect(whisperRequest).toMatchObject({
      language: "hi",
      model: "whisper-1",
      responseFormat: "verbose_json",
    });
    expect(whisperRequest.prompt).toContain("आज से");
    expect(whisperRequest.prompt).toContain("मेरा घर");
    expect(result).toMatchObject({
      canonicalLineCount: 2,
      canonicalSource: "user",
      lineCount: 2,
      lyricPolishSummary: {
        changedLineCount: 2,
        originalTextChangeCount: 0,
        romanizationChangeCount: 1,
        status: "applied",
        translationChangeCount: 1,
      },
      qualitySummary: {
        auditStatus: "not-run",
        highRiskLineCount: 0,
      },
      timingLanguage: "hi",
      timingSummary: {
        matchedCount: 2,
      },
    });
    expect(result.lines).toMatchObject([
      {
        id: "line-1",
        original: "आज से",
        quality: {
          riskLevel: "ok",
        },
        start: 0,
        translation: "From today.",
      },
      {
        id: "line-2",
        original: "मेरा घर",
        quality: {
          riskLevel: "ok",
        },
        romanization: "merā ghar",
        start: 0.52,
      },
    ]);
  });

  it("transcribes only the selected section and offsets words back to global time", async () => {
    const { normalizeSourceLanguage, runLyricTimingPipeline } = await import(
      "./openai-lyrics"
    );
    cutAudioWindow.mockResolvedValue({
      buffer: Buffer.from("section mp3"),
      contentType: "audio/mpeg",
      end: 20,
      fileName: "window.mp3",
      start: 10,
    });

    const fetchMock = vi.fn(async (_url, options = {}) => {
      expect(getFormValue(options.body, "file").name).toBe("window.mp3");

      return jsonResponse({
        duration: 10,
        language: "english",
        segments: [
          {
            avg_logprob: -0.1,
            compression_ratio: 1,
            end: 2,
            no_speech_prob: 0,
            start: 1,
            text: "hello world",
          },
        ],
        text: "hello world",
        words: [
          { end: 1.4, start: 1.1, word: "hello" },
          { end: 1.8, start: 1.4, word: "world" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runLyricTimingPipeline({
      audio: { duration: 40, endOffset: 20, startOffset: 10 },
      contentType: "audio/mpeg",
      fileBuffer: Buffer.from("full mp3"),
      fileName: "full.mp3",
      lines: [{ id: "line-1", original: "hello world" }],
      sourceLanguage: normalizeSourceLanguage("auto"),
    });

    expect(cutAudioWindow).toHaveBeenCalledWith({
      end: 20,
      fileBuffer: Buffer.from("full mp3"),
      fileName: "full.mp3",
      start: 10,
    });
    expect(result).toMatchObject({
      duration: 20,
      wordCount: 2,
      words: [
        { end: 11.4, start: 11.1, word: "hello" },
        { end: 11.8, start: 11.4, word: "world" },
      ],
    });
    expect(result.lines[0].start).toBe(11.1);
  });

  it("deduplicates overlapping chunk words with normalized text comparison", async () => {
    const { getWordTimingsFromAudio, normalizeSourceLanguage } = await import(
      "./openai-lyrics"
    );
    splitAudioIntoChunks.mockResolvedValue([
      {
        buffer: Buffer.from("chunk one"),
        contentType: "audio/mpeg",
        end: 5,
        fileName: "chunk-one.mp3",
        start: 0,
      },
      {
        buffer: Buffer.from("chunk two"),
        contentType: "audio/mpeg",
        end: 9,
        fileName: "chunk-two.mp3",
        start: 4,
      },
    ]);

    const fetchMock = vi.fn(async (_url, options = {}) => {
      const fileName = getFormValue(options.body, "file").name;

      if (fileName === "chunk-one.mp3") {
        return jsonResponse({
          duration: 5,
          language: "hindi",
          segments: [
            {
              avg_logprob: -0.1,
              compression_ratio: 1,
              end: 5,
              no_speech_prob: 0,
              start: 0,
              text: "गयां",
            },
          ],
          text: "गयां",
          words: [{ end: 4.3, start: 4, word: "गयां" }],
        });
      }

      return jsonResponse({
        duration: 5,
        language: "hindi",
        segments: [
          {
            avg_logprob: -0.1,
            compression_ratio: 1,
            end: 1,
            no_speech_prob: 0,
            start: 0,
            text: "गया फिर",
          },
        ],
        text: "गया फिर",
        words: [
          { end: 0.32, start: 0.12, word: "गया" },
          { end: 1.1, start: 0.8, word: "फिर" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getWordTimingsFromAudio({
      audio: { duration: 9, endOffset: null, startOffset: 0 },
      contentType: "audio/mpeg",
      fileBuffer: Buffer.from("full mp3"),
      fileName: "full.mp3",
      sourceLanguage: normalizeSourceLanguage("hi"),
    });

    expect(result.words).toEqual([
      { end: 4.3, start: 4, word: "गयां" },
      { end: 5.1, start: 4.8, word: "फिर" },
    ]);
  });

  it("fills interpolated timing gaps with a targeted second whisper pass", async () => {
    const { normalizeSourceLanguage, runLyricTimingPipeline } = await import(
      "./openai-lyrics"
    );
    const requests = [];
    cutAudioWindow.mockResolvedValue({
      buffer: Buffer.from("gap window mp3"),
      contentType: "audio/mpeg",
      end: 9.5,
      fileName: "gap-window.mp3",
      start: 0.8,
    });

    const fetchMock = vi.fn(async (_url, options = {}) => {
      const file = getFormValue(options.body, "file");
      const prompt = getFormValue(options.body, "prompt");
      requests.push({
        fileName: file?.name,
        prompt,
      });

      if (file?.name === "gap-window.mp3") {
        expect(prompt).toContain("middle lyric");
        expect(prompt).not.toContain("alpha");
        expect(prompt).not.toContain("omega");

        return jsonResponse({
          duration: 8.7,
          language: "english",
          segments: [
            {
              avg_logprob: -0.1,
              compression_ratio: 1,
              end: 4.7,
              no_speech_prob: 0,
              start: 4.2,
              text: "middle lyric",
            },
          ],
          text: "middle lyric",
          words: [
            { end: 4.5, start: 4.2, word: "middle" },
            { end: 4.9, start: 4.5, word: "lyric" },
          ],
        });
      }

      return jsonResponse({
        duration: 12,
        language: "english",
        segments: [
          {
            avg_logprob: -0.1,
            compression_ratio: 1,
            end: 9.4,
            no_speech_prob: 0,
            start: 1,
            text: "alpha omega",
          },
        ],
        text: "alpha omega",
        words: [
          { end: 1.3, start: 1, word: "alpha" },
          { end: 9.4, start: 9, word: "omega" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runLyricTimingPipeline({
      audio: { duration: 12, endOffset: null, startOffset: 0 },
      contentType: "audio/mpeg",
      fileBuffer: Buffer.from("full mp3"),
      fileName: "full.mp3",
      lines: [
        { id: "line-1", original: "alpha" },
        { id: "line-2", original: "middle lyric" },
        { id: "line-3", original: "omega" },
      ],
      sourceLanguage: normalizeSourceLanguage("auto"),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cutAudioWindow).toHaveBeenCalledWith({
      end: expect.any(Number),
      fileBuffer: Buffer.from("full mp3"),
      fileName: "full.mp3",
      start: expect.any(Number),
    });
    expect(requests.map((request) => request.fileName)).toEqual([
      "full.mp3",
      "gap-window.mp3",
    ]);
    expect(result.gapFillSummary).toMatchObject({
      initialWeakLineCount: 1,
      pass2: {
        newWordCount: 2,
        windowCount: 1,
      },
      whisperPassCount: 2,
    });
    expect(result.matches).toMatchObject([
      { confidence: "high", start: 1, timingSource: "word-match" },
      { confidence: "high", start: 5, timingSource: "word-match" },
      { confidence: "high", start: 9, timingSource: "word-match" },
    ]);
    expect(result.wordCount).toBe(4);
  });

  it("uses a repeat template for an untranscribed line with a leading vocalization", async () => {
    const { normalizeSourceLanguage, runLyricTimingPipeline } = await import(
      "./openai-lyrics"
    );
    cutAudioWindow.mockResolvedValue({
      buffer: Buffer.from("silent gap mp3"),
      contentType: "audio/mpeg",
      end: 6,
      fileName: "silent-gap.mp3",
      start: 2,
    });

    const fetchMock = vi.fn(async (_url, options = {}) => {
      const file = getFormValue(options.body, "file");

      if (file?.name === "silent-gap.mp3") {
        return jsonResponse({
          duration: 4,
          language: "english",
          segments: [],
          text: "",
          words: [],
        });
      }

      return jsonResponse({
        duration: 10,
        language: "english",
        segments: [
          {
            avg_logprob: -0.1,
            compression_ratio: 1,
            end: 8.4,
            no_speech_prob: 0,
            start: 1,
            text: "hello world after",
          },
        ],
        text: "hello world after",
        words: [
          { end: 1.4, start: 1, word: "hello" },
          { end: 1.9, start: 1.4, word: "world" },
          { end: 8.4, start: 8, word: "after" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runLyricTimingPipeline({
      audio: { duration: 10, endOffset: null, startOffset: 0 },
      contentType: "audio/mpeg",
      fileBuffer: Buffer.from("full mp3"),
      fileName: "full.mp3",
      lines: [
        { id: "line-1", original: "hello world" },
        { id: "line-2", original: "oh hello world" },
        { id: "line-3", original: "after" },
      ],
      sourceLanguage: normalizeSourceLanguage("auto"),
    });

    expect(result.matches[1]).toMatchObject({
      confidence: "medium",
      timingSource: "repeat-template",
    });
    expect(result.matches[1].words.map((word) => word.text)).toEqual([
      "oh",
      "hello",
      "world",
    ]);
    expect(result.gapFillSummary).toMatchObject({
      finalWeakLineCount: 0,
      repeatTemplateCount: 1,
      whisperPassCount: 3,
    });
  });

  it("generates canonical lyrics only when no user lyrics are provided", async () => {
    const { normalizeSourceLanguage, runLyricTimingPipeline } = await import(
      "./openai-lyrics"
    );
    const requests = [];
    const fetchMock = vi.fn(async (url, options = {}) => {
      const request = {
        body: options.body,
        model:
          getFormValue(options.body, "model") ??
          JSON.parse(String(options.body ?? "{}")).model,
        url,
      };
      requests.push(request);

      if (request.model === "gpt-4o-transcribe") {
        return jsonResponse({
          text: "♪ hello world ♪ second line",
        });
      }

      if (request.model === "gpt-4o") {
        expect(String(request.body)).not.toContain("♪");
        return jsonResponse({
          output_text: "hello world\nsecond line",
        });
      }

      if (getResponseFormatName(request.body) === "reel_creator_lyric_source_repair") {
        return jsonResponse({
          output_text: JSON.stringify({
            changes: [],
          }),
        });
      }

      if (
        request.model === "gpt-4o-mini" &&
        String(request.body).includes("reel_creator_lyric_quality_audit")
      ) {
        return jsonResponse({
          output_text: JSON.stringify({
            lines: [
              {
                line_number: 1,
                reason: "The nearby words support this line.",
                verdict: "supported",
              },
              {
                line_number: 2,
                reason: "The nearby words are partly uncertain.",
                verdict: "questionable",
              },
            ],
          }),
        });
      }

      if (String(request.body).includes("reel_creator_lyric_polish_audit")) {
        expect(request.model).toBe("gpt-5.4");
        const bodyText = String(request.body);
        const polishBody = JSON.parse(bodyText);
        const polishInput = JSON.parse(polishBody.input);
        expect(polishInput.x[0]).not.toHaveProperty("start");
        expect(polishInput.x[0]).not.toHaveProperty("end");
        expect(polishInput.x[0]).not.toHaveProperty("words");
        expect(polishInput.x[0]).not.toHaveProperty("quality");

        return jsonResponse({
          output_text: JSON.stringify({
            changes: [
              {
                change_type: "translation_error",
                confidence: "high",
                corrected_original: "second line",
                corrected_translation: "The second line",
                line_number: 2,
                reason: "Makes the English subtitle more natural.",
              },
            ],
          }),
        });
      }

      if (request.model === "gpt-5.4-mini") {
        return jsonResponse({
          output_text: JSON.stringify({
            lines: [
              {
                line_number: 1,
                original: "hello world",
                translation: "Hello world",
              },
              {
                line_number: 2,
                original: "second line",
                translation: "Second line",
              },
            ],
          }),
        });
      }

      return jsonResponse({
        duration: 2,
        language: "english",
        segments: [
          {
            avg_logprob: -0.1,
            compression_ratio: 1,
            end: 2,
            no_speech_prob: 0,
            start: 0,
            text: "hello world second line",
          },
        ],
        text: "hello world second line",
        words: [
          { end: 0.4, start: 0.1, word: "hello" },
          { end: 0.8, start: 0.4, word: "world" },
          { end: 1.3, start: 1.0, word: "second" },
          { end: 1.7, start: 1.3, word: "line" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runLyricTimingPipeline({
      audio: { duration: 2, endOffset: null, startOffset: 0 },
      contentType: "audio/mpeg",
      fileBuffer: Buffer.from("fake mp3"),
      fileName: "sample.mp3",
      lines: [],
      sourceLanguage: normalizeSourceLanguage("auto"),
    });

    expect(requests.map((request) => request.model)).toEqual([
      "gpt-4o-transcribe",
      "gpt-4o",
      "gpt-5.4-mini",
      "gpt-5.4-mini",
      "gpt-5.4",
      "whisper-1",
      "gpt-4o-mini",
    ]);
    expect(result).toMatchObject({
      canonicalLineCount: 2,
      canonicalSource: "generated",
      lineCount: 2,
      lyricPolishSummary: {
        changedLineCount: 1,
        originalTextChangeCount: 0,
        status: "applied",
        translationChangeCount: 1,
      },
      sourceRepairSummary: {
        changedLineCount: 0,
        status: "applied",
      },
      qualitySummary: {
        auditStatus: "passed",
        reviewLineCount: 1,
      },
      timingSummary: {
        matchedCount: 2,
      },
    });
    expect(result.lines).toMatchObject([
      {
        original: "hello world",
        quality: {
          riskLevel: "ok",
        },
        start: 0.1,
        translation: "Hello world",
      },
      {
        original: "second line",
        quality: {
          flags: expect.arrayContaining([
            expect.objectContaining({ code: "gpt_questionable_text" }),
          ]),
          riskLevel: "review",
        },
        start: 1.0,
        translation: "The second line",
      },
    ]);
  });

  it("repairs generated source lyric text before translation and timing", async () => {
    const { normalizeSourceLanguage, runLyricTimingPipeline } = await import(
      "./openai-lyrics"
    );
    const fetchMock = vi.fn(async (_url, options = {}) => {
      const model =
        getFormValue(options.body, "model") ??
        JSON.parse(String(options.body ?? "{}")).model;
      const bodyText = String(options.body ?? "");
      const formatName = getResponseFormatName(options.body);

      if (model === "gpt-4o-transcribe") {
        return jsonResponse({ text: "bichli dil" });
      }

      if (model === "gpt-4o") {
        return jsonResponse({ output_text: "bichli dil" });
      }

      if (formatName === "reel_creator_lyric_source_repair") {
        return jsonResponse({
          output_text: JSON.stringify({
            changes: [
              {
                change_type: "transcription_error",
                confidence: "high",
                corrected_original: "bijli bill",
                evidence_type: "language_knowledge",
                line_number: 1,
                reason: "Corrects a garbled lyric phrase in context.",
              },
            ],
          }),
        });
      }

      if (formatName === "reel_creator_lyric_polish_audit") {
        return jsonResponse({
          output_text: JSON.stringify({
            changes: [],
          }),
        });
      }

      if (bodyText.includes("reel_creator_lyric_quality_audit")) {
        return jsonResponse({
          output_text: JSON.stringify({
            lines: [
              {
                line_number: 1,
                reason: "The corrected line is supported by the words.",
                verdict: "supported",
              },
            ],
          }),
        });
      }

      if (formatName === "reel_creator_lyric_lines") {
        const translationBody = getJsonBody(options.body);
        const translationInput = JSON.parse(
          translationBody.input.replace(/^Input lyric lines JSON:\n/, ""),
        );

        expect(translationInput.lines[0].text).toBe("bijli bill");

        return jsonResponse({
          output_text: JSON.stringify({
            lines: [
              {
                line_number: 1,
                original: "bijli bill",
                translation: "That electricity bill of yours.",
              },
            ],
          }),
        });
      }

      return jsonResponse({
        duration: 5,
        language: "english",
        segments: [
          {
            avg_logprob: -0.1,
            compression_ratio: 1,
            end: 3.8,
            no_speech_prob: 0,
            start: 3,
            text: "bijli bill",
          },
        ],
        text: "bijli bill",
        words: [
          { end: 3.4, start: 3.1, word: "bijli" },
          { end: 3.8, start: 3.4, word: "bill" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runLyricTimingPipeline({
      audio: { duration: 5, endOffset: null, startOffset: 0 },
      contentType: "audio/mpeg",
      fileBuffer: Buffer.from("fake mp3"),
      fileName: "sample.mp3",
      lines: [],
      sourceLanguage: normalizeSourceLanguage("auto"),
    });

    expect(result).toMatchObject({
      lyricPolishSummary: {
        changedLineCount: 0,
        originalTextChangeCount: 0,
        translationChangeCount: 0,
      },
      sourceRepairSummary: {
        changedLineCount: 1,
        flagsByCode: {
          source_repair_applied: 1,
        },
        status: "applied",
      },
      timingSummary: {
        matchedCount: 1,
      },
    });
    expect(result.lines[0]).toMatchObject({
      original: "bijli bill",
      start: 3.1,
      translation: "That electricity bill of yours.",
    });
    expect(result.matches[0]).toMatchObject({
      original: "bijli bill",
      start: 3.1,
    });
  });

  it("does not auto-apply possible artist-style source suggestions", async () => {
    const { normalizeSourceLanguage, runLyricTimingPipeline } = await import(
      "./openai-lyrics"
    );
    const fetchMock = vi.fn(async (_url, options = {}) => {
      const model =
        getFormValue(options.body, "model") ??
        JSON.parse(String(options.body ?? "{}")).model;
      const bodyText = String(options.body ?? "");
      const formatName = getResponseFormatName(options.body);

      if (model === "gpt-4o-transcribe") {
        return jsonResponse({ text: "ain't no sun" });
      }

      if (model === "gpt-4o") {
        return jsonResponse({ output_text: "ain't no sun" });
      }

      if (formatName === "reel_creator_lyric_source_repair") {
        return jsonResponse({
          output_text: JSON.stringify({
            changes: [
              {
                change_type: "possible_artist_style",
                confidence: "high",
                corrected_original: "there is no sun",
                evidence_type: "possible_artist_style",
                line_number: 1,
                reason: "The current phrase may be colloquial artist wording.",
              },
            ],
          }),
        });
      }

      if (bodyText.includes("reel_creator_lyric_polish_audit")) {
        expect(model).toBe("gpt-5.4");

        return jsonResponse({
          output_text: JSON.stringify({
            changes: [],
          }),
        });
      }

      if (bodyText.includes("reel_creator_lyric_quality_audit")) {
        return jsonResponse({
          output_text: JSON.stringify({
            lines: [
              {
                line_number: 1,
                reason: "The line is supported.",
                verdict: "supported",
              },
            ],
          }),
        });
      }

      if (model === "gpt-5.4-mini") {
        return jsonResponse({
          output_text: JSON.stringify({
            lines: [
              {
                line_number: 1,
                original: "ain't no sun",
                translation: "There is no sun.",
              },
            ],
          }),
        });
      }

      return jsonResponse({
        duration: 2,
        language: "english",
        segments: [
          {
            avg_logprob: -0.1,
            compression_ratio: 1,
            end: 1,
            no_speech_prob: 0,
            start: 0,
            text: "ain't no sun",
          },
        ],
        text: "ain't no sun",
        words: [
          { end: 0.3, start: 0.1, word: "ain't" },
          { end: 0.6, start: 0.3, word: "no" },
          { end: 0.9, start: 0.6, word: "sun" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runLyricTimingPipeline({
      audio: { duration: 2, endOffset: null, startOffset: 0 },
      contentType: "audio/mpeg",
      fileBuffer: Buffer.from("fake mp3"),
      fileName: "sample.mp3",
      lines: [],
      sourceLanguage: normalizeSourceLanguage("auto"),
    });

    expect(result.lyricPolishSummary).toMatchObject({
      changedLineCount: 0,
      originalTextChangeCount: 0,
      status: "applied",
    });
    expect(result.sourceRepairSummary).toMatchObject({
      changedLineCount: 0,
      flaggedLineCount: 1,
      flagsByCode: {
        source_repair_possible_artist_style_high: 1,
      },
      status: "applied",
    });
    expect(result.lines[0]).toMatchObject({
      original: "ain't no sun",
      start: 0.1,
    });
  });

  it("keeps generated lyrics when the GPT quality audit fails", async () => {
    const { normalizeSourceLanguage, runLyricTimingPipeline } = await import(
      "./openai-lyrics"
    );
    const fetchMock = vi.fn(async (_url, options = {}) => {
      const model =
        getFormValue(options.body, "model") ??
        JSON.parse(String(options.body ?? "{}")).model;
      const bodyText = String(options.body ?? "");
      const formatName = getResponseFormatName(options.body);

      if (model === "gpt-4o-transcribe") {
        return jsonResponse({ text: "hello world" });
      }

      if (model === "gpt-4o") {
        return jsonResponse({ output_text: "hello world" });
      }

      if (formatName === "reel_creator_lyric_source_repair") {
        return jsonResponse({
          output_text: JSON.stringify({
            changes: [],
          }),
        });
      }

      if (
        model === "gpt-4o-mini" &&
        bodyText.includes("reel_creator_lyric_quality_audit")
      ) {
        return new Response(JSON.stringify({ error: { message: "audit down" } }), {
          headers: { "Content-Type": "application/json" },
          status: 500,
        });
      }

      if (bodyText.includes("reel_creator_lyric_polish_audit")) {
        expect(model).toBe("gpt-5.4");
        return jsonResponse({
          output_text: JSON.stringify({
            changes: [],
          }),
        });
      }

      if (model === "gpt-5.4-mini") {
        return jsonResponse({
          output_text: JSON.stringify({
            lines: [
              {
                line_number: 1,
                original: "hello world",
                translation: "Hello world",
              },
            ],
          }),
        });
      }

      return jsonResponse({
        duration: 2,
        language: "english",
        segments: [
          {
            avg_logprob: -0.1,
            compression_ratio: 1,
            end: 1,
            no_speech_prob: 0,
            start: 0,
            text: "hello world",
          },
        ],
        text: "hello world",
        words: [
          { end: 0.4, start: 0.1, word: "hello" },
          { end: 0.8, start: 0.4, word: "world" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runLyricTimingPipeline({
      audio: { duration: 2, endOffset: null, startOffset: 0 },
      contentType: "audio/mpeg",
      fileBuffer: Buffer.from("fake mp3"),
      fileName: "sample.mp3",
      lines: [],
      sourceLanguage: normalizeSourceLanguage("auto"),
    });

    expect(result).toMatchObject({
      canonicalSource: "generated",
      lineCount: 1,
      lyricPolishSummary: {
        changedLineCount: 0,
        status: "applied",
      },
      qualitySummary: {
        auditStatus: "error",
        flagsByCode: {
          qa_audit_unavailable: 1,
        },
      },
    });
    expect(result.lines[0]).toMatchObject({
      original: "hello world",
      quality: {
        riskLevel: "ok",
      },
      start: 0.1,
    });
  });

  it("keeps generated lyrics when the polish audit fails", async () => {
    const { normalizeSourceLanguage, runLyricTimingPipeline } = await import(
      "./openai-lyrics"
    );
    const fetchMock = vi.fn(async (_url, options = {}) => {
      const model =
        getFormValue(options.body, "model") ??
        JSON.parse(String(options.body ?? "{}")).model;
      const bodyText = String(options.body ?? "");
      const formatName = getResponseFormatName(options.body);

      if (model === "gpt-4o-transcribe") {
        return jsonResponse({ text: "hello world" });
      }

      if (model === "gpt-4o") {
        return jsonResponse({ output_text: "hello world" });
      }

      if (formatName === "reel_creator_lyric_source_repair") {
        return jsonResponse({
          output_text: JSON.stringify({
            changes: [],
          }),
        });
      }

      if (bodyText.includes("reel_creator_lyric_polish_audit")) {
        expect(model).toBe("gpt-5.4");
        return new Response(JSON.stringify({ error: { message: "polish down" } }), {
          headers: { "Content-Type": "application/json" },
          status: 500,
        });
      }

      if (bodyText.includes("reel_creator_lyric_quality_audit")) {
        return jsonResponse({
          output_text: JSON.stringify({
            lines: [
              {
                line_number: 1,
                reason: "The line is supported.",
                verdict: "supported",
              },
            ],
          }),
        });
      }

      if (model === "gpt-5.4-mini") {
        return jsonResponse({
          output_text: JSON.stringify({
            lines: [
              {
                line_number: 1,
                original: "hello world",
                translation: "Hello world",
              },
            ],
          }),
        });
      }

      return jsonResponse({
        duration: 2,
        language: "english",
        segments: [
          {
            avg_logprob: -0.1,
            compression_ratio: 1,
            end: 1,
            no_speech_prob: 0,
            start: 0,
            text: "hello world",
          },
        ],
        text: "hello world",
        words: [
          { end: 0.4, start: 0.1, word: "hello" },
          { end: 0.8, start: 0.4, word: "world" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runLyricTimingPipeline({
      audio: { duration: 2, endOffset: null, startOffset: 0 },
      contentType: "audio/mpeg",
      fileBuffer: Buffer.from("fake mp3"),
      fileName: "sample.mp3",
      lines: [],
      sourceLanguage: normalizeSourceLanguage("auto"),
    });

    expect(result).toMatchObject({
      canonicalSource: "generated",
      lineCount: 1,
      lyricPolishSummary: {
        changedLineCount: 0,
        status: "error",
      },
      qualitySummary: {
        auditStatus: "passed",
      },
    });
    expect(result.lines[0]).toMatchObject({
      original: "hello world",
      start: 0.1,
      translation: "Hello world",
    });
  });
});
