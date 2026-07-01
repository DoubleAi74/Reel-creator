"use client";

export function CollapsibleSection({ children, onToggle, open, title }) {
  return (
    <section className="overflow-hidden rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface-2)]">
      <button
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)]"
        onClick={onToggle}
        type="button"
      >
        <span>{title}</span>
        <svg
          aria-hidden="true"
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div className="border-t border-[var(--border)] px-4 py-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}
