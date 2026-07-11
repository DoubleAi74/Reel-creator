"use client";

import { CreditHeaderButtons } from "@/components/credit-header-buttons";

export function EditorHeader({
  artist,
  credit,
  onTogglePreview,
  onToggleWordBoard,
  showPreview,
  showWordBoard,
  title,
}) {
  return (
    <header className="top-frame flex items-center justify-between gap-3 lg:static lg:rounded-2xl lg:border lg:border-[var(--border)] lg:bg-[var(--shell)] lg:px-4 lg:py-2.5 lg:shadow-[var(--shadow-soft)]">
      <div className="top-inner w-full">
      <div className="brand-lockup flex min-w-0 items-center gap-3">
        <img
          src="/android-chrome-192x192.png"
          alt="Cross Lang"
          className="brand-mark flex-none object-cover"
        />
        <div className="brand-copy min-w-0 leading-tight">
          <div className="flex items-baseline gap-2">
            <h1 className="truncate text-sm font-semibold tracking-tight lg:text-base">
              {title || "Cross Lang"}
            </h1>
            {artist ? (
              <span className="hidden truncate text-xs text-[var(--muted)] lg:inline">
                · {artist}
              </span>
            ) : null}
          </div>
          <p className="text-[9px] uppercase tracking-[0.3em] text-[var(--muted)] lg:text-[10px]">
            Language is connection
          </p>
        </div>
      </div>

      <div className="header-right flex items-center gap-2 lg:gap-3">
      <div
        className="mobile-view-toggle inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-1"
        role="group"
        aria-label="Show or hide the preview and word board"
      >
        <button
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
            showPreview
              ? "is-active bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-soft)]"
              : "text-[var(--muted)]"
          }`}
          type="button"
          data-wsview="preview"
          aria-pressed={showPreview}
          onClick={onTogglePreview}
        >
          Preview
        </button>
        <button
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
            showWordBoard
              ? "is-active bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-soft)]"
              : "text-[var(--muted)]"
          }`}
          type="button"
          data-wsview="board"
          aria-pressed={showWordBoard}
          onClick={onToggleWordBoard}
        >
          Word board
        </button>
      </div>

        <CreditHeaderButtons {...(credit ?? {})} />
      </div>

      </div>
    </header>
  );
}
