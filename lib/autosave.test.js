import { describe, expect, it } from "vitest";

import { AUTOSAVE_VERSION, decodeAutosave, encodeAutosave } from "./autosave";
import { createDefaultProject } from "./project";

function sampleProject() {
  return createDefaultProject({
    audio: { duration: 120, name: "song.mp3" },
    lines: [{ id: "line-1", original: "hello", start: 1.5, translation: "hi" }],
    meta: { artist: "Artist", title: "Song" },
  });
}

describe("autosave envelope", () => {
  it("round-trips the project, audio descriptor, and transcription pointer", () => {
    const raw = encodeAutosave({
      audioAsset: {
        assetId: "asset-1",
        durationSec: 120,
        kind: "audio",
        name: "song.mp3",
        sizeBytes: 4096,
      },
      project: sampleProject(),
      transcription: { appliedJobId: null, jobId: "job-1", mode: "lyrics" },
    });

    const decoded = decodeAutosave(raw);

    expect(decoded.project.meta.title).toBe("Song");
    expect(decoded.project.lines).toHaveLength(1);
    expect(decoded.audioAsset).toEqual({
      assetId: "asset-1",
      durationSec: 120,
      name: "song.mp3",
      sizeBytes: 4096,
    });
    expect(decoded.transcription).toEqual({
      appliedJobId: null,
      jobId: "job-1",
      mode: "lyrics",
    });
  });

  it("excludes transient fields by serializing through the project schema", () => {
    const raw = encodeAutosave({
      audioAsset: null,
      // Transient runtime junk that must never be persisted.
      project: { ...sampleProject(), isPlaying: true, selectedLineId: "x" },
      transcription: null,
    });

    expect(JSON.parse(raw).project).not.toHaveProperty("isPlaying");
    expect(JSON.parse(raw).project).not.toHaveProperty("selectedLineId");
    expect(decodeAutosave(raw).audioAsset).toBeNull();
    expect(decodeAutosave(raw).transcription).toBeNull();
  });

  it("discards an envelope from a different autosave version", () => {
    const raw = encodeAutosave({ project: sampleProject() });
    const bumped = JSON.parse(raw);
    bumped.v = AUTOSAVE_VERSION + 1;

    expect(decodeAutosave(JSON.stringify(bumped))).toBeNull();
  });

  it("returns null for malformed, empty, or schema-invalid data", () => {
    expect(decodeAutosave(null)).toBeNull();
    expect(decodeAutosave("")).toBeNull();
    expect(decodeAutosave("{not json")).toBeNull();

    const invalid = JSON.parse(encodeAutosave({ project: sampleProject() }));
    invalid.project.version = 99; // unsupported project version

    expect(decodeAutosave(JSON.stringify(invalid))).toBeNull();
  });

  it("drops a transcription pointer that has no jobId", () => {
    const raw = encodeAutosave({
      project: sampleProject(),
      transcription: { appliedJobId: "x", mode: "timing" },
    });

    expect(decodeAutosave(raw).transcription).toBeNull();
  });
});
