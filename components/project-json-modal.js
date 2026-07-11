"use client";

import { useRef } from "react";

function CloseIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 14 14" width="14">
      <path
        d="M2 2l10 10M12 2L2 12"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function ProjectJsonModal({
  draft,
  errorMessage,
  isOpen,
  onChange,
  onClose,
  onFileSelected,
  onImport,
  onStartNew,
}) {
  const fileInputRef = useRef(null);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="yt-modal-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose?.();
        }
      }}
    >
      <section
        aria-labelledby="project-json-title"
        aria-modal="true"
        className="yt-modal is-wide"
        role="dialog"
      >
        <div className="yt-modal__header">
          <div className="min-w-0">
            <p className="yt-modal__eyebrow">Project import / export</p>
            <h2 className="yt-modal__title" id="project-json-title">
              Paste project JSON or load a file
            </h2>
            <p className="yt-modal__lede">
              Unknown fields are ignored, missing style and background values fall back to
              defaults, and invalid JSON keeps the current project untouched.
            </p>
          </div>
          <button
            aria-label="Close"
            className="yt-modal__close"
            onClick={onClose}
            type="button"
          >
            <CloseIcon />
          </button>
        </div>

        <input
          accept=".json,application/json"
          className="hidden"
          hidden
          onChange={(event) => {
            onFileSelected(event.target.files?.[0] ?? null);
            event.target.value = "";
          }}
          ref={fileInputRef}
          type="file"
        />

        <div className="yt-modal__body">
          <div className="yt-modal__controls" style={{ marginTop: 0 }}>
            <button
              className="yt-modal__button is-primary"
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              Choose JSON file
            </button>
            <p className="yt-modal__hint m-0 flex-1">
              Expected shape: <code>lines</code>, plus optional <code>audio</code>,{" "}
              <code>style</code>, and <code>background</code>.
            </p>
          </div>

          <label className="yt-modal__field">
            <span>Project JSON</span>
            <textarea
              className="yt-modal__textarea"
              onChange={(event) => onChange(event.target.value)}
              placeholder={`{\n  "audio": { "name": "track.mp3", "duration": 42 },\n  "lines": [{ "original": "Hello world" }]\n}`}
              spellCheck={false}
              value={draft}
            />
          </label>

          {errorMessage ? (
            <p className="yt-modal__status is-error m-0" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </div>

        <div className="yt-modal__actions">
          {onStartNew ? (
            <button
              className="yt-modal__button is-danger"
              onClick={onStartNew}
              style={{ marginRight: "auto" }}
              type="button"
            >
              Start new project
            </button>
          ) : null}
          <button className="yt-modal__button" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="yt-modal__button is-primary" onClick={onImport} type="button">
            Import project
          </button>
        </div>
      </section>
    </div>
  );
}
