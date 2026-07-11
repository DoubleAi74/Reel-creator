"use client";

// WordBoard — React port of the live #wb-script board from index_new.html.
// Markup mirrors renderSketch() so the verbatim word-board.css applies. Data is
// driven by project lines[].words (gloss/roman), with positional fallback when
// gloss is missing (P1/P3). Selection can be controlled (editor context, P6) or
// internal (standalone demo / tests).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import "./word-board.css";
import { useWordBoard } from "./use-word-board";

function WordTile({ audioState, word, selected, width, onSelect }) {
  const followClass =
    audioState === "current"
      ? " is-follow-current"
      : audioState === "passed"
        ? " is-follow-passed"
        : "";

  return (
    <span
      className={`word-unit${audioState ? ` is-follow-${audioState}` : ""}`}
      data-word-id={word.id}
    >
      <button
        className={`word-button${selected ? " is-selected" : ""}${followClass}`}
        type="button"
        data-word-id={word.id}
        data-follow-state={audioState ?? undefined}
        style={width ? { width: `${width}px` } : undefined}
        aria-label={`${word.original}, ${word.english}`}
        onClick={() => onSelect(word)}
      >
        <span className="word-hindi">{word.original}</span>
        <span className="word-english">{word.english}</span>
      </button>
      <span className="word-roman-inline">{word.roman}</span>
    </span>
  );
}

function LineRow({
  line,
  selectedWordId,
  selectedLineId,
  hovered,
  followActive,
  getTileWidth,
  getWordRows,
  getLineMinHeight,
  getWordAudioState,
  onSelect,
  onHover,
}) {
  const wordRows = getWordRows(line);
  const minHeight = getLineMinHeight(line);
  return (
    <div
      className={`line-row${line.id === selectedLineId ? " is-selection-line" : ""}${
        hovered ? " is-hover-line" : ""
      }${followActive ? " is-follow-line" : ""}${
        wordRows.length > 1 ? " is-wrapped-line" : ""
      }`}
      style={minHeight ? { minHeight: `${minHeight}px` } : undefined}
      data-line-id={line.id}
      data-source-line-id={line.sourceId ?? undefined}
      data-line-number={line.number}
      onPointerOver={() => onHover(line.id)}
      onPointerOut={() => onHover(null)}
    >
      {wordRows.map((row, rowIndex) => (
        <div
          className="line-word-group"
          data-visual-row={rowIndex + 1}
          key={`${line.id}-${rowIndex}`}
        >
          {row.map((word) => (
            <WordTile
              key={word.id}
              audioState={getWordAudioState(word)}
              word={word}
              selected={word.id === selectedWordId}
              width={getTileWidth(word)}
              onSelect={onSelect}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function SelectionPanel({ word }) {
  const wordRowRef = useRef(null);
  const translationRef = useRef(null);

  useLayoutEffect(() => {
    const row = wordRowRef.current;
    const translation = translationRef.current;

    if ((!row && !translation) || !word || !word.line) {
      return undefined;
    }

    let animationFrame = 0;

    const fitWordRow = () => {
      if (!row) {
        return;
      }

      row.style.setProperty("--selection-word-scale", "1");

      const availableWidth = row.clientWidth;
      const naturalWidth = row.scrollWidth;
      let nextScale =
        availableWidth > 0 && naturalWidth > availableWidth
          ? Math.max(0.72, Math.min(1, (availableWidth - 12) / naturalWidth))
          : 1;

      row.style.setProperty(
        "--selection-word-scale",
        nextScale.toFixed(3),
      );

      if (row.scrollWidth > row.clientWidth && nextScale > 0.72) {
        nextScale = Math.max(
          0.72,
          nextScale * ((row.clientWidth - 8) / row.scrollWidth),
        );
        row.style.setProperty(
          "--selection-word-scale",
          nextScale.toFixed(3),
        );
      }
    };

    const fitTranslation = () => {
      if (!translation) {
        return;
      }

      translation.style.setProperty("--selection-translation-scale", "1");

      const availableWidth = translation.clientWidth;
      const naturalWidth = translation.scrollWidth;
      let nextScale =
        availableWidth > 0 && naturalWidth > availableWidth
          ? Math.max(0.5, Math.min(1, (availableWidth - 10) / naturalWidth))
          : 1;

      translation.style.setProperty(
        "--selection-translation-scale",
        nextScale.toFixed(3),
      );

      if (translation.scrollWidth > translation.clientWidth && nextScale > 0.5) {
        nextScale = Math.max(
          0.5,
          nextScale * ((translation.clientWidth - 6) / translation.scrollWidth),
        );
        translation.style.setProperty(
          "--selection-translation-scale",
          nextScale.toFixed(3),
        );
      }
    };

    const scheduleFit = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        fitWordRow();
        fitTranslation();
      });
    };

    scheduleFit();

    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(scheduleFit)
        : null;

    if (observer) {
      if (row) {
        observer.observe(row);
      }
      if (translation) {
        observer.observe(translation);
      }
    }

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer?.disconnect();
    };
  }, [word]);

  if (!word || !word.line) {
    return (
      <div className="selection-stack">
        <section className="selection-panel is-empty" aria-live="polite">
          <div className="selection-main">
            <div className="selection-word-row" aria-hidden="true" />
            <div className="selection-divider" />
            <div className="selection-line-stack" aria-hidden="true" />
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="selection-stack" aria-live="polite">
      <section className="selection-panel">
        <div className="selection-main">
          <div className="selection-word-row" ref={wordRowRef}>
            <p className="selection-english">{word.english}</p>
            <p className="selection-roman">{word.roman}</p>
            <div className="selection-hindi">{word.original}</div>
          </div>
          <div className="selection-divider" />
          <div className="selection-line-stack">
            <p className="line-original">{word.line.original}</p>
            <p className="line-romanization">{word.line.romanization}</p>
            <p className="line-translation" ref={translationRef}>
              {word.line.translation}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function BoardControls({
  showRoman,
  followAudioEnabled,
  canFollowAudio,
  canDecreaseSize,
  canIncreaseSize,
  tileStep,
  onToggleRoman,
  onToggleFollowAudio,
  onStepSize,
}) {
  const followTitle = !canFollowAudio
    ? "Follow audio unavailable until word timings exist"
    : followAudioEnabled
      ? "Stop following audio"
      : "Follow audio";

  return (
    <div className="board-control-panel">
      <div className="board-control-grid">
        <button
          className="roman-toggle"
          type="button"
          aria-label="Toggle romanization labels"
          aria-pressed={String(showRoman)}
          title={showRoman ? "Hide romanization labels" : "Show romanization labels"}
          onClick={onToggleRoman}
        >
          Rm
        </button>
        <button
          className="follow-toggle"
          type="button"
          aria-label="Toggle follow audio"
          aria-pressed={followAudioEnabled}
          disabled={!canFollowAudio}
          title={followTitle}
          onClick={onToggleFollowAudio}
        >
          F
        </button>
        <button
          className="mobile-size-button"
          type="button"
          aria-label="Decrease tile size"
          title="Decrease tile size"
          disabled={!canDecreaseSize}
          onClick={() => onStepSize(-tileStep)}
        >
          -
        </button>
        <button
          className="mobile-size-button"
          type="button"
          aria-label="Increase tile size"
          title="Increase tile size"
          disabled={!canIncreaseSize}
          onClick={() => onStepSize(tileStep)}
        >
          +
        </button>
      </div>
    </div>
  );
}

function BoardToolsStrip({
  className,
  ready,
  selectedWord,
  showRoman,
  followAudioEnabled,
  canFollowAudio,
  canDecreaseSize,
  canIncreaseSize,
  tileStep,
  onToggleRoman,
  onToggleFollowAudio,
  onStepSize,
}) {
  return (
    <div className={className}>
      {/* Empty (outline-only) until measured so the translation box shows
          in the initial skeleton; populates once the words are revealed. */}
      <SelectionPanel word={ready ? selectedWord : null} />
      <BoardControls
        showRoman={showRoman}
        followAudioEnabled={followAudioEnabled}
        canFollowAudio={canFollowAudio}
        canDecreaseSize={canDecreaseSize}
        canIncreaseSize={canIncreaseSize}
        tileStep={tileStep}
        onToggleRoman={onToggleRoman}
        onToggleFollowAudio={onToggleFollowAudio}
        onStepSize={onStepSize}
      />
    </div>
  );
}

function BoardPageNav({
  canPage,
  currentPage,
  pageCount,
  showRefollowButton,
  onPreviousPage,
  onRefollow,
  onNextPage,
}) {
  return (
    <div className="board-page-nav" aria-label="Word board page controls">
      <button
        className="board-page-button"
        type="button"
        data-board-page="prev"
        aria-label={`Previous word page (${currentPage + 1} of ${pageCount})`}
        disabled={!canPage || currentPage <= 0}
        onClick={onPreviousPage}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path
            d="m15 6-6 6 6 6"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.4"
          />
        </svg>
      </button>
      {showRefollowButton ? (
        <button
          className="board-page-refollow-button"
          type="button"
          aria-label="Re-follow current audio line"
          onClick={onRefollow}
        >
          Re-follow
        </button>
      ) : null}
      <button
        className="board-page-button"
        type="button"
        data-board-page="next"
        aria-label={`Next word page (${currentPage + 1} of ${pageCount})`}
        disabled={!canPage || currentPage >= pageCount - 1}
        onClick={onNextPage}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path
            d="m9 6 6 6-6 6"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.4"
          />
        </svg>
      </button>
    </div>
  );
}

export function WordBoard({
  lines,
  selectedWordId,
  onSelectWord,
  currentTime = 0,
  followAudioResetKey = null,
  boardToolsPortalSelector = null,
}) {
  const board = useWordBoard(lines, {
    currentTime,
    followAudioResetKey,
  });
  const {
    hostRef,
    stageRef,
    ready,
    boardStyle,
    getTileWidth,
    getWordRows,
    getLineMinHeight,
    visibleLines,
    isPagedMode,
    currentPage,
    pageCount,
    canPage,
    hoveredLineId,
    setHoveredLineId,
    activeDisplayLineId,
    activeSourceLineId,
    canFollowAudio,
    followAudioEnabled,
    followScrollPaused,
    getWordAudioState,
    showRefollowButton,
    showRoman,
    canDecreaseSize,
    canIncreaseSize,
    tileStep,
    stepTileScale,
    toggleRoman,
    toggleFollowAudio,
    handleRefollow,
    goToPreviousPage,
    goToNextPage,
    handleStageScroll,
  } = board;

  // Internal selection when uncontrolled. The flat list of currently-visible
  // words lets us resolve a selected id back to its full word object.
  const [internalSelectedId, setInternalSelectedId] = useState(null);
  const controlled = typeof onSelectWord === "function";

  const wordsById = useMemo(() => {
    const map = new Map();
    for (const line of visibleLines) {
      for (const word of line.words) {
        map.set(word.id, word);
      }
    }
    return map;
  }, [visibleLines]);

  // Resolve the active selection. Null is a real state: no word selected.
  const requestedId = controlled ? selectedWordId : internalSelectedId;
  const activeSelectedId =
    requestedId && wordsById.has(requestedId)
      ? requestedId
      : null;

  const selectedWord = activeSelectedId ? wordsById.get(activeSelectedId) ?? null : null;
  const selectedLineId = selectedWord?.lineId ?? null;
  const [boardToolsPortalTarget, setBoardToolsPortalTarget] = useState(null);

  useEffect(() => {
    if (!boardToolsPortalSelector || typeof document === "undefined") {
      return undefined;
    }

    const updatePortalTarget = () => {
      const nextTarget = document.querySelector(boardToolsPortalSelector);
      // This state mirrors whether the shell's Words card is mounted.
      setBoardToolsPortalTarget((currentTarget) =>
        currentTarget === nextTarget ? currentTarget : nextTarget,
      );
    };

    updatePortalTarget();

    if (typeof MutationObserver !== "function") {
      return undefined;
    }

    const observer = new MutationObserver(updatePortalTarget);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
    };
  }, [boardToolsPortalSelector]);

  const handleSelect = (word) => {
    // Toggle: clicking the selected word clears it (prototype behavior).
    const nextId = word.id === activeSelectedId ? null : word.id;
    if (controlled) {
      onSelectWord(nextId ? word : null);
    } else {
      setInternalSelectedId(nextId);
    }
  };
  const clearSelection = () => {
    if (controlled) {
      onSelectWord(null);
    } else {
      setInternalSelectedId(null);
    }
  };
  const handlePreviousPage = () => {
    if (!canPage) {
      return;
    }
    clearSelection();
    goToPreviousPage();
  };
  const handleNextPage = () => {
    if (!canPage) {
      return;
    }
    clearSelection();
    goToNextPage();
  };
  const boardToolsStrip = (
    <BoardToolsStrip
      className="pager-strip"
      ready={ready}
      selectedWord={selectedWord}
      showRoman={showRoman}
      followAudioEnabled={followAudioEnabled}
      canFollowAudio={canFollowAudio}
      canDecreaseSize={canDecreaseSize}
      canIncreaseSize={canIncreaseSize}
      tileStep={tileStep}
      onToggleRoman={toggleRoman}
      onToggleFollowAudio={toggleFollowAudio}
      onStepSize={stepTileScale}
    />
  );

  return (
    <div className="wb" ref={hostRef}>
      {boardToolsPortalTarget
        ? createPortal(
            <BoardToolsStrip
              className="board-tools-layout"
              ready={ready}
              selectedWord={selectedWord}
              showRoman={showRoman}
              followAudioEnabled={followAudioEnabled}
              canFollowAudio={canFollowAudio}
              canDecreaseSize={canDecreaseSize}
              canIncreaseSize={canIncreaseSize}
              tileStep={tileStep}
              onToggleRoman={toggleRoman}
              onToggleFollowAudio={toggleFollowAudio}
              onStepSize={stepTileScale}
            />,
            boardToolsPortalTarget,
          )
        : null}
      {/* The frame is contain-fit by CSS and can paint immediately. The
          scale-sensitive lyric rows stay hidden until the client measurement
          pass lands, so the first visible words already have their final size. */}
      <section
        className={`prototype-shell version-sketch ${
          isPagedMode ? "is-page-mode" : "is-scroll-mode"
        }${
          showRoman ? " show-inline-roman" : ""
        }`}
        aria-busy={!ready}
        style={boardStyle}
      >
        <div className="board-frame">
          <div
            className={`stage${followScrollPaused ? " is-follow-paused" : ""}`}
            data-stage
            ref={stageRef}
            onScroll={handleStageScroll}
          >
            <div
              className="line-stack"
              style={ready ? undefined : { visibility: "hidden" }}
            >
              {visibleLines.map((line) => (
                <LineRow
                  key={line.id}
                  line={line}
                  selectedWordId={activeSelectedId}
                  selectedLineId={selectedLineId}
                  hovered={hoveredLineId === line.id}
                  followActive={
                    activeSourceLineId
                      ? line.sourceId === activeSourceLineId
                      : activeDisplayLineId === line.id
                  }
                  getTileWidth={getTileWidth}
                  getWordRows={getWordRows}
                  getLineMinHeight={getLineMinHeight}
                  getWordAudioState={getWordAudioState}
                  onSelect={handleSelect}
                  onHover={setHoveredLineId}
                />
              ))}
            </div>
          </div>
          {showRefollowButton && !isPagedMode ? (
            <button
              className="refollow-button"
              type="button"
              aria-label="Re-follow current audio line"
              onClick={handleRefollow}
            >
              re-follow
            </button>
          ) : null}
          <BoardPageNav
            canPage={canPage}
            currentPage={currentPage}
            pageCount={pageCount}
            showRefollowButton={isPagedMode && showRefollowButton}
            onPreviousPage={handlePreviousPage}
            onRefollow={handleRefollow}
            onNextPage={handleNextPage}
          />
          {boardToolsStrip}
        </div>
      </section>
    </div>
  );
}
