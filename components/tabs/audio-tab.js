"use client";

import { StatusBadge } from "@/components/ui/status-badge";
import { formatTime, SOURCE_LANGUAGE_OPTIONS } from "@/lib/editor-format";
import { LYRIC_PIPELINE_PRESETS } from "@/lib/staged-lyrics";
import { extractYouTubeVideoId } from "@/lib/youtube-audio/youtube-url";

const PIPELINE_PRESET_OPTIONS = [
  {
    label: "Generate + Time",
    preset: LYRIC_PIPELINE_PRESETS.both,
  },
  {
    label: "Generate only",
    preset: LYRIC_PIPELINE_PRESETS.generateOnly,
  },
];

const PIPELINE_PHASE_OPTIONS = [
  {
    phase: "generate",
    title: "Generate lyrics",
    unavailable: "Upload an MP3 first.",
  },
  {
    phase: "time",
    title: "Time lyrics",
    unavailable: "Generate lyrics or add lyric lines first.",
  },
];

function getStatusTone(status) {
  if (status === "running") {
    return "accent";
  }

  if (status === "error") {
    return "danger";
  }

  if (status === "success") {
    return "success";
  }

  return "neutral";
}

function getStatusLabel(status) {
  if (status === "running") {
    return "Running";
  }

  if (status === "error") {
    return "Error";
  }

  if (status === "success") {
    return "Done";
  }

  if (status === "ready") {
    return "Ready";
  }

  return "Waiting";
}

function getRunButtonLabel(isBusy, preset, selectedCount) {
  if (isBusy) {
    return "Running...";
  }

  if (preset === LYRIC_PIPELINE_PRESETS.generateOnly) {
    return "Generate lyrics";
  }

  if (preset === LYRIC_PIPELINE_PRESETS.timeOnly) {
    return "Time lyrics";
  }

  return selectedCount > 0 ? "Run both" : "Run";
}

export function AudioTab({ audio, credit = {}, lyricsSource, project }) {
  const {
    isLoadingSample,
    objectUrl,
    onClear,
    onFile,
    onLoadSample,
    onPickFile,
    upload,
    youtube = {},
  } = audio;

  const {
    auto,
    autoLyricsBusy,
    autoTiming,
    autoTimingBusy,
    canGenerate,
    inlineNotice,
    languageRequirementMessage,
    onClearLyrics,
    onExportJson,
    onImportJson,
    onOtherSourceLanguage,
    onSourceLanguage,
    otherSourceLanguage,
    pipeline,
    sourceLanguage,
  } = lyricsSource;
  const hasTrack = Boolean(project.audio.name || upload.asset?.assetId || objectUrl);
  const youtubeUrlReady = Boolean(extractYouTubeVideoId(youtube.url ?? ""));
  const hasLyrics = project.lines.length > 0;
  const pipelineBusy = autoLyricsBusy || autoTimingBusy;
  const selectedPhaseCount = Array.isArray(pipeline?.selectedPhases)
    ? pipeline.selectedPhases.length
    : 0;
  const canRunSelectedPipeline = canGenerate && selectedPhaseCount > 0;
  const visibleNotice =
    autoTimingBusy ||
    autoTiming?.status === "error" ||
    (auto.status === "idle" && autoTiming?.status !== "idle")
      ? autoTiming
      : auto;
  const runButtonTitle = canRunSelectedPipeline
    ? undefined
    : !upload.asset?.assetId
      ? "Upload an MP3 before running the lyric pipeline."
      : languageRequirementMessage ||
        (selectedPhaseCount === 0 ? "Select a runnable mode." : undefined);
  const generationSaveStatus = credit.generationSave?.status ?? "idle";
  const saveIncludeMp3 = credit.saveIncludeMp3 === true;
  const saveAudioPassword = credit.saveAudioPassword ?? "";
  const generationSaveBaseDisabled =
    generationSaveStatus !== "ready" && generationSaveStatus !== "error";
  const generationSaveNeedsMp3Password =
    !generationSaveBaseDisabled && saveIncludeMp3 && !saveAudioPassword.trim();
  const generationSaveDisabled =
    generationSaveBaseDisabled || generationSaveNeedsMp3Password;
  const generationSaveLabel =
    generationSaveStatus === "saving"
      ? "Saving..."
      : generationSaveStatus === "saved"
        ? "Saved"
        : "Save";
  const generationSaveStatusLabel =
    generationSaveNeedsMp3Password
      ? "Enter MP3 password"
      : generationSaveStatus === "ready"
        ? "Ready to save"
        : generationSaveStatus === "saved"
          ? "Saved to dashboard"
          : generationSaveStatus === "saving"
            ? "Saving"
            : generationSaveStatus === "error"
              ? "Try again"
              : "Available after run";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div
        className="upload-card rounded-[1.5rem] border border-dashed border-[var(--border)] bg-[var(--surface)] px-5 pt-2.5 pb-5 text-center"
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          onFile(event.dataTransfer.files?.[0] ?? null);
        }}
      >
        <h2 className="text-base font-semibold text-[var(--text)]">
          Welcome to Cross Lang!
        </h2>
        <div className="button-row mt-5 flex flex-wrap items-center justify-center gap-3">
          <button
            className="pill primary rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--on-accent)] transition hover:opacity-90"
            onClick={() => onPickFile()}
            type="button"
          >
            Choose MP3
          </button>
          <button
            className="pill rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isLoadingSample}
            onClick={() => {
              void onLoadSample();
            }}
            type="button"
          >
            {isLoadingSample ? "Loading sample…" : "Load sample"}
          </button>
        </div>

        {youtube.enabled ? (
          <div className="youtube-import mx-auto mt-5 w-full max-w-[560px]">
            <div aria-hidden="true" className="flex items-center gap-3">
              <span className="h-px flex-1 bg-[var(--border)]" />
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                or import from YouTube
              </span>
              <span className="h-px flex-1 bg-[var(--border)]" />
            </div>
            <div className="mt-3 flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-1 pl-4 transition focus-within:border-[var(--accent)]">
              <svg
                aria-hidden="true"
                className="w-[22px] flex-none text-[var(--muted)]"
                fill="none"
                height="16"
                viewBox="0 0 22 16"
                width="22"
              >
                <rect fill="currentColor" height="16" opacity="0.25" rx="4" width="22" />
                <path d="M9 5l5 3-5 3V5z" fill="currentColor" />
              </svg>
              <input
                className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
                onChange={(event) => youtube.onUrlChange?.(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && youtubeUrlReady) {
                    event.preventDefault();
                    youtube.onOpen?.();
                  }
                }}
                placeholder="Paste a YouTube link"
                type="url"
                value={youtube.url ?? ""}
              />
              <button
                className="flex-none rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--on-accent)] transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!youtubeUrlReady}
                onClick={() => youtube.onOpen?.()}
                type="button"
              >
                Import
              </button>
            </div>
            {youtube.error ? (
              <p className="mt-2 text-left text-sm leading-6 text-[var(--danger)]">
                {youtube.error}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <p
        className={`track-status flex min-w-0 items-center rounded-[1rem] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm leading-6 ${
          upload.status === "error"
            ? "text-[var(--danger)]"
            : "text-[var(--muted)]"
        }`}
        title={upload.message}
      >
        <span className="min-w-0 truncate font-medium text-[var(--text)]">
          {project.audio.name || "No track"}
        </span>
        <span className="shrink-0 whitespace-nowrap">
          {" · "}
          {project.audio.duration > 0
            ? formatTime(project.audio.duration)
            : "—"}
          {" · "}
          {upload.status === "success" ? "ready" : upload.status}
        </span>
      </p>

      <div className="auto-card rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
        <div className="auto-grid mt-1 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="grid gap-3">
            <label className="field-label block">
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
            className="run-button min-w-[8.5rem] rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--on-accent)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!canRunSelectedPipeline}
            onClick={() => {
              void pipeline?.onRun?.();
            }}
            title={runButtonTitle}
            type="button"
          >
            {getRunButtonLabel(pipelineBusy, pipeline?.preset, selectedPhaseCount)}
          </button>
        </div>

        {credit?.enabled ? (
          <div className="mt-3 rounded-[1rem] border border-[var(--border)] bg-[var(--surface)] p-3">
            <form
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-2"
              onSubmit={(event) => credit.onUnlockSubmit?.(event)}
            >
              <input
                aria-label="Generation password"
                className="min-h-10 min-w-0 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-4 text-sm text-[var(--text)] outline-none transition focus:border-[var(--accent)]"
                onChange={(event) =>
                  credit.onUnlockPasswordChange?.(event.target.value)
                }
                placeholder="Generation password"
                type="password"
                value={credit.unlockPassword ?? ""}
              />
              <button
                className="min-h-10 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-4 text-sm font-semibold text-[var(--text)] transition hover:bg-[var(--surface-hover)] disabled:opacity-60"
                disabled={credit.unlockStatus === "submitting"}
                type="submit"
              >
                {credit.unlockStatus === "submitting" ? "Unlocking..." : "Unlock"}
              </button>
            </form>

            {credit.unlockMessage ? (
              <p
                className={`mt-2 text-xs leading-5 ${
                  credit.unlockStatus === "error"
                    ? "text-[var(--danger)]"
                    : "text-[var(--muted)]"
                }`}
              >
                {credit.unlockMessage}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="phase-row mt-4 flex flex-wrap gap-2" aria-label="Lyric pipeline mode">
          {PIPELINE_PRESET_OPTIONS.map((option) => {
            const active = pipeline?.preset === option.preset;

            return (
              <button
                className={`phase-chip rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  active
                    ? "is-active border-[var(--accent)] bg-[var(--surface-active)] text-[var(--accent)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--surface-hover)]"
                }`}
                disabled={pipelineBusy}
                key={option.preset}
                onClick={() => pipeline?.onPreset?.(option.preset)}
                type="button"
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="mt-4 grid gap-3" aria-label="Lyric pipeline status">
          {PIPELINE_PHASE_OPTIONS.map((option) => {
            const phaseStatus = pipeline?.statusByPhase?.[option.phase] ?? {
              message: option.unavailable,
              status: "idle",
              title: "Waiting",
            };

            return (
              <div
                className="grid gap-2 border-t border-[var(--border)] pt-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                key={option.phase}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--text)]">
                    {option.title}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                    {phaseStatus.message}
                  </p>
                </div>
                <StatusBadge tone={getStatusTone(phaseStatus.status)}>
                  {getStatusLabel(phaseStatus.status)}
                </StatusBadge>
              </div>
            );
          })}
        </div>

        {credit?.enabled ? (
          <div className="credit-generation-controls mt-4 rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <button
                className={`inline-flex min-h-10 items-center justify-center rounded-full border px-4 text-sm font-semibold transition ${
                  generationSaveDisabled
                    ? "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]"
                    : "border-[var(--text)] bg-[var(--text)] text-[var(--page)] hover:opacity-90"
                } disabled:cursor-not-allowed`}
                disabled={generationSaveDisabled}
                onClick={() => credit.onSaveGeneration?.()}
                type="button"
              >
                {generationSaveLabel}
              </button>
              <span
                className={`min-w-0 truncate text-xs font-medium ${
                  generationSaveNeedsMp3Password ||
                  generationSaveStatus === "error"
                    ? "text-[var(--danger)]"
                    : generationSaveStatus === "ready" ||
                        generationSaveStatus === "saved"
                      ? "text-[var(--accent)]"
                      : "text-[var(--muted)]"
                }`}
                role="status"
              >
                {generationSaveStatusLabel}
              </span>
            </div>

            <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm font-semibold text-[var(--text)]">
              <input
                checked={saveIncludeMp3}
                className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                disabled={
                  generationSaveStatus === "saving" ||
                  generationSaveStatus === "saved"
                }
                onChange={(event) =>
                  credit.onSaveIncludeMp3Change?.(event.target.checked)
                }
                type="checkbox"
              />
              <span>Save MP3</span>
            </label>

            {saveIncludeMp3 ? (
              <input
                aria-label="MP3 save password"
                autoComplete="off"
                className="mt-3 min-h-10 w-full rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-4 text-sm text-[var(--text)] outline-none transition focus:border-[var(--accent)] disabled:opacity-60"
                disabled={
                  generationSaveStatus === "saving" ||
                  generationSaveStatus === "saved"
                }
                onChange={(event) =>
                  credit.onSaveAudioPasswordChange?.(event.target.value)
                }
                placeholder="MP3 save password"
                type="password"
                value={saveAudioPassword}
              />
            ) : null}

            {credit.generationSave?.message ? (
              <p
                className={`mt-2 text-xs leading-5 ${
                  credit.generationSave?.status === "error"
                    ? "text-[var(--danger)]"
                    : "text-[var(--muted)]"
                }`}
              >
                {credit.generationSave?.message}
              </p>
            ) : null}
          </div>
        ) : null}

        {visibleNotice?.status !== "idle" ? (
          <div
            className={`mt-4 rounded-[1rem] border px-4 py-3 ${
              visibleNotice?.status === "error"
                ? "border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]"
                : visibleNotice?.status === "success"
                  ? "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]"
                  : "border-[var(--accent)] bg-[var(--surface-active)] text-[var(--accent)]"
            }`}
          >
            <p className="text-sm font-medium">{visibleNotice.title}</p>
            {visibleNotice.message ? (
              <p className="mt-1 text-sm leading-6">{visibleNotice.message}</p>
            ) : null}
            {visibleNotice.detail ? (
              <p className="mt-1 text-sm leading-6 opacity-80">
                {visibleNotice.detail}
              </p>
            ) : null}
          </div>
        ) : null}

      </div>

      {inlineNotice ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm leading-6 text-[var(--text)]">
          {inlineNotice}
        </div>
      ) : null}

      <div className="audio-actions-row border-t border-[var(--border)] pt-4">
        <button
          aria-label="Import JSON"
          className="audio-json-button"
          onClick={onImportJson}
          title="Import JSON"
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M7 3h7l4 4v14H7z" />
            <path d="M14 3v5h5" />
            <path d="M12 16V9" />
            <path d="m9 12 3-3 3 3" />
          </svg>
          <span>JSON</span>
        </button>
        <button
          aria-label="Export JSON"
          className="audio-json-button"
          onClick={onExportJson}
          title="Export JSON"
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M7 3h7l4 4v14H7z" />
            <path d="M14 3v5h5" />
            <path d="M12 9v7" />
            <path d="m9 13 3 3 3-3" />
          </svg>
          <span>JSON</span>
        </button>
        <button
          className="audio-clear-button"
          disabled={!hasTrack || isLoadingSample}
          onClick={onClear}
          type="button"
        >
          Clear track
        </button>
        <button
          className="audio-clear-button"
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
