"use client";

import { getRenderStatusLabel } from "@/lib/export-flow";

function SummaryStat({ label, value }) {
  return (
    <div className="rounded-[1rem] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.28em] text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-sm font-medium text-[var(--muted)]">{value}</p>
    </div>
  );
}

export function RenderExportModal({
  downloadError,
  errorMessage,
  formatLabel = "MP4",
  isDownloading,
  isReconnecting,
  lineCount,
  onClose,
  onDownload,
  onRetry,
  phase,
  progressPercent,
  projectTitle,
  renderStatus,
  sectionLengthLabel,
  statusNote,
}) {
  const resolvedStatus =
    phase === "done"
      ? "done"
      : phase === "error"
        ? "error"
        : renderStatus;
  const statusLabel = getRenderStatusLabel(resolvedStatus);
  const busy = phase === "starting" || phase === "polling";
  const toneClasses =
    phase === "error"
      ? "border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]"
      : phase === "done"
        ? "border-emerald-300/25 bg-emerald-300/12 text-emerald-100"
        : "border-[var(--accent)] bg-[var(--surface-active)] text-[var(--accent)]";
  const description =
    phase === "starting"
      ? "Packing your current lyrics, styling, and audio references for the local renderer."
      : phase === "polling"
        ? isReconnecting
          ? "Connection hiccup. The render job is still running locally, and the app is reconnecting to it now."
          : renderStatus === "queued"
            ? "The render job is queued. The app will keep polling until local rendering starts."
            : "Rendering the MP4 now. Keep this tab open while progress updates."
        : phase === "done"
          ? `Your ${formatLabel} is ready. If the download did not start automatically, use the button below.`
          : errorMessage;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[var(--surface)] p-4 backdrop-blur-md">
      <div className="w-full max-w-xl rounded-[2rem] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(16,34,59,0.96)_0%,rgba(5,10,18,0.98)_100%)] p-5 shadow-[0_40px_120px_rgba(0,0,0,0.55)] sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">
              Export {formatLabel}
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-[var(--text)]">
              {projectTitle || "Reel Creator"}
            </h2>
          </div>
          <span
            className={`rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.24em] ${toneClasses}`}
          >
            {statusLabel}
          </span>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <SummaryStat label="Lines" value={String(lineCount)} />
          <SummaryStat label="Section length" value={sectionLengthLabel} />
        </div>

        <div className="mt-5 rounded-[1.35rem] border border-[var(--border)] bg-black/22 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-[var(--muted)]">Render progress</p>
            <p className="font-mono text-sm text-[var(--muted)]">{progressPercent}%</p>
          </div>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${
                phase === "error"
                  ? "bg-[var(--danger)]"
                  : phase === "done"
                    ? "bg-[var(--accent)]"
                    : "bg-[var(--accent)]"
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <p
            className={`mt-4 text-sm leading-6 ${
              phase === "error" ? "text-[var(--danger)]" : "text-[var(--muted)]"
            }`}
          >
            {description}
          </p>

          {statusNote ? (
            <p
              className={`mt-3 text-sm leading-6 ${
                phase === "done" ? "text-emerald-100" : "text-[var(--muted)]"
              }`}
            >
              {statusNote}
            </p>
          ) : null}

          {downloadError ? (
            <p className="mt-3 text-sm leading-6 text-[var(--danger)]">{downloadError}</p>
          ) : null}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          {phase === "done" ? (
            <>
              <button
                className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)]"
                onClick={onClose}
                type="button"
              >
                Back to editor
              </button>
              <button
                className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--on-accent)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isDownloading}
                onClick={onDownload}
                type="button"
              >
                {isDownloading ? "Downloading..." : `Download ${formatLabel}`}
              </button>
            </>
          ) : null}

          {phase === "error" ? (
            <>
              <button
                className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)]"
                onClick={onClose}
                type="button"
              >
                Close
              </button>
              <button
                className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--on-accent)] transition hover:opacity-90"
                onClick={onRetry}
                type="button"
              >
                Retry export
              </button>
            </>
          ) : null}

          {busy ? (
            <button
              className="rounded-full bg-[var(--surface-2)] px-4 py-2 text-sm font-medium text-[var(--muted)]"
              disabled
              type="button"
            >
              Exporting...
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
