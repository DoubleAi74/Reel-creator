import { describe, expect, it } from "vitest";

import {
  createDefaultProject,
  exportProjectJson,
  importProjectJson,
} from "./project";

describe("project import/export", () => {
  it("round-trips a project with style and background settings", () => {
    const project = createDefaultProject({
      audio: {
        duration: 96,
        endOffset: 32,
        name: "roundtrip.mp3",
        startOffset: 4,
      },
      background: {
        assetName: "cover-art.png",
        scrim: {
          color: "#020617",
          enabled: true,
          opacity: 0.55,
        },
        type: "image",
      },
      timing: {
        lyricLeadInMs: 120,
      },
      lines: [
        {
          id: "line-a",
          original: "First line",
          quality: {
            flags: [
              {
                code: "weak_text_evidence",
                message: "Matched words are sparse.",
                severity: "review",
              },
            ],
            metrics: {
              durationSec: 0.65,
              matchedWordCount: 2,
              matchRatio: 0.8,
              tokenCount: 2,
            },
            riskLevel: "review",
            textEvidenceConfidence: "medium",
            timingConfidence: "high",
          },
          start: 2.5,
          translation: "One",
          words: [
            { end: 2.82, start: 2.5, text: "First" },
            { end: 3.15, start: 2.82, text: "line" },
          ],
        },
        {
          id: "line-b",
          original: "Second line",
          start: 6.75,
          translation: "Two",
        },
      ],
      style: {
        animation: {
          durationMs: 480,
          slidePx: 52,
          type: "fade-slide",
        },
        color: "#FFEEAA",
        font: "noto-sans-jp",
        originalSize: 70,
      },
    });

    const importedProject = importProjectJson(exportProjectJson(project));

    expect(importedProject.audio).toMatchObject(project.audio);
    expect(importedProject.background).toMatchObject(project.background);
    expect(importedProject.style).toMatchObject(project.style);
    expect(importedProject.timing).toMatchObject(project.timing);
    expect(importedProject.lines).toEqual(project.lines);
  });

  it("ignores unknown fields and preserves imported line order", () => {
    const importedProject = importProjectJson(
      JSON.stringify({
        lines: [
          {
            original: "Later in the file",
            start: 5,
            translation: "Second by time",
          },
          {
            original: "Earlier in the file",
            start: 1,
            translation: "First by time",
          },
        ],
        meta: {
          title: "Order test",
        },
        mysteryField: true,
      }),
    );

    expect(importedProject.meta.title).toBe("Order test");
    expect(importedProject.lines.map((line) => line.original)).toEqual([
      "Later in the file",
      "Earlier in the file",
    ]);
    expect(importedProject.lines[0].id).toBeTruthy();
    expect(importedProject.background.type).toBe("gradient");
  });

  it("backfills gloss/roman and loads legacy (no-gloss) and new word shapes", () => {
    const project = createDefaultProject({
      lines: [
        {
          id: "legacy",
          original: "Legacy timed line",
          start: 1,
          words: [{ end: 1.4, start: 1, text: "Legacy" }],
        },
        {
          id: "glossy",
          original: "आज से",
          start: 2,
          words: [
            { text: "आज", gloss: "today", roman: "aaj" },
            { end: 2.5, start: 2, text: "से", gloss: "from", roman: "se" },
          ],
        },
      ],
    });

    // Legacy timed word gets gloss/roman backfilled to null.
    expect(project.lines[0].words).toEqual([
      { end: 1.4, gloss: null, roman: null, start: 1, text: "Legacy" },
    ]);
    // New untimed gloss word keeps display data with null timing.
    expect(project.lines[1].words).toEqual([
      { end: null, gloss: "today", roman: "aaj", start: null, text: "आज" },
      { end: 2.5, gloss: "from", roman: "se", start: 2, text: "से" },
    ]);

    // Survives a JSON round-trip unchanged.
    expect(importProjectJson(exportProjectJson(project)).lines).toEqual(
      project.lines,
    );
  });

  it("round-trips video background settings", () => {
    const importedProject = importProjectJson(
      exportProjectJson(
        createDefaultProject({
          background: {
            assetName: "city-loop.mp4",
            scrim: {
              color: "#000000",
              enabled: true,
              opacity: 0.35,
            },
            type: "video",
          },
          lines: [
            {
              id: "video-line",
              original: "Looped skyline",
              start: 0,
            },
          ],
        }),
      ),
    );

    expect(importedProject.background).toMatchObject({
      assetName: "city-loop.mp4",
      scrim: {
        color: "#000000",
        enabled: true,
        opacity: 0.35,
      },
      type: "video",
    });
  });

  it("heals a project whose Devanagari text was corrupted to mojibake on import", () => {
    // Simulate a file that was double-encoded externally (UTF-8 read as Latin-1).
    const original = "आज से तेरी सारी गलियां मेरी हो गई";
    const word = "तेरी";
    const mojibake = (text) => Buffer.from(text, "utf8").toString("latin1");
    const corruptedJson = JSON.stringify({
      version: 1,
      meta: { title: mojibake("आज से तेरी"), artist: "" },
      lines: [
        {
          id: "a516f697-5a20-44e4",
          original: mojibake(original),
          translation: "From today, all your streets are mine",
          start: 41.44,
          words: [
            { text: mojibake(word), gloss: "your", roman: "teri", start: 43.3, end: 44.32 },
          ],
        },
      ],
    });

    const imported = importProjectJson(corruptedJson);

    expect(imported.meta.title).toBe("आज से तेरी");
    expect(imported.lines[0].original).toBe(original);
    expect(imported.lines[0].words[0].text).toBe(word);
    // Non-text fields are untouched.
    expect(imported.lines[0].id).toBe("a516f697-5a20-44e4");
    expect(imported.lines[0].words[0].start).toBe(43.3);
  });
});
