"use client";

import { createContext, useContext } from "react";

// Context carrying { state, actions } from useEditorState. New workspace
// components (Word Board, preview slot) read cross-cutting signals here instead
// of threading props through the shell.
const EditorContext = createContext(null);

export function EditorProvider({ value, children }) {
  return (
    <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
  );
}

export function useEditor() {
  const value = useContext(EditorContext);
  if (!value) {
    throw new Error("useEditor must be used within an EditorProvider.");
  }
  return value;
}

// Safe variant for components that may render outside the provider (returns null
// rather than throwing) — used by leaf components that degrade gracefully.
export function useOptionalEditor() {
  return useContext(EditorContext);
}
