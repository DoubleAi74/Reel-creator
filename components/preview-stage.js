"use client";

import { createPortal } from "react-dom";

import { useEditor } from "@/components/editor-context";
import { PreviewPlayer } from "@/components/preview-player";
import { WordBoard } from "@/components/word-board/word-board";

// Preview column (PreviewPlayer + fullscreen close + gradient), the fullscreen-only
// Word Board, the preview-under-actions, and the standard wb-slot Word Board. Renders
// inside the workspace-grid (which stays in the shell) and reads word-board selection
// from context via useEditor(), matching how WordBoard consumes it.
export function PreviewStage({
  backgroundDurationSec,
  backgroundPreviewUrl,
  canExport,
  currentAudioTime,
  exportBusy,
  isPreviewFullscreen,
  onEnterFullscreen,
  onExitFullscreen,
  onExport,
  previewCurrentFrame,
  previewPlayerRef,
  project,
  wordBoardFollowAudioResetKey,
}) {
  const editor = useEditor();
  const selectedWordId = editor.state.selection.selectedWord?.id ?? null;
  const handleSelectWord = (word) => editor.actions.setSelectedWord(word);

  const previewColumn = (
      <section
        className={`preview-col ${
          isPreviewFullscreen
            ? "fixed inset-0 z-50 flex min-h-0 flex-col items-center justify-center bg-black/95 p-4 backdrop-blur-sm"
            : "relative z-0 flex flex-none flex-col overflow-hidden bg-transparent lg:static lg:order-2 lg:min-h-0 lg:flex-1 lg:items-center lg:justify-center lg:rounded-2xl lg:border lg:border-white/8 lg:bg-white/[0.03] lg:p-4"
        }`}
      >
        {isPreviewFullscreen ? (
          <button
            aria-label="Close full-screen preview"
            className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white transition hover:bg-white/20"
            onClick={onExitFullscreen}
            type="button"
          >
            <svg
              aria-hidden="true"
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        ) : null}

        {!isPreviewFullscreen ? (
          <div className="fixed left-2.5 top-[calc(var(--mobile-transport-h)_+_10px)] z-40 flex flex-col gap-2 lg:hidden">
            <button
              aria-label="Preview"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] opacity-80 shadow-md transition hover:bg-[var(--surface-hover)]"
              onClick={onEnterFullscreen}
              type="button"
            >
              <svg
                aria-hidden="true"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                viewBox="0 0 24 24"
              >
                <path d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              </svg>
            </button>
            <button
              aria-label="Export video"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] opacity-80 shadow-md transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canExport || exportBusy}
              onClick={onExport}
              type="button"
            >
              <svg
                aria-hidden="true"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                viewBox="0 0 24 24"
              >
                <path d="M12 3v12" />
                <path d="m7 10 5 5 5-5" />
                <path d="M5 20h14" />
              </svg>
            </button>
          </div>
        ) : null}

        <div
          className={`relative flex min-h-0 w-full flex-1 items-center justify-center ${
            isPreviewFullscreen ? "gap-5" : ""
          }`}
        >
          <div
            className={`preview-screen relative overflow-hidden bg-(--preview-bg) ${
              isPreviewFullscreen
                ? "aspect-[9/16] h-full max-h-full w-auto max-w-full rounded-[1.75rem] border border-white/12 shadow-[0_40px_120px_rgba(0,0,0,0.6)]"
                : "mx-auto aspect-[9/16] w-auto max-w-full lg:aspect-[9/16] lg:h-full lg:max-h-full lg:w-auto lg:max-w-full lg:rounded-[2rem] lg:border lg:border-white/12 lg:shadow-[0_30px_70px_rgba(0,0,0,0.5)]"
            }`}
          >
            <div className="absolute inset-0">
              <PreviewPlayer
                backgroundDurationSec={backgroundDurationSec}
                backgroundUrl={backgroundPreviewUrl}
                playerRef={previewPlayerRef}
                project={project}
                targetFrame={previewCurrentFrame}
              />
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-950/55 to-transparent" />
          </div>

          {/* D-Modal: fullscreen preview shows the phone + Word Board. */}
          {isPreviewFullscreen ? (
            <div className="hidden h-full max-h-full min-w-0 flex-1 items-center justify-center lg:flex">
              <WordBoard
                lines={project.lines}
                selectedWordId={selectedWordId}
                onSelectWord={handleSelectWord}
                currentTime={currentAudioTime}
                followAudioResetKey={wordBoardFollowAudioResetKey}
              />
            </div>
          ) : null}
        </div>

        {!isPreviewFullscreen ? (
          <div className="preview-under-actions mt-3 hidden w-full flex-none items-center justify-between gap-4 text-[11px] text-[var(--muted)] lg:flex">
            <button
              className="top-action preview-under-action"
              onClick={onEnterFullscreen}
              type="button"
            >
              Preview
            </button>
            <button
              className="top-action preview-under-action"
              disabled={!canExport || exportBusy}
              onClick={onExport}
              type="button"
            >
              {exportBusy ? "Exporting..." : "Export video"}
            </button>
          </div>
        ) : null}
      </section>
  );

  return (
    <>
      {isPreviewFullscreen && typeof document !== "undefined"
        ? createPortal(previewColumn, document.body)
        : previewColumn}
      {!isPreviewFullscreen ? (
        <section className="wb-slot flex flex-none flex-col items-center justify-center overflow-hidden lg:order-2 lg:min-h-0 lg:flex-1 lg:items-center lg:justify-center lg:rounded-2xl lg:p-2">
          <WordBoard
            lines={project.lines}
            selectedWordId={selectedWordId}
            onSelectWord={handleSelectWord}
            currentTime={currentAudioTime}
            followAudioResetKey={wordBoardFollowAudioResetKey}
            boardToolsPortalSelector="[data-board-tools-card]"
          />
        </section>
      ) : null}
    </>
  );
}
