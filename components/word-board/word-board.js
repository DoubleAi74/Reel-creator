"use client";

// WordBoard — React port of the live #wb-script board from index_new.html.
// Markup mirrors renderSketch() so the verbatim word-board.css applies. Data is
// driven by project lines[].words (gloss/roman), with positional fallback when
// gloss is missing (P1/P3). Selection can be controlled (editor context, P6) or
// internal (standalone demo / tests).

import { useMemo, useState } from "react";

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

export function WordBoard({
  lines,
  selectedWordId,
  onSelectWord,
  currentTime = 0,
  followAudioResetKey = null,
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
    hoveredLineId,
    setHoveredLineId,
    activeDisplayLineId,
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

  const handleSelect = (word) => {
    // Toggle: clicking the selected word clears it (prototype behavior).
    const nextId = word.id === activeSelectedId ? null : word.id;
    if (controlled) {
      onSelectWord(nextId ? word : null);
    } else {
      setInternalSelectedId(nextId);
    }
  };

  return (
    <div className="wb" ref={hostRef}>
      {/* The frame (outline + nested boxes) is sized by CSS (container-query
          contain-fit), so it paints at the correct size from the very first
          frame — no JS needed, no size snap. Only the scale-dependent INTERIOR
          (tile widths / fonts) needs the client measurement pass, so we hide
          just the words + selection panel until `ready` and reveal them already
          at their final scale. boardStyle carries the measured CSS variables and
          is applied in render so the reveal is atomic (no one-frame larger text). */}
      <section
        className={`prototype-shell version-sketch is-scroll-mode${
          showRoman ? " show-inline-roman" : ""
        }`}
        style={boardStyle}
      >
        <div className="board-frame">
          <div
            className={`stage${followScrollPaused ? " is-follow-paused" : ""}`}
            data-stage
            ref={stageRef}
            onScroll={handleStageScroll}
          >
            {showRefollowButton ? (
              <button
                className="refollow-button"
                type="button"
                aria-label="Re-follow current audio line"
                onClick={handleRefollow}
              >
                re-follow
              </button>
            ) : null}
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
                  followActive={activeDisplayLineId === line.id}
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
          <div className="pager-strip">
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
              onToggleRoman={toggleRoman}
              onToggleFollowAudio={toggleFollowAudio}
              onStepSize={stepTileScale}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
