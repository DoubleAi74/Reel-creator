import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_API_KEY = process.env.OPENAI_API_KEY;

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

// The Responses API returns the structured payload as a JSON string in output.
function responsesEnvelope(payloadObject) {
  return jsonResponse({
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(payloadObject) }],
      },
    ],
  });
}

describe("generateWordMeanings", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.OPENAI_API_KEY = ORIGINAL_API_KEY;
    vi.unstubAllGlobals();
  });

  it("buildWordMeaningsSchema requires text/gloss/roman per word", async () => {
    const { buildWordMeaningsSchema } = await import("./openai-lyrics");
    const schema = buildWordMeaningsSchema(true);
    const wordSchema =
      schema.properties.lines.items.properties.words.items;
    expect(wordSchema.required).toEqual(["text", "gloss", "roman"]);
    expect(wordSchema.additionalProperties).toBe(false);

    const noRoman = buildWordMeaningsSchema(false);
    expect(
      noRoman.properties.lines.items.properties.words.items.required,
    ).toEqual(["text", "gloss"]);
  });

  it("returns per-line words with gloss/roman and sends the strict schema", async () => {
    const fetchMock = vi.fn(async () =>
      responsesEnvelope({
        lines: [
          {
            line_number: 1,
            words: [
              { text: "आज", gloss: "today", roman: "aaj" },
              { text: "से", gloss: "from", roman: "se" },
            ],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { generateWordMeanings, normalizeSourceLanguage } = await import(
      "./openai-lyrics"
    );

    const result = await generateWordMeanings({
      includeRomanization: true,
      lines: [{ original: "आज से", translation: "from today" }],
      sourceLanguage: normalizeSourceLanguage("hindi"),
    });

    expect(result).toEqual([
      {
        line_number: 1,
        words: [
          { gloss: "today", roman: "aaj", text: "आज" },
          { gloss: "from", roman: "se", text: "से" },
        ],
      },
    ]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text.format.name).toBe("reel_creator_word_meanings");
    expect(body.text.format.strict).toBe(true);
  });

  it("returns [] for empty input without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { generateWordMeanings, normalizeSourceLanguage } = await import(
      "./openai-lyrics"
    );

    expect(
      await generateWordMeanings({
        lines: [],
        sourceLanguage: normalizeSourceLanguage("hindi"),
      }),
    ).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
