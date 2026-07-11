"use client";

// useWordBoard — ports the #wb-script board module (state + render/layout loop)
// into React. Page/scroll modes, fit-scaling, scroll-position preservation,
// debounced resize, and the live range note all match the prototype.
//
// Written to satisfy the React Compiler lint rules: ALL DOM measurement happens
// inside effects and lands in state; the render path stays pure (no ref reads,
// no setState-in-effect). Board layout state stays local; only selection crosses
// into the editor context.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  buildPageLinesByHeight,
  buildScrollLines,
  clamp,
  COMPACT_DESKTOP_MEDIA_QUERY,
  DEFAULT_BOARD_SCALE,
  DESKTOP_LYRIC_LINE_STEP,
  DESKTOP_LYRIC_LINE_STEP_ROMAN,
  estimateWrappedLineHeight,
  fitLayoutScale,
  getTileScaleDefault,
  getTileScaleLimits,
  measureBoardMetrics,
  measureTileWidth,
  MOBILE_LYRIC_LINE_STEP,
  MOBILE_LYRIC_LINE_STEP_ROMAN,
  MOBILE_MEDIA_QUERY,
  prepareBoardLines,
  SKETCH_IDEAL_BOARD_WIDTH,
  splitWordsIntoRows,
  stageContentWidth,
  TILE_SCALE_STEP,
} from "@/lib/word-board";
import {
  hasFollowAudioTiming,
  resolveFollowAudioState,
} from "@/lib/word-board-follow";

function matchesQuery(query) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(query).matches;
}

const NARROW_WORKSPACE_MEDIA_QUERY = MOBILE_MEDIA_QUERY;

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
    currentTime = 0,
    followAudioResetKey = null,
  } = options;

  const hostRef = useRef(null);
  const stageRef = useRef(null);
  const resizeFrameRef = useRef(0);
  const scrollFrameRef = useRef(0);
  const programmaticScrollTimeoutRef = useRef(0);
  const programmaticScrollRef = useRef(false);
  const pendingScrollTopRef = useRef(0);

  const [tileScale, setTileScale] = useState(() => getTileScaleDefault(false));
  const [page, setPage] = useState(0);
  const [showRoman, setShowRoman] = useState(false);
  const [followAudioEnabled, setFollowAudioEnabled] = useState(false);
  const [followScrollPaused, setFollowScrollPaused] = useState(false);
  const [hoveredLineId, setHoveredLineId] = useState(null);
  // Lazily create the canvas measurer once (client only; null under SSR).
  const [measureText] = useState(() => createTextMeasurer());
  const [stageWidth, setStageWidth] = useState(null);
  const [stageHeight, setStageHeight] = useState(null);
  // Inline tile widths are only applied after mount so SSR and the first client
  // render agree (the canvas measurer would otherwise produce different widths
  // than SSR's heuristic → hydration mismatch).
  const [hydrated, setHydrated] = useState(false);
  const [metrics, setMetrics] = useState(() => ({
    boardWidth: SKETCH_IDEAL_BOARD_WIDTH,
    boardHeight: SKETCH_IDEAL_BOARD_WIDTH / (1094 / 922),
    boardScale: DEFAULT_BOARD_SCALE,
    isMobile: false,
    isNarrow: false,
    isCompactDesktop: false,
    hostWidth: SKETCH_IDEAL_BOARD_WIDTH,
  }));
  const lastIsMobileRef = useRef(false);

  const boardLines = useMemo(() => prepareBoardLines(rawLines), [rawLines]);

  // ---- Measurement: recompute board box + stage width on resize / slot change ----
  const measure = useCallback(() => {
    const host = hostRef.current;
    const slot = host?.parentElement || host;
    const rect = slot?.getBoundingClientRect?.() ?? {};
    const next = measureBoardMetrics(rect);
    const nextIsMobile = matchesQuery(MOBILE_MEDIA_QUERY);
    const previousIsMobile = lastIsMobileRef.current;
    setMetrics({
      boardWidth: next.boardWidth,
      boardHeight: next.boardHeight,
      boardScale: next.boardScale,
      isMobile: nextIsMobile,
      isNarrow: matchesQuery(NARROW_WORKSPACE_MEDIA_QUERY),
      isCompactDesktop: matchesQuery(COMPACT_DESKTOP_MEDIA_QUERY),
      hostWidth: host?.getBoundingClientRect?.().width || next.boardWidth,
    });
    setTileScale((current) => {
      const limits = getTileScaleLimits(nextIsMobile);
      const nextScale =
        nextIsMobile !== previousIsMobile
          ? getTileScaleDefault(nextIsMobile)
          : clamp(current, limits.min, limits.max);
      return nextScale === current ? current : nextScale;
    });
    lastIsMobileRef.current = nextIsMobile;

    const stage = stageRef.current;
    if (stage && stage.clientWidth > 0) {
      const style = window.getComputedStyle(stage);
      const padX =
        parseFloat(style.paddingLeft || "0") + parseFloat(style.paddingRight || "0");
      const padY =
        parseFloat(style.paddingTop || "0") + parseFloat(style.paddingBottom || "0");
      setStageWidth(Math.max(120, stage.clientWidth - padX));
      setStageHeight(Math.max(96, stage.clientHeight - padY));
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
  const tileScaleLimits = useMemo(
    () => getTileScaleLimits(metrics.isMobile),
    [metrics.isMobile],
  );

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
  const layoutScale = fittedLayoutScale;
  const tileSizeRatio = tileScale / tileScaleLimits.max;
  const allDisplayLines = useMemo(() => buildScrollLines(boardLines), [boardLines]);

  const isPagedMode = metrics.isNarrow;
  const pageData = useMemo(() => {
    if (!isPagedMode) {
      return {
        lines: allDisplayLines,
        page: 0,
        pageCount: 1,
        sourceLinePageMap: new Map(),
        start: 0,
      };
    }

    return buildPageLinesByHeight(boardLines, {
      page,
      availableHeight: stageHeight,
      availableWidth,
      boardScale: metrics.boardScale,
      boardWidth: metrics.boardWidth,
      isCompactDesktop: metrics.isCompactDesktop,
      isMobile: metrics.isMobile,
      measureText,
      showRoman,
      tileSizeRatio,
      tileScale: layoutScale,
    });
  }, [
    availableWidth,
    allDisplayLines,
    boardLines,
    isPagedMode,
    layoutScale,
    measureText,
    metrics.boardScale,
    metrics.boardWidth,
    metrics.isCompactDesktop,
    metrics.isMobile,
    page,
    showRoman,
    stageHeight,
    tileSizeRatio,
  ]);
  const visibleLines = pageData.lines;
  const currentPage = pageData.page ?? 0;
  const pageCount = pageData.pageCount ?? 1;
  const canFollowAudio = useMemo(
    () => hasFollowAudioTiming(allDisplayLines),
    [allDisplayLines],
  );
  const effectiveFollowAudioEnabled = followAudioEnabled && canFollowAudio;
  const followAudioState = useMemo(
    () =>
      effectiveFollowAudioEnabled
        ? resolveFollowAudioState(allDisplayLines, currentTime)
        : {
            activeDisplayLineId: null,
            activeSourceLineId: null,
            available: canFollowAudio,
            currentWordKeys: [],
            passedWordKeys: [],
          },
    [allDisplayLines, canFollowAudio, currentTime, effectiveFollowAudioEnabled],
  );
  const currentWordKeySet = useMemo(
    () => new Set(followAudioState.currentWordKeys),
    [followAudioState.currentWordKeys],
  );
  const passedWordKeySet = useMemo(
    () => new Set(followAudioState.passedWordKeys),
    [followAudioState.passedWordKeys],
  );
  const activeDisplayLineId = followAudioState.activeDisplayLineId;
  const activeSourceLineId = followAudioState.activeSourceLineId;
  const followTargetPage =
    isPagedMode && activeSourceLineId
      ? (pageData.sourceLinePageMap?.get(activeSourceLineId) ?? null)
      : null;

  useEffect(() => {
    if (!isPagedMode || page === currentPage) {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(currentPage);
  }, [currentPage, isPagedMode, page]);

  useEffect(() => {
    // Legitimate external reset: a different project/audio identity should make
    // the session-only F state start off again.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFollowAudioEnabled(false);
    setFollowScrollPaused(false);
  }, [followAudioResetKey]);

  useEffect(() => {
    if (canFollowAudio || !followAudioEnabled) {
      return;
    }
    // If timing data is removed while F is on, return the local toggle to off.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFollowAudioEnabled(false);
  }, [canFollowAudio, followAudioEnabled]);

  useEffect(() => {
    if (effectiveFollowAudioEnabled) {
      return;
    }
    // F off/unavailable should also clear any paused-follow affordance.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFollowScrollPaused(false);
  }, [effectiveFollowAudioEnabled]);

  const clearProgrammaticScrollGuard = useCallback(() => {
    if (programmaticScrollTimeoutRef.current) {
      window.clearTimeout(programmaticScrollTimeoutRef.current);
      programmaticScrollTimeoutRef.current = 0;
    }
    programmaticScrollRef.current = false;
  }, []);

  const armProgrammaticScrollGuard = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    programmaticScrollRef.current = true;
    if (programmaticScrollTimeoutRef.current) {
      window.clearTimeout(programmaticScrollTimeoutRef.current);
    }
    programmaticScrollTimeoutRef.current = window.setTimeout(() => {
      programmaticScrollRef.current = false;
      programmaticScrollTimeoutRef.current = 0;
    }, 520);
  }, []);

  useEffect(
    () => () => {
      clearProgrammaticScrollGuard();
    },
    [clearProgrammaticScrollGuard],
  );

  const centerActiveFollowLine = useCallback(
    (behavior = "smooth") => {
      if (!activeDisplayLineId) {
        return false;
      }
      const stage = stageRef.current;
      const row = stage?.querySelector(
        `[data-line-id="${activeDisplayLineId}"]`,
      );

      if (!row) {
        return false;
      }

      armProgrammaticScrollGuard();
      row.scrollIntoView({ behavior, block: "center" });
      return true;
    },
    [activeDisplayLineId, armProgrammaticScrollGuard],
  );

  const isActiveFollowLineCentered = useCallback(() => {
    if (!activeDisplayLineId) {
      return true;
    }
    const stage = stageRef.current;
    const row = stage?.querySelector(
      `[data-line-id="${activeDisplayLineId}"]`,
    );

    if (!stage || !row) {
      return true;
    }

    const stageRect = stage.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const visible =
      rowRect.bottom > stageRect.top + 2 && rowRect.top < stageRect.bottom - 2;

    if (!visible) {
      return false;
    }

    const stageCenter = stageRect.top + stageRect.height / 2;
    const rowCenter = rowRect.top + rowRect.height / 2;
    return Math.abs(rowCenter - stageCenter) <= stageRect.height * 0.3;
  }, [activeDisplayLineId]);

  // While F is on and follow scrolling is not paused, keep the active line centered.
  useLayoutEffect(() => {
    if (
      isPagedMode ||
      !effectiveFollowAudioEnabled ||
      followScrollPaused ||
      !activeDisplayLineId
    ) {
      return;
    }

    centerActiveFollowLine("smooth");
  }, [
    activeDisplayLineId,
    centerActiveFollowLine,
    effectiveFollowAudioEnabled,
    followScrollPaused,
    isPagedMode,
  ]);

  // In paged mode, F follows by moving to the page containing the active source line.
  useEffect(() => {
    if (
      !isPagedMode ||
      !effectiveFollowAudioEnabled ||
      followScrollPaused ||
      followTargetPage == null ||
      followTargetPage === currentPage
    ) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(followTargetPage);
  }, [
    currentPage,
    effectiveFollowAudioEnabled,
    followScrollPaused,
    followTargetPage,
    isPagedMode,
  ]);

  const getTileWidth = useCallback(
    (word) =>
      hydrated
        ? Math.round(
            measureTileWidth(word, {
              isMobile: metrics.isMobile,
              measureText,
            }) * layoutScale,
          )
        : null,
    [hydrated, layoutScale, measureText, metrics.isMobile],
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

  // ---- Board CSS variables (applied in render, not an effect) ----
  // Computing these as an inline style (instead of writing them imperatively in a
  // layout effect) keeps them perfectly in sync with the rendered tile widths:
  // the scale used to lay out the tiles and the --tile-layout-scale that sizes
  // their fonts land in the SAME commit, so the words never paint one frame at
  // the wrong scale and then snap. The frame's own width/height are sized by CSS
  // (container-query contain-fit), so --board-width/height here are advisory only.
  const boardStyle = useMemo(() => {
    const boardHeight = metrics.boardWidth / (1094 / 922);
    return {
      "--tile-scale": String(tileScale),
      // layoutScale derives from the canvas text-measurer, which only exists on
      // the client — so emitting it during SSR / the first client render would
      // mismatch and trip a hydration error. The fitted value only matters once
      // the words are revealed (gated on `hydrated`), so use 1 until then.
      "--tile-layout-scale": hydrated ? String(layoutScale) : "1",
      "--board-width": `${metrics.boardWidth}px`,
      "--board-height": `${boardHeight}px`,
      "--board-scale": String(metrics.boardScale),
      "--desktop-lyric-line-step": `${DESKTOP_LYRIC_LINE_STEP}px`,
      "--desktop-lyric-line-step-roman": `${DESKTOP_LYRIC_LINE_STEP_ROMAN}px`,
      "--mobile-lyric-line-step": `${MOBILE_LYRIC_LINE_STEP}px`,
      "--mobile-lyric-line-step-roman": `${MOBILE_LYRIC_LINE_STEP_ROMAN}px`,
    };
  }, [hydrated, metrics, tileScale, layoutScale]);

  // ---- Scroll-position preservation ----
  const updateScrollState = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    pendingScrollTopRef.current = stage.scrollTop;
  }, []);

  const handleStageScroll = useCallback(() => {
    const stage = stageRef.current;
    if (stage) {
      pendingScrollTopRef.current = stage.scrollTop;
    }
    const shouldDetectManualScroll =
      effectiveFollowAudioEnabled &&
      !followScrollPaused &&
      Boolean(activeDisplayLineId) &&
      !programmaticScrollRef.current;
    if (typeof window === "undefined") {
      updateScrollState();
      return;
    }
    window.cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      updateScrollState();
      if (shouldDetectManualScroll && !isActiveFollowLineCentered()) {
        setFollowScrollPaused(true);
      }
    });
  }, [
    activeDisplayLineId,
    effectiveFollowAudioEnabled,
    followScrollPaused,
    isActiveFollowLineCentered,
    updateScrollState,
  ]);

  // Restore scroll position after re-render in scroll mode; page mode always
  // shows a clipped page, so keep the stage pinned to the top.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (stage && isPagedMode) {
      stage.scrollTop = 0;
      pendingScrollTopRef.current = 0;
      updateScrollState();
      return;
    }

    if (stage && !effectiveFollowAudioEnabled) {
      const maxScrollTop = Math.max(0, stage.scrollHeight - stage.clientHeight);
      const previousBehavior = stage.style.scrollBehavior;
      stage.style.scrollBehavior = "auto";
      stage.scrollTop = clamp(pendingScrollTopRef.current || 0, 0, maxScrollTop);
      stage.style.scrollBehavior = previousBehavior;
    }
    updateScrollState();
  }, [
    currentPage,
    effectiveFollowAudioEnabled,
    isPagedMode,
    updateScrollState,
    visibleLines,
  ]);

  // ---- Controls ----
  const stepTileScale = useCallback(
    (deltaPercent) => {
      setTileScale((current) => {
        const next = clamp(
          Math.round(current * 100) + deltaPercent,
          tileScaleLimits.min * 100,
          tileScaleLimits.max * 100,
        );
        return next / 100;
      });
    },
    [tileScaleLimits],
  );

  const toggleRoman = useCallback(() => setShowRoman((value) => !value), []);

  const toggleFollowAudio = useCallback(() => {
    if (!canFollowAudio) {
      return;
    }
    setFollowAudioEnabled((enabled) => !enabled);
    setFollowScrollPaused(false);
  }, [canFollowAudio]);

  const handleRefollow = useCallback(() => {
    if (isPagedMode) {
      if (followTargetPage != null) {
        setPage(followTargetPage);
      }
      setFollowScrollPaused(false);
      return;
    }

    setFollowScrollPaused(false);
    centerActiveFollowLine("smooth");
  }, [centerActiveFollowLine, followTargetPage, isPagedMode]);

  const goToPreviousPage = useCallback(() => {
    // Non-cyclic: clamp at the first page instead of wrapping to the last.
    setPage((current) => Math.max(current - 1, 0));
    if (effectiveFollowAudioEnabled) {
      setFollowScrollPaused(true);
    }
  }, [effectiveFollowAudioEnabled]);

  const goToNextPage = useCallback(() => {
    // Non-cyclic: clamp at the last page instead of wrapping to the first.
    setPage((current) => Math.min(current + 1, Math.max(pageCount - 1, 0)));
    if (effectiveFollowAudioEnabled) {
      setFollowScrollPaused(true);
    }
  }, [effectiveFollowAudioEnabled, pageCount]);

  const getWordAudioState = useCallback(
    (word) => {
      if (!effectiveFollowAudioEnabled) {
        return null;
      }

      if (currentWordKeySet.has(word.sourceWordKey)) {
        return "current";
      }

      if (passedWordKeySet.has(word.sourceWordKey)) {
        return "passed";
      }

      return null;
    },
    [currentWordKeySet, effectiveFollowAudioEnabled, passedWordKeySet],
  );

  const sizePercent = Math.round(tileScale * 100);

  return {
    hostRef,
    stageRef,
    // The board is only laid out correctly once the client measurement pass has
    // run (tile widths / wrapping / page height all depend on it). Until then the
    // server-rendered tiles have no width and collapse, so callers hide them to
    // avoid a flash of broken layout on load/refresh. Matches SSR (false → false).
    ready: hydrated,
    boardStyle,
    getTileWidth,
    getWordRows,
    getLineMinHeight,
    visibleLines,
    isPagedMode,
    currentPage,
    pageCount,
    canPage: pageCount > 1,
    hoveredLineId,
    setHoveredLineId,
    activeDisplayLineId,
    activeSourceLineId,
    canFollowAudio,
    followAudioEnabled: effectiveFollowAudioEnabled,
    followScrollPaused,
    getWordAudioState,
    showRefollowButton: effectiveFollowAudioEnabled && followScrollPaused,
    showRoman,
    sizePercent,
    canDecreaseSize: sizePercent > tileScaleLimits.min * 100,
    canIncreaseSize: sizePercent < tileScaleLimits.max * 100,
    tileStep: TILE_SCALE_STEP * 100,
    stepTileScale,
    toggleRoman,
    toggleFollowAudio,
    handleRefollow,
    goToPreviousPage,
    goToNextPage,
    handleStageScroll,
  };
}
