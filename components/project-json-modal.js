"use client";

import { useRef } from "react";

export function ProjectJsonModal({
  draft,
  errorMessage,
  isOpen,
  onChange,
  onClose,
  onFileSelected,
  onImport,
}) {
  const fileInputRef = useRef(null);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--surface)] px-4 py-6 backdrop-blur">
      <div className="w-full max-w-3xl rounded-[2rem] border border-[var(--border)] bg-[#07111f] p-6 shadow-[0_32px_90px_rgba(2,6,23,0.58)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-cyan-200/70">
              Project import
            </p>
            <h2 className="mt-3 text-2xl font-semibold text-[var(--text)]">
              Paste project JSON or load a `.json` file
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
              Unknown fields are ignored, missing style/background values fall
              back to defaults, and invalid JSON keeps the current project
              untouched.
            </p>
          </div>

          <button
            className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)]"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>

        <input
          accept=".json,application/json"
          className="hidden"
          onChange={(event) => {
            onFileSelected(event.target.files?.[0] ?? null);
            event.target.value = "";
          }}
          ref={fileInputRef}
          type="file"
        />

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--on-accent)] transition hover:opacity-90"
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            Choose JSON file
          </button>
          <span className="text-sm text-[var(--muted)]">
            Expected shape: `lines`, plus optional `audio`, `style`, and `background`.
          </span>
        </div>

        <label className="mt-6 block">
          <span className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">
            Project JSON
          </span>
          <textarea
            className="mt-3 min-h-[320px] w-full rounded-[1.5rem] border border-[var(--border)] bg-[var(--surface)] px-4 py-4 font-mono text-sm leading-6 text-[var(--text)] outline-none"
            onChange={(event) => onChange(event.target.value)}
            placeholder={`{\n  "audio": { "name": "track.mp3", "duration": 42 },\n  "lines": [{ "original": "Hello world" }]\n}`}
            spellCheck={false}
            value={draft}
          />
        </label>

        {errorMessage ? (
          <p className="mt-4 text-sm leading-6 text-[var(--danger)]">{errorMessage}</p>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)]"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-full bg-cyan-300 px-5 py-2 text-sm font-semibold text-[var(--on-accent)] transition hover:bg-cyan-200"
            onClick={onImport}
            type="button"
          >
            Import project
          </button>
        </div>
      </div>
    </div>
  );
}
