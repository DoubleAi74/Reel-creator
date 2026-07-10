"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { formatGbpFromMinor } from "@/lib/money";

const iconButtonClasses =
  "inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)] transition hover:bg-[var(--surface)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

const pillButtonClasses =
  "inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-[var(--text)] transition hover:bg-[var(--surface)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

function BriefcaseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0 1 12 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 0 1-.673-.38m0 0A2.18 2.18 0 0 1 3 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894m7.5 0a48.667 48.667 0 0 0-7.5 0M12 12.75h.008v.008H12v-.008Z"
      />
    </svg>
  );
}

function MoneyIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z"
      />
    </svg>
  );
}

// Desktop-only header actions: a dashboard link + a credits/top-up dropdown.
// Reuses the balance + top-up state/handlers already wired in the editor shell;
// renders nothing when the credit layer is disabled (matches CreditChrome).
export function CreditHeaderButtons({
  balanceMinor = 0,
  dashboardHref = "/dashboard",
  enabled = false,
  onTopUpAmountChange,
  onTopUpSubmit,
  status = "idle",
  topUpAmount = "",
  topUpMessage = "",
  topUpStatus = "idle",
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  if (!enabled) {
    return null;
  }

  const checkingBalance = status === "loading";
  const submitting = topUpStatus === "submitting";

  return (
    <div
      className="credit-header-actions hidden items-center justify-end gap-2 lg:inline-flex"
      ref={wrapperRef}
    >
      <div className="relative">
        <button
          type="button"
          className={iconButtonClasses}
          aria-label="Credits and add money"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          title="Credits"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <MoneyIcon />
        </button>

        {menuOpen ? (
          <div
            className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-soft)]"
            role="dialog"
            aria-label="Credits"
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
              Credits
            </p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums">
              {checkingBalance ? "Checking…" : formatGbpFromMinor(balanceMinor)}
            </p>

            <form
              className="mt-3 flex items-center gap-2"
              onSubmit={(event) => {
                onTopUpSubmit?.(event);
              }}
            >
              <span className="text-sm text-[var(--muted)]">£</span>
              <input
                aria-label="Top-up amount in pounds"
                className="min-h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm outline-none focus:border-[var(--accent)]"
                inputMode="decimal"
                onChange={(event) => onTopUpAmountChange?.(event.target.value)}
                placeholder="5.00"
                value={topUpAmount}
              />
              <button
                type="submit"
                className="min-h-9 whitespace-nowrap rounded-lg bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--on-accent)] transition hover:opacity-90 disabled:opacity-60"
                disabled={submitting}
              >
                {submitting ? "…" : "Add money"}
              </button>
            </form>

            {topUpMessage ? (
              <p
                className={`mt-2 text-xs ${
                  topUpStatus === "error"
                    ? "text-[var(--danger)]"
                    : "text-[var(--muted)]"
                }`}
              >
                {topUpMessage}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <Link
        href={dashboardHref}
        className={pillButtonClasses}
        aria-label="Open generations dashboard"
        title="Dashboard"
      >
        <BriefcaseIcon />
        <span className="text-sm font-semibold">Dashboard</span>
      </Link>
    </div>
  );
}
