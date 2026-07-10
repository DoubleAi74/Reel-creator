"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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
  const [editMode, setEditMode] = useState(false);
  const [unlockModalOpen, setUnlockModalOpen] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockStatus, setUnlockStatus] = useState("idle");
  const [unlockMessage, setUnlockMessage] = useState("");
  const [editingGenerationId, setEditingGenerationId] = useState(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [savingTitleId, setSavingTitleId] = useState(null);
  const [deletingGenerationId, setDeletingGenerationId] = useState(null);
  const [cardErrorById, setCardErrorById] = useState({});

  useEffect(() => {
    let cancelled = false;

    fetch("/api/dashboard/state", {
      cache: "no-store",
      credentials: "same-origin",
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

  const clearCardError = (generationId) => {
    setCardErrorById((currentErrors) => {
      if (!currentErrors[generationId]) {
        return currentErrors;
      }

      const nextErrors = { ...currentErrors };
      delete nextErrors[generationId];

      return nextErrors;
    });
  };

  const setCardError = (generationId, message) => {
    setCardErrorById((currentErrors) => ({
      ...currentErrors,
      [generationId]: message,
    }));
  };

  const handleToggleEditMode = async () => {
    if (editMode) {
      setEditMode(false);
      setEditingGenerationId(null);
      setTitleDraft("");
      setCardErrorById({});
      return;
    }

    setUnlockStatus("checking");
    setUnlockMessage("");

    try {
      const response = await fetch("/api/credits/unlock", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload = await response.json().catch(() => ({}));

      if (response.ok && payload.unlocked === true) {
        setEditMode(true);
        setUnlockStatus("idle");
        return;
      }
    } catch {
      // Fall through to the password prompt.
    }

    setUnlockStatus("idle");
    setUnlockPassword("");
    setUnlockModalOpen(true);
  };

  const handleUnlockSubmit = async (event) => {
    event.preventDefault();
    setUnlockStatus("submitting");
    setUnlockMessage("");

    try {
      const response = await fetch("/api/credits/unlock", {
        body: JSON.stringify({ password: unlockPassword }),
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          payload.error === "locked"
            ? "Password is incorrect."
            : payload.message ?? payload.error ?? "Edit mode could not be unlocked.",
        );
      }

      setEditMode(true);
      setUnlockModalOpen(false);
      setUnlockPassword("");
      setUnlockStatus("idle");
    } catch (error) {
      setUnlockStatus("error");
      setUnlockMessage(
        error instanceof Error ? error.message : "Edit mode could not be unlocked.",
      );
    }
  };

  const startTitleEdit = (generation) => {
    setEditingGenerationId(generation.id);
    setTitleDraft(generation.title || "");
    clearCardError(generation.id);
  };

  const cancelTitleEdit = () => {
    setEditingGenerationId(null);
    setTitleDraft("");
  };

  const saveTitleEdit = async (generationId) => {
    const title = titleDraft.trim();

    if (!title) {
      setCardError(generationId, "Enter a generation title.");
      return;
    }

    setSavingTitleId(generationId);
    clearCardError(generationId);

    try {
      const response = await fetch(
        `/api/dashboard/generations/${encodeURIComponent(generationId)}`,
        {
          body: JSON.stringify({ title }),
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
          },
          method: "PATCH",
        },
      );
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.generation) {
        throw new Error(payload.message ?? payload.error ?? "Title could not be saved.");
      }

      setGenerations((currentGenerations) =>
        currentGenerations.map((generation) =>
          generation.id === generationId ? payload.generation : generation,
        ),
      );
      setEditingGenerationId(null);
      setTitleDraft("");
    } catch (error) {
      setCardError(
        generationId,
        error instanceof Error ? error.message : "Title could not be saved.",
      );
    } finally {
      setSavingTitleId(null);
    }
  };

  const deleteGeneration = async (generation) => {
    if (
      !window.confirm(
        `Delete "${generation.title || "this generation"}" from the shared dashboard?`,
      )
    ) {
      return;
    }

    setDeletingGenerationId(generation.id);
    clearCardError(generation.id);

    try {
      const response = await fetch(
        `/api/dashboard/generations/${encodeURIComponent(generation.id)}`,
        {
          credentials: "same-origin",
          method: "DELETE",
        },
      );
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error ?? "Generation could not be deleted.");
      }

      setGenerations((currentGenerations) =>
        currentGenerations.filter((currentGeneration) => currentGeneration.id !== generation.id),
      );

      if (editingGenerationId === generation.id) {
        cancelTitleEdit();
      }
    } catch (error) {
      setCardError(
        generation.id,
        error instanceof Error ? error.message : "Generation could not be deleted.",
      );
    } finally {
      setDeletingGenerationId(null);
    }
  };

  return (
    <main className="min-h-screen bg-[var(--page)] text-[var(--text)]">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--muted)]">
              Cross Lang
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">
              Shared Dashboard
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              className="inline-flex min-h-10 items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--text)] shadow-[var(--shadow-soft)] transition hover:bg-[var(--surface-hover)]"
              href="/"
            >
              Editor
            </Link>
            <button
              className="inline-flex min-h-10 items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--text)] shadow-[var(--shadow-soft)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={unlockStatus === "checking"}
              onClick={() => {
                void handleToggleEditMode();
              }}
              type="button"
            >
              {editMode ? "Done" : unlockStatus === "checking" ? "Checking" : "Edit"}
            </button>
          </div>
        </header>

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
                <div className="min-w-0">
                  {editingGenerationId === generation.id ? (
                    <div className="grid gap-2">
                      <label className="sr-only" htmlFor={`title-${generation.id}`}>
                        Generation title
                      </label>
                      <input
                        className="min-h-10 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-base font-semibold text-[var(--text)] outline-none focus:border-[var(--accent)]"
                        disabled={savingTitleId === generation.id}
                        id={`title-${generation.id}`}
                        maxLength={180}
                        onChange={(event) => setTitleDraft(event.target.value)}
                        value={titleDraft}
                      />
                    </div>
                  ) : (
                    <h2 className="truncate text-base font-semibold">
                      {generation.title || "Generation"}
                    </h2>
                  )}
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {formatDate(generation.createdAt)}
                  </p>
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

                {cardErrorById[generation.id] ? (
                  <p className="mt-3 text-sm font-medium text-[var(--danger)]">
                    {cardErrorById[generation.id]}
                  </p>
                ) : null}

                <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                  <span className="text-xs font-medium text-[var(--muted)]">
                    {formatDuration(generation.audioDurationSeconds)}
                  </span>
                  {editMode ? (
                    editingGenerationId === generation.id ? (
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                          className="inline-flex min-h-9 items-center rounded-lg bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--on-accent)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={savingTitleId === generation.id}
                          onClick={() => {
                            void saveTitleEdit(generation.id);
                          }}
                          type="button"
                        >
                          {savingTitleId === generation.id ? "Saving" : "Save"}
                        </button>
                        <button
                          className="inline-flex min-h-9 items-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-xs font-semibold text-[var(--text)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={savingTitleId === generation.id}
                          onClick={cancelTitleEdit}
                          type="button"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                          className="inline-flex min-h-9 items-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-xs font-semibold text-[var(--text)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={deletingGenerationId === generation.id}
                          onClick={() => startTitleEdit(generation)}
                          type="button"
                        >
                          Edit title
                        </button>
                        <button
                          className="inline-flex min-h-9 items-center rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-3 text-xs font-semibold text-[var(--danger)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={deletingGenerationId === generation.id}
                          onClick={() => {
                            void deleteGeneration(generation);
                          }}
                          type="button"
                        >
                          {deletingGenerationId === generation.id ? "Deleting" : "Delete"}
                        </button>
                      </div>
                    )
                  ) : (
                    <Link
                      className="inline-flex min-h-9 items-center rounded-lg bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--on-accent)] transition hover:opacity-90"
                      href={`/?generation=${encodeURIComponent(generation.id)}`}
                    >
                      Open
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </section>
        ) : null}
      </div>

      {unlockModalOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4">
          <form
            className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-soft)]"
            onSubmit={(event) => {
              void handleUnlockSubmit(event);
            }}
          >
            <h2 className="text-lg font-semibold">Unlock edit mode</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Enter the generation password to edit shared dashboard items.
            </p>
            <label className="mt-4 block">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                Password
              </span>
              <input
                autoFocus
                className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                disabled={unlockStatus === "submitting"}
                onChange={(event) => setUnlockPassword(event.target.value)}
                type="password"
                value={unlockPassword}
              />
            </label>
            {unlockMessage ? (
              <p className="mt-3 text-sm font-medium text-[var(--danger)]">
                {unlockMessage}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="inline-flex min-h-9 items-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-xs font-semibold text-[var(--text)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={unlockStatus === "submitting"}
                onClick={() => {
                  setUnlockModalOpen(false);
                  setUnlockPassword("");
                  setUnlockStatus("idle");
                  setUnlockMessage("");
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="inline-flex min-h-9 items-center rounded-lg bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--on-accent)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={unlockStatus === "submitting"}
                type="submit"
              >
                {unlockStatus === "submitting" ? "Unlocking" : "Unlock"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
