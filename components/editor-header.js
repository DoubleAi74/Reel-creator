"use client";

export function EditorHeader({
  artist,
  onTogglePreview,
  onToggleWordBoard,
  showPreview,
  showWordBoard,
  title,
}) {
  return (
    <header className="top-frame absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-3 bg-gradient-to-b from-[var(--page)] via-[var(--page)]/70 to-transparent px-4 pb-7 pt-4 lg:static lg:rounded-2xl lg:border lg:border-[var(--border)] lg:bg-[var(--shell)] lg:px-4 lg:py-2.5 lg:shadow-[var(--shadow-soft)]">
      <div className="top-inner">
      <div className="brand-lockup flex min-w-0 items-center gap-3">
        <div className="brand-mark flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-bold text-[var(--on-accent)] lg:h-9 lg:w-9 lg:rounded-xl lg:text-sm">
          RC
        </div>
        <div className="brand-copy min-w-0 leading-tight">
          <p className="text-[9px] uppercase tracking-[0.3em] text-[var(--muted)] lg:text-[10px]">
            Vertical lyric video maker
          </p>
          <div className="flex items-baseline gap-2">
            <h1 className="truncate text-sm font-semibold tracking-tight lg:text-base">
              {title || "Reel Creator"}
            </h1>
            {artist ? (
              <span className="hidden truncate text-xs text-[var(--muted)] lg:inline">
                · {artist}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div
        className="mobile-view-toggle"
        role="group"
        aria-label="Show or hide the preview and word board"
      >
        <button
          className={showPreview ? "is-active" : ""}
          type="button"
          data-wsview="preview"
          aria-pressed={showPreview}
          onClick={onTogglePreview}
        >
          Preview
        </button>
        <button
          className={showWordBoard ? "is-active" : ""}
          type="button"
          data-wsview="board"
          aria-pressed={showWordBoard}
          onClick={onToggleWordBoard}
        >
          Word board
        </button>
      </div>

      </div>
    </header>
  );
}
