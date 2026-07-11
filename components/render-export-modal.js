"use client";

import { getRenderStatusLabel } from "@/lib/export-flow";

function SummaryStat({ label, value }) {
  return (
    <div className="yt-modal__stat">
      <p className="yt-modal__stat-label">{label}</p>
      <p className="yt-modal__stat-value">{value}</p>
    </div>
  );
}

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
  const badgeClass =
    phase === "error"
      ? "yt-modal__badge is-error"
      : phase === "done"
        ? "yt-modal__badge is-done"
        : busy
          ? "yt-modal__badge is-active"
          : "yt-modal__badge";
  const description =
    phase === "starting"
      ? "Preparing browser export. You may be asked to share this tab."
      : phase === "polling"
        ? isReconnecting
          ? "Reconnecting…"
          : renderStatus === "queued"
            ? "Waiting to start tab capture…"
            : "Recording in this browser. Keep this tab focused until it finishes."
        : phase === "done"
          ? `Your ${formatLabel} should have downloaded. Check your downloads folder if you do not see a file.`
          : errorMessage;

  return (
    <div
      className="yt-modal-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onClose?.();
        }
      }}
    >
      <section
        aria-labelledby="export-modal-title"
        aria-modal="true"
        className="yt-modal"
        role="dialog"
      >
        <div className="yt-modal__header">
          <div className="min-w-0">
            <p className="yt-modal__eyebrow">Export {formatLabel}</p>
            <h2 className="yt-modal__title" id="export-modal-title">
              {projectTitle || "Reel Creator"}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className={badgeClass}>{statusLabel}</span>
            {!busy ? (
              <button
                aria-label="Close"
                className="yt-modal__close"
                onClick={onClose}
                type="button"
              >
                <CloseIcon />
              </button>
            ) : null}
          </div>
        </div>

        <div className="yt-modal__body">
          <div className="yt-modal__stats">
            <SummaryStat label="Lines" value={String(lineCount)} />
            <SummaryStat label="Section length" value={sectionLengthLabel} />
          </div>

          <div
            className={`yt-modal__status ${phase === "error" ? "is-error" : ""}`}
            role="status"
          >
            {busy ? <span aria-hidden="true" className="yt-spinner" /> : null}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <p className="m-0 text-sm font-semibold text-[var(--text)]">
                  {busy ? "Recording progress" : phase === "done" ? "Complete" : "Status"}
                </p>
                <p className="m-0 font-mono text-sm tabular-nums text-[var(--muted)]">
                  {progressPercent}%
                </p>
              </div>
              <div className="yt-modal__progress-track">
                <div
                  className={`yt-modal__progress-fill ${
                    phase === "error" ? "is-error" : phase === "done" ? "is-done" : ""
                  }`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              {description ? (
                <p className="mt-3 mb-0 text-sm leading-6">{description}</p>
              ) : null}
              {statusNote ? (
                <p className="mt-2 mb-0 text-sm leading-6 text-[var(--muted)]">{statusNote}</p>
              ) : null}
              {downloadError ? (
                <p className="mt-2 mb-0 text-sm leading-6 text-[var(--danger)]">
                  {downloadError}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="yt-modal__actions">
          {phase === "done" ? (
            <>
              <button className="yt-modal__button" onClick={onClose} type="button">
                Back to editor
              </button>
              {typeof onDownload === "function" ? (
                <button
                  className="yt-modal__button is-primary"
                  disabled={isDownloading}
                  onClick={onDownload}
                  type="button"
                >
                  {isDownloading ? "Downloading…" : `Download ${formatLabel}`}
                </button>
              ) : null}
            </>
          ) : null}

          {phase === "error" ? (
            <>
              <button className="yt-modal__button" onClick={onClose} type="button">
                Close
              </button>
              <button className="yt-modal__button is-primary" onClick={onRetry} type="button">
                Retry export
              </button>
            </>
          ) : null}

          {busy ? (
            <button className="yt-modal__button" disabled type="button">
              <span aria-hidden="true" className="yt-spinner" />
              Exporting…
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
