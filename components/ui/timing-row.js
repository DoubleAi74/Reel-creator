"use client";

import { AutoGrowTextarea } from "@/components/ui/auto-grow-textarea";
import { getLineSummary } from "@/lib/editor-format";

export function TimingRow({
  canMoveDown,
  canMoveUp,
  displayTime,
  index,
  isActive,
  isEditing,
  isHeard,
  line,
  onClear,
  onDelete,
  onDraftChange,
  onDraftCommit,
  onDraftReset,
  onMark,
  onMoveDown,
  onMoveUp,
  onNudge,
  onSelect,
  onToggleEdit,
  onUpdateLine,
  rowRef,
  timeValue,
}) {
  return (
    <div
      className={`relative min-w-0 max-w-full overflow-hidden rounded-[1rem] border px-2.5 py-2 transition ${
        isActive
          ? "border-[var(--accent)] bg-[var(--surface-active)] pr-10 shadow-[var(--shadow-soft)]"
          : isHeard
            ? "border-[var(--border)] bg-[var(--surface-2)]"
            : "border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)]"
      }`}
      onClick={onSelect}
      ref={rowRef}
      role="button"
      tabIndex={0}
      title={getLineSummary(line)}
    >
      {isActive ? (
        <button
          aria-label={isEditing ? "Close line editor" : "Edit line text"}
          className={`absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md border text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)] ${
            isEditing
              ? "border-[var(--accent)] bg-[var(--surface-active)] text-[var(--accent)]"
              : "border-[var(--border)] bg-[var(--surface)]"
          }`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleEdit();
          }}
          title={isEditing ? "Close line editor" : "Edit line text"}
          type="button"
        >
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
      ) : null}

      <div className="flex min-w-0 items-center gap-2.5">
        {isActive ? (
          <input
            className="w-[74px] flex-none rounded-md border border-[var(--accent)] bg-[var(--surface-active)] px-2 py-1 font-mono text-[11px] text-[var(--accent)] outline-none"
            onBlur={() => onDraftCommit(line.id)}
            onChange={(event) => onDraftChange(line.id, event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onFocus={onSelect}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                // Enter always stamps the playhead + advances (identical to
                // Mark), whether or not this line is already timed. Discard any
                // in-progress typed value; commit a typed time with Tab / blur.
                event.preventDefault();
                onDraftReset(line.id);
                onMark();
                return;
              }

              if (event.key === "Escape") {
                event.preventDefault();
                onDraftReset(line.id);
              }
            }}
            value={timeValue}
          />
        ) : (
          <span
            className={`flex-none rounded-md px-2 py-1 font-mono text-[11px] ${
              Number.isFinite(line.start)
                ? "bg-[var(--surface-2)] text-[var(--muted)]"
                : "bg-[var(--surface-2)] text-[var(--muted)]"
            }`}
          >
            {Number.isFinite(line.start) ? displayTime : "—:—"}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="min-w-0 truncate text-[13px] font-medium text-[var(--text)] sm:text-sm">
              {line.original || `Line ${index + 1}`}
            </p>
            {isActive ? (
              <span className="shrink-0 text-[9px] uppercase tracking-[0.28em] text-[var(--accent)]">
                Active
              </span>
            ) : null}
          </div>
          <p className="truncate text-[11px] text-[var(--muted)]">
            {line.translation || "No translation"}
          </p>
        </div>
      </div>

      {isActive ? (
        <div className="mt-2 grid min-w-0 grid-cols-3 gap-1.5 sm:grid-cols-6">
          {[-0.5, -0.05, 0.05, 0.5].map((delta) => (
            <button
              className="min-w-0 truncate rounded-md border border-[var(--border)] px-1.5 py-1 font-mono text-[11px] text-[var(--muted)] transition hover:bg-[var(--surface-hover)]"
              key={delta}
              onClick={(event) => {
                event.stopPropagation();
                onNudge(delta);
              }}
              type="button"
            >
              {delta > 0 ? "+" : ""}
              {Math.abs(delta) === 0.5 ? delta.toFixed(1) : delta.toFixed(2)}
            </button>
          ))}

          <button
            className="min-w-0 truncate rounded-md border border-[var(--accent)] bg-[var(--surface-active)] px-1.5 py-1 text-[11px] font-semibold text-[var(--accent)] transition hover:bg-[var(--surface-hover)]"
            onClick={(event) => {
              event.stopPropagation();
              onMark();
            }}
            type="button"
          >
            {Number.isFinite(line.start) ? "Re-time" : "Mark"}
          </button>
          <button
            className="min-w-0 truncate rounded-md border border-[var(--border)] px-1.5 py-1 text-[11px] font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)]"
            onClick={(event) => {
              event.stopPropagation();
              onClear();
            }}
            type="button"
          >
            Clear
          </button>
        </div>
      ) : null}

      {isEditing ? (
        <div
          className="mt-3 grid gap-2 rounded-[0.85rem] border border-[var(--border)] bg-[var(--surface)] p-3"
          onClick={(event) => event.stopPropagation()}
        >
          <label className="block">
            <span className="block text-right text-[9px] font-medium uppercase tracking-[0.18em] text-[var(--muted)]">
              Original
            </span>
            <AutoGrowTextarea
              className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none"
              onChange={(event) =>
                onUpdateLine({ original: event.target.value })
              }
              onClick={(event) => event.stopPropagation()}
              value={line.original}
            />
          </label>

          <label className="block">
            <span className="block text-right text-[9px] font-medium uppercase tracking-[0.18em] text-[var(--muted)]">
              Romanization
            </span>
            <AutoGrowTextarea
              className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm italic text-[var(--muted)] outline-none"
              onChange={(event) =>
                onUpdateLine({ romanization: event.target.value })
              }
              onClick={(event) => event.stopPropagation()}
              placeholder="Romanized text (optional)"
              value={line.romanization ?? ""}
            />
          </label>

          <label className="block">
            <span className="block text-right text-[9px] font-medium uppercase tracking-[0.18em] text-[var(--muted)]">
              Translation
            </span>
            <AutoGrowTextarea
              className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none"
              onChange={(event) =>
                onUpdateLine({
                  translation: event.target.value,
                })
              }
              onClick={(event) => event.stopPropagation()}
              value={line.translation}
            />
          </label>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs font-medium uppercase tracking-[0.24em] text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canMoveUp}
              onClick={(event) => {
                event.stopPropagation();
                onMoveUp();
              }}
              type="button"
            >
              Up
            </button>
            <button
              className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs font-medium uppercase tracking-[0.24em] text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canMoveDown}
              onClick={(event) => {
                event.stopPropagation();
                onMoveDown();
              }}
              type="button"
            >
              Down
            </button>
            <button
              className="rounded-full bg-[var(--danger-soft)] px-3 py-1.5 text-xs font-medium uppercase tracking-[0.24em] text-[var(--danger)] transition hover:bg-[var(--danger-soft)]"
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
              type="button"
            >
              Delete
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
