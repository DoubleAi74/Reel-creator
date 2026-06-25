import { describe, expect, it } from "vitest";

import { editorReducer, initialEditorState } from "./editor-state";

describe("editorReducer", () => {
  it("sets and clears the selected board word", () => {
    const selected = editorReducer(initialEditorState, {
      type: "setSelectedWord",
      word: { id: "w1", original: "आज", english: "today" },
    });
    expect(selected.selection.selectedWord.id).toBe("w1");

    const cleared = editorReducer(selected, { type: "clearSelectedWord" });
    expect(cleared.selection.selectedWord).toBeNull();
    // clearing an already-null selection returns the same reference
    expect(editorReducer(cleared, { type: "clearSelectedWord" })).toBe(cleared);
  });

  it("patches playback signals without dropping others", () => {
    const next = editorReducer(initialEditorState, {
      type: "setPlayback",
      patch: { currentTime: 12.5, isPlaying: true },
    });
    expect(next.playback).toMatchObject({
      activeLineId: null,
      currentTime: 12.5,
      isPlaying: true,
    });
  });

  it("toggles auto-follow and fullscreen as booleans", () => {
    const a = editorReducer(initialEditorState, {
      type: "setAutoFollow",
      enabled: 0,
    });
    expect(a.ui.autoFollowEnabled).toBe(false);

    const b = editorReducer(a, { type: "setPreviewFullscreen", open: 1 });
    expect(b.ui.isPreviewFullscreen).toBe(true);
  });

  it("keeps the same reference when setLines receives the same array", () => {
    const lines = [{ id: "l1" }];
    const first = editorReducer(initialEditorState, { type: "setLines", lines });
    expect(first.lines).toBe(lines);
    expect(editorReducer(first, { type: "setLines", lines })).toBe(first);
  });

  it("ignores unknown actions", () => {
    expect(editorReducer(initialEditorState, { type: "nope" })).toBe(
      initialEditorState,
    );
  });
});
