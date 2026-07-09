"use client";

import Link from "next/link";

import { formatGbpFromMinor } from "../lib/money";

export function CreditChrome({
  balanceMinor = 0,
  enabled = false,
  onSaveGenerationChange,
  onTopUpAmountChange,
  onTopUpSubmit,
  onUnlockPasswordChange,
  onUnlockSubmit,
  saveGeneration,
  status = "idle",
  topUpAmount,
  topUpMessage,
  topUpStatus,
  unlockMessage,
  unlockPassword,
  unlockStatus,
}) {
  if (!enabled) {
    return null;
  }

  const busy = status === "loading";

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-[8rem]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
            Credits
          </p>
          <p className="text-sm font-semibold tabular-nums">
            {busy ? "Checking" : formatGbpFromMinor(balanceMinor)}
          </p>
        </div>

        <label className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-xs font-semibold">
          <input
            checked={saveGeneration}
            className="h-4 w-4 accent-[var(--accent)]"
            onChange={(event) => onSaveGenerationChange(event.target.checked)}
            type="checkbox"
          />
          Save
        </label>

        <form className="flex items-center gap-2" onSubmit={onUnlockSubmit}>
          <input
            aria-label="Generation password"
            className="min-h-9 w-28 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-xs outline-none focus:border-[var(--accent)]"
            onChange={(event) => onUnlockPasswordChange(event.target.value)}
            placeholder="Password"
            type="password"
            value={unlockPassword}
          />
          <button
            className="min-h-9 rounded-lg bg-[var(--text)] px-3 text-xs font-semibold text-[var(--page)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
            disabled={unlockStatus === "submitting"}
            type="submit"
          >
            Unlock
          </button>
        </form>

        <form className="flex items-center gap-2" onSubmit={onTopUpSubmit}>
          <input
            aria-label="Top-up amount"
            className="min-h-9 w-20 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-xs tabular-nums outline-none focus:border-[var(--accent)]"
            inputMode="decimal"
            onChange={(event) => onTopUpAmountChange(event.target.value)}
            value={topUpAmount}
          />
          <button
            className="min-h-9 rounded-lg bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--on-accent)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
            disabled={topUpStatus === "submitting"}
            type="submit"
          >
            Top up
          </button>
        </form>

        <Link
          className="inline-flex min-h-9 items-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-xs font-semibold text-[var(--text)] transition hover:bg-[var(--surface-hover)]"
          href="/dashboard"
        >
          Dashboard
        </Link>
      </div>

      {unlockMessage || topUpMessage ? (
        <p className="mt-2 text-xs text-[var(--muted)]" role="status">
          {unlockMessage || topUpMessage}
        </p>
      ) : null}
    </section>
  );
}
