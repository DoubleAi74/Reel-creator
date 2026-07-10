"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "Unknown length";
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);

  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function DashboardView() {
  const [generations, setGenerations] = useState([]);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let cancelled = false;

    fetch("/api/dashboard/state", {
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(payload.error ?? "Dashboard unavailable.");
        }

        return payload;
      })
      .then((payload) => {
        if (cancelled) {
          return;
        }

        setGenerations(Array.isArray(payload.generations) ? payload.generations : []);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const totalDurationSeconds = useMemo(
    () =>
      generations.reduce(
        (sum, generation) =>
          sum +
          (Number.isFinite(generation.audioDurationSeconds)
            ? generation.audioDurationSeconds
            : 0),
        0,
      ),
    [generations],
  );
  const latestGeneration = generations[0] ?? null;

  return (
    <main className="min-h-screen bg-[var(--page)] text-[var(--text)]">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--muted)]">
              Reel Creator
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">
              Credit dashboard
            </h1>
          </div>
          <Link
            className="inline-flex min-h-10 items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--text)] shadow-[var(--shadow-soft)] transition hover:bg-[var(--surface-hover)]"
            href="/"
          >
            Editor
          </Link>
        </header>

        <section className="grid gap-3 border-b border-[var(--border)] py-4 text-sm text-[var(--muted)] sm:grid-cols-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em]">
              Saved
            </p>
            <p className="mt-1 text-xl font-semibold text-[var(--text)]">
              {generations.length}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em]">
              Audio
            </p>
            <p className="mt-1 text-xl font-semibold text-[var(--text)]">
              {formatDuration(totalDurationSeconds)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em]">
              Latest
            </p>
            <p className="mt-1 text-xl font-semibold text-[var(--text)]">
              {latestGeneration ? formatDate(latestGeneration.createdAt) : "None"}
            </p>
          </div>
        </section>

        {status === "loading" ? (
          <p className="py-8 text-sm text-[var(--muted)]">Loading saved reels.</p>
        ) : null}

        {status === "error" ? (
          <p className="py-8 text-sm font-medium text-[var(--danger)]">
            Dashboard is unavailable.
          </p>
        ) : null}

        {status === "ready" && generations.length === 0 ? (
          <p className="py-8 text-sm text-[var(--muted)]">
            No saved generations yet.
          </p>
        ) : null}

        {generations.length > 0 ? (
          <section className="grid gap-3 py-5 sm:grid-cols-2 lg:grid-cols-3">
            {generations.map((generation) => (
              <article
                className="flex min-h-[220px] flex-col rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-soft)]"
                key={generation.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold">
                      {generation.title || "Untitled generation"}
                    </h2>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {formatDate(generation.createdAt)}
                    </p>
                  </div>
                  <span className="rounded-full border border-[var(--border)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                    {generation.sourceType}
                  </span>
                </div>

                <p className="mt-4 line-clamp-3 min-h-[3.75rem] text-sm leading-5 text-[var(--muted)]">
                  {generation.lyricPreview || "No lyric preview available."}
                </p>

                <audio
                  className="mt-4 w-full"
                  controls
                  preload="none"
                  src={generation.audioUrl}
                />

                <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                  <span className="text-xs font-medium text-[var(--muted)]">
                    {formatDuration(generation.audioDurationSeconds)}
                  </span>
                  <Link
                    className="inline-flex min-h-9 items-center rounded-lg bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--on-accent)] transition hover:opacity-90"
                    href={`/?generation=${encodeURIComponent(generation.id)}`}
                  >
                    Open
                  </Link>
                </div>
              </article>
            ))}
          </section>
        ) : null}
      </div>
    </main>
  );
}
