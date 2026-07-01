"use client";

export function StyleColorField({ label, onChange, value }) {
  return (
    <label className="block rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
      <span className="text-sm font-medium text-[var(--muted)]">{label}</span>
      <div className="mt-4 flex items-center gap-3">
        <input
          className="h-11 w-16 rounded-lg border border-[var(--border)] bg-transparent"
          onChange={onChange}
          type="color"
          value={value}
        />
        <code className="text-sm text-[var(--muted)]">{value}</code>
      </div>
    </label>
  );
}
