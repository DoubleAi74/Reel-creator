"use client";

import { useId } from "react";

import { formatSegmentRangeLabel } from "@/lib/generations/source-reference";

function formatSeconds(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  const total = Math.max(0, Math.floor(value));
  const mins = Math.floor(total / 60);
  const secs = total % 60;

  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function SaveGenerationModal({
  defaultTitle = "",
  errorMessage = "",
  includeMp3 = false,
  isOpen = false,
  isSaving = false,
  onClose,
  onSubmit,
  source = null,
}) {
  const titleId = useId();

  if (!isOpen) {
    return null;
  }

  const isYoutube = source?.type === "youtube" && Boolean(source?.youtubeUrl);
  const segmentLabel =
    formatSegmentRangeLabel(source) ||
    (Number.isFinite(source?.segmentStartSec) && Number.isFinite(source?.segmentEndSec)
      ? `${formatSeconds(source.segmentStartSec)} – ${formatSeconds(source.segmentEndSec)}`
      : null);

  return (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 p-3 sm:items-center"
      role="dialog"
    >
      <button
        aria-label="Close save dialog"
        className="absolute inset-0 cursor-default"
        onClick={() => {
          if (!isSaving) {
            onClose?.();
          }
        }}
        type="button"
      />

      <form
        className="relative z-10 flex max-h-[min(90vh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-soft)]"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const titleValue = formData.get("title");
          onSubmit?.({
            title: typeof titleValue === "string" ? titleValue.trim() : "",
          });
        }}
      >
        <div className="border-b border-[var(--border)] px-5 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
            Dashboard
          </p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--text)]" id={titleId}>
            Save generation
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Optional. By default we store the YouTube link and segment times — not the MP3.
          </p>
        </div>

        <div className="grid gap-4 overflow-y-auto px-5 py-4">
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
              Title
            </span>
            <input
              autoFocus
              className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm outline-none focus:border-[var(--accent)]"
              defaultValue={defaultTitle || ""}
              maxLength={180}
              name="title"
              placeholder="Public title (leave blank for private)"
            />
            <span className="text-xs text-[var(--muted)]">
              A title makes this card public on the dashboard. Blank keeps it private to this
              browser session.
            </span>
          </label>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
              Source (saved by default)
            </p>
            {isYoutube ? (
              <div className="mt-2 grid gap-1 text-sm">
                <p className="break-all text-[var(--text)]">{source.youtubeUrl}</p>
                <p className="text-[var(--muted)]">
                  Segment: {segmentLabel || "times not available"}
                </p>
              </div>
            ) : source?.type === "upload" ? (
              <p className="mt-2 text-sm text-[var(--muted)]">
                Uploaded MP3 (no YouTube link). Without the optional MP3 save, this card will not
                include playable audio.
              </p>
            ) : (
              <p className="mt-2 text-sm text-[var(--muted)]">
                Source reference unavailable. Lyrics and project data still save.
              </p>
            )}
          </div>

          {includeMp3 ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3">
              <p className="text-sm font-semibold text-[var(--text)]">
                MP3 audio selected
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                The password from the save area will be used.
              </p>
            </div>
          ) : null}

          {errorMessage ? (
            <p className="text-sm font-medium text-[var(--danger)]" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
          <button
            className="min-h-10 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 text-sm font-semibold transition hover:bg-[var(--surface-hover)] disabled:opacity-55"
            disabled={isSaving}
            onClick={() => onClose?.()}
            type="button"
          >
            Cancel
          </button>
          <button
            className="min-h-10 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--on-accent)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
            disabled={isSaving}
            type="submit"
          >
            {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
