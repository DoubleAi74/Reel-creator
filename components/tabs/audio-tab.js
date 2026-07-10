"use client";

import { StatusBadge } from "@/components/ui/status-badge";
import { formatTime, SOURCE_LANGUAGE_OPTIONS } from "@/lib/editor-format";
import { LYRIC_PIPELINE_PRESETS } from "@/lib/staged-lyrics";

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

  return (
    <div className="grid gap-4">
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
          {youtube.enabled ? (
            <button
              className="pill rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!String(youtube.url ?? "").trim()}
              onClick={() => youtube.onOpen?.()}
              type="button"
            >
              Youtube segment
            </button>
          ) : null}
        </div>

        {youtube.enabled ? (
          <div className="youtube-import mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="field-label text-left">
              <input
                className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--text)] outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                onChange={(event) => youtube.onUrlChange?.(event.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                type="url"
                value={youtube.url ?? ""}
              />
            </label>
            {youtube.error ? (
              <p className="text-left text-sm leading-6 text-[var(--danger)] sm:col-span-2">
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
        <div className="auto-grid mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
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
          <div className="credit-generation-controls mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <label className="inline-flex items-center gap-2 text-sm font-semibold">
              <input
                checked={Boolean(credit.saveGeneration)}
                className="h-4 w-4 accent-[var(--accent)]"
                onChange={(event) =>
                  credit.onSaveGenerationChange?.(event.target.checked)
                }
                type="checkbox"
              />
              Save generation
            </label>

            <form
              className="ml-auto flex items-center gap-2"
              onSubmit={(event) => credit.onUnlockSubmit?.(event)}
            >
              <input
                aria-label="Generation password"
                className="min-h-9 w-40 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm outline-none focus:border-[var(--accent)]"
                onChange={(event) =>
                  credit.onUnlockPasswordChange?.(event.target.value)
                }
                placeholder="Password"
                type="password"
                value={credit.unlockPassword ?? ""}
              />
              <button
                className="min-h-9 whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-xs font-semibold text-[var(--text)] transition hover:bg-[var(--surface)] disabled:opacity-60"
                disabled={credit.unlockStatus === "submitting"}
                type="submit"
              >
                {credit.unlockStatus === "submitting" ? "Unlocking…" : "Unlock"}
              </button>
            </form>

            {credit.unlockMessage ? (
              <p
                className={`w-full text-xs ${
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

        <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
          Romanization is added automatically for non-Latin scripts.
        </p>

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

      {inlineNotice ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm leading-6 text-[var(--text)]">
          {inlineNotice}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] pt-4">
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
