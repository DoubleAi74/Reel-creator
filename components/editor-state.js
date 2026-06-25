"use client";

// Shared editor state for the cross-cutting signals the new workspace components
// (Word Board + preview) need without prop-drilling through the shell. This is a
// real useReducer hook over grouped slices; the shell publishes read-mostly
// project/audio signals into it and consumes the board's selection back.
//
// The board's own internal layout state (page/scroll/tileScale/etc.) deliberately
// stays local to useWordBoard — only the cross-boundary signals live here.

import { useMemo, useReducer } from "react";

export const initialEditorState = {
  // The lyric lines the board renders (mirrors projectState.lines).
  lines: [],
  selection: {
    // The board word the user clicked (drives preview line + gloss panel).
    selectedWord: null,
  },
  playback: {
    // Active line id during playback (drives board auto-follow + highlight).
    activeLineId: null,
    currentTime: 0,
    isPlaying: false,
  },
  ui: {
    autoFollowEnabled: true,
    isPreviewFullscreen: false,
  },
};

export function editorReducer(state, action) {
  switch (action.type) {
    case "setLines":
      return state.lines === action.lines
        ? state
        : { ...state, lines: action.lines };

    case "setSelectedWord":
      return {
        ...state,
        selection: { ...state.selection, selectedWord: action.word },
      };

    case "clearSelectedWord":
      return state.selection.selectedWord == null
        ? state
        : { ...state, selection: { ...state.selection, selectedWord: null } };

    case "setPlayback":
      return {
        ...state,
        playback: { ...state.playback, ...action.patch },
      };

    case "setAutoFollow":
      return {
        ...state,
        ui: { ...state.ui, autoFollowEnabled: Boolean(action.enabled) },
      };

    case "setPreviewFullscreen":
      return {
        ...state,
        ui: { ...state.ui, isPreviewFullscreen: Boolean(action.open) },
      };

    default:
      return state;
  }
}

export function useEditorState(overrides) {
  const [state, dispatch] = useReducer(editorReducer, undefined, () => ({
    ...initialEditorState,
    ...overrides,
  }));

  const actions = useMemo(
    () => ({
      setLines: (lines) => dispatch({ type: "setLines", lines }),
      setSelectedWord: (word) => dispatch({ type: "setSelectedWord", word }),
      clearSelectedWord: () => dispatch({ type: "clearSelectedWord" }),
      setPlayback: (patch) => dispatch({ type: "setPlayback", patch }),
      setAutoFollow: (enabled) => dispatch({ type: "setAutoFollow", enabled }),
      setPreviewFullscreen: (open) =>
        dispatch({ type: "setPreviewFullscreen", open }),
    }),
    [],
  );

  return { state, actions };
}
