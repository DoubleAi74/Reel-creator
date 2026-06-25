"use client";

// useWordBoard — ports the #wb-script board module (state + render/layout loop)
// into React. Page/scroll modes, fit-scaling, scroll-position preservation,
// debounced resize, and the live range note all match the prototype.
//
// Written to satisfy the React Compiler lint rules: ALL DOM measurement happens
// inside effects and lands in state; the render path stays pure (no ref reads,
// no setState-in-effect). Board layout state stays local; only selection crosses
// into the editor context.

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  buildPageLinesByHeight,
  buildScrollLines,
  calculateLinesPerPage,
  clamp,
  COMPACT_DESKTOP_MEDIA_QUERY,
  DEFAULT_BOARD_SCALE,
  estimateWrappedLineHeight,
  fitLayoutScale,
  measureBoardMetrics,
  measureTileWidth,
  MOBILE_MEDIA_QUERY,
  prepareBoardLines,
  SKETCH_IDEAL_BOARD_WIDTH,
  splitWordsIntoRows,
  stageContentWidth,
  TILE_SCALE_MAX,
  TILE_SCALE_MIN,
  TILE_SCALE_STEP,
} from "@/lib/word-board";

function matchesQuery(query) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(query).matches;
}

// Canvas-backed rendered-text measurement (P2). Created in an effect (not during
// render) and stored in state; until then the heuristic fallback applies.
function createTextMeasurer() {
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  const ORIGINAL_FONT = '760 20px "Noto Sans Devanagari", "Noto Sans", sans-serif';
  const GLOSS_FONT = "760 15px Inter, ui-sans-serif, system-ui, sans-serif";
  return (text, kind) => {
    ctx.font = kind === "gloss" ? GLOSS_FONT : ORIGINAL_FONT;
    return ctx.measureText(String(text ?? "")).width;
  };
}

export function useWordBoard(rawLines, options = {}) {
  const {
    defaultMode = "page",
    activeSourceLineId = null,
    autoFollow = false,
    isPlaying = false,
  } = options;

  const hostRef = useRef(null);
  const stageRef = useRef(null);
  const resizeFrameRef = useRef(0);
  const scrollFrameRef = useRef(0);
  const pendingScrollTopRef = useRef(0);

  const [mode, setMode] = useState(defaultMode);
  const [page, setPage] = useState(0);
  const [tileScale, setTileScale] = useState(1);
  const [showRoman, setShowRoman] = useState(false);
  const [hoveredLineId, setHoveredLineId] = useState(null);
  // Lazily create the canvas measurer once (client only; null under SSR).
  const [measureText] = useState(() => createTextMeasurer());
  const [stageWidth, setStageWidth] = useState(null);
  const [stageContentHeight, setStageContentHeight] = useState(null);
  // Inline tile widths are only applied after mount so SSR and the first client
  // render agree (the canvas measurer would otherwise produce different widths
  // than SSR's heuristic → hydration mismatch).
  const [hydrated, setHydrated] = useState(false);
  const [metrics, setMetrics] = useState(() => ({
    boardWidth: SKETCH_IDEAL_BOARD_WIDTH,
    boardScale: DEFAULT_BOARD_SCALE,
    isMobile: false,
    isCompactDesktop: false,
    hostWidth: SKETCH_IDEAL_BOARD_WIDTH,
  }));
  const [scrollRange, setScrollRange] = useState({ start: 1, end: 1 });

  const boardLines = useMemo(() => prepareBoardLines(rawLines), [rawLines]);

  // Mobile forces scroll mode (enforceResponsiveMode).
  const effectiveMode = metrics.isMobile ? "scroll" : mode;

  // ---- Measurement: recompute board box + stage width on resize / slot change ----
  const measure = useCallback(() => {
    const host = hostRef.current;
    const slot = host?.parentElement || host;
    const rect = slot?.getBoundingClientRect?.() ?? {};
    const next = measureBoardMetrics(rect);
    setMetrics({
      boardWidth: next.boardWidth,
      boardScale: next.boardScale,
      isMobile: matchesQuery(MOBILE_MEDIA_QUERY),
      isCompactDesktop: matchesQuery(COMPACT_DESKTOP_MEDIA_QUERY),
      hostWidth: host?.getBoundingClientRect?.().width || next.boardWidth,
    });

    const stage = stageRef.current;
    if (stage && stage.clientWidth > 0) {
      const style = window.getComputedStyle(stage);
      const padX =
        parseFloat(style.paddingLeft || "0") + parseFloat(style.paddingRight || "0");
      const padY =
        parseFloat(style.paddingTop || "0") + parseFloat(style.paddingBottom || "0");
      setStageWidth(Math.max(120, stage.clientWidth - padX));
      setStageContentHeight(Math.max(80, stage.clientHeight - padY));
    }
  }, []);

  useLayoutEffect(() => {
    // One-time post-mount flag (canonical SSR isMounted pattern); legitimate use
    // of setState in an effect to gate hydration-sensitive inline widths.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true);
    measure();
    if (typeof window === "undefined") {
      return undefined;
    }
    const onResize = () => {
      window.cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = window.requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onResize);
    let observer;
    const slot = hostRef.current?.parentElement;
    if (slot && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(onResize);
      observer.observe(slot);
    }
    return () => {
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
      window.cancelAnimationFrame(resizeFrameRef.current);
    };
  }, [measure]);

  // ---- Layout (pure, render path) ----
  const availableWidth = stageWidth ?? stageContentWidth(metrics);

  const fittedLayoutScale = useMemo(() => {
    const fittedBaseScale = fitLayoutScale(boardLines, {
      tileScale: 1,
      availableWidth,
      boardScale: metrics.boardScale,
      isMobile: metrics.isMobile,
      measureText,
    });
    return fittedBaseScale * tileScale;
  }, [availableWidth, boardLines, measureText, metrics, tileScale]);
  const tileSizeRatio = tileScale / TILE_SCALE_MAX;

  const linesPerPage = useMemo(
    () =>
      calculateLinesPerPage({
        availableHeight: stageContentHeight,
        availableWidth,
        lineCount: boardLines.length,
        lines: boardLines,
        measureText,
        isMobile: metrics.isMobile,
        isCompactDesktop: metrics.isCompactDesktop,
        showRoman,
        tileSizeRatio,
        tileScale: fittedLayoutScale,
        boardScale: metrics.boardScale,
        boardWidth: metrics.boardWidth,
      }),
    [
      availableWidth,
      boardLines,
      measureText,
      metrics,
      showRoman,
      stageContentHeight,
      fittedLayoutScale,
      tileSizeRatio,
    ],
  );

  const { visibleLines, pageCount, safePage, pageStarts } = useMemo(() => {
    if (effectiveMode === "scroll") {
      return {
        visibleLines: buildScrollLines(boardLines),
        pageCount: Math.max(1, Math.ceil(boardLines.length / Math.max(1, linesPerPage))),
        pageStarts: [0],
        safePage: 0,
      };
    }
    const built = buildPageLinesByHeight(boardLines, {
      page,
      availableHeight: stageContentHeight,
      availableWidth,
      boardScale: metrics.boardScale,
      boardWidth: metrics.boardWidth,
      isCompactDesktop: metrics.isCompactDesktop,
      isMobile: metrics.isMobile,
      measureText,
      showRoman,
      tileSizeRatio,
      tileScale: fittedLayoutScale,
    });
    return {
      visibleLines: built.lines,
      pageCount: built.pageCount,
      pageStarts: built.pageStarts,
      safePage: built.page,
    };
  }, [
    availableWidth,
    boardLines,
    fittedLayoutScale,
    effectiveMode,
    linesPerPage,
    measureText,
    metrics,
    page,
    showRoman,
    stageContentHeight,
    tileSizeRatio,
  ]);

  // Auto-follow (P5): during playback keep the active line visible + highlighted.
  // Selection (gloss panel) is untouched — only page/scroll/highlight move.
  const following = autoFollow && isPlaying && Boolean(activeSourceLineId);
  const activeIndex = useMemo(
    () =>
      activeSourceLineId
        ? boardLines.findIndex((line) => line.id === activeSourceLineId)
        : -1,
    [boardLines, activeSourceLineId],
  );
  const activeDisplayLineId = useMemo(() => {
    if (!following || activeIndex < 0) {
      return null;
    }
    const match = visibleLines.find(
      (line) => line.sourceId === activeSourceLineId,
    );
    return match ? match.id : null;
  }, [following, activeIndex, visibleLines, activeSourceLineId]);
  const activePage = useMemo(() => {
    if (activeIndex < 0) {
      return -1;
    }
    let target = 0;
    for (let index = 0; index < pageStarts.length; index += 1) {
      if (pageStarts[index] <= activeIndex) {
        target = index;
      }
    }
    return target;
  }, [activeIndex, pageStarts]);

  // Page to the active line (page mode).
  useLayoutEffect(() => {
    if (!following || effectiveMode !== "page" || activeIndex < 0) {
      return;
    }
    const targetPage = activePage;
    if (targetPage !== page) {
      // Legitimate external-driven sync (playback → page); not derivable in render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPage(targetPage);
    }
  }, [following, effectiveMode, activeIndex, activePage, page]);

  // Scroll the active line into view (scroll mode).
  useLayoutEffect(() => {
    if (!following || effectiveMode !== "scroll" || !activeDisplayLineId) {
      return;
    }
    const stage = stageRef.current;
    const row = stage?.querySelector(
      `[data-line-id="${activeDisplayLineId}"]`,
    );
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [following, effectiveMode, activeDisplayLineId]);

  const layoutScale = fittedLayoutScale;

  const getTileWidth = useCallback(
    (word) =>
      hydrated
        ? Math.round(measureTileWidth(word, { measureText }) * layoutScale)
        : null,
    [hydrated, layoutScale, measureText],
  );

  const getWordRows = useCallback(
    (line) => {
      if (!hydrated) {
        return [line.words];
      }
      return splitWordsIntoRows(line.words, {
        availableWidth,
        boardScale: metrics.boardScale,
        isMobile: metrics.isMobile,
        measureText,
        tileScale: layoutScale,
      });
    },
    [availableWidth, hydrated, layoutScale, measureText, metrics],
  );

  const getLineMinHeight = useCallback(
    (line) => {
      if (!hydrated) {
        return null;
      }
      const height = estimateWrappedLineHeight(line, {
        availableWidth,
        boardScale: metrics.boardScale,
        isMobile: metrics.isMobile,
        measureText,
        showRoman,
        tileSizeRatio,
        tileScale: layoutScale,
      });
      return Number.isFinite(height) ? Math.round(height) : null;
    },
    [
      availableWidth,
      hydrated,
      layoutScale,
      measureText,
      metrics,
      showRoman,
      tileSizeRatio,
    ],
  );

  // ---- Apply CSS variables + roman class to the board root (effect) ----
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const board = host.querySelector(".version-sketch") || host;
    const boardHeight = metrics.boardWidth / (1094 / 922);
    board.style.setProperty("--tile-scale", String(tileScale));
    board.style.setProperty("--tile-layout-scale", String(layoutScale));
    board.style.setProperty("--board-width", `${metrics.boardWidth}px`);
    board.style.setProperty("--board-height", `${boardHeight}px`);
    board.style.setProperty("--board-scale", String(metrics.boardScale));
    board.classList.toggle("show-inline-roman", showRoman);
  }, [metrics, tileScale, layoutScale, showRoman, effectiveMode, visibleLines]);

  // ---- Scroll-position preservation + range note (scroll mode) ----
  const updateScrollState = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const stageRect = stage.getBoundingClientRect();
    const rows = [...stage.querySelectorAll("[data-line-number]")];
    const visibleRows = rows.filter((row) => {
      const rect = row.getBoundingClientRect();
      return rect.bottom > stageRect.top + 2 && rect.top < stageRect.bottom - 2;
    });
    const firstLine = Number(
      visibleRows[0]?.dataset.lineNumber || rows[0]?.dataset.lineNumber || 1,
    );
    const lastLine = Number(
      visibleRows.at(-1)?.dataset.lineNumber ||
        visibleRows[0]?.dataset.lineNumber ||
        firstLine,
    );
    setScrollRange((prev) =>
      prev.start === firstLine && prev.end === lastLine
        ? prev
        : { start: firstLine, end: lastLine },
    );
  }, []);

  const handleStageScroll = useCallback(() => {
    const stage = stageRef.current;
    if (stage) {
      pendingScrollTopRef.current = stage.scrollTop;
    }
    if (typeof window === "undefined") {
      updateScrollState();
      return;
    }
    window.cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = window.requestAnimationFrame(updateScrollState);
  }, [updateScrollState]);

  // Restore scroll position after re-render in scroll mode; refresh range note.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (stage && effectiveMode === "scroll") {
      const maxScrollTop = Math.max(0, stage.scrollHeight - stage.clientHeight);
      const previousBehavior = stage.style.scrollBehavior;
      stage.style.scrollBehavior = "auto";
      stage.scrollTop = clamp(pendingScrollTopRef.current || 0, 0, maxScrollTop);
      stage.style.scrollBehavior = previousBehavior;
    }
    updateScrollState();
  }, [effectiveMode, visibleLines, updateScrollState]);

  // ---- Controls ----
  const stepTileScale = useCallback((deltaPercent) => {
    setTileScale((current) => {
      const next = clamp(
        Math.round(current * 100) + deltaPercent,
        TILE_SCALE_MIN * 100,
        TILE_SCALE_MAX * 100,
      );
      return next / 100;
    });
  }, []);

  const toggleRoman = useCallback(() => setShowRoman((value) => !value), []);

  const toggleMode = useCallback(() => {
    setMode((current) => (current === "scroll" ? "page" : "scroll"));
  }, []);

  const goToPage = useCallback(
    (next) => setPage((current) => clamp(next, 0, Math.max(0, pageCount - 1))),
    [pageCount],
  );

  const sizePercent = Math.round(tileScale * 100);

  return {
    hostRef,
    stageRef,
    getTileWidth,
    getWordRows,
    getLineMinHeight,
    mode: effectiveMode,
    isMobile: metrics.isMobile,
    visibleLines,
    page: safePage,
    pageCount,
    hoveredLineId,
    setHoveredLineId,
    activeDisplayLineId,
    showRoman,
    sizePercent,
    canDecreaseSize: sizePercent > TILE_SCALE_MIN * 100,
    canIncreaseSize: sizePercent < TILE_SCALE_MAX * 100,
    scrollRange,
    lineCount: boardLines.length,
    tileStep: TILE_SCALE_STEP * 100,
    stepTileScale,
    toggleRoman,
    toggleMode,
    goToPage,
    handleStageScroll,
  };
}
