"use client";

export function StatusBadge({ children, tone = "neutral" }) {
  const toneClasses =
    tone === "accent"
      ? "border-[var(--accent)] bg-[var(--surface-active)] text-[var(--accent)]"
      : tone === "success"
        ? "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]"
        : tone === "danger"
          ? "border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]"
          : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]";

  return (
    <span
      className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] ${toneClasses}`}
    >
      {children}
    </span>
  );
}
