"use client";

// WordBoard — React port of the live #wb-script board from index_new.html.
// Markup mirrors renderSketch() so the verbatim word-board.css applies. Data is
// driven by project lines[].words (gloss/roman), with positional fallback when
// gloss is missing (P1/P3). Selection can be controlled (editor context, P6) or
// internal (standalone demo / tests).

import { useMemo, useState } from "react";

import "./word-board.css";
import { useWordBoard } from "./use-word-board";

function WordTile({ word, selected, width, onSelect }) {
  return (
    <span className="word-unit" data-word-id={word.id}>
      <button
        className={`word-button${selected ? " is-selected" : ""}`}
        type="button"
        data-word-id={word.id}
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
  active,
  getTileWidth,
  getWordRows,
  getLineMinHeight,
  onSelect,
  onHover,
}) {
  const wordRows = getWordRows(line);
  const minHeight = getLineMinHeight(line);
  return (
    <div
      className={`line-row${line.id === selectedLineId ? " is-selection-line" : ""}${
        hovered || active ? " is-hover-line" : ""
      }${wordRows.length > 1 ? " is-wrapped-line" : ""}`}
      style={minHeight ? { minHeight: `${minHeight}px` } : undefined}
      data-line-id={line.id}
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
          <div className="selection-word-row">
            <p className="selection-english">{word.english}</p>
            <p className="selection-roman">{word.roman}</p>
            <div className="selection-hindi">{word.original}</div>
          </div>
          <div className="selection-divider" />
          <div className="selection-line-stack">
            <p className="line-original">{word.line.original}</p>
            <p className="line-romanization">{word.line.romanization}</p>
            <p className="line-translation">{word.line.translation}</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function BoardControls({ showRoman, mode, isMobile, canDecreaseSize, canIncreaseSize, tileStep, onToggleRoman, onToggleMode, onStepSize }) {
  return (
    <div className="board-control-panel">
      <div className="board-toggle-row">
        <button
          className="roman-toggle"
          type="button"
          aria-label="Toggle romanization labels"
          aria-pressed={String(showRoman)}
          title={showRoman ? "Hide romanization labels" : "Show romanization labels"}
          onClick={onToggleRoman}
        >
          R
        </button>
        <button
          className="mode-toggle"
          type="button"
          aria-label={
            mode === "scroll" ? "Switch to page-arrow mode" : "Switch to scroll mode"
          }
          aria-pressed={String(mode === "scroll")}
          title={mode === "scroll" ? "Scroll mode" : "Page-arrow mode"}
          disabled={isMobile}
          onClick={onToggleMode}
        >
          {mode === "scroll" ? "↕" : "↔"}
        </button>
      </div>
      <div className="mobile-size-stepper" aria-label="Tile size controls">
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

function Pager({ mode, page, pageCount, onGoToPage }) {
  const isPageMode = mode === "page";
  return (
    <div
      className={`pager-arrow-cluster${isPageMode ? "" : " is-hidden"}`}
      aria-hidden={isPageMode ? undefined : "true"}
    >
      {isPageMode ? (
        <>
          <button
            className="pager-button"
            type="button"
            data-page-action="prev"
            aria-label="Previous page"
            title="Previous page"
            disabled={page === 0}
            onClick={() => onGoToPage(page - 1)}
          >
            ‹
          </button>
          <button
            className="pager-button"
            type="button"
            data-page-action="next"
            aria-label="Next page"
            title="Next page"
            disabled={page >= pageCount - 1}
            onClick={() => onGoToPage(page + 1)}
          >
            ›
          </button>
        </>
      ) : null}
    </div>
  );
}

export function WordBoard({
  lines,
  selectedWordId,
  onSelectWord,
  defaultMode = "page",
  activeSourceLineId = null,
  autoFollow = false,
  isPlaying = false,
}) {
  const board = useWordBoard(lines, {
    defaultMode,
    activeSourceLineId,
    autoFollow,
    isPlaying,
  });
  const {
    hostRef,
    stageRef,
    getTileWidth,
    getWordRows,
    getLineMinHeight,
    mode,
    isMobile,
    visibleLines,
    page,
    pageCount,
    hoveredLineId,
    setHoveredLineId,
    activeDisplayLineId,
    showRoman,
    canDecreaseSize,
    canIncreaseSize,
    scrollRange,
    lineCount,
    tileStep,
    stepTileScale,
    toggleRoman,
    toggleMode,
    goToPage,
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

  // Resolve the active selection. Uncontrolled boards fall back to the first
  // visible word (matching the prototype's always-populated panel) — derived in
  // render so no effect/setState is needed.
  const firstWordId = visibleLines[0]?.words[0]?.id ?? null;
  const defaultWordId =
    visibleLines
      .flatMap((line) => line.words)
      .find(
        (word) =>
          word.original === "गलियां" ||
          word.original === "गलियाँ" ||
          word.english?.toLowerCase() === "streets",
      )?.id ?? firstWordId;
  const requestedId = controlled ? selectedWordId : internalSelectedId;
  const activeSelectedId =
    requestedId && wordsById.has(requestedId)
      ? requestedId
      : defaultWordId;

  const selectedWord = activeSelectedId ? wordsById.get(activeSelectedId) ?? null : null;
  const selectedLineId = selectedWord?.lineId ?? null;

  const handleSelect = (word) => {
    // Toggle: clicking the selected word clears it (prototype behavior).
    const nextId = word.id === activeSelectedId ? null : word.id;
    if (controlled) {
      onSelectWord(nextId ? word : null);
    } else {
      setInternalSelectedId(nextId);
    }
  };

  const rangeNote =
    mode === "page"
      ? `Page ${page + 1} / ${pageCount}`
      : `Lines ${scrollRange.start}-${scrollRange.end} / ${lineCount || 0}`;

  return (
    <div className="wb" ref={hostRef}>
      <section
        className={`prototype-shell version-sketch ${
          mode === "scroll" ? "is-scroll-mode" : "is-page-mode"
        }`}
      >
        <div className="board-frame">
          <div className="stage" data-stage ref={stageRef} onScroll={handleStageScroll}>
            <div className="line-stack">
              {visibleLines.map((line) => (
                <LineRow
                  key={line.id}
                  line={line}
                  selectedWordId={activeSelectedId}
                  selectedLineId={selectedLineId}
                  hovered={hoveredLineId === line.id}
                  active={activeDisplayLineId === line.id}
                  getTileWidth={getTileWidth}
                  getWordRows={getWordRows}
                  getLineMinHeight={getLineMinHeight}
                  onSelect={handleSelect}
                  onHover={setHoveredLineId}
                />
              ))}
            </div>
          </div>
          <div className="pager-strip">
            <BoardControls
              showRoman={showRoman}
              mode={mode}
              isMobile={isMobile}
              canDecreaseSize={canDecreaseSize}
              canIncreaseSize={canIncreaseSize}
              tileStep={tileStep}
              onToggleRoman={toggleRoman}
              onToggleMode={toggleMode}
              onStepSize={stepTileScale}
            />
            <SelectionPanel word={selectedWord} />
            <Pager mode={mode} page={page} pageCount={pageCount} onGoToPage={goToPage} />
          </div>
          <div className="page-note board-page-note" data-line-range>
            {rangeNote}
          </div>
        </div>
      </section>
    </div>
  );
}
