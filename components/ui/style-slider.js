"use client";

export function StyleSlider({
  label,
  max,
  min,
  onChange,
  step,
  value,
  valueLabel = value,
}) {
  return (
    <label className="block rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium text-[var(--muted)]">{label}</span>
        <span className="text-sm text-[var(--muted)]">{valueLabel}</span>
      </div>
      <input
        className="mt-4 w-full accent-[var(--accent)]"
        max={max}
        min={min}
        onChange={onChange}
        step={step}
        type="range"
        value={value}
      />
    </label>
  );
}
