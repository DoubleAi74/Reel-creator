"use client";

import { StatusBadge } from "@/components/ui/status-badge";
import { formatTime, SOURCE_LANGUAGE_OPTIONS } from "@/lib/editor-format";

export function AudioTab({ audio, lyricsSource, project }) {
  const {
    isLoadingSample,
    objectUrl,
    onClear,
    onFile,
    onLoadSample,
    onPickFile,
    upload,
  } = audio;

  const {
    auto,
    autoLyricsBusy,
    autoTimingBusy,
    canGenerate,
    inlineNotice,
    languageRequirementMessage,
    onClearLyrics,
    onExportJson,
    onGenerate,
    onImportJson,
    onOtherSourceLanguage,
    onSourceLanguage,
    otherSourceLanguage,
    sourceLanguage,
  } = lyricsSource;
  const hasTrack = Boolean(project.audio.name || upload.asset?.assetId || objectUrl);
  const hasLyrics = project.lines.length > 0;

  return (
    <div className="grid gap-4">
      <div
        className="rounded-[1.5rem] border border-dashed border-[var(--border)] bg-[var(--surface)] p-5 text-center"
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          onFile(event.dataTransfer.files?.[0] ?? null);
        }}
      >
        <p className="text-sm font-medium text-[var(--text)]">
          Drag an MP3 here or choose one from your computer
        </p>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Up to 25 MB. The uploaded track drives the persistent waveform dock,
          timing workflow, and later export.
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <button
            className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--on-accent)] transition hover:opacity-90"
            onClick={() => onPickFile()}
            type="button"
          >
            Choose MP3
          </button>
          <button
            className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isLoadingSample}
            onClick={() => {
              void onLoadSample();
            }}
            type="button"
          >
            {isLoadingSample ? "Loading sample…" : "Load sample"}
          </button>
          <StatusBadge
            tone={
              upload.status === "success"
                ? "success"
                : upload.status === "error"
                  ? "danger"
                  : "neutral"
            }
          >
            {upload.status}
          </StatusBadge>
        </div>
      </div>

      <p
        className={`truncate rounded-[1rem] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm leading-6 ${
          upload.status === "error"
            ? "text-[var(--danger)]"
            : "text-[var(--muted)]"
        }`}
        title={upload.message}
      >
        <span className="font-medium text-[var(--text)]">
          {project.audio.name || "No track"}
        </span>
        <span>
          {" · "}
          {project.audio.duration > 0
            ? formatTime(project.audio.duration)
            : "—"}
          {" · "}
          {upload.status === "success" ? "ready" : upload.status}
        </span>
      </p>

      <div className="rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-[var(--muted)]">Auto-lyrics</p>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Transcribe the uploaded MP3 and replace the current lyric lines with
              English translations.
            </p>
          </div>
          <StatusBadge
            tone={
              auto.status === "running"
                ? "accent"
                : auto.status === "success"
                  ? "success"
                  : auto.status === "error"
                    ? "danger"
                    : "neutral"
            }
          >
            {auto.status === "running" ? "Running" : auto.status}
          </StatusBadge>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="grid gap-3">
            <label className="block">
              <span className="text-[10px] font-medium uppercase tracking-[0.24em] text-[var(--muted)]">
                Source language
              </span>
              <select
                className="mt-2 w-full min-w-[11rem] rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none disabled:cursor-not-allowed disabled:opacity-50"
                disabled={autoLyricsBusy || autoTimingBusy}
                onChange={(event) => onSourceLanguage(event.target.value)}
                value={sourceLanguage}
              >
                <option disabled value="">
                  Select language
                </option>
                {SOURCE_LANGUAGE_OPTIONS.map((languageOption) => (
                  <option key={languageOption.id} value={languageOption.id}>
                    {languageOption.label}
                  </option>
                ))}
              </select>
            </label>

            {sourceLanguage === "other" ? (
              <label className="block">
                <span className="text-[10px] font-medium uppercase tracking-[0.24em] text-[var(--muted)]">
                  Other language
                </span>
                <input
                  className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={autoLyricsBusy || autoTimingBusy}
                  onChange={(event) => onOtherSourceLanguage(event.target.value)}
                  placeholder="e.g. Tamil"
                  type="text"
                  value={otherSourceLanguage}
                />
              </label>
            ) : null}
          </div>

          <button
            className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--on-accent)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!canGenerate}
            onClick={() => {
              void onGenerate();
            }}
            title={
              canGenerate
                ? undefined
                : !upload.asset?.assetId
                  ? "Upload an MP3 before generating and timing lyrics."
                  : languageRequirementMessage || undefined
            }
            type="button"
          >
            {autoLyricsBusy ? "Generating & timing..." : "Generate & time lyrics"}
          </button>
        </div>

        <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
          Romanization is added automatically for non-Latin scripts.
        </p>

        {auto.status !== "idle" ? (
          <div
            className={`mt-4 rounded-[1rem] border px-4 py-3 ${
              auto.status === "error"
                ? "border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]"
                : auto.status === "success"
                  ? "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]"
                  : "border-[var(--accent)] bg-[var(--surface-active)] text-[var(--accent)]"
            }`}
          >
            <p className="text-sm font-medium">{auto.title}</p>
            {auto.message ? (
              <p className="mt-1 text-sm leading-6">{auto.message}</p>
            ) : null}
            {auto.detail ? (
              <p className="mt-1 text-sm leading-6 opacity-80">{auto.detail}</p>
            ) : null}
          </div>
        ) : null}

        {!upload.asset?.assetId ? (
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            Upload an MP3 first to enable generation.
          </p>
        ) : languageRequirementMessage ? (
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            {languageRequirementMessage}
          </p>
        ) : null}
      </div>

      <div className="rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
        <p className="text-sm font-medium text-[var(--muted)]">Lyrics data</p>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Import a project JSON to load existing lyrics and timings, or export the
          current project to a file.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            className="rounded-full bg-[var(--surface-2)] px-4 py-2 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)]"
            onClick={onImportJson}
            type="button"
          >
            Import JSON
          </button>
          <button
            className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)]"
            onClick={onExportJson}
            type="button"
          >
            Export JSON
          </button>
        </div>
        {inlineNotice ? (
          <div className="mt-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm leading-6 text-[var(--text)]">
            {inlineNotice}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] pt-4">
        <button
          className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-sm font-medium text-[var(--danger)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!hasTrack || isLoadingSample}
          onClick={onClear}
          type="button"
        >
          Clear track
        </button>
        <button
          className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-sm font-medium text-[var(--danger)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!hasLyrics}
          onClick={onClearLyrics}
          type="button"
        >
          Clear lyrics
        </button>
      </div>
    </div>
  );
}
