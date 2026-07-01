"use client";

import { TimingRow } from "@/components/ui/timing-row";
import { formatSectionRelativeTime } from "@/lib/editor-format";

export function LyricsTab({ project, timing }) {
  const {
    activeTimingLineId,
    autoFollowEnabled,
    autoTiming,
    autoTimingBusy,
    canStart,
    controlsVisible,
    cursorLine,
    drafts,
    editingLineId,
    heardLineId,
    lineCount,
    nextLine,
    notice,
    onAddLine,
    onClearAll,
    onClearLineStart,
    onDeleteLine,
    onDraftCommit,
    onDraftReset,
    onJump,
    onMark,
    onMoveLine,
    onNudge,
    onPauseSession,
    onResumeSession,
    onSelectLine,
    onSetDrafts,
    onSetEditingLine,
    onSetNotice,
    onSetSelectedLine,
    onStartSession,
    onStopSession,
    onTapNext,
    onToggleControls,
    onUpdateLine,
    progress,
    rowRefs,
    sectionActive,
    session,
    startDisabledReason,
    startLine,
    startLineNumber,
    timedLineCount,
  } = timing;

  return (
    <div className="grid min-w-0 gap-3">
      {sectionActive && !session.active ? (
        <div className="flex justify-end">
          <button
            className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition lg:text-xs ${
              controlsVisible
                ? "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-hover)]"
                : "border-[var(--accent)] bg-[var(--surface-active)] text-[var(--accent)] hover:opacity-90"
            }`}
            onClick={onToggleControls}
            type="button"
          >
            {controlsVisible ? "Hide times" : "Set times"}
          </button>
        </div>
      ) : null}

      {controlsVisible ? (
      <div className="sticky top-0 z-10 rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface)] px-3 py-3 shadow-[0_18px_40px_rgba(2,6,23,0.24)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
              autoFollowEnabled
                ? "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-hover)]"
                : "border-[var(--accent)] bg-[var(--surface-active)] text-[var(--accent)] hover:bg-[var(--surface-hover)]"
            }`}
            onClick={onJump}
            type="button"
          >
            ↩ Jump
          </button>
          <span
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
              autoFollowEnabled
                ? "border-[var(--accent)] bg-[var(--surface-active)] text-[var(--accent)]"
                : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                autoFollowEnabled ? "bg-[var(--accent)]" : "bg-[var(--surface-2)]"
              }`}
            />
            {autoFollowEnabled ? "Auto-follow" : "Follow paused"}
          </span>
        </div>

        {session.active ? (
          <div className="mt-3 grid gap-3 border-t border-[var(--border)] pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-[var(--muted)]">
                <span className="rounded-full border border-[var(--accent)] bg-[var(--surface-active)] px-2.5 py-1 text-[var(--accent)]">
                  Line {progress.current} of {progress.total}
                </span>
                {session.paused ? (
                  <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-[var(--muted)]">
                    Paused
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {session.paused ? (
                  <button
                    className="rounded-full bg-[var(--accent)] px-3 py-1.5 text-[11px] font-semibold text-[var(--on-accent)] transition hover:opacity-90"
                    onClick={() => {
                      void onResumeSession();
                    }}
                    type="button"
                  >
                    Resume
                  </button>
                ) : (
                  <button
                    className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[11px] font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)]"
                    onClick={onPauseSession}
                    type="button"
                  >
                    Pause
                  </button>
                )}
                <button
                  className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[11px] font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={session.history.length === 0}
                  onClick={onUndoTap}
                  type="button"
                >
                  Undo
                </button>
                <button
                  className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[11px] font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)]"
                  onClick={() => onStopSession()}
                  type="button"
                >
                  Stop
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end lg:grid-cols-1">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.28em] text-[var(--muted)]">
                  Current
                </p>
                <p className="mt-1 truncate text-base font-semibold text-[var(--text)]">
                  {cursorLine?.original || `Line ${progress.current}`}
                </p>
                <p className="mt-1 truncate text-sm text-[var(--muted)]">
                  {cursorLine?.translation || "No translation"}
                </p>
                <p className="mt-2 truncate text-xs text-[var(--muted)]">
                  Next: {nextLine?.original || "Complete"}
                </p>
              </div>

              <button
                className="min-h-14 rounded-xl bg-[var(--accent)] px-6 py-4 text-sm font-bold text-[var(--on-accent)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 sm:min-w-44"
                disabled={session.paused}
                onClick={onTapNext}
                type="button"
              >
                Tap next line
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 grid gap-3 border-t border-[var(--border)] pt-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end lg:grid-cols-1 lg:items-stretch">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
                <span>
                  Line {startLineNumber ?? "—"} of {lineCount}
                </span>
                <span>
                  {timedLineCount} timed · {lineCount - timedLineCount} untimed
                </span>
              </div>
              <p className="mt-1 truncate text-sm font-medium text-[var(--muted)]">
                {startLine?.original || "No lyric lines"}
              </p>
              {startDisabledReason ? (
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {startDisabledReason}
                </p>
              ) : null}
              {autoTiming.status !== "idle" ? (
                <p
                  className={`mt-2 text-xs leading-5 ${
                    autoTiming.status === "error"
                      ? "text-[var(--danger)]"
                      : autoTiming.status === "success"
                        ? "text-[var(--muted)]"
                        : "text-[var(--accent)]"
                  }`}
                >
                  {autoTiming.title ? `${autoTiming.title}. ` : ""}
                  {autoTiming.message || autoTiming.detail}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <button
                className="rounded-full border border-[var(--border)] px-4 py-2.5 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-45"
                disabled={!canStart || autoTimingBusy}
                onClick={() => {
                  void onStartSession();
                }}
                type="button"
              >
                Start tap timing
              </button>
            </div>
          </div>
        )}

        {notice.message ? (
          <p
            className={`mt-3 text-sm leading-6 ${
              notice.status === "danger" ? "text-[var(--danger)]" : "text-[var(--muted)]"
            }`}
          >
            {notice.message}
          </p>
        ) : null}
      </div>
      ) : null}

      <div className="grid min-w-0 gap-2">
        {project.lines.map((line, index) => (
          <TimingRow
            canMoveDown={index < project.lines.length - 1}
            canMoveUp={index > 0}
            displayTime={formatSectionRelativeTime(line.start, project.audio)}
            index={index}
            isActive={activeTimingLineId === line.id}
            isEditing={activeTimingLineId === line.id && editingLineId === line.id}
            isHeard={heardLineId === line.id}
            key={line.id}
            line={line}
            onClear={() => {
              onClearLineStart(line.id);
              onSetNotice({
                message: `Cleared line ${index + 1}.`,
                status: "success",
              });
            }}
            onDelete={() => {
              onSetEditingLine(null);
              onDeleteLine(line.id);
            }}
            onDraftChange={(lineId, nextDraft) => {
              onSetSelectedLine(lineId);
              onSetDrafts((currentDrafts) => ({
                ...currentDrafts,
                [lineId]: nextDraft,
              }));
            }}
            onDraftCommit={onDraftCommit}
            onDraftReset={onDraftReset}
            onMark={onMark}
            onMoveDown={() => onMoveLine(line.id, 1)}
            onMoveUp={() => onMoveLine(line.id, -1)}
            onNudge={onNudge}
            onSelect={() => onSelectLine(line)}
            onToggleEdit={() =>
              onSetEditingLine((currentLineId) =>
                currentLineId === line.id ? null : line.id,
              )
            }
            onUpdateLine={(patch) => onUpdateLine(line.id, patch)}
            rowRef={(node) => {
              if (node) {
                rowRefs.current.set(line.id, node);
                return;
              }

              rowRefs.current.delete(line.id);
            }}
            timeValue={
              drafts[line.id] ??
              (Number.isFinite(line.start)
                ? formatSectionRelativeTime(line.start, project.audio)
                : "")
            }
          />
        ))}
      </div>

      <button
        className="rounded-[1.25rem] border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-4 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)]"
        onClick={onAddLine}
        type="button"
      >
        Add lyric line
      </button>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-[var(--muted)]">
        <p>
          Press <span className="text-[var(--muted)]">Enter</span> or tap{" "}
          <span className="text-[var(--muted)]">Mark</span> to time the active line.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {timedLineCount} timed · {lineCount - timedLineCount} untimed
          </span>
          <button
            className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--muted)]"
            onClick={onClearAll}
            type="button"
          >
            Clear all
          </button>
        </div>
      </div>
    </div>
  );
}
