import { describe, expect, it } from "vitest";

import { repairMojibake, repairMojibakeDeep } from "./text-encoding";

// Produce the exact corruption an external tool makes: correct UTF-8 bytes
// decoded as Latin-1.
function toMojibake(text) {
  return Buffer.from(text, "utf8").toString("latin1");
}

describe("repairMojibake", () => {
  it("repairs UTF-8-as-Latin-1 Devanagari back to correct text", () => {
    expect(repairMojibake(toMojibake("आज से तेरी"))).toBe("आज से तेरी");
    expect(repairMojibake(toMojibake("के"))).toBe("के");
    expect(repairMojibake(toMojibake("घुंगूंगा"))).toBe("घुंगूंगा");
  });

  it("leaves already-correct Unicode untouched", () => {
    expect(repairMojibake("आज से तेरी")).toBe("आज से तेरी");
    expect(repairMojibake("के")).toBe("के");
  });

  it("leaves ASCII (ids, hex colors, English) untouched", () => {
    expect(repairMojibake("a516f697-5a20-44e4")).toBe("a516f697-5a20-44e4");
    expect(repairMojibake("#FFFFFF")).toBe("#FFFFFF");
    expect(repairMojibake("From today, all your streets are mine")).toBe(
      "From today, all your streets are mine",
    );
  });

  it("leaves genuine Latin-1 text untouched (not valid UTF-8)", () => {
    // "café" is correct already; its bytes are not a valid UTF-8 sequence, so
    // the fatal decode rejects it and we keep the original.
    expect(repairMojibake("café")).toBe("café");
    expect(repairMojibake("naïve")).toBe("naïve");
  });

  it("ignores non-strings and empty strings", () => {
    expect(repairMojibake("")).toBe("");
    expect(repairMojibake(null)).toBe(null);
    expect(repairMojibake(42)).toBe(42);
  });
});

describe("repairMojibakeDeep", () => {
  it("repairs every string in a nested structure and preserves non-strings", () => {
    const corrupted = {
      lines: [
        {
          id: "L1",
          original: toMojibake("आज से तेरी"),
          start: 41.44,
          end: null,
          words: [
            { text: toMojibake("तेरी"), gloss: "your", start: 43.3, end: 44.32 },
          ],
        },
      ],
      style: { color: "#FFFFFF" },
    };

    expect(repairMojibakeDeep(corrupted)).toEqual({
      lines: [
        {
          id: "L1",
          original: "आज से तेरी",
          start: 41.44,
          end: null,
          words: [{ text: "तेरी", gloss: "your", start: 43.3, end: 44.32 }],
        },
      ],
      style: { color: "#FFFFFF" },
    });
  });
});
