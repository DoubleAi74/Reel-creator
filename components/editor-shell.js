"use client";

import { startTransition, useEffect, useEffectEvent, useRef, useState } from "react";

import { EditorProvider } from "@/components/editor-context";
import { useEditorState } from "@/components/editor-state";
import { EditorHeader } from "@/components/editor-header";
import { EditorModals } from "@/components/editor-modals";
import { EditorTabBar } from "@/components/editor-tab-bar";
import { PreviewStage } from "@/components/preview-stage";
import { AudioTab } from "@/components/tabs/audio-tab";
import { LyricsTab } from "@/components/tabs/lyrics-tab";
import { StyleTab } from "@/components/tabs/style-tab";
import { WaveformTimeline } from "@/components/waveform-timeline";
import { YoutubeSegmentModal } from "@/components/youtube-segment-modal";
import {
  getExportReadiness,
  getRenderPollDelayMs,
  getRenderProgressPercent,
} from "@/lib/export-flow";
import {
  createDefaultProject,
  createLine,
  exportProjectJson,
  importProjectJson,
  importProjectValue,
} from "@/lib/project";
import { parseGbpInputToMinor } from "@/lib/money";
import {
  AUTOSAVE_STORAGE_KEY,
  decodeAutosave,
  encodeAutosave,
} from "@/lib/autosave";
import {
  applyWordMeaningsToLines,
  mergeMeaningWordsWithTiming,
} from "@/lib/word-meanings";
import {
  DEFAULT_TEXT_LAYER_MODE,
  getTextLayerFormat,
} from "@/lib/render/formats";
import {
  getNextTapTimingLineId,
  getTapTimingLineProgress,
  getTapTimingStartLineId,
} from "@/lib/tap-timing";
import {
  clampLineStartsToSection,
  clampTimeToSection,
  findActiveLine,
  getSectionBounds,
  getSectionDurationInFrames,
  getSectionFrameFromTime,
  isSectionWithinLimit,
  MAX_SECTION_DURATION_SECONDS,
  normalizeAudioSection,
} from "@/lib/timing";
import { applyStylePreset, STYLE_PRESETS } from "@/lib/style-presets";
import {
  formatPreciseTime,
  formatSectionRelativeTime,
  isBackgroundMediaType,
} from "@/lib/editor-format";
import {
  LYRIC_PIPELINE_PRESETS,
  getLyricPipelineCanRun,
  getLyricPipelineSelectionForPreset,
  getSelectedLyricPipelinePhases,
  hasLyricPipelineDownstreamData,
} from "@/lib/staged-lyrics";
import { VIDEO_FPS } from "@/remotion/constants";

// Bundled demo assets. The MP3 is copied into /public/samples so it can be
// fetched and pushed through the normal audio upload pipeline; the project JSON
// is loaded on demand via dynamic import.
const SAMPLE_AUDIO_NAME = "Aaj-Se-Teri-Lyrical-Padman-Aksha.mp3";
const SAMPLE_AUDIO_URL = `/samples/${SAMPLE_AUDIO_NAME}`;
const LYRIC_REBUILD_CONFIRM_MESSAGE =
  "This rebuilds your lyric set and clears the translation and timing below. Continue?";

// Mobile-only bottom-sheet snap heights (ignored at lg+, where the editor fills its grid column).
const SHEET_SNAPS = [
  { key: "peek", label: "Expand settings panel" },
  { key: "full", label: "Collapse settings panel" },
];

const BACKGROUND_UPLOAD_COPY = {
  image: {
    buttonLabel: "Choose image",
    emptyMessage: "Upload a PNG, JPG, or WebP still to preview and export it here.",
    helperText:
      "PNG, JPG, or WebP up to 10 MB. The image cover-fits the 9:16 frame in preview and export.",
    missingMessage:
      "Preview and export stay blocked until this session has the matching image upload.",
    statusLabel: "Image status",
    uploadLabel: "Drag a still image here or choose one from your computer",
  },
  video: {
    buttonLabel: "Choose video",
    emptyMessage:
      "Upload an MP4 or WebM clip to loop it behind the lyrics in preview and export.",
    helperText:
      "MP4 or WebM up to 50 MB. The clip cover-fits the 9:16 frame, loops automatically, and stays muted while your MP3 remains the audio track.",
    missingMessage:
      "Preview and export stay blocked until this session has the matching video upload.",
    statusLabel: "Video status",
    uploadLabel: "Drag a short video clip here or choose one from your computer",
  },
};

function parseTypedTime(value) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(":");

  if (parts.length === 1) {
    const seconds = Number(parts[0]);

    return Number.isFinite(seconds) && seconds >= 0 ? seconds : Number.NaN;
  }

  let multiplier = 1;
  let totalSeconds = 0;

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const partValue = Number(parts[index]);

    if (!Number.isFinite(partValue) || partValue < 0) {
      return Number.NaN;
    }

    totalSeconds += partValue * multiplier;
    multiplier *= 60;
  }

  return totalSeconds;
}

function cloneProject(project) {
  return structuredClone(project);
}

function buildSessionAssetUrl(assetId) {
  return assetId ? `/api/assets/${assetId}` : null;
}

/**
 * Prefer embedded convert bytes (Vercel multi-isolate /tmp 404s on /api/assets).
 * Falls back to session asset URL for localhost / single-instance hosts.
 */
function youtubeAssetToFile(asset) {
  if (!asset?.audioBase64 || typeof asset.audioBase64 !== "string") {
    return null;
  }

  try {
    const binary = atob(asset.audioBase64);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    const type = asset.mimeType || "audio/mpeg";
    const name =
      typeof asset.name === "string" && asset.name.trim()
        ? asset.name.trim()
        : "youtube-audio.mp3";

    return new File([bytes], name, { type });
  } catch {
    return null;
  }
}

function buildYoutubeAssetPlaybackUrl(asset) {
  const file = youtubeAssetToFile(asset);

  if (file) {
    return URL.createObjectURL(file);
  }

  return buildSessionAssetUrl(asset?.assetId);
}

function stripEmbeddedYoutubeAudio(asset) {
  if (!asset || typeof asset !== "object") {
    return asset;
  }

  const { audioBase64: _audioBase64, mimeType: _mimeType, ...rest } = asset;
  return rest;
}

// localStorage is a best-effort recovery cache, not the source of truth, so all
// access is wrapped: a disabled/full store simply degrades to no autosave.
function readAutosaveRaw() {
  try {
    return window.localStorage.getItem(AUTOSAVE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeAutosaveRaw(value) {
  try {
    window.localStorage.setItem(AUTOSAVE_STORAGE_KEY, value);
  } catch {
    // Ignore quota / private-mode errors — autosave is non-essential.
  }
}

function clearAutosaveRaw() {
  try {
    window.localStorage.removeItem(AUTOSAVE_STORAGE_KEY);
  } catch {
    // Ignore — nothing to recover is an acceptable outcome.
  }
}

// Lightweight existence check for a restored asset. The asset route only
// implements GET (no HEAD), so we issue a GET but abort as soon as the response
// headers arrive, avoiding a full re-download of the audio just to verify it.
async function verifyAssetExists(assetId) {
  const url = buildSessionAssetUrl(assetId);

  if (!url) {
    return false;
  }

  const controller = new AbortController();

  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    const exists = response.ok;

    controller.abort();

    return exists;
  } catch {
    return false;
  }
}

async function fetchCreditBalancePayload() {
  const response = await fetch("/api/credits/balance", {
    cache: "no-store",
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error ?? "Credit balance is unavailable.");
  }

  return payload;
}

function createBackgroundUploadEntry(kind, assetName = null) {
  if (assetName) {
    return {
      asset: null,
      message: `Project imported. Re-upload ${assetName} in this session to restore the ${kind} preview and export.`,
      status: "idle",
    };
  }

  return {
    asset: null,
    message: BACKGROUND_UPLOAD_COPY[kind].emptyMessage,
    status: "idle",
  };
}

function createBackgroundUploadState(background = {}) {
  return {
    image: createBackgroundUploadEntry(
      "image",
      background.type === "image" ? background.assetName : null,
    ),
    video: createBackgroundUploadEntry(
      "video",
      background.type === "video" ? background.assetName : null,
    ),
  };
}

function getBackgroundUploadEntry(backgroundUpload, backgroundType) {
  return backgroundType === "video" ? backgroundUpload.video : backgroundUpload.image;
}

function getBackgroundAssetName(backgroundUpload, currentBackground, nextType) {
  if (!isBackgroundMediaType(nextType)) {
    return currentBackground.assetName;
  }

  const uploadedAssetName =
    getBackgroundUploadEntry(backgroundUpload, nextType).asset?.name ?? null;

  if (uploadedAssetName) {
    return uploadedAssetName;
  }

  return currentBackground.type === nextType ? currentBackground.assetName : null;
}

function slugifyFileStem(value, fallback) {
  return (
    String(value ?? fallback)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || fallback
  );
}

function getFallbackRenderFileName(
  title,
  transparent = false,
  textLayerMode = DEFAULT_TEXT_LAYER_MODE,
) {
  const stem = slugifyFileStem(title, "reel-creator-render");

  return transparent
    ? `${stem}-text-layer.${getTextLayerFormat(textLayerMode).extension}`
    : `${stem}.mp4`;
}

function parseDownloadFileName(contentDisposition, fallback) {
  if (!contentDisposition) {
    return fallback;
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);

  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const quotedMatch = contentDisposition.match(/filename="([^"]+)"/i);

  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }

  const plainMatch = contentDisposition.match(/filename=([^;]+)/i);

  return plainMatch?.[1]?.trim() ?? fallback;
}

async function downloadRenderFile(fileUrl, fallbackName) {
  const response = await fetch(fileUrl, {
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));

    throw new Error(payload.error ?? "The rendered MP4 could not be downloaded.");
  }

  const fileName = parseDownloadFileName(
    response.headers.get("Content-Disposition"),
    fallbackName,
  );
  const blobUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");

  link.href = blobUrl;
  link.download = fileName;
  link.click();

  window.setTimeout(() => {
    URL.revokeObjectURL(blobUrl);
  }, 1000);

  return fileName;
}

function createIdleExportState() {
  return {
    downloadError: "",
    downloadName: "",
    errorMessage: "",
    fileUrl: "",
    isDownloading: false,
    isReconnecting: false,
    jobId: "",
    phase: "idle",
    pollFailureCount: 0,
    progress: 0,
    renderStatus: null,
    statusNote: "",
    textLayerMode: DEFAULT_TEXT_LAYER_MODE,
    transparent: false,
  };
}

function createIdleAutoLyricsState() {
  return {
    detail: "",
    lineCount: 0,
    message: "",
    status: "idle",
    title: "",
  };
}

function createIdleAutoTimingState() {
  return {
    detail: "",
    lineCount: 0,
    message: "",
    status: "idle",
    title: "",
  };
}

function getEnrichedLineCount(lines) {
  return lines.filter((line) => {
    const hasLineText =
      typeof line?.translation === "string" && line.translation.trim();
    const hasRomanization =
      typeof line?.romanization === "string" && line.romanization.trim();
    const hasWordMeanings = (Array.isArray(line?.words) ? line.words : []).some(
      (word) =>
        (typeof word?.gloss === "string" && word.gloss.trim()) ||
        (typeof word?.roman === "string" && word.roman.trim()),
    );

    return hasLineText || hasRomanization || hasWordMeanings;
  }).length;
}

function normalizeLineWords(rawWords) {
  return (Array.isArray(rawWords) ? rawWords : [])
    .map((word) => ({
      end: Number(word?.end),
      start: Number(word?.start),
      text: String(word?.text ?? word?.word ?? "").trim(),
    }))
    .filter(
      (word) =>
        word.text && Number.isFinite(word.start) && Number.isFinite(word.end),
    );
}

function getPipelineTimingCounts(payload, fallbackLineCount) {
  const summary = payload?.timingSummary ?? {};
  const lines = Array.isArray(payload?.lines) ? payload.lines : [];
  const finiteStartedCount = lines.filter((line) =>
    Number.isFinite(line?.start),
  ).length;
  const totalCount = Number.isFinite(summary.lineCount)
    ? summary.lineCount
    : Number.isFinite(fallbackLineCount)
      ? fallbackLineCount
      : lines.length;
  const timedCount = Number.isFinite(summary.timedCount)
    ? summary.timedCount
    : finiteStartedCount;
  const measuredCount = Number.isFinite(summary.matchedCount)
    ? summary.matchedCount
    : timedCount;
  const estimatedCount = Number.isFinite(summary.estimatedCount)
    ? summary.estimatedCount
    : Math.max(0, timedCount - measuredCount);

  return {
    estimatedCount,
    measuredCount,
    timedCount,
    totalCount,
  };
}

function buildPipelineTimingSummary(payload, fallbackLineCount) {
  const { estimatedCount, measuredCount, timedCount, totalCount } =
    getPipelineTimingCounts(payload, fallbackLineCount);
  const estimatedPart =
    estimatedCount > 0
      ? `, ${estimatedCount} estimated`
      : "";

  return {
    estimatedCount,
    measuredCount,
    message: `Timed ${timedCount} of ${totalCount} line${
      totalCount === 1 ? "" : "s"
    } (${measuredCount} measured${estimatedPart}).`,
    timedCount,
    totalCount,
  };
}

function createIdleTapTimingSession() {
  return {
    active: false,
    cursorLineId: null,
    history: [],
    paused: false,
  };
}

function getTimingDebugState() {
  if (typeof window === "undefined") {
    return null;
  }

  const debugState = (window.__reelTimingDebug ??= {});

  if (!Array.isArray(debugState.markEvents)) {
    debugState.markEvents = [];
  }

  return debugState;
}

function readAudioDuration(file) {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    const objectUrl = URL.createObjectURL(file);

    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(audio.duration);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read the uploaded track duration."));
    };
    audio.src = objectUrl;
  });
}

function getInitialFocusLine(lines = []) {
  const untimedLine = lines.find((line) => !Number.isFinite(line.start));

  if (untimedLine) {
    return untimedLine;
  }

  const timedLines = [...lines]
    .filter((line) => typeof line.start === "number")
    .sort((left, right) => left.start - right.start);

  return timedLines[0] ?? null;
}

function getInitialPreviewFrame(project) {
  const focusLine = getInitialFocusLine(project.lines);

  if (!focusLine || !Number.isFinite(focusLine.start)) {
    return 0;
  }

  return getSectionFrameFromTime(
    focusLine.start + 0.35,
    project.audio,
    VIDEO_FPS,
  );
}

function getDefaultTimingLineId(lines = []) {
  return getInitialFocusLine(lines)?.id ?? null;
}

function getInitialTransportTime(project) {
  return project.audio.startOffset ?? 0;
}

function getNextTimingLineId(lines = [], currentLineId) {
  const currentIndex = lines.findIndex((line) => line.id === currentLineId);

  if (currentIndex === -1) {
    return getDefaultTimingLineId(lines);
  }

  return lines[currentIndex + 1]?.id ?? lines[currentIndex]?.id ?? null;
}

function getLineNumber(lines = [], lineId) {
  const index = lines.findIndex((line) => line.id === lineId);

  return index === -1 ? null : index + 1;
}

export function EditorShell({
  creditsEnabled = false,
  debugProbe = null,
  openGenerationId = "",
  project,
}) {
  const [activeSection, setActiveSection] = useState("audio");
  const previousActiveSectionRef = useRef(activeSection);
  const [audioUpload, setAudioUpload] = useState({
    asset: null,
    message: "Upload an MP3 to replace the sample track metadata.",
    status: "idle",
  });
  const [backgroundUpload, setBackgroundUpload] = useState(() =>
    createBackgroundUploadState(project.background),
  );
  const [audioObjectUrl, setAudioObjectUrl] = useState(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeAudioEnabled, setYoutubeAudioEnabled] = useState(false);
  const [youtubeConfigError, setYoutubeConfigError] = useState("");
  const [isYoutubeModalOpen, setIsYoutubeModalOpen] = useState(false);
  const [isLoadingSample, setIsLoadingSample] = useState(false);
  const [currentAudioTime, setCurrentAudioTime] = useState(
    getInitialTransportTime(project),
  );
  const [lyricSeekTime, setLyricSeekTime] = useState(null);
  const [isTransportPlaying, setIsTransportPlaying] = useState(false);

  // Clear the pending lyric seek signal shortly after it's consumed by the waveform.
  // This prevents it from accidentally forcing seeks on future playback updates
  // that happen to land on the same time value.
  useEffect(() => {
    if (lyricSeekTime !== null) {
      const id = setTimeout(() => setLyricSeekTime(null), 0);
      return () => clearTimeout(id);
    }
  }, [lyricSeekTime]);
  const [isJsonModalOpen, setIsJsonModalOpen] = useState(false);
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonImportError, setJsonImportError] = useState("");
  const [jsonNotice, setJsonNotice] = useState({
    message: "",
    status: "idle",
  });
  const [timingNotice, setTimingNotice] = useState({
    message: "",
    status: "idle",
  });
  const [debugMarkEvents, setDebugMarkEvents] = useState([]);
  const [debugProbeRunStatus, setDebugProbeRunStatus] = useState("idle");
  const [debugWaveSurferOnsets, setDebugWaveSurferOnsets] = useState(null);
  const [timingDrafts, setTimingDrafts] = useState({});
  const [tapTimingSession, setTapTimingSession] = useState(
    createIdleTapTimingSession,
  );
  const [autoFollowEnabled, setAutoFollowEnabled] = useState(true);
  const [sheetSnapIndex, setSheetSnapIndex] = useState(0);
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);
  const [exportState, setExportState] = useState(createIdleExportState);
  const [autoLyricsState, setAutoLyricsState] = useState(
    createIdleAutoLyricsState,
  );
  const [autoTimingState, setAutoTimingState] = useState(
    createIdleAutoTimingState,
  );
  const [creditState, setCreditState] = useState({
    balanceMinor: 0,
    // Seeded from the server (CREDITS_ENABLED) so the credit chrome renders on
    // first paint instead of popping in after the async balance fetch.
    enabled: creditsEnabled,
    status: "idle",
  });
  const [saveGeneration, setSaveGeneration] = useState(true);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockStatus, setUnlockStatus] = useState("idle");
  const [unlockMessage, setUnlockMessage] = useState("");
  const [topUpAmount, setTopUpAmount] = useState("5.00");
  const [topUpStatus, setTopUpStatus] = useState("idle");
  const [topUpMessage, setTopUpMessage] = useState("");
  // Pointer to the background transcription/timing job that the poll effect
  // drives: { jobId, phase: "full" | "generate" | "transcribe" | "enrich" | "time",
  // status: "running" | "done" | "error", appliedJobId }. Survives
  // sleep/reload via autosave so a job can be resumed (or its finished result
  // recovered) after the editor remounts.
  const [transcription, setTranscription] = useState(null);
  const [sourceLanguage, setSourceLanguage] = useState("");
  const [otherSourceLanguage, setOtherSourceLanguage] = useState("");
  const [lyricPipelinePreset, setLyricPipelinePreset] = useState(
    LYRIC_PIPELINE_PRESETS.both,
  );
  const [lyricPipelineSelection, setLyricPipelineSelection] = useState(() =>
    getLyricPipelineSelectionForPreset(LYRIC_PIPELINE_PRESETS.both),
  );
  const [timingControlsOpen, setTimingControlsOpen] = useState(false);
  const [editingLineId, setEditingLineId] = useState(null);
  const [textDisplayOpen, setTextDisplayOpen] = useState(true);
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  // Independent visibility for the two workspace panes. On wide desktop both can
  // be on at once (preview, board, both, or neither). When the viewport is narrow
  // enough that only one fits, the toggle handlers + an effect keep them mutually
  // exclusive (turning one on turns the other off).
  const [showPreview, setShowPreview] = useState(true);
  const [showWordBoard, setShowWordBoard] = useState(true);
  const [isNarrowWorkspace, setIsNarrowWorkspace] = useState(false);
  const previousNarrowWorkspaceRef = useRef(false);
  const [projectState, setProjectState] = useState(() => cloneProject(project));
  const projectStateRef = useRef(projectState);
  const [selectedTimingLineId, setSelectedTimingLineId] = useState(null);
  const audioInputRef = useRef(null);
  const backgroundImageInputRef = useRef(null);
  const backgroundVideoInputRef = useRef(null);
  const appScrollRef = useRef(null);
  const editorScrollRef = useRef(null);
  const previewPlayerRef = useRef(null);
  const pinnedMediaTouchYRef = useRef(null);
  const programmaticScrollTimeoutRef = useRef(null);
  const suppressManualScrollRef = useRef(false);
  const timingRowRefs = useRef(new Map());
  const autoDownloadedJobIdRef = useRef(null);
  // Guards against importing a completed transcription result more than once
  // across repeated polls or remounts (mirrors the persisted appliedJobId).
  const appliedTranscribeJobIdRef = useRef(null);
  const transcriptionWaitersRef = useRef(new Map());
  const pipelineRunInFlightRef = useRef(false);
  // Keep the playable MP3 bytes on the client so generate can re-attach them to
  // the request (multi-isolate hosts lose /tmp between upload and generate).
  const audioSourceFileRef = useRef(null);
  // Stays false until autosave recovery has run, so the initial blank project
  // cannot overwrite saved state before it is restored on mount.
  const autosaveHydratedRef = useRef(false);

  // Shared cross-cutting editor state for the Word Board + workspace components
  // (additive — the shell keeps its own state and publishes the board-relevant
  // signals into this context; see editor-state.js).
  const editor = useEditorState();

  const lineCount = projectState.lines.length;
  const timedLineCount = projectState.lines.filter((line) => Number.isFinite(line.start))
    .length;
  const sectionBounds = getSectionBounds(projectState.audio);
  const sectionDuration = sectionBounds.sectionDuration;
  const hasAudioDuration = sectionBounds.duration > 0;
  const sectionWithinLimit = isSectionWithinLimit(projectState.audio);
  const activeBackgroundUpload = getBackgroundUploadEntry(
    backgroundUpload,
    projectState.background.type,
  );
  const activeBackgroundAsset = isBackgroundMediaType(projectState.background.type)
    ? activeBackgroundUpload.asset
    : null;
  const activeBackgroundUploadCopy =
    projectState.background.type === "video"
      ? BACKGROUND_UPLOAD_COPY.video
      : BACKGROUND_UPLOAD_COPY.image;
  const backgroundPreviewUrl =
    isBackgroundMediaType(projectState.background.type) && activeBackgroundAsset
      ? buildSessionAssetUrl(activeBackgroundAsset.assetId)
      : null;
  const initialPreviewFrame = getInitialPreviewFrame(projectState);
  const previewDurationInFrames = getSectionDurationInFrames(
    projectState.audio,
    VIDEO_FPS,
  );
  const previewCurrentFrame = audioObjectUrl
    ? getSectionFrameFromTime(
        currentAudioTime,
        projectState.audio,
        VIDEO_FPS,
        previewDurationInFrames,
      )
    : initialPreviewFrame;
  const previewTime = Math.max(
    0,
    clampTimeToSection(currentAudioTime, projectState.audio) -
      sectionBounds.startOffset,
  );
  const wordBoardFollowAudioResetKey = [
    projectState.audio.name ?? "",
    audioUpload.asset?.assetId ?? "",
    projectState.meta.title ?? "",
    projectState.meta.artist ?? "",
  ].join("|");
  const stylePresetEntries = Object.entries(STYLE_PRESETS);
  const heardLine = findActiveLine(
    projectState.lines,
    currentAudioTime,
    projectState.audio,
  );
  const resolvedSelectedTimingLineId =
    selectedTimingLineId &&
    projectState.lines.some((line) => line.id === selectedTimingLineId)
      ? selectedTimingLineId
      : null;
  const selectedTimingLine =
    projectState.lines.find((line) => line.id === resolvedSelectedTimingLineId) ?? null;
  const tapTimingStartLineId = getTapTimingStartLineId(
    projectState.lines,
    resolvedSelectedTimingLineId,
  );
  const tapTimingStartLine =
    projectState.lines.find((line) => line.id === tapTimingStartLineId) ?? null;
  const tapTimingStartLineNumber = getLineNumber(
    projectState.lines,
    tapTimingStartLineId,
  );
  const tapTimingCursorIndex = projectState.lines.findIndex(
    (line) => line.id === tapTimingSession.cursorLineId,
  );
  const tapTimingCursorLine =
    tapTimingCursorIndex === -1 ? null : projectState.lines[tapTimingCursorIndex];
  const tapTimingNextLine =
    tapTimingCursorIndex === -1
      ? null
      : projectState.lines[tapTimingCursorIndex + 1] ?? null;
  const tapTimingProgress = getTapTimingLineProgress(
    projectState.lines,
    tapTimingSession.cursorLineId,
  );
  const tapTimingStartDisabledReason = !audioObjectUrl
    ? "Upload an MP3 first"
    : lineCount === 0
      ? "Add lyric lines first"
      : !hasAudioDuration || sectionDuration <= 0
        ? "Choose an audio section with duration"
        : "";
  const canStartTapTiming = tapTimingStartDisabledReason.length === 0;
  const activeTimingLineId =
    tapTimingSession.active && tapTimingCursorLine
      ? tapTimingCursorLine.id
      : (activeSection === "lyrics" ? resolvedSelectedTimingLineId : null);
  const heardLineNumber = getLineNumber(projectState.lines, heardLine?.id);
  // While the audio plays, follow the currently-heard line so the list scrolls
  // in sync with playback (works for already-timed lines being reviewed too);
  // while paused, follow the selected line (Mark/Enter advancing).
  const followTimingLineId =
    (tapTimingSession.active && tapTimingCursorLine
      ? tapTimingCursorLine.id
      : null) ??
    (isTransportPlaying ? heardLine?.id : null) ??
    resolvedSelectedTimingLineId;
  const isTimingTab = activeSection === "lyrics";

  // Publish cross-cutting signals into the shared editor context so the Word
  // Board can read project lines + playback + follow state without prop drilling.
  // One-directional (shell → context); the board's selection flows back in P6.
  const editorActions = editor.actions;
  const heardLineId = heardLine?.id ?? null;
  useEffect(() => {
    projectStateRef.current = projectState;
  }, [projectState]);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/youtube-audio/config", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then((response) => (response.ok ? response.json() : { enabled: false }))
      .then((payload) => {
        if (cancelled) {
          return;
        }

        setYoutubeAudioEnabled(Boolean(payload?.enabled));
        setYoutubeConfigError("");
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setYoutubeAudioEnabled(false);
        setYoutubeConfigError("");
      });

    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;

    setCreditState((currentState) => ({
      ...currentState,
      status: "loading",
    }));
    fetchCreditBalancePayload()
      .then((payload) => {
        if (cancelled) {
          return;
        }

        setCreditState({
          balanceMinor: Number.isInteger(payload.balanceMinor)
            ? payload.balanceMinor
            : 0,
          currency: payload.currency ?? "GBP",
          enabled: payload.enabled === true,
          status: "ready",
        });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setCreditState({
          balanceMinor: 0,
          enabled: false,
          status: "error",
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!openGenerationId) {
      return undefined;
    }

    let cancelled = false;

    fetch(`/api/dashboard/generations/${encodeURIComponent(openGenerationId)}`, {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(payload.error ?? "Saved generation could not be opened.");
        }

        return payload.generation;
      })
      .then((generation) => {
        if (cancelled || !generation?.snapshot) {
          return;
        }

        const importedProject = importProjectValue(
          generation.snapshot.project ?? generation.snapshot,
        );

        setProjectState(importedProject);
        projectStateRef.current = importedProject;
        setBackgroundUpload(createBackgroundUploadState(importedProject.background));
        setAudioUpload({
          asset: {
            assetId: "",
            durationSec: importedProject.audio.duration,
            name: importedProject.audio.name || generation.title,
          },
          message: `${generation.title || "Saved generation"} opened from dashboard.`,
          status: "success",
        });
        setAudioObjectUrl(
          `/api/media/generations/${encodeURIComponent(generation.id)}?proxy=1`,
        );
        setCurrentAudioTime(importedProject.audio.startOffset ?? 0);
        setSelectedTimingLineId(null);
        setTimingDrafts({});
        setTranscription(null);
        setJsonNotice({
          message: `${generation.title || "Saved generation"} opened.`,
          status: "success",
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setJsonNotice({
          message:
            error instanceof Error
              ? error.message
              : "Saved generation could not be opened.",
          status: "error",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [openGenerationId]);
  useEffect(() => {
    editorActions.setLines(projectState.lines);
  }, [editorActions, projectState.lines]);
  // Publish only the low-frequency signals the board needs (active line + play
  // state); avoid republishing per-frame currentAudioTime to keep this heavy
  // component from double-rendering each transport tick.
  useEffect(() => {
    editorActions.setPlayback({
      activeLineId: heardLineId,
      isPlaying: isTransportPlaying,
    });
  }, [editorActions, heardLineId, isTransportPlaying]);
  useEffect(() => {
    editorActions.setAutoFollow(autoFollowEnabled);
  }, [editorActions, autoFollowEnabled]);
  useEffect(() => {
    editorActions.setPreviewFullscreen(isPreviewFullscreen);
  }, [editorActions, isPreviewFullscreen]);
  useEffect(() => {
    if (
      editingLineId &&
      !projectState.lines.some((line) => line.id === editingLineId)
    ) {
      setEditingLineId(null);
    }
  }, [editingLineId, projectState.lines]);

  // Track whether the workspace is narrow enough to fit only one pane. Matches
  // the CSS breakpoint that collapses the workspace to a single column.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return undefined;
    }
    const query = window.matchMedia("(max-width: 1023.98px)");
    const update = () => setIsNarrowWorkspace(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // When the viewport becomes narrow with both panes on, drop to one (keep the
  // word board, the primary view) so the single-column layout shows exactly one.
  useEffect(() => {
    if (isNarrowWorkspace && showPreview && showWordBoard) {
      setShowPreview(false);
      setActiveSection("words");
      setSheetSnapIndex(0);
    }
  }, [isNarrowWorkspace, showPreview, showWordBoard]);

  useEffect(() => {
    const wasNarrow = previousNarrowWorkspaceRef.current;
    if (wasNarrow === isNarrowWorkspace) {
      return;
    }
    previousNarrowWorkspaceRef.current = isNarrowWorkspace;

    if (isNarrowWorkspace) {
      if (showWordBoard && !showPreview) {
        setActiveSection("words");
        setSheetSnapIndex(0);
      }
      return;
    }

    setShowPreview(true);
    setShowWordBoard(true);
    setActiveSection((section) => (section === "words" ? "audio" : section));
  }, [isNarrowWorkspace, showPreview, showWordBoard]);

  useEffect(() => {
    if (isNarrowWorkspace && activeSection === "words") {
      setSheetSnapIndex(0);
      if (appScrollRef.current) {
        appScrollRef.current.scrollTop = 0;
      }
      if (editorScrollRef.current) {
        editorScrollRef.current.scrollTop = 0;
      }
    }
  }, [activeSection, isNarrowWorkspace]);

  useEffect(() => {
    const prev = previousActiveSectionRef.current;
    if (prev === "lyrics" && activeSection !== "lyrics") {
      setSelectedTimingLineId(null);
    }
    previousActiveSectionRef.current = activeSection;
  }, [activeSection]);

  const syncMobileTabForViewTransition = (wasBoardOnly, willBoardOnly) => {
    if (wasBoardOnly && !willBoardOnly) {
      setActiveSection((section) => (section === "words" ? "audio" : section));
    }
  };

  // Each pane toggles independently on wide desktop; on narrow, turning one on
  // turns the other off (and turning the only-on one off shows neither).
  const handleTogglePreview = () => {
    const wasBoardOnly = isNarrowWorkspace && showWordBoard && !showPreview;
    const nextPreview = !showPreview;
    const nextWordBoard =
      nextPreview && isNarrowWorkspace ? false : showWordBoard;
    const willBoardOnly = isNarrowWorkspace && nextWordBoard && !nextPreview;

    setShowPreview(nextPreview);
    if (nextPreview && isNarrowWorkspace) {
      setShowWordBoard(false);
    }
    syncMobileTabForViewTransition(wasBoardOnly, willBoardOnly);
  };
  const handleToggleWordBoard = () => {
    const wasBoardOnly = isNarrowWorkspace && showWordBoard && !showPreview;
    const nextWordBoard = !showWordBoard;
    const nextPreview =
      nextWordBoard && isNarrowWorkspace ? false : showPreview;
    const willBoardOnly = isNarrowWorkspace && nextWordBoard && !nextPreview;

    setShowWordBoard(nextWordBoard);
    if (nextWordBoard && isNarrowWorkspace) {
      setShowPreview(false);
    }
    syncMobileTabForViewTransition(wasBoardOnly, willBoardOnly);
  };
  const handleSelectSection = (sectionId) => {
    setActiveSection(sectionId);
    if (sectionId === "words" && isNarrowWorkspace) {
      setSheetSnapIndex(0);
    }
  };

  const exportReadiness = getExportReadiness({
    audioAssetId: audioUpload.asset?.assetId ?? "",
    backgroundAssetId: activeBackgroundAsset?.assetId ?? "",
    backgroundDurationSec: activeBackgroundAsset?.durationSec ?? null,
    backgroundType: projectState.background.type,
    sectionWithinLimit,
  });
  const textLayerReadiness = getExportReadiness({
    audioAssetId: audioUpload.asset?.assetId ?? "",
    sectionWithinLimit,
    transparent: true,
  });
  const exportBusy =
    exportState.phase === "starting" || exportState.phase === "polling";
  const exportModalOpen = exportState.phase !== "idle";
  const exportProgressPercent = getRenderProgressPercent(
    exportState.phase === "done" ? "done" : exportState.renderStatus,
    exportState.progress,
  );
  const autoLyricsBusy = autoLyricsState.status === "running";
  const autoTimingBusy = autoTimingState.status === "running";
  const sourceLanguageRequired = sourceLanguage.trim().length === 0;
  const otherSourceLanguageRequired =
    sourceLanguage === "other" && otherSourceLanguage.trim().length === 0;
  const autoLyricsLanguageRequirementMessage = sourceLanguageRequired
    ? "Select a source language before running the lyric pipeline."
    : otherSourceLanguageRequired
      ? "Type the source language to use Other."
      : "";
  const lyricPipelineCanRun = getLyricPipelineCanRun({
    hasAudio:
      audioUpload.status === "success" && Boolean(audioUpload.asset?.assetId),
    lines: projectState.lines,
  });
  const selectedLyricPipelinePhases = getSelectedLyricPipelinePhases(
    lyricPipelineSelection,
    lyricPipelineCanRun,
  );
  const selectedPipelineNeedsSourceLanguage = Boolean(
    lyricPipelineSelection?.generate,
  );
  const lyricPipelineLanguageRequirementMessage =
    selectedPipelineNeedsSourceLanguage ? autoLyricsLanguageRequirementMessage : "";
  const canGenerateAutoLyrics =
    audioUpload.status === "success" &&
    Boolean(audioUpload.asset?.assetId) &&
    !autoLyricsBusy &&
    !autoTimingBusy &&
    !lyricPipelineLanguageRequirementMessage;
  const transcriptionPhase =
    typeof transcription?.phase === "string" ? transcription.phase : "";
  const transcriptionRunningPhase =
    transcription?.status === "running" ? transcriptionPhase : "";
  const transcriptionFailedPhase =
    transcription?.status === "error" ? transcriptionPhase : "";
  const generatedLineCount = getEnrichedLineCount(projectState.lines);
  const lyricPipelineStatusByPhase = {
    generate:
      transcriptionRunningPhase === "generate" ||
      transcriptionRunningPhase === "transcribe" ||
      transcriptionRunningPhase === "enrich" ||
      transcriptionRunningPhase === "full"
        ? {
            message:
              autoLyricsState.detail ||
              autoLyricsState.message ||
              "Generating translated lyric lines.",
            status: "running",
            title: autoLyricsState.title || "Generate lyrics running",
          }
        : transcriptionFailedPhase === "generate" ||
            transcriptionFailedPhase === "transcribe" ||
            transcriptionFailedPhase === "enrich" ||
            transcriptionFailedPhase === "full"
          ? {
              message: autoLyricsState.message || "Generate lyrics failed.",
              status: "error",
              title: autoLyricsState.title || "Generate lyrics failed",
            }
          : generatedLineCount > 0
            ? {
                message: `${generatedLineCount} translated lyric line${
                  generatedLineCount === 1 ? "" : "s"
                } ready.`,
                status: "success",
                title: "Ready",
              }
            : {
                message: lyricPipelineCanRun.generate
                  ? "Ready to generate translated lyrics from the uploaded MP3."
                  : "Upload an MP3 first.",
                status: lyricPipelineCanRun.generate ? "ready" : "idle",
                title: lyricPipelineCanRun.generate ? "Ready" : "Waiting",
              },
    time:
      transcriptionRunningPhase === "time"
        ? {
            message:
              autoTimingState.detail ||
              autoTimingState.message ||
              "Aligning current lyrics to the audio.",
            status: "running",
            title: autoTimingState.title || "Time lyrics running",
          }
        : transcriptionFailedPhase === "time"
          ? {
              message: autoTimingState.message || "Time lyrics failed.",
              status: "error",
              title: autoTimingState.title || "Time lyrics failed",
            }
          : timedLineCount > 0
            ? {
                message: `${timedLineCount} of ${lineCount} lyric line${
                  lineCount === 1 ? "" : "s"
                } timed.`,
                status: "success",
                title: "Ready",
              }
            : {
                message:
                  lineCount > 0
                    ? "Ready to time current lyrics."
                    : "Generate lyrics or add lyric lines first.",
                status: lineCount > 0 ? "ready" : "idle",
                title: lineCount > 0 ? "Ready" : "Waiting",
              },
  };
  const handleLyricPipelinePreset = (preset) => {
    setLyricPipelinePreset(preset);
    setLyricPipelineSelection(getLyricPipelineSelectionForPreset(preset));
  };
  const clearProgrammaticScrollGuard = () => {
    if (programmaticScrollTimeoutRef.current) {
      window.clearTimeout(programmaticScrollTimeoutRef.current);
      programmaticScrollTimeoutRef.current = null;
    }
  };

  const armProgrammaticScrollGuard = () => {
    suppressManualScrollRef.current = true;
    clearProgrammaticScrollGuard();
    programmaticScrollTimeoutRef.current = window.setTimeout(() => {
      suppressManualScrollRef.current = false;
      programmaticScrollTimeoutRef.current = null;
    }, 360);
  };

  const scrollSelectedTimingLineIntoView = (behavior = "smooth") => {
    if (!followTimingLineId) {
      return;
    }

    const row = timingRowRefs.current.get(followTimingLineId);

    if (!row) {
      return;
    }

    armProgrammaticScrollGuard();
    row.scrollIntoView({
      behavior,
      block: "center",
    });
  };

  const updateStyle = (updater) => {
    setProjectState((currentProject) => {
      const nextStyle =
        typeof updater === "function"
          ? updater(currentProject.style)
          : { ...currentProject.style, ...updater };

      return {
        ...currentProject,
        style: nextStyle,
      };
    });
  };

  const updateTiming = (patch) => {
    setProjectState((currentProject) => ({
      ...currentProject,
      timing: {
        ...currentProject.timing,
        ...patch,
      },
    }));
  };

  const applyPreset = (presetId) => {
    updateStyle((currentStyle) => applyStylePreset(currentStyle, presetId));
  };

  const updateShadow = (patch) => {
    updateStyle((currentStyle) => ({
      ...currentStyle,
      shadow: {
        ...currentStyle.shadow,
        ...patch,
      },
    }));
  };

  const updateBackground = (updater) => {
    setProjectState((currentProject) => {
      const nextBackground =
        typeof updater === "function"
          ? updater(currentProject.background)
          : { ...currentProject.background, ...updater };

      return {
        ...currentProject,
        background: nextBackground,
      };
    });
  };

  const selectBackgroundType = (nextType) => {
    updateBackground((currentBackground) => ({
      ...currentBackground,
      assetName: getBackgroundAssetName(backgroundUpload, currentBackground, nextType),
      type: nextType,
    }));
  };

  const updateLine = (lineId, patch) => {
    setProjectState((currentProject) => ({
      ...currentProject,
      lines: currentProject.lines.map((line) =>
        line.id === lineId ? { ...line, ...patch } : line,
      ),
    }));
  };

  const confirmLyricRebuildIfNeeded = () => {
    if (!hasLyricPipelineDownstreamData(projectStateRef.current.lines)) {
      return true;
    }

    return window.confirm(LYRIC_REBUILD_CONFIRM_MESSAGE);
  };

  const moveLine = (lineId, direction) => {
    if (!confirmLyricRebuildIfNeeded()) {
      return;
    }

    setProjectState((currentProject) => {
      const currentIndex = currentProject.lines.findIndex((line) => line.id === lineId);

      if (currentIndex === -1) {
        return currentProject;
      }

      const targetIndex = currentIndex + direction;

      if (targetIndex < 0 || targetIndex >= currentProject.lines.length) {
        return currentProject;
      }

      const nextLines = [...currentProject.lines];
      const [line] = nextLines.splice(currentIndex, 1);
      nextLines.splice(targetIndex, 0, line);

      return {
        ...currentProject,
        lines: nextLines,
      };
    });
  };

  const deleteLine = (lineId) => {
    if (!confirmLyricRebuildIfNeeded()) {
      return;
    }

    setProjectState((currentProject) => ({
      ...currentProject,
      lines: currentProject.lines.filter((line) => line.id !== lineId),
    }));
  };

  const addLine = () => {
    if (!confirmLyricRebuildIfNeeded()) {
      return;
    }

    const nextLineId = crypto.randomUUID();

    setProjectState((currentProject) => ({
      ...currentProject,
      lines: [
        ...currentProject.lines,
        createLine({
          id: nextLineId,
          original: "New lyric line",
          start: null,
          translation: "Add a translation",
        }),
      ],
    }));

    setSelectedTimingLineId((currentLineId) => currentLineId ?? nextLineId);
  };

  const setTimingLineStart = (lineId, nextTime, { syncPlayhead = false } = {}) => {
    const clampedTime = clampTimeToSection(nextTime, projectState.audio);

    setProjectState((currentProject) => ({
      ...currentProject,
      lines: currentProject.lines.map((line) =>
        line.id === lineId ? { ...line, start: clampedTime } : line,
      ),
    }));
    setTimingDrafts((currentDrafts) => {
      const nextDrafts = { ...currentDrafts };
      delete nextDrafts[lineId];
      return nextDrafts;
    });

    if (syncPlayhead) {
      setCurrentAudioTime(clampedTime);
    }

    return clampedTime;
  };

  const clearTimingLineStart = (lineId) => {
    setProjectState((currentProject) => ({
      ...currentProject,
      lines: currentProject.lines.map((line) =>
        line.id === lineId ? { ...line, start: null } : line,
      ),
    }));
    setTimingDrafts((currentDrafts) => {
      const nextDrafts = { ...currentDrafts };
      delete nextDrafts[lineId];
      return nextDrafts;
    });
  };

  const restoreTimingLineStart = (lineId, nextStart) => {
    if (Number.isFinite(nextStart)) {
      setTimingLineStart(lineId, nextStart);
      return;
    }

    clearTimingLineStart(lineId);
  };

  const getPreferredTapTimingTime = () => {
    const debugState = getTimingDebugState();
    const liveWaveSurferTime = debugState?.getWaveSurferTime?.() ?? null;

    if (Number.isFinite(liveWaveSurferTime)) {
      return clampTimeToSection(liveWaveSurferTime, projectState.audio);
    }

    return clampTimeToSection(currentAudioTime, projectState.audio);
  };

  const handleMarkCurrentLine = () => {
    if (!selectedTimingLine) {
      return;
    }

    const debugState = getTimingDebugState();
    const liveWaveSurferTime = debugState?.getWaveSurferTime?.() ?? null;
    const stateMarkedTime = clampTimeToSection(currentAudioTime, projectState.audio);
    const liveMarkedTime = Number.isFinite(liveWaveSurferTime)
      ? clampTimeToSection(liveWaveSurferTime, projectState.audio)
      : null;
    const markClockMode =
      debugProbe?.markClockMode === "live" || debugState?.useLiveMarkClock
        ? "live"
        : "state";
    const markedTime =
      markClockMode === "live" && Number.isFinite(liveMarkedTime)
        ? liveMarkedTime
        : stateMarkedTime;
    const nextLineId = getNextTimingLineId(projectState.lines, selectedTimingLine.id);

    const debugMarkEvent = {
      lineId: selectedTimingLine.id,
      liveMarkedTime,
      mode: markClockMode,
      stateMarkedTime,
      storedTime: markedTime,
      timestampMs: Date.now(),
    };

    debugState?.markEvents?.push(debugMarkEvent);
    if (debugProbe) {
      setDebugMarkEvents((currentEvents) => [...currentEvents, debugMarkEvent]);
    }
    console.log(
      "[timing-debug:mark]",
      JSON.stringify({
        lineId: selectedTimingLine.id,
        liveMarkedTime,
        mode: markClockMode,
        stateMarkedTime,
        storedTime: markedTime,
      }),
    );

    setTimingNotice({
      message: "",
      status: "idle",
    });
    setTimingLineStart(selectedTimingLine.id, markedTime);
    startTransition(() => {
      setSelectedTimingLineId(nextLineId);
    });

    // Also move the playhead to the next line if it already has a time
    // (consistent with explicit lyric selection in the tab).
    const nextLine = projectState.lines.find((l) => l.id === nextLineId);
    if (nextLine && Number.isFinite(nextLine.start)) {
      const t = clampTimeToSection(nextLine.start, projectState.audio);
      setCurrentAudioTime(t);
      setLyricSeekTime(t);
    }
  };

  const runDebugMarkCurrentLine = () => {
    handleMarkCurrentLine();
  };

  const stopTapTimingSession = ({
    message = "Tap timing stopped.",
    status = "success",
  } = {}) => {
    const debugState = getTimingDebugState();

    try {
      debugState?.pauseWaveSurfer?.();
    } catch {
      // The waveform may already be gone during imports or tab changes.
    }

    setIsTransportPlaying(false);
    setTapTimingSession(createIdleTapTimingSession());

    if (message != null) {
      setTimingNotice({
        message,
        status,
      });
    }
  };

  const startTapTimingSession = async () => {
    if (!canStartTapTiming) {
      setTimingNotice({
        message: tapTimingStartDisabledReason,
        status: "danger",
      });
      return;
    }

    const debugState = getTimingDebugState();
    const waveSurferTime = debugState?.getWaveSurferTime?.() ?? null;

    if (
      typeof debugState?.playWaveSurfer !== "function" ||
      typeof debugState?.seekWaveSurfer !== "function" ||
      !Number.isFinite(waveSurferTime)
    ) {
      setTimingNotice({
        message: "Waveform is still loading.",
        status: "danger",
      });
      return;
    }

    const startLineId = tapTimingStartLineId;
    const startLine =
      projectState.lines.find((line) => line.id === startLineId) ?? null;
    const startTime = clampTimeToSection(
      Number.isFinite(startLine?.start)
        ? startLine.start
        : sectionBounds.startOffset,
      projectState.audio,
    );

    setTapTimingSession({
      active: true,
      cursorLineId: startLineId,
      history: [],
      paused: false,
    });
    setSelectedTimingLineId(startLineId);
    setCurrentAudioTime(startTime);
    setAutoFollowEnabled(true);
    setTimingNotice({
      message: "",
      status: "idle",
    });

    try {
      debugState.seekWaveSurfer(startTime);
      await debugState.playWaveSurfer();
      setIsTransportPlaying(true);
    } catch (error) {
      setIsTransportPlaying(false);
      setTapTimingSession((currentSession) =>
        currentSession.active
          ? {
              ...currentSession,
              paused: true,
            }
          : currentSession,
      );
      setTimingNotice({
        message:
          error instanceof Error
            ? error.message
            : "Playback could not start for this MP3.",
        status: "danger",
      });
    }
  };

  const pauseTapTimingSession = () => {
    if (!tapTimingSession.active) {
      return;
    }

    const debugState = getTimingDebugState();

    try {
      debugState?.pauseWaveSurfer?.();
    } catch {
      // Pause is best-effort because the waveform can unmount during tab swaps.
    }

    setIsTransportPlaying(false);
    setTapTimingSession((currentSession) =>
      currentSession.active
        ? {
            ...currentSession,
            paused: true,
          }
        : currentSession,
    );
  };

  const resumeTapTimingSession = async () => {
    if (!tapTimingSession.active) {
      return;
    }

    const debugState = getTimingDebugState();

    if (typeof debugState?.playWaveSurfer !== "function") {
      setTimingNotice({
        message: "Waveform is still loading.",
        status: "danger",
      });
      return;
    }

    try {
      await debugState.playWaveSurfer();
      setIsTransportPlaying(true);
      setAutoFollowEnabled(true);
      setTapTimingSession((currentSession) =>
        currentSession.active
          ? {
              ...currentSession,
              paused: false,
            }
          : currentSession,
      );
      setTimingNotice({
        message: "",
        status: "idle",
      });
    } catch (error) {
      setTimingNotice({
        message:
          error instanceof Error
            ? error.message
            : "Playback could not resume for this MP3.",
        status: "danger",
      });
    }
  };

  const tapNextTimingLine = () => {
    if (!tapTimingSession.active || tapTimingSession.paused) {
      return;
    }

    if (!tapTimingCursorLine) {
      stopTapTimingSession({
        message: "Tap timing stopped because the current line changed.",
        status: "danger",
      });
      return;
    }

    const markedTime = getPreferredTapTimingTime();
    const previousStart = Number.isFinite(tapTimingCursorLine.start)
      ? tapTimingCursorLine.start
      : null;
    const nextLineId = getNextTapTimingLineId(
      projectState.lines,
      tapTimingCursorLine.id,
    );
    const historyEntry = {
      lineId: tapTimingCursorLine.id,
      nextStart: markedTime,
      previousStart,
    };

    setTimingLineStart(tapTimingCursorLine.id, markedTime);
    setSelectedTimingLineId(nextLineId ?? tapTimingCursorLine.id);
    setAutoFollowEnabled(true);

    if (!nextLineId) {
      const timedCount = tapTimingSession.history.length + 1;
      const lineLabel = timedCount === 1 ? "line" : "lines";
      const debugState = getTimingDebugState();

      try {
        debugState?.pauseWaveSurfer?.();
      } catch {
        // Playback may already be paused when the last tap lands.
      }

      setIsTransportPlaying(false);
      setTapTimingSession(createIdleTapTimingSession());
      setTimingNotice({
        message: `${timedCount} ${lineLabel} timed. Fine-tune with nudges below.`,
        status: "success",
      });
      return;
    }

    setTapTimingSession((currentSession) =>
      currentSession.active
        ? {
            ...currentSession,
            cursorLineId: nextLineId,
            history: [...currentSession.history, historyEntry],
          }
        : currentSession,
    );
    setTimingNotice({
      message: "",
      status: "idle",
    });
  };

  const undoLastTap = () => {
    if (!tapTimingSession.active || tapTimingSession.history.length === 0) {
      return;
    }

    const lastTap = tapTimingSession.history[tapTimingSession.history.length - 1];

    restoreTimingLineStart(lastTap.lineId, lastTap.previousStart);
    setSelectedTimingLineId(lastTap.lineId);
    setAutoFollowEnabled(true);
    setTapTimingSession((currentSession) =>
      currentSession.active
        ? {
            ...currentSession,
            cursorLineId: lastTap.lineId,
            history: currentSession.history.slice(0, -1),
          }
        : currentSession,
    );
    setTimingNotice({
      message: `Line ${getLineNumber(projectState.lines, lastTap.lineId)} restored.`,
      status: "success",
    });
  };

  const startDebugProbeRun = async () => {
    if (!debugProbe?.autoMarkAtMs?.length) {
      return;
    }

    const debugState = getTimingDebugState();

    if (
      !debugState?.seekWaveSurfer ||
      !debugState?.playWaveSurfer ||
      !debugState?.pauseWaveSurfer
    ) {
      setDebugProbeRunStatus("missing-wave-hooks");
      return;
    }

    const startOffset = getSectionBounds(debugProbe.project.audio).startOffset;
    const maxMarkMs = Math.max(...debugProbe.autoMarkAtMs);

    setProjectState(cloneProject(debugProbe.project));
    setSelectedTimingLineId(null);
    setCurrentAudioTime(startOffset);
    setIsTransportPlaying(false);
    setDebugMarkEvents([]);
    setDebugProbeRunStatus("running");
    debugState.markEvents = [];

    try {
      await debugState.pauseWaveSurfer();
      debugState.seekWaveSurfer(startOffset);
      await debugState.playWaveSurfer();

      debugProbe.autoMarkAtMs.forEach((markAtMs) => {
        window.setTimeout(() => {
          runDebugMarkCurrentLine();
        }, markAtMs);
      });

      window.setTimeout(() => {
        void debugState.pauseWaveSurfer();
        setDebugProbeRunStatus("complete");
      }, maxMarkMs + 250);
    } catch (error) {
      setDebugProbeRunStatus(
        error instanceof Error ? `error:${error.message}` : "error:unknown",
      );
    }
  };

  const handleNudgeSelectedLine = (delta) => {
    if (!selectedTimingLine) {
      return;
    }

    const baseTime = Number.isFinite(selectedTimingLine.start)
      ? selectedTimingLine.start
      : currentAudioTime;

    setTimingLineStart(selectedTimingLine.id, baseTime + delta, {
      syncPlayhead: true,
    });
  };

  const handleTimingLineSelect = (line) => {
    const isDeselect = selectedTimingLineId === line.id;
    const nextId = isDeselect ? null : line.id;

    setSelectedTimingLineId(nextId);
    setEditingLineId((currentLineId) =>
      currentLineId && currentLineId !== line.id ? null : currentLineId,
    );
    setTapTimingSession((currentSession) =>
      currentSession.active
        ? {
            ...currentSession,
            cursorLineId: nextId,
          }
        : currentSession,
    );
    setTimingNotice({
      message: "",
      status: "idle",
    });

    // Only seek to the line's start time when selecting (not when deselecting)
    if (!isDeselect && Number.isFinite(line.start)) {
      const targetTime = clampTimeToSection(line.start, projectState.audio);
      setCurrentAudioTime(targetTime);
      setLyricSeekTime(targetTime);
    }
  };

  const handleTimingDraftCommit = (lineId) => {
    const line = projectState.lines.find((item) => item.id === lineId);
    const draftValue = timingDrafts[lineId];

    if (!line || draftValue == null) {
      return;
    }

    const parsedTime = parseTypedTime(draftValue);

    if (draftValue.trim().length === 0) {
      clearTimingLineStart(lineId);
      setTimingNotice({
        message: `Cleared the start time for line ${getLineNumber(projectState.lines, lineId)}.`,
        status: "success",
      });
      return;
    }

    if (!Number.isFinite(parsedTime)) {
      setTimingNotice({
        message: "Type the time as seconds or mm:ss.ss, then press Enter.",
        status: "danger",
      });
      return;
    }

    const requestedTime = sectionBounds.startOffset + parsedTime;
    const nextTime = setTimingLineStart(lineId, requestedTime, {
      syncPlayhead: true,
    });
    const wasClamped = Math.abs(nextTime - requestedTime) >= 0.0001;

    setTimingNotice({
      message: wasClamped
        ? `Line ${getLineNumber(projectState.lines, lineId)} was clamped to ${formatSectionRelativeTime(
            nextTime,
            projectState.audio,
          )} inside the active section.`
        : `Line ${getLineNumber(projectState.lines, lineId)} set to ${formatSectionRelativeTime(
            nextTime,
            projectState.audio,
          )} from the section start.`,
      status: "success",
    });
  };

  const handleTimingDraftReset = (lineId) => {
    setTimingDrafts((currentDrafts) => {
      const nextDrafts = { ...currentDrafts };
      delete nextDrafts[lineId];
      return nextDrafts;
    });
  };

  const handleJumpToCurrentLine = () => {
    setAutoFollowEnabled(true);
    scrollSelectedTimingLineIntoView("smooth");
  };

  const handleManualTimingScroll = () => {
    if (
      activeSection !== "lyrics" ||
      !isTransportPlaying ||
      !autoFollowEnabled ||
      suppressManualScrollRef.current
    ) {
      return;
    }

    setAutoFollowEnabled(false);
  };

  const scrollPinnedMediaSheet = (deltaY) => {
    const scrollEl = appScrollRef.current;

    if (
      !isNarrowWorkspace ||
      activeSection === "words" ||
      !scrollEl ||
      !Number.isFinite(deltaY)
    ) {
      return false;
    }

    const maxScrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
    const nextScrollTop = Math.min(
      maxScrollTop,
      Math.max(0, scrollEl.scrollTop + deltaY),
    );

    scrollEl.scrollTop = nextScrollTop;
    return maxScrollTop > 0;
  };

  const isPanelScrollEvent = (event) =>
    typeof event.target?.closest === "function" &&
    Boolean(event.target.closest(".side-panel"));

  const shouldTransferPanelScroll = (deltaY) => {
    if (deltaY >= 0) {
      return false;
    }

    const editorScrollEl = editorScrollRef.current;
    return !editorScrollEl || editorScrollEl.scrollTop <= 0;
  };

  const handlePinnedMediaWheel = (event) => {
    if (isPanelScrollEvent(event)) {
      if (!shouldTransferPanelScroll(event.deltaY)) {
        return;
      }

      scrollPinnedMediaSheet(event.deltaY);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (!scrollPinnedMediaSheet(event.deltaY)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  };

  const handlePinnedMediaTouchStart = (event) => {
    pinnedMediaTouchYRef.current = event.touches?.[0]?.clientY ?? null;
  };

  const handlePinnedMediaTouchMove = (event) => {
    const currentY = event.touches?.[0]?.clientY ?? null;
    const previousY = pinnedMediaTouchYRef.current;

    if (currentY == null || previousY == null) {
      pinnedMediaTouchYRef.current = currentY;
      return;
    }

    pinnedMediaTouchYRef.current = currentY;
    const deltaY = previousY - currentY;

    if (isPanelScrollEvent(event)) {
      if (!shouldTransferPanelScroll(deltaY)) {
        return;
      }

      scrollPinnedMediaSheet(deltaY);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (!scrollPinnedMediaSheet(deltaY)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  };

  const handlePinnedMediaTouchEnd = () => {
    pinnedMediaTouchYRef.current = null;
  };

  const handleMarkHotkey = useEffectEvent(() => {
    handleMarkCurrentLine();
  });
  const handleNudgeHotkey = useEffectEvent((delta) => {
    handleNudgeSelectedLine(delta);
  });
  const handleJumpHotkey = useEffectEvent(() => {
    handleJumpToCurrentLine();
  });
  const handleTapNextHotkey = useEffectEvent(() => {
    tapNextTimingLine();
  });
  const handleUndoLastTapHotkey = useEffectEvent(() => {
    undoLastTap();
  });
  const handleStopTapTimingHotkey = useEffectEvent(() => {
    stopTapTimingSession();
  });
  const handleStopTapTimingEffect = useEffectEvent((options) => {
    stopTapTimingSession(options);
  });

  const handleClearAllTimes = () => {
    if (tapTimingSession.active) {
      stopTapTimingSession({
        message: null,
      });
    }

    const firstLineId = projectState.lines[0]?.id ?? null;

    setProjectState((currentProject) => ({
      ...currentProject,
      lines: currentProject.lines.map((line) => ({
        ...line,
        start: null,
      })),
    }));
    setTimingDrafts({});
    setSelectedTimingLineId(firstLineId);
    setCurrentAudioTime(projectState.audio.startOffset ?? 0);
    setAutoFollowEnabled(true);
    setTimingNotice({
      message: "All line times were cleared. Start marking again from the top.",
      status: "success",
    });
  };

  const openJsonImport = () => {
    setJsonDraft("");
    setJsonImportError("");
    setIsJsonModalOpen(true);
  };

  const closeJsonImport = () => {
    setJsonImportError("");
    setIsJsonModalOpen(false);
  };

  const handleJsonFile = async (file) => {
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      setJsonDraft(text);
      setJsonImportError("");
      setJsonNotice({
        message: `${file.name} loaded. Review it, then click Import project.`,
        status: "success",
      });
    } catch {
      setJsonImportError("That JSON file could not be read.");
    }
  };

  const handleProjectImport = () => {
    try {
      const importedProject = importProjectJson(jsonDraft);
      const needsImageReupload = importedProject.background.type === "image";
      const needsVideoReupload = importedProject.background.type === "video";

      setProjectState(importedProject);
      setAudioObjectUrl(null);
      audioSourceFileRef.current = null;
      setAudioUpload({
        asset: null,
        message:
          "Project imported. Re-upload the matching MP3 to restore waveform playback and export.",
        status: "idle",
      });
      setBackgroundUpload(createBackgroundUploadState(importedProject.background));
      setCurrentAudioTime(getInitialTransportTime(importedProject));
      setIsTransportPlaying(false);
      setSelectedTimingLineId(null);
      setTimingDrafts({});
      setAutoFollowEnabled(true);
      setTimingNotice({
        message: "",
        status: "idle",
      });
      setAutoLyricsState(createIdleAutoLyricsState());
      setAutoTimingState(createIdleAutoTimingState());
      setJsonImportError("");
      setJsonNotice({
        message: needsImageReupload
          ? "Project imported successfully. Re-upload the matching MP3 and background image when you're ready to preview or export."
          : needsVideoReupload
            ? "Project imported successfully. Re-upload the matching MP3 and background video when you're ready to preview or export."
            : "Project imported successfully. Re-upload the matching MP3 when you're ready to time or export.",
        status: "success",
      });
      setActiveSection("audio");
      setIsJsonModalOpen(false);
    } catch (error) {
      setJsonImportError(
        error instanceof Error ? error.message : "Project JSON could not be imported.",
      );
    }
  };

  // Clear the autosave and reset to a blank slate. The explicit path for
  // starting fresh so a recovered project can be deliberately discarded.
  const handleStartNewProject = () => {
    clearAutosaveRaw();
    appliedTranscribeJobIdRef.current = null;

    const blankProject = createDefaultProject();

    setProjectState(cloneProject(blankProject));
    setAudioObjectUrl(null);
    audioSourceFileRef.current = null;
    setAudioUpload({
      asset: null,
      message: "Upload an MP3 to start a new project.",
      status: "idle",
    });
    setBackgroundUpload(createBackgroundUploadState(blankProject.background));
    setCurrentAudioTime(getInitialTransportTime(blankProject));
    setIsTransportPlaying(false);
    setSelectedTimingLineId(null);
    setTimingDrafts({});
    setTranscription(null);
    setAutoFollowEnabled(true);
    setTimingNotice({ message: "", status: "idle" });
    setAutoLyricsState(createIdleAutoLyricsState());
    setAutoTimingState(createIdleAutoTimingState());
    setJsonImportError("");
    setJsonDraft("");
    setJsonNotice({
      message: "Started a new blank project.",
      status: "success",
    });
    setActiveSection("audio");
    setIsJsonModalOpen(false);
  };

  // Clear only the loaded MP3 (asset, blob URL, audio section, and the
  // transcription state derived from it) while leaving the lyric lines intact.
  const handleClearAudio = () => {
    appliedTranscribeJobIdRef.current = null;

    const blankAudio = { name: "", duration: 0, startOffset: 0, endOffset: null };

    setProjectState((currentProject) => ({
      ...currentProject,
      audio: blankAudio,
    }));
    setAudioObjectUrl(null);
    audioSourceFileRef.current = null;
    setAudioUpload({
      asset: null,
      message: "Track cleared. Upload an MP3 to start again.",
      status: "idle",
    });
    setCurrentAudioTime(0);
    setIsTransportPlaying(false);
    setTranscription(null);
    setAutoLyricsState(createIdleAutoLyricsState());
    setAutoTimingState(createIdleAutoTimingState());
    setTimingNotice({ message: "", status: "idle" });
  };

  // Clear only the lyric lines (and the board/timing/meaning state derived from
  // them) while leaving the loaded MP3 intact.
  const handleClearLyrics = () => {
    setProjectState((currentProject) => ({
      ...currentProject,
      lines: [],
    }));
    editorActions.clearSelectedWord();
    setSelectedTimingLineId(null);
    setTimingDrafts({});
    setAutoLyricsState(createIdleAutoLyricsState());
    setTimingNotice({ message: "", status: "idle" });
    setJsonNotice({ message: "Lyrics cleared.", status: "success" });
  };

  // Load the bundled demo: import the sample project JSON, then fetch the
  // matching MP3 and push it through the real upload pipeline so the waveform,
  // preview, and export all work. Composed as a single handler (rather than
  // reusing handleProjectImport + handleAudioFile) so the line clamp runs
  // against the freshly imported lines instead of stale closure state.
  const handleLoadSample = async () => {
    if (isLoadingSample) {
      return;
    }

    setIsLoadingSample(true);
    appliedTranscribeJobIdRef.current = null;
    setJsonImportError("");
    setJsonNotice({ message: "", status: "idle" });
    setAudioUpload({
      asset: null,
      message: "Loading sample track…",
      status: "uploading",
    });

    try {
      const { default: sampleProjectJson } = await import(
        "@/samples/reel-creator-project.json"
      );
      const importedProject = importProjectValue(sampleProjectJson);

      const audioResponse = await fetch(SAMPLE_AUDIO_URL);
      if (!audioResponse.ok) {
        throw new Error("Sample track could not be loaded.");
      }
      const audioBlob = await audioResponse.blob();
      const sampleFile = new File([audioBlob], SAMPLE_AUDIO_NAME, {
        type: "audio/mpeg",
      });

      const formData = new FormData();
      formData.append("file", sampleFile);
      formData.append("kind", "audio");

      const uploadResponse = await fetch("/api/upload", {
        body: formData,
        credentials: "same-origin",
        method: "POST",
      });
      const payload = await uploadResponse.json();

      if (!uploadResponse.ok) {
        throw new Error(payload.error ?? "Sample upload failed.");
      }

      const durationSec = await readAudioDuration(sampleFile).catch(() => null);
      const nextObjectUrl = URL.createObjectURL(sampleFile);
      audioSourceFileRef.current = sampleFile;
      const nextAsset = {
        ...payload,
        durationSec: durationSec ?? payload.durationSec ?? null,
      };
      const nextAudio = normalizeAudioSection({
        ...importedProject.audio,
        duration:
          durationSec && Number.isFinite(durationSec)
            ? durationSec
            : importedProject.audio.duration,
        endOffset:
          durationSec && Number.isFinite(durationSec)
            ? null
            : importedProject.audio.endOffset,
        name: payload.name,
        startOffset: 0,
      });
      const { lines } = clampLineStartsToSection(
        importedProject.lines,
        nextAudio,
      );
      const nextProject = { ...importedProject, audio: nextAudio, lines };

      setProjectState(nextProject);
      setAudioObjectUrl(nextObjectUrl);
      setAudioUpload({
        asset: nextAsset,
        message: `${payload.name} uploaded successfully.`,
        status: "success",
      });
      setBackgroundUpload(createBackgroundUploadState(nextProject.background));
      setCurrentAudioTime(getInitialTransportTime(nextProject));
      setIsTransportPlaying(false);
      setSelectedTimingLineId(null);
      setTimingDrafts({});
      setTranscription(null);
      setAutoFollowEnabled(true);
      setTimingNotice({ message: "", status: "idle" });
      setAutoLyricsState(createIdleAutoLyricsState());
      setAutoTimingState(createIdleAutoTimingState());
      setJsonNotice({
        message: "Sample project loaded. The demo track and lyrics are ready.",
        status: "success",
      });
    } catch (error) {
      setAudioUpload({
        asset: null,
        message:
          error instanceof Error ? error.message : "Sample could not be loaded.",
        status: "error",
      });
    } finally {
      setIsLoadingSample(false);
    }
  };

  const handleProjectExport = () => {
    const json = exportProjectJson(projectState);
    const downloadUrl = URL.createObjectURL(
      new Blob([json], {
        type: "application/json",
      }),
    );
    const fileName = `${slugifyFileStem(
      projectState.meta.title,
      "reel-creator-project",
    )}.json`;
    const link = document.createElement("a");

    link.href = downloadUrl;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(downloadUrl);
    setJsonNotice({
      message: `${fileName} downloaded with lyrics, style, background, and audio metadata.`,
      status: "success",
    });
  };

  const closeExportModal = () => {
    if (exportBusy) {
      return;
    }

    autoDownloadedJobIdRef.current = null;
    setExportState(createIdleExportState());
  };

  const runRenderDownload = async ({
    automatic = false,
    fallbackName,
    fileUrl,
  } = {}) => {
    if (!fileUrl) {
      return;
    }

    setExportState((currentState) => ({
      ...currentState,
      downloadError: "",
      isDownloading: true,
    }));

    try {
      const downloadName = await downloadRenderFile(fileUrl, fallbackName);

      setExportState((currentState) => {
        if (currentState.phase !== "done") {
          return currentState;
        }

        return {
          ...currentState,
          downloadError: "",
          downloadName,
          isDownloading: false,
          statusNote: automatic
            ? `${downloadName} downloaded automatically.`
            : `${downloadName} downloaded.`,
        };
      });
    } catch (error) {
      setExportState((currentState) => {
        if (currentState.phase === "idle") {
          return currentState;
        }

        return {
          ...currentState,
          downloadError:
            error instanceof Error
              ? error.message
              : "The rendered MP4 could not be downloaded.",
          isDownloading: false,
        };
      });
    }
  };

  const handleBackgroundAssetFile = async (kind, file) => {
    if (!file) {
      return;
    }

    const kindLabel = kind === "video" ? "Video" : "Image";

    setBackgroundUpload((currentUpload) => ({
      ...currentUpload,
      [kind]: {
        ...currentUpload[kind],
        message: `Uploading ${file.name}...`,
        status: "uploading",
      },
    }));

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("kind", kind);

      const response = await fetch("/api/upload", {
        body: formData,
        credentials: "same-origin",
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? `${kindLabel} upload failed.`);
      }

      setBackgroundUpload((currentUpload) => ({
        ...currentUpload,
        [kind]: {
          asset: payload,
          message:
            kind === "video"
              ? `${payload.name} uploaded. Preview and export now loop this clip under the lyrics while your MP3 stays the audio track.`
              : `${payload.name} uploaded. Preview and export now use this image with the current scrim.`,
          status: "success",
        },
      }));
      updateBackground((currentBackground) => ({
        ...currentBackground,
        assetName: payload.name,
        type: kind,
      }));
    } catch (error) {
      setBackgroundUpload((currentUpload) => ({
        ...currentUpload,
        [kind]: {
          ...currentUpload[kind],
          message:
            error instanceof Error
              ? error.message
              : `${kindLabel} upload failed unexpectedly.`,
          status: "error",
        },
      }));
    }
  };

  const handleBackgroundImageFile = async (file) => {
    await handleBackgroundAssetFile("image", file);
  };

  const handleBackgroundVideoFile = async (file) => {
    await handleBackgroundAssetFile("video", file);
  };

  const resolveClientAudioFileForTranscribe = async () => {
    if (audioSourceFileRef.current instanceof File) {
      return audioSourceFileRef.current;
    }

    if (audioObjectUrl?.startsWith("blob:")) {
      try {
        const blob = await fetch(audioObjectUrl).then((response) => response.blob());
        const name =
          typeof audioUpload.asset?.name === "string" && audioUpload.asset.name.trim()
            ? audioUpload.asset.name.trim()
            : "audio.mp3";

        return new File([blob], name, {
          type: blob.type || "audio/mpeg",
        });
      } catch {
        return null;
      }
    }

    return null;
  };

  // POST to start (or, on 409, adopt the already-running job for this session +
  // asset) a background transcription job and return its jobId. The poll effect
  // drives progress + completion, decoupled from this request, so a dropped
  // connection (sleep / reload / navigation) no longer cancels the work.
  // When the client still has the MP3 (File or blob:), send it as multipart so
  // multi-isolate hosts can store it on the same isolate that runs the job.
  const startTranscriptionJob = async (body) => {
    const audioFile = await resolveClientAudioFileForTranscribe();
    let response;

    if (audioFile) {
      const formData = new FormData();
      formData.append("payload", JSON.stringify(body));
      formData.append("file", audioFile, audioFile.name || "audio.mp3");
      response = await fetch("/api/ai/transcribe", {
        body: formData,
        credentials: "same-origin",
        method: "POST",
      });
    } else {
      response = await fetch("/api/ai/transcribe", {
        body: JSON.stringify(body),
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
    }

    const payload = await response.json().catch(() => ({}));

    if (
      typeof payload.audioAssetId === "string" &&
      payload.audioAssetId.trim() &&
      audioUpload.asset
    ) {
      const nextAssetId = payload.audioAssetId.trim();
      setAudioUpload((current) =>
        current.asset
          ? {
              ...current,
              asset: {
                ...current.asset,
                assetId: nextAssetId,
              },
            }
          : current,
      );
    }

    if (response.status === 409 && typeof payload.jobId === "string") {
      return payload.jobId;
    }

    if (!response.ok || typeof payload.jobId !== "string" || !payload.jobId) {
      if (
        response.status === 402 ||
        payload.error === "insufficient_balance"
      ) {
        throw new Error(
          body?.phase === "time"
            ? "Credit balance exhausted — timing was skipped. Top up to continue."
            : "Credit balance is too low to start generation. Top up to continue.",
        );
      }

      throw new Error(
        typeof payload.message === "string" && payload.message.trim()
          ? payload.message
          : payload.error ?? "Transcription could not be started.",
      );
    }

    return payload.jobId;
  };

  const beginTranscriptionTracking = (jobId, phase) => {
    // Fresh job: clear the idempotency guard so its result applies exactly once.
    appliedTranscribeJobIdRef.current = null;
    setTranscription({ appliedJobId: null, jobId, phase, status: "running" });
  };

  const waitForTranscriptionJob = (jobId, phase) =>
    new Promise((resolve) => {
      transcriptionWaitersRef.current.set(jobId, { phase, resolve });
    });

  const resolveTranscriptionWaiter = (jobId, outcome) => {
    const waiter = transcriptionWaitersRef.current.get(jobId);

    if (!waiter || waiter.phase !== outcome.phase) {
      return;
    }

    transcriptionWaitersRef.current.delete(jobId);
    window.setTimeout(() => waiter.resolve(outcome), 0);
  };

  const refreshCreditBalance = async () => {
    const payload = await fetchCreditBalancePayload();

    setCreditState({
      balanceMinor: Number.isInteger(payload.balanceMinor) ? payload.balanceMinor : 0,
      currency: payload.currency ?? "GBP",
      enabled: payload.enabled === true,
      status: "ready",
    });
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
        throw new Error(payload.error ?? "Unlock failed.");
      }

      setUnlockPassword("");
      setUnlockMessage("Generation unlocked.");
      setUnlockStatus("success");
    } catch (error) {
      setUnlockStatus("error");
      setUnlockMessage(
        error instanceof Error ? error.message : "Unlock failed.",
      );
    }
  };

  const handleTopUpSubmit = async (event) => {
    event.preventDefault();

    const amountMinor = parseGbpInputToMinor(topUpAmount);

    if (amountMinor == null) {
      setTopUpStatus("error");
      setTopUpMessage("Enter an amount like 5.00.");
      return;
    }

    setTopUpStatus("submitting");
    setTopUpMessage("");

    try {
      const response = await fetch("/api/credits/checkout", {
        body: JSON.stringify({ amountMinor }),
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.checkoutUrl) {
        throw new Error(payload.error ?? "Checkout could not be started.");
      }

      window.location.href = payload.checkoutUrl;
    } catch (error) {
      setTopUpStatus("error");
      setTopUpMessage(
        error instanceof Error ? error.message : "Checkout could not be started.",
      );
      await refreshCreditBalance().catch(() => {});
    }
  };

  // Apply a completed auto-lyrics result by replacing all lines with the
  // transcription output. An effect event so the poll loop and mount recovery
  // can both invoke it against the latest editor state.
  const applyAutoLyricsResult = useEffectEvent((finalPayload) => {
    if (!Array.isArray(finalPayload?.lines) || finalPayload.lines.length === 0) {
      setAutoLyricsState({
        detail: "",
        lineCount: 0,
        message: "Auto-lyrics finished without any lyric lines.",
        status: "error",
        title: "Auto-lyrics failed",
      });
      return;
    }

    const nextLines = finalPayload.lines.map((line) =>
      createLine({
        confidence: String(line?.confidence ?? ""),
        end: Number.isFinite(line?.end) ? line.end : null,
        id: typeof line?.id === "string" && line.id ? line.id : undefined,
        matchRatio: Number.isFinite(line?.matchRatio) ? line.matchRatio : 0,
        original: String(line?.original ?? "").trim(),
        quality: line?.quality,
        romanization: String(line?.romanization ?? "").trim(),
        start: Number.isFinite(line?.start) ? line.start : null,
        timingSource: String(line?.timingSource ?? ""),
        translation: String(line?.translation ?? "").trim(),
        // Pass raw words so createLine's normalizer preserves gloss/roman and
        // untimed display words — keeps the Word Board fed (T06.4).
        words: line?.words,
      }),
    );
    const timingSummary = buildPipelineTimingSummary(
      finalPayload,
      nextLines.length,
    );

    const nextProject = {
      ...projectStateRef.current,
      lines: nextLines,
    };

    projectStateRef.current = nextProject;
    setProjectState(nextProject);
    setSelectedTimingLineId(null);
    setTimingDrafts({});
    setTimingNotice({
      message: timingSummary.timedCount > 0 ? timingSummary.message : "",
      status: timingSummary.timedCount > 0 ? "success" : "idle",
    });
    setAutoFollowEnabled(true);
    setAutoTimingState(createIdleAutoTimingState());
    setAutoLyricsState({
      detail:
        timingSummary.timedCount > 0
          ? "Open Timing to review starts and nudge anything that feels late or early."
          : "Open Lyrics to edit text, or Timing to mark starts when ready.",
      lineCount: nextLines.length,
      message: `${nextLines.length} lyric line${
        nextLines.length === 1 ? "" : "s"
      } loaded. ${timingSummary.message}`,
      status: "success",
      title: "Lyrics ready",
    });
  });

  const applyEnrichResult = useEffectEvent((payload) => {
    if (!Array.isArray(payload?.lines) || payload.lines.length === 0) {
      setAutoLyricsState({
        detail: "",
        lineCount: 0,
        message: "Translate & enrich finished without any lyric line results.",
        status: "error",
        title: "Lyrics enrich failed",
      });
      return;
    }

    const returnedLinesById = new Map(
      payload.lines
        .filter((line) => typeof line?.id === "string" && line.id)
        .map((line) => [line.id, line]),
    );

    setProjectState((currentProject) => {
      const meaningEntries = currentProject.lines
        .map((line, index) => {
          const enrichedLine = returnedLinesById.get(line.id);

          return enrichedLine
            ? { line_number: index + 1, words: enrichedLine.words }
            : null;
        })
        .filter(Boolean);
      const linesWithText = currentProject.lines.map((line) => {
        const enrichedLine = returnedLinesById.get(line.id);

        if (!enrichedLine) {
          return line;
        }

        return {
          ...line,
          romanization: String(enrichedLine?.romanization ?? "").trim(),
          translation: String(enrichedLine?.translation ?? "").trim(),
        };
      });

      const nextProject = {
        ...currentProject,
        lines: applyWordMeaningsToLines(linesWithText, meaningEntries),
      };

      projectStateRef.current = nextProject;
      return nextProject;
    });

    setAutoLyricsState({
      detail: "Translations and word meanings were merged into the current lyric lines.",
      lineCount: returnedLinesById.size,
      message: `${returnedLinesById.size} lyric line${
        returnedLinesById.size === 1 ? "" : "s"
      } enriched. Timing was preserved.`,
      status: "success",
      title: "Lyrics enriched",
    });
  });

  const handleRunPipeline = async () => {
    if (
      pipelineRunInFlightRef.current ||
      !audioUpload.asset?.assetId ||
      autoLyricsBusy ||
      autoTimingBusy
    ) {
      return;
    }

    const phasesToRun = selectedLyricPipelinePhases;

    if (phasesToRun.length === 0) {
      setAutoLyricsState({
        detail: "",
        lineCount: 0,
        message: "Select a runnable lyric pipeline mode.",
        status: "error",
        title: "Pipeline unavailable",
      });
      return;
    }

    if (
      phasesToRun.includes("generate") &&
      autoLyricsLanguageRequirementMessage
    ) {
      setAutoLyricsState({
        detail: "",
        lineCount: projectStateRef.current.lines.length,
        message: autoLyricsLanguageRequirementMessage,
        status: "error",
        title: "Pipeline unavailable",
      });
      return;
    }

    if (phasesToRun.includes("generate") && !confirmLyricRebuildIfNeeded()) {
      return;
    }

    pipelineRunInFlightRef.current = true;
    let runningPhase = null;
    const pipelineRunId = crypto.randomUUID();
    const finalPhase = phasesToRun.at(-1);

    try {
      for (const phase of phasesToRun) {
        runningPhase = phase;
        const currentProject = projectStateRef.current;
        const currentCanRun = getLyricPipelineCanRun({
          hasAudio: Boolean(audioUpload.asset?.assetId),
          lines: currentProject.lines,
        });

        if (!currentCanRun[phase]) {
          throw new Error(
            phase === "generate"
              ? "Upload an MP3 before generating lyrics."
              : "Generate lyrics or add lyric lines before timing.",
          );
        }

        if (phase === "time") {
          setAutoTimingState({
            detail: "Preparing the current lyric lines for timing.",
            lineCount: currentProject.lines.length,
            message: "",
            status: "running",
            title: "Starting auto-time",
          });
        } else {
          setAutoLyricsState({
            detail: "Preparing the uploaded MP3 for lyric generation.",
            lineCount: currentProject.lines.length,
            message: "",
            status: "running",
            title: "Starting lyric generation",
          });
        }

        const includeRomanization =
          sourceLanguage !== "es" && sourceLanguage !== "fr";
        const jobId = await startTranscriptionJob({
          audio: currentProject.audio,
          audioAssetId: audioUpload.asset.assetId,
          includeRomanization,
          lines: phase === "time" ? currentProject.lines : [],
          otherLanguage: otherSourceLanguage.trim(),
          phase,
          pipelineRunId,
          save: saveGeneration,
          saveOnCompletion: phase === finalPhase,
          sourceLanguage:
            phase === "time" && !sourceLanguage ? "auto" : sourceLanguage,
          // REP-403 / D-C: project meta title is the user-entered public card title.
          title: currentProject.meta?.title ?? "",
        });

        beginTranscriptionTracking(jobId, phase);

        const outcome = await waitForTranscriptionJob(jobId, phase);

        if (outcome.status !== "done") {
          break;
        }
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Lyric pipeline failed unexpectedly.";

      if (runningPhase === "time") {
        setAutoTimingState((currentState) => ({
          ...currentState,
          detail: "",
          message,
          status: "error",
          title: "Pipeline failed",
        }));
        setTimingNotice({ message, status: "danger" });
      } else {
        setAutoLyricsState((currentState) => ({
          ...currentState,
          detail: "",
          message,
          status: "error",
          title: "Pipeline failed",
        }));
      }
    } finally {
      pipelineRunInFlightRef.current = false;
    }
  };

  // Apply a completed auto-time result by merging returned timing into the
  // existing lines (matched by id), preserving gloss/roman. An effect event so
  // the poll loop and mount recovery can both invoke it with the latest lines.
  const applyAutoTimingResult = useEffectEvent((payload) => {
    if (!Array.isArray(payload?.lines) || payload.lines.length === 0) {
      setAutoTimingState({
        detail: "",
        lineCount: projectStateRef.current.lines.length,
        message: "Auto-timing finished without lyric timing results.",
        status: "error",
        title: "Auto-time failed",
      });
      setTimingNotice({
        message: "Auto-timing finished without lyric timing results.",
        status: "danger",
      });
      return;
    }

    const returnedLinesById = new Map(
      payload.lines
        .filter((line) => typeof line?.id === "string" && line.id)
        .map((line) => [line.id, line]),
    );

    const currentProject = projectStateRef.current;
    const nextLines = currentProject.lines.map((line) => {
      const timedLine = returnedLinesById.get(line.id);

      if (!timedLine) {
        return line;
      }

      return {
        ...line,
        confidence: String(timedLine?.confidence ?? ""),
        end: Number.isFinite(timedLine?.end) ? timedLine.end : null,
        matchRatio: Number.isFinite(timedLine?.matchRatio)
          ? timedLine.matchRatio
          : 0,
        quality: timedLine?.quality ?? null,
        start: Number.isFinite(timedLine?.start)
          ? clampTimeToSection(timedLine.start, currentProject.audio)
          : line.start,
        timingSource: String(timedLine?.timingSource ?? ""),
        // Apply new timing without clobbering existing gloss/roman (P3): keep
        // the line's display words and attach start/end best-effort. When the
        // line had no gloss words yet, this falls back to the timing words.
        words: line.words?.length
          ? mergeMeaningWordsWithTiming(timedLine?.words, line.words)
          : normalizeLineWords(timedLine?.words),
      };
    });
    const nextProject = {
      ...currentProject,
      lines: nextLines,
    };

    projectStateRef.current = nextProject;
    setProjectState(nextProject);
    setTimingDrafts((currentDrafts) => {
      const nextDrafts = { ...currentDrafts };

      for (const lineId of returnedLinesById.keys()) {
        delete nextDrafts[lineId];
      }

      return nextDrafts;
    });

    const timingSummary = buildPipelineTimingSummary(
      payload,
      currentProject.lines.length,
    );
    const firstUntimedLine = nextLines.find((line) => {
      const timedLine = returnedLinesById.get(line.id);

      return !Number.isFinite(timedLine?.start);
    });

    setSelectedTimingLineId(firstUntimedLine?.id ?? nextLines[0]?.id ?? null);
    setAutoFollowEnabled(true);
    setAutoTimingState({
      detail:
        timingSummary.estimatedCount > 0
          ? `${timingSummary.estimatedCount} ${
              timingSummary.estimatedCount === 1 ? "line is" : "lines are"
            } estimated; review those starts closely.`
          : "Review the starts below and nudge anything that feels late or early.",
      lineCount: timingSummary.totalCount,
      message: timingSummary.message,
      status: timingSummary.timedCount > 0 ? "success" : "error",
      title:
        timingSummary.timedCount > 0 ? "Auto-time complete" : "No timing results",
    });
    setTimingNotice({
      message:
        timingSummary.timedCount > 0
          ? timingSummary.message
          : "No timestamp results were found. Use tap timing below.",
      status: timingSummary.timedCount > 0 ? "success" : "danger",
    });
  });

  const handleAutoRenderDownload = useEffectEvent((fileUrl, fallbackName) => {
    void runRenderDownload({
      automatic: true,
      fallbackName,
      fileUrl,
    });
  });

  const handleStartExport = async (
    transparent = false,
    textLayerMode = DEFAULT_TEXT_LAYER_MODE,
  ) => {
    if (exportBusy) {
      return;
    }

    const readiness = transparent ? textLayerReadiness : exportReadiness;

    if (!readiness.canExport) {
      setExportState({
        ...createIdleExportState(),
        errorMessage: readiness.reason,
        phase: "error",
        renderStatus: "error",
        textLayerMode,
        transparent,
      });
      return;
    }

    setExportState({
      ...createIdleExportState(),
      phase: "starting",
      textLayerMode,
      transparent,
    });

    try {
      const response = await fetch("/api/render", {
        body: JSON.stringify({
          audioAssetId: audioUpload.asset.assetId,
          backgroundAssetId:
            !transparent && isBackgroundMediaType(projectState.background.type)
              ? activeBackgroundAsset?.assetId ?? null
              : null,
          project: projectState,
          textLayerMode: transparent ? textLayerMode : null,
          transparent,
        }),
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));

      if (response.status === 409 && typeof payload.jobId === "string") {
        autoDownloadedJobIdRef.current = null;
        setExportState({
          ...createIdleExportState(),
          jobId: payload.jobId,
          phase: "polling",
          statusNote: "Picked up the render already running in this session.",
          textLayerMode,
          transparent,
        });
        return;
      }

      if (!response.ok) {
        throw new Error(payload.error ?? "Render could not be started.");
      }

      if (typeof payload.jobId !== "string" || payload.jobId.length === 0) {
        throw new Error("Render started, but no job id came back from the server.");
      }

      autoDownloadedJobIdRef.current = null;
      setExportState({
        ...createIdleExportState(),
        jobId: payload.jobId,
        phase: "polling",
        textLayerMode,
        transparent,
      });
    } catch (error) {
      setExportState({
        ...createIdleExportState(),
        errorMessage:
          error instanceof Error ? error.message : "Render could not be started.",
        phase: "error",
        renderStatus: "error",
        textLayerMode,
        transparent,
      });
    }
  };

  const handleAudioFile = async (file) => {
    if (!file) {
      return;
    }

    setAudioUpload({
      asset: null,
      message: `Uploading ${file.name}...`,
      status: "uploading",
    });
    setAutoLyricsState(createIdleAutoLyricsState());
    setAutoTimingState(createIdleAutoTimingState());

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("kind", "audio");

      const response = await fetch("/api/upload", {
        body: formData,
        credentials: "same-origin",
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Upload failed.");
      }

      const durationSec = await readAudioDuration(file).catch(() => null);
      const nextObjectUrl = URL.createObjectURL(file);
      audioSourceFileRef.current = file;
      const nextAsset = {
        ...payload,
        durationSec: durationSec ?? payload.durationSec ?? null,
      };
      const nextAudio = normalizeAudioSection({
        ...projectState.audio,
        duration:
          durationSec && Number.isFinite(durationSec)
            ? durationSec
            : projectState.audio.duration,
        endOffset:
          durationSec && Number.isFinite(durationSec)
            ? null
            : projectState.audio.endOffset,
        name: payload.name,
        startOffset: 0,
      });
      const { clampedCount, lines } = clampLineStartsToSection(
        projectState.lines,
        nextAudio,
      );

      setProjectState((currentProject) => ({
        ...currentProject,
        audio: nextAudio,
        lines,
      }));
      setAudioUpload({
        asset: nextAsset,
        message: `${payload.name} uploaded successfully.`,
        status: "success",
      });
      setTimingNotice(
        clampedCount > 0
          ? {
              message: `${clampedCount} timed ${
                clampedCount === 1 ? "line was" : "lines were"
              } clamped inside the active section.`,
              status: "danger",
            }
          : {
              message: "",
              status: "idle",
            },
      );
      setAudioObjectUrl(nextObjectUrl);
      setIsTransportPlaying(false);
      setCurrentAudioTime(0);
      setAutoFollowEnabled(true);
    } catch (error) {
      setAudioUpload({
        asset: null,
        message:
          error instanceof Error ? error.message : "Upload failed unexpectedly.",
        status: "error",
      });
    }
  };

  const handleOpenYoutubeModal = () => {
    if (!youtubeAudioEnabled) {
      return;
    }

    if (!youtubeUrl.trim()) {
      setYoutubeConfigError("Enter a YouTube URL.");
      return;
    }

    setYoutubeConfigError("");
    setIsYoutubeModalOpen(true);
  };

  const handleYoutubeSegmentComplete = (asset) => {
    const durationSec = Number(asset?.durationSec);

    if (!asset?.assetId || !Number.isFinite(durationSec) || durationSec <= 0) {
      setAudioUpload({
        asset: null,
        message: "YouTube import completed without a usable audio asset.",
        status: "error",
      });
      return;
    }

    appliedTranscribeJobIdRef.current = null;
    const currentProject = projectStateRef.current;
    const nextAsset = {
      ...stripEmbeddedYoutubeAudio(asset),
      durationSec,
      kind: "audio",
    };
    const nextAudio = normalizeAudioSection({
      ...currentProject.audio,
      duration: durationSec,
      endOffset: null,
      name: asset.name,
      startOffset: 0,
    });
    const { clampedCount, lines } = clampLineStartsToSection(
      currentProject.lines,
      nextAudio,
    );
    const sourceFile = youtubeAssetToFile(asset);
    const nextObjectUrl = sourceFile
      ? URL.createObjectURL(sourceFile)
      : buildYoutubeAssetPlaybackUrl(asset);
    audioSourceFileRef.current = sourceFile;

    if (audioObjectUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(audioObjectUrl);
    }

    setProjectState({
      ...currentProject,
      audio: nextAudio,
      lines,
    });
    setAudioUpload({
      asset: nextAsset,
      message: `${asset.name} added.`,
      status: "success",
    });
    setTimingNotice(
      clampedCount > 0
        ? {
            message: `${clampedCount} timed ${
              clampedCount === 1 ? "line was" : "lines were"
            } clamped inside the active section.`,
            status: "danger",
          }
        : {
            message: "",
            status: "idle",
          },
    );
    setAudioObjectUrl(nextObjectUrl);
    setIsTransportPlaying(false);
    setCurrentAudioTime(0);
    setAutoFollowEnabled(true);
    setSelectedTimingLineId(null);
    setTimingDrafts({});
    setTranscription(null);
    setAutoLyricsState(createIdleAutoLyricsState());
    setAutoTimingState(createIdleAutoTimingState());
    setIsYoutubeModalOpen(false);
  };

  useEffect(() => {
    // Only object URLs created from an uploaded File need revoking. Restored
    // sessions point audio playback at the server asset URL (/api/assets/...),
    // which must not be revoked.
    if (!audioObjectUrl || !audioObjectUrl.startsWith("blob:")) {
      return undefined;
    }

    return () => {
      URL.revokeObjectURL(audioObjectUrl);
    };
  }, [audioObjectUrl]);

  const setTranscriptionProgress = useEffectEvent((phase, payload) => {
    const setState = phase === "time" ? setAutoTimingState : setAutoLyricsState;

    setState((currentState) => ({
      ...currentState,
      detail:
        typeof payload?.detail === "string"
          ? payload.detail
          : currentState.detail,
      message: "",
      status: "running",
      title:
        typeof payload?.title === "string" ? payload.title : currentState.title,
    }));
  });

  const failTranscription = useEffectEvent((phase, message) => {
    const resolved = message || "Transcription failed unexpectedly.";

    if (phase === "time") {
      setAutoTimingState((currentState) => ({
        ...currentState,
        detail: "",
        message: resolved,
        status: "error",
        title: "Auto-time failed",
      }));
      setTimingNotice({ message: resolved, status: "danger" });
      return;
    }

    setAutoLyricsState((currentState) => ({
      ...currentState,
      detail: "",
      message: resolved,
      status: "error",
      title: "Auto-lyrics failed",
    }));
  });

  // Drive a background transcription/timing job to completion by polling — the
  // same resilient pattern as the render flow. It tolerates brief network drops
  // and, because `transcription` is restored from autosave on mount, resumes
  // automatically after the editor remounts (sleep / reload / navigation).
  useEffect(() => {
    if (
      !transcription ||
      transcription.status !== "running" ||
      !transcription.jobId
    ) {
      return undefined;
    }

    let ignore = false;
    let timeoutId = 0;
    let consecutiveFailures = 0;
    const { jobId, phase } = transcription;

    const schedulePoll = (delayMs) => {
      timeoutId = window.setTimeout(runPoll, delayMs);
    };

    const settle = (patch) => {
      setTranscription((currentState) =>
        currentState && currentState.jobId === jobId
          ? { ...currentState, ...patch }
          : currentState,
      );
    };

    const runPoll = async () => {
      try {
        const response = await fetch(`/api/ai/transcribe/${jobId}`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        const payload = await response.json().catch(() => ({}));

        if (ignore) {
          return;
        }

        if (!response.ok) {
          if (response.status === 404) {
            failTranscription(
              phase,
              payload.error ??
                "That transcription is no longer available. Start it again.",
            );
            settle({ status: "error" });
            resolveTranscriptionWaiter(jobId, { phase, status: "error" });
            return;
          }

          throw new Error(
            payload.error ?? "Transcription status could not be refreshed.",
          );
        }

        if (typeof payload.phase === "string" && payload.phase !== phase) {
          failTranscription(
            phase,
            `Expected a ${phase} lyric job but received ${payload.phase}. Start it again.`,
          );
          settle({ status: "error" });
          resolveTranscriptionWaiter(jobId, { phase, status: "error" });
          return;
        }

        if (payload.status === "done") {
          // Idempotent apply: the in-memory ref blocks repeated polls within a
          // session; the persisted appliedJobId blocks re-apply across remounts;
          // and the apply itself (replace lines / merge by id) is outcome-stable.
          if (appliedTranscribeJobIdRef.current !== jobId) {
            appliedTranscribeJobIdRef.current = jobId;

            if (phase === "time") {
              applyAutoTimingResult(payload.result);
            } else if (phase === "enrich") {
              applyEnrichResult(payload.result);
            } else {
              applyAutoLyricsResult(payload.result);
            }

            // REP-201: clamp may zero the balance while still delivering work.
            if (payload.balanceExhausted === true) {
              const exhaustedMessage =
                "Credit balance exhausted. Completed work was kept; further phases need a top-up.";

              if (phase === "time") {
                setTimingNotice({
                  message: exhaustedMessage,
                  status: "success",
                });
              } else {
                // Apply handlers also write lyric state; merge after they settle.
                window.setTimeout(() => {
                  setAutoLyricsState((currentState) => ({
                    ...currentState,
                    detail: exhaustedMessage,
                    message: currentState.message
                      ? `${currentState.message} ${exhaustedMessage}`
                      : exhaustedMessage,
                  }));
                }, 0);
              }

              void refreshCreditBalance().catch(() => {});
            }
          }

          settle({ appliedJobId: jobId, status: "done" });
          resolveTranscriptionWaiter(jobId, {
            balanceExhausted: payload.balanceExhausted === true,
            phase,
            status: "done",
            writeOffMinor: payload.writeOffMinor ?? 0,
          });
          return;
        }

        if (payload.status === "error") {
          failTranscription(phase, payload.error);
          settle({ status: "error" });
          resolveTranscriptionWaiter(jobId, { phase, status: "error" });
          return;
        }

        consecutiveFailures = 0;
        setTranscriptionProgress(phase, payload);
        schedulePoll(getRenderPollDelayMs(0));
      } catch (error) {
        if (ignore) {
          return;
        }

        consecutiveFailures += 1;

        // The server-side job keeps running, so tolerate a run of failures (e.g.
        // a just-woken laptop's first requests) with backoff before giving up.
        if (consecutiveFailures > 6) {
          failTranscription(
            phase,
            error instanceof Error
              ? error.message
              : "Transcription status could not be refreshed.",
          );
          settle({ status: "error" });
          resolveTranscriptionWaiter(jobId, { phase, status: "error" });
          return;
        }

        schedulePoll(getRenderPollDelayMs(consecutiveFailures));
      }
    };

    void runPoll();

    return () => {
      ignore = true;
      window.clearTimeout(timeoutId);
    };
  }, [transcription]);

  // One-time autosave recovery. Restores the saved project, audio asset, and
  // transcription pointer BEFORE the autosave write effect is allowed to run, so
  // the blank initial project cannot overwrite saved work. Skipped on the debug
  // probe page (which drives its own project).
  useEffect(() => {
    if (debugProbe) {
      return undefined;
    }

    let cancelled = false;

    const restore = async () => {
      const restored = decodeAutosave(readAutosaveRaw());

      if (!restored) {
        clearAutosaveRaw();
        autosaveHydratedRef.current = true;
        return;
      }

      const restoredProject = cloneProject(restored.project);

      setProjectState(restoredProject);
      setSelectedTimingLineId(null);
      setCurrentAudioTime(getInitialTransportTime(restoredProject));

      if (restored.audioAsset?.assetId) {
        setAudioUpload({
          asset: { ...restored.audioAsset, kind: "audio" },
          message: `Restoring ${
            restored.audioAsset.name || "audio"
          } from your last session...`,
          status: "uploading",
        });

        const assetExists = await verifyAssetExists(restored.audioAsset.assetId);

        if (cancelled) {
          return;
        }

        if (assetExists) {
          setAudioUpload({
            asset: { ...restored.audioAsset, kind: "audio" },
            message: `${
              restored.audioAsset.name || "Audio"
            } restored from your last session.`,
            status: "success",
          });
          // Restored sessions play from the server asset URL (the original File
          // blob URL is gone after a reload).
          setAudioObjectUrl(buildSessionAssetUrl(restored.audioAsset.assetId));
        } else {
          setAudioUpload({
            asset: null,
            message:
              "Your previously uploaded MP3 has expired. Upload it again to preview, time, or export.",
            status: "idle",
          });
        }
      }

      if (restored.transcription?.jobId) {
        const { appliedJobId, jobId, phase } = restored.transcription;

        appliedTranscribeJobIdRef.current = appliedJobId ?? null;

        if (appliedJobId && appliedJobId === jobId) {
          // Already applied before the remount — keep it settled, no re-poll.
          setTranscription({ appliedJobId, jobId, phase, status: "done" });
        } else {
          // Re-confirm with the server: the poll effect resumes, recovers a
          // completed result, or surfaces that the job failed/expired.
          const resumeState = {
            detail: "Reconnecting to the job that was still running.",
            lineCount: 0,
            message: "",
            status: "running",
            title:
              phase === "time" ? "Auto-timing lyrics" : "Starting auto-lyrics",
          };

          if (phase === "time") {
            setAutoTimingState(resumeState);
          } else {
            setAutoLyricsState(resumeState);
          }

          setTranscription({
            appliedJobId: appliedJobId ?? null,
            jobId,
            phase,
            status: "running",
          });
        }
      }

      autosaveHydratedRef.current = true;
    };

    void restore();

    return () => {
      cancelled = true;
    };
  }, [debugProbe]);

  // Debounced full-project autosave: serialized project + audio descriptor +
  // active transcription pointer. Gated on hydration so it never overwrites
  // saved state with the blank initial project during mount.
  useEffect(() => {
    if (debugProbe || !autosaveHydratedRef.current) {
      return undefined;
    }

    const handle = window.setTimeout(() => {
      writeAutosaveRaw(
        encodeAutosave({
          audioAsset: audioUpload.asset,
          project: projectState,
          transcription,
        }),
      );
    }, 700);

    return () => {
      window.clearTimeout(handle);
    };
  }, [audioUpload.asset, debugProbe, projectState, transcription]);

  useEffect(() => {
    if (exportState.phase !== "polling" || !exportState.jobId) {
      return undefined;
    }

    // Keep the modal resilient to brief local-network hiccups without duplicating jobs.
    let ignore = false;
    let timeoutId = 0;
    let consecutiveFailures = 0;
    const jobId = exportState.jobId;

    const schedulePoll = (delayMs) => {
      timeoutId = window.setTimeout(runPoll, delayMs);
    };

    const runPoll = async () => {
      try {
        const response = await fetch(`/api/render/${jobId}`, {
          cache: "no-store",
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          if (response.status === 404) {
            setExportState((currentState) => {
              if (currentState.jobId !== jobId) {
                return currentState;
              }

              return {
                ...currentState,
                errorMessage:
                  payload.error ??
                  "That render job is no longer available. Start the export again.",
                isReconnecting: false,
                phase: "error",
                pollFailureCount: 0,
                renderStatus: "error",
              };
            });
            return;
          }

          throw new Error(payload.error ?? "Render status could not be refreshed.");
        }

        if (ignore) {
          return;
        }

        if (payload.status === "done") {
          setExportState((currentState) => {
            if (currentState.jobId !== jobId) {
              return currentState;
            }

            return {
              ...currentState,
              downloadError: "",
              errorMessage: "",
              fileUrl: payload.fileUrl ?? "",
              isReconnecting: false,
              phase: "done",
              pollFailureCount: 0,
              progress: 1,
              renderStatus: "done",
            };
          });
          return;
        }

        if (payload.status === "error") {
          setExportState((currentState) => {
            if (currentState.jobId !== jobId) {
              return currentState;
            }

            return {
              ...currentState,
              errorMessage: payload.error ?? "Render failed unexpectedly.",
              isReconnecting: false,
              phase: "error",
              pollFailureCount: 0,
              progress:
                Number.isFinite(payload.progress) && payload.progress >= 0
                  ? payload.progress
                  : currentState.progress,
              renderStatus: "error",
            };
          });
          return;
        }

        if (payload.status !== "queued" && payload.status !== "rendering") {
          setExportState((currentState) => {
            if (currentState.jobId !== jobId) {
              return currentState;
            }

            return {
              ...currentState,
              errorMessage: "The renderer returned an unexpected status. Try again.",
              isReconnecting: false,
              phase: "error",
              pollFailureCount: 0,
              renderStatus: "error",
            };
          });
          return;
        }

        consecutiveFailures = 0;
        setExportState((currentState) => {
          if (currentState.jobId !== jobId) {
            return currentState;
          }

          return {
            ...currentState,
            downloadError: "",
            errorMessage: "",
            isReconnecting: false,
            phase: "polling",
            pollFailureCount: 0,
            progress:
              Number.isFinite(payload.progress) && payload.progress >= 0
                ? payload.progress
                : currentState.progress,
            renderStatus: payload.status,
          };
        });
        schedulePoll(getRenderPollDelayMs(0));
      } catch {
        if (ignore) {
          return;
        }

        consecutiveFailures += 1;
        setExportState((currentState) => {
          if (currentState.jobId !== jobId) {
            return currentState;
          }

          return {
            ...currentState,
            isReconnecting: true,
            pollFailureCount: consecutiveFailures,
          };
        });
        schedulePoll(getRenderPollDelayMs(consecutiveFailures));
      }
    };

    schedulePoll(0);

    return () => {
      ignore = true;
      window.clearTimeout(timeoutId);
    };
  }, [exportState.jobId, exportState.phase]);

  useEffect(() => {
    if (
      exportState.phase !== "done" ||
      !exportState.fileUrl ||
      !exportState.jobId ||
      autoDownloadedJobIdRef.current === exportState.jobId
    ) {
      return;
    }

    autoDownloadedJobIdRef.current = exportState.jobId;
    handleAutoRenderDownload(
      exportState.fileUrl,
      getFallbackRenderFileName(
        projectState.meta.title,
        exportState.transparent,
        exportState.textLayerMode,
      ),
    );
  }, [
    exportState.fileUrl,
    exportState.jobId,
    exportState.phase,
    exportState.textLayerMode,
    exportState.transparent,
    projectState.meta.title,
  ]);

  useEffect(() => {
    clearProgrammaticScrollGuard();

    return () => {
      clearProgrammaticScrollGuard();
    };
  }, []);

  useEffect(() => {
    if (!debugProbe) {
      return;
    }

    setProjectState(cloneProject(debugProbe.project));
    setAudioUpload({
      asset: {
        assetId: "debug-audio",
        durationSec: debugProbe.durationSec,
        kind: "audio",
        name: debugProbe.project.audio.name || "debug-audio.mp3",
        sizeBytes: 0,
      },
      message: "Debug probe audio loaded.",
      status: "success",
    });
    setAudioObjectUrl(debugProbe.audioUrl);
    setBackgroundUpload(createBackgroundUploadState(debugProbe.project.background));
    setCurrentAudioTime(getInitialTransportTime(debugProbe.project));
    setIsTransportPlaying(false);
    setSelectedTimingLineId(null);
    setDebugMarkEvents([]);
    setDebugProbeRunStatus("idle");
    setDebugWaveSurferOnsets(null);
    setActiveSection("lyrics");
    setTimingDrafts({});
    setAutoFollowEnabled(true);
    setJsonNotice({
      message: "",
      status: "idle",
    });
    setAutoLyricsState(createIdleAutoLyricsState());
    setAutoTimingState(createIdleAutoTimingState());
    setTimingNotice({
      message: "",
      status: "idle",
    });
  }, [debugProbe]);

  useEffect(() => {
    const debugState = getTimingDebugState();

    if (!debugState) {
      return;
    }

    debugState.getCurrentAudioTimeState = () => currentAudioTime;
    debugState.getSelectedTimingLineId = () => selectedTimingLine?.id ?? null;
    debugState.getProjectLines = () =>
      projectState.lines.map((line) => ({
        id: line.id,
        original: line.original,
        start: line.start,
      }));
    debugState.resetMarkEvents = () => {
      debugState.markEvents = [];
    };
    debugState.loadProbeScenario = ({
      audioUrl,
      durationSec,
      project: nextProject,
    }) => {
      const importedProject = importProjectJson(JSON.stringify(nextProject));

      setProjectState(importedProject);
      setAudioUpload({
        asset: {
          assetId: "debug-audio",
          durationSec,
          kind: "audio",
          name: importedProject.audio.name || "debug-audio.mp3",
          sizeBytes: 0,
        },
        message: "Debug probe audio loaded.",
        status: "success",
      });
      setAudioObjectUrl(audioUrl);
      setBackgroundUpload(createBackgroundUploadState(importedProject.background));
      setCurrentAudioTime(getInitialTransportTime(importedProject));
      setIsTransportPlaying(false);
      setSelectedTimingLineId(null);
      setActiveSection("lyrics");
      setTimingDrafts({});
      setAutoFollowEnabled(true);
      setJsonNotice({
        message: "",
        status: "idle",
      });
      setAutoLyricsState(createIdleAutoLyricsState());
      setAutoTimingState(createIdleAutoTimingState());
      setTimingNotice({
        message: "",
        status: "idle",
      });
    };
  }, [currentAudioTime, projectState.lines, selectedTimingLine?.id]);

  useEffect(() => {
    if (!debugProbe) {
      return undefined;
    }

    const updateDebugWaveSurferOnsets = () => {
      const debugState = getTimingDebugState();
      const onsetResult = debugState?.getWaveSurferOnsets?.();

      if (!onsetResult?.onsets?.length) {
        return;
      }

      setDebugWaveSurferOnsets((currentValue) => {
        if (
          currentValue?.sampleRate === onsetResult.sampleRate &&
          currentValue?.onsets?.length === onsetResult.onsets.length
        ) {
          return currentValue;
        }

        return {
          onsets: onsetResult.onsets,
          sampleRate: onsetResult.sampleRate,
        };
      });
    };

    updateDebugWaveSurferOnsets();
    const intervalId = window.setInterval(updateDebugWaveSurferOnsets, 250);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [debugProbe]);

  useEffect(() => {
    if (!tapTimingSession.active || activeSection === "lyrics") {
      return;
    }

    handleStopTapTimingEffect({
      message: null,
    });
  }, [activeSection, tapTimingSession.active]);

  useEffect(() => {
    if (!tapTimingSession.active) {
      return;
    }

    const cursorStillExists = projectState.lines.some(
      (line) => line.id === tapTimingSession.cursorLineId,
    );

    if (audioObjectUrl && cursorStillExists) {
      return;
    }

    handleStopTapTimingEffect({
      message: "Tap timing stopped because the session changed.",
      status: "danger",
    });
  }, [
    audioObjectUrl,
    projectState.lines,
    tapTimingSession.active,
    tapTimingSession.cursorLineId,
  ]);

  useEffect(() => {
    if (activeSection !== "lyrics" || !autoFollowEnabled || !followTimingLineId) {
      return;
    }

    const row = timingRowRefs.current.get(followTimingLineId);

    if (!row) {
      return;
    }

    // Follow the active line: the heard line during playback, otherwise the
    // selected line (e.g. Mark/Enter advancing to the next line).
    suppressManualScrollRef.current = true;
    clearProgrammaticScrollGuard();
    programmaticScrollTimeoutRef.current = window.setTimeout(() => {
      suppressManualScrollRef.current = false;
      programmaticScrollTimeoutRef.current = null;
    }, 360);
    row.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [activeSection, autoFollowEnabled, followTimingLineId]);

  useEffect(() => {
    if (activeSection !== "lyrics" || isJsonModalOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      const target = event.target;
      const isEditableTarget =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");

      if (event.key === "Enter" && !isEditableTarget) {
        if (tapTimingSession.active) {
          event.preventDefault();

          if (!tapTimingSession.paused) {
            handleTapNextHotkey();
          }

          return;
        }

        event.preventDefault();
        handleMarkHotkey();
        return;
      }

      if (event.key === " " && !isEditableTarget && tapTimingSession.active) {
        event.preventDefault();

        if (!tapTimingSession.paused) {
          handleTapNextHotkey();
        }

        return;
      }

      if (event.key === "Escape" && !isEditableTarget && tapTimingSession.active) {
        event.preventDefault();
        handleStopTapTimingHotkey();
        return;
      }

      if (
        (event.key === "Backspace" || event.key === "u" || event.key === "U") &&
        !isEditableTarget &&
        tapTimingSession.active
      ) {
        event.preventDefault();
        handleUndoLastTapHotkey();
        return;
      }

      if (
        (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
        !isEditableTarget &&
        selectedTimingLine
      ) {
        event.preventDefault();
        const magnitude = event.shiftKey ? 0.5 : 0.05;
        handleNudgeHotkey(event.key === "ArrowLeft" ? -magnitude : magnitude);
        return;
      }

      if ((event.key === "j" || event.key === "J") && !isEditableTarget) {
        event.preventDefault();
        handleJumpHotkey();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    activeSection,
    currentAudioTime,
    isJsonModalOpen,
    projectState.audio,
    selectedTimingLine,
    tapTimingSession.active,
    tapTimingSession.paused,
  ]);

  const handleWaveformDuration = (durationInSeconds) => {
    if (!Number.isFinite(durationInSeconds) || durationInSeconds <= 0) {
      return;
    }

    if (Math.abs(durationInSeconds - projectState.audio.duration) < 0.01) {
      return;
    }

    const nextAudio = normalizeAudioSection({
      ...projectState.audio,
      duration: durationInSeconds,
    });
    const { clampedCount, lines } = clampLineStartsToSection(
      projectState.lines,
      nextAudio,
    );

    setProjectState((currentProject) => ({
      ...currentProject,
      audio: nextAudio,
      lines,
    }));
    setCurrentAudioTime((currentTime) => clampTimeToSection(currentTime, nextAudio));

    if (clampedCount > 0) {
      setTimingNotice({
        message: `${clampedCount} timed ${
          clampedCount === 1 ? "line was" : "lines were"
        } clamped inside the active section.`,
        status: "danger",
      });
    }
  };

  const handleWaveformPeaks = (waveformPeaks) => {
    if (!waveformPeaks?.assetId) {
      return;
    }

    setAudioUpload((currentUpload) => {
      const currentAsset = currentUpload.asset;

      if (!currentAsset || currentAsset.assetId !== waveformPeaks.assetId) {
        return currentUpload;
      }

      const currentPeaks = currentAsset.waveformPeaks;

      if (
        currentPeaks?.version === waveformPeaks.version &&
        currentPeaks?.assetId === waveformPeaks.assetId &&
        currentPeaks?.durationSec === waveformPeaks.durationSec &&
        currentPeaks?.channels === waveformPeaks.channels &&
        currentPeaks?.maxLength === waveformPeaks.maxLength &&
        currentPeaks?.precision === waveformPeaks.precision &&
        currentPeaks?.data?.length === waveformPeaks.data.length
      ) {
        return currentUpload;
      }

      return {
        ...currentUpload,
        asset: {
          ...currentAsset,
          waveformPeaks,
        },
      };
    });
  };

  const timingControlsVisible = timingControlsOpen || tapTimingSession.active;

  const renderActiveTab = () => {
    switch (activeSection) {
      case "audio":
        return (
          <AudioTab
            audio={{
              upload: audioUpload,
              objectUrl: audioObjectUrl,
              isLoadingSample,
              onFile: handleAudioFile,
              onClear: handleClearAudio,
              onLoadSample: handleLoadSample,
              onPickFile: () => audioInputRef.current?.click(),
              youtube: {
                enabled: youtubeAudioEnabled,
                error: youtubeConfigError,
                onOpen: handleOpenYoutubeModal,
                onUrlChange: (value) => {
                  setYoutubeUrl(value);
                  if (youtubeConfigError) {
                    setYoutubeConfigError("");
                  }
                },
                url: youtubeUrl,
              },
            }}
            credit={{
              enabled: creditState.enabled,
              onSaveGenerationChange: setSaveGeneration,
              onUnlockPasswordChange: setUnlockPassword,
              onUnlockSubmit: (event) => {
                void handleUnlockSubmit(event);
              },
              saveGeneration,
              unlockMessage,
              unlockPassword,
              unlockStatus,
            }}
            lyricsSource={{
              auto: autoLyricsState,
              autoLyricsBusy,
              autoTiming: autoTimingState,
              autoTimingBusy,
              sourceLanguage,
              otherSourceLanguage,
              canGenerate: canGenerateAutoLyrics,
              pipeline: {
                canRun: lyricPipelineCanRun,
                onPreset: handleLyricPipelinePreset,
                onRun: handleRunPipeline,
                preset: lyricPipelinePreset,
                selectedPhases: selectedLyricPipelinePhases,
                selection: lyricPipelineSelection,
                statusByPhase: lyricPipelineStatusByPhase,
              },
              languageRequirementMessage: lyricPipelineLanguageRequirementMessage,
              onSourceLanguage: (value) => {
                setSourceLanguage(value);
                setAutoTimingState((currentState) =>
                  currentState.status === "error"
                    ? createIdleAutoTimingState()
                    : currentState,
                );
                setAutoLyricsState((currentState) =>
                  currentState.status === "error"
                    ? createIdleAutoLyricsState()
                    : currentState,
                );
              },
              onOtherSourceLanguage: (value) => {
                setOtherSourceLanguage(value);
                setAutoTimingState((currentState) =>
                  currentState.status === "error"
                    ? createIdleAutoTimingState()
                    : currentState,
                );
                setAutoLyricsState((currentState) =>
                  currentState.status === "error"
                    ? createIdleAutoLyricsState()
                    : currentState,
                );
              },
              onImportJson: openJsonImport,
              onExportJson: handleProjectExport,
              onClearLyrics: handleClearLyrics,
              inlineNotice: showInlineJsonNotice ? jsonNotice.message : null,
            }}
            project={projectState}
          />
        );
      case "lyrics":
        return (
          <LyricsTab
            project={projectState}
            timing={{
              sectionActive: activeSection === "lyrics",
              controlsVisible: timingControlsVisible,
              autoFollowEnabled,
              notice: timingNotice,
              drafts: timingDrafts,
              editingLineId,
              activeTimingLineId,
              heardLineId: heardLine?.id ?? null,
              lineCount,
              timedLineCount,
              session: tapTimingSession,
              progress: tapTimingProgress,
              cursorLine: tapTimingCursorLine,
              nextLine: tapTimingNextLine,
              startLine: tapTimingStartLine,
              startLineNumber: tapTimingStartLineNumber,
              startDisabledReason: tapTimingStartDisabledReason,
              canStart: canStartTapTiming,
              autoTiming: autoTimingState,
              autoTimingBusy,
              rowRefs: timingRowRefs,
              onToggleControls: () => setTimingControlsOpen((open) => !open),
              onJump: handleJumpToCurrentLine,
              onResumeSession: resumeTapTimingSession,
              onPauseSession: pauseTapTimingSession,
              onUndoTap: undoLastTap,
              onStopSession: stopTapTimingSession,
              onTapNext: tapNextTimingLine,
              onStartSession: startTapTimingSession,
              onMark: tapTimingSession.active
                ? tapNextTimingLine
                : handleMarkCurrentLine,
              onClearLineStart: clearTimingLineStart,
              onSetNotice: setTimingNotice,
              onSetEditingLine: setEditingLineId,
              onDeleteLine: deleteLine,
              onSetSelectedLine: setSelectedTimingLineId,
              onSetDrafts: setTimingDrafts,
              onDraftCommit: handleTimingDraftCommit,
              onDraftReset: handleTimingDraftReset,
              onMoveLine: moveLine,
              onNudge: handleNudgeSelectedLine,
              onSelectLine: handleTimingLineSelect,
              onUpdateLine: updateLine,
              onAddLine: addLine,
              onClearAll: handleClearAllTimes,
            }}
          />
        );
      case "style":
        return (
          <StyleTab
            textDisplay={{
              style: projectState.style,
              timing: projectState.timing,
              presetEntries: stylePresetEntries,
              open: textDisplayOpen,
              onToggle: () => setTextDisplayOpen((open) => !open),
              onApplyPreset: applyPreset,
              onUpdateStyle: updateStyle,
              onUpdateTiming: updateTiming,
              onUpdateShadow: updateShadow,
            }}
            background={{
              settings: projectState.background,
              open: backgroundOpen,
              onToggle: () => setBackgroundOpen((open) => !open),
              onSelectType: selectBackgroundType,
              onUpdateBackground: updateBackground,
              onImageFile: handleBackgroundImageFile,
              onVideoFile: handleBackgroundVideoFile,
              onPickImage: () => backgroundImageInputRef.current?.click(),
              onPickVideo: () => backgroundVideoInputRef.current?.click(),
              uploadCopy: activeBackgroundUploadCopy,
              upload: activeBackgroundUpload,
              asset: activeBackgroundAsset,
            }}
          />
        );
      case "words":
        return (
          <div
            aria-label="Word board controls"
            className="board-tools-card"
            data-board-tools-card
          />
        );
      default:
        return null;
    }
  };

  const layoutNoticeCount =
    (!sectionWithinLimit ? 1 : 0) +
    (jsonNotice.message && jsonNotice.status === "error" ? 1 : 0);
  const showGlobalJsonNotice =
    Boolean(jsonNotice.message) && jsonNotice.status === "error";
  const showInlineJsonNotice =
    Boolean(jsonNotice.message) && !showGlobalJsonNotice;
  const isAudioRestoring =
    audioUpload.status === "uploading" &&
    Boolean(audioUpload.asset?.assetId) &&
    !audioObjectUrl;
  const appFrameClasses = [
    "app-frame relative flex h-dvh flex-col overflow-hidden bg-[var(--page)] text-[var(--text)]",
    showPreview ? "show-preview" : "",
    showWordBoard ? "show-board" : "",
    activeSection === "words" ? "words-tab-active" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const currentSheetSnap = SHEET_SNAPS[sheetSnapIndex] ?? SHEET_SNAPS[0];
  const creditControls = {
    balanceMinor: creditState.balanceMinor,
    enabled: creditState.enabled,
    onTopUpAmountChange: setTopUpAmount,
    onTopUpSubmit: (event) => {
      void handleTopUpSubmit(event);
    },
    status: creditState.status,
    topUpAmount,
    topUpMessage,
    topUpStatus,
  };

  return (
    <EditorProvider value={editor}>
    <div className={appFrameClasses} data-snap={currentSheetSnap.key}>
        <div
          className="app-responsive mx-auto flex h-full w-full max-w-[1720px] flex-col lg:gap-3 lg:px-5 lg:py-4"
          onTouchCancelCapture={handlePinnedMediaTouchEnd}
          onTouchEndCapture={handlePinnedMediaTouchEnd}
          onTouchMoveCapture={handlePinnedMediaTouchMove}
          onTouchStartCapture={handlePinnedMediaTouchStart}
          onWheelCapture={handlePinnedMediaWheel}
          ref={appScrollRef}
          style={
            layoutNoticeCount
              ? { "--layout-notice-offset": `${layoutNoticeCount * 62}px` }
              : undefined
        }
      >
        <EditorHeader
          artist={projectState.meta.artist}
          credit={creditControls}
          onTogglePreview={handleTogglePreview}
          onToggleWordBoard={handleToggleWordBoard}
          showPreview={showPreview}
          showWordBoard={showWordBoard}
          title={projectState.meta.title}
        />

        {!sectionWithinLimit || showGlobalJsonNotice ? (
        <div className="layout-notices absolute inset-x-3 top-[4.25rem] z-30 space-y-2 lg:static lg:inset-auto lg:space-y-3">
          {!sectionWithinLimit ? (
            <div className="rounded-2xl border border-[var(--danger)]/35 bg-[var(--danger-soft)] px-4 py-2.5 text-sm text-[var(--danger)]">
              Export stays blocked: the selected section is{" "}
              {formatPreciseTime(sectionDuration)}. Keep it at{" "}
              {formatPreciseTime(MAX_SECTION_DURATION_SECONDS)} or shorter.
            </div>
          ) : null}

          {showGlobalJsonNotice ? (
            <div
              className="rounded-2xl border border-[var(--danger)]/35 bg-[var(--danger-soft)] px-4 py-2.5 text-sm text-[var(--danger)]"
            >
              {jsonNotice.message}
            </div>
          ) : null}
        </div>
        ) : null}

        <main
          className="work-area no-scrollbar relative flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden lg:overflow-visible lg:flex-row lg:gap-3"
          onTouchMove={handleManualTimingScroll}
          onWheel={handleManualTimingScroll}
        >
          <section className="workspace-panel">
            <div
              className={`workspace-grid${!showPreview ? " hide-preview" : ""}${
                !showWordBoard ? " hide-board" : ""
              }`}
            >
          <PreviewStage
            backgroundDurationSec={activeBackgroundAsset?.durationSec ?? null}
            backgroundPreviewUrl={backgroundPreviewUrl}
            canExport={exportReadiness.canExport}
            currentAudioTime={currentAudioTime}
            exportBusy={exportBusy}
            isPreviewFullscreen={isPreviewFullscreen}
            onEnterFullscreen={() => setIsPreviewFullscreen(true)}
            onExitFullscreen={() => setIsPreviewFullscreen(false)}
            onExport={() => {
              void handleStartExport(false);
            }}
            previewCurrentFrame={previewCurrentFrame}
            previewPlayerRef={previewPlayerRef}
            project={projectState}
            wordBoardFollowAudioResetKey={wordBoardFollowAudioResetKey}
          />
            </div>
          </section>

          <section
            className="side-panel flex flex-none flex-col lg:static lg:mt-0 lg:min-h-0 lg:overflow-hidden lg:rounded-2xl lg:border lg:border-[var(--border)] lg:bg-[var(--shell)] lg:shadow-[var(--shadow-panel)] lg:backdrop-blur-none xl:w-[420px] lg:w-[420px]"
          >
            <button
              aria-label={currentSheetSnap.label}
              className="sheet-handle lg:hidden"
              onClick={() => {
                if (activeSection === "words" && isNarrowWorkspace) {
                  return;
                }
                setSheetSnapIndex((index) => (index + 1) % SHEET_SNAPS.length);
              }}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path
                  d="m6 13 6-6 6 6M6 17l6-6 6 6"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                />
              </svg>
            </button>

            <EditorTabBar
              activeSection={activeSection}
              onSelectSection={handleSelectSection}
            />

            <input
              accept=".mp3,audio/mpeg"
              className="hidden"
              onChange={(event) => {
                handleAudioFile(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
              ref={audioInputRef}
              type="file"
            />
            <input
              accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                void handleBackgroundImageFile(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
              ref={backgroundImageInputRef}
              type="file"
            />
            <input
              accept=".mp4,.webm,video/mp4,video/webm"
              className="hidden"
              onChange={(event) => {
                void handleBackgroundVideoFile(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
              ref={backgroundVideoInputRef}
              type="file"
            />

            <div
              className="editor-panel-content overflow-x-hidden px-4 pb-4 pt-3 lg:no-scrollbar lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:px-3.5 lg:py-4"
              data-active-tab={activeSection}
              onTouchMove={handleManualTimingScroll}
              onWheel={handleManualTimingScroll}
              ref={editorScrollRef}
            >
              {renderActiveTab()}
            </div>
          </section>
        </main>

        <section className="transport-slot flex-none">
          <WaveformTimeline
            activeLineId={activeTimingLineId}
            audio={projectState.audio}
            lyricSeekTime={lyricSeekTime}
            audioAssetDurationSec={
              audioUpload.asset?.durationSec ?? projectState.audio.duration
            }
            audioAssetId={audioUpload.asset?.assetId ?? ""}
            audioSrc={audioObjectUrl}
            cachedWaveformPeaks={audioUpload.asset?.waveformPeaks ?? null}
            currentTime={currentAudioTime}
            isAudioRestoring={isAudioRestoring}
            isPlaying={isTransportPlaying}
            isTimingActive={isTimingTab}
            lines={projectState.lines}
            mobileMenu={creditControls}
            mobileTabs={{
              activeSection,
              onSelectSection: handleSelectSection,
            }}
            onDurationChange={handleWaveformDuration}
            onMark={handleMarkCurrentLine}
            onTogglePreview={handleTogglePreview}
            onToggleWordBoard={handleToggleWordBoard}
            onPlayingChange={setIsTransportPlaying}
            onTimeChange={setCurrentAudioTime}
            onWaveformPeaks={handleWaveformPeaks}
            showPreview={showPreview}
            showWordBoard={showWordBoard}
          />
        </section>

        {debugProbe ? (
          <section
            aria-hidden="true"
            className="fixed bottom-2 left-2 z-[70] flex max-w-md flex-col gap-1 rounded-lg border border-white/12 bg-slate-950/90 p-2 text-[11px] text-white/80 shadow-lg"
            data-testid="timing-probe-readout"
          >
            {debugProbe.autoMarkAtMs?.length ? (
              <button
                className="rounded border border-white/15 bg-white/8 px-2 py-1 text-left text-[11px] text-white/90"
                data-testid="timing-probe-run"
                onClick={() => {
                  void startDebugProbeRun();
                }}
                type="button"
              >
                Run timing probe
              </button>
            ) : null}
            <div data-testid="timing-probe-run-status">{debugProbeRunStatus}</div>
            <div data-testid="timing-probe-current-audio-time">
              {currentAudioTime.toFixed(6)}
            </div>
            <div data-testid="timing-probe-selected-line">
              {resolvedSelectedTimingLineId ?? ""}
            </div>
            <div data-testid="timing-probe-mark-mode">{debugProbe.markClockMode}</div>
            <pre data-testid="timing-probe-mark-events">
              {JSON.stringify(debugMarkEvents)}
            </pre>
            <pre data-testid="timing-probe-wave-onsets">
              {JSON.stringify(debugWaveSurferOnsets)}
            </pre>
          </section>
        ) : null}
      </div>

      <EditorModals
        json={{
          draft: jsonDraft,
          errorMessage: jsonImportError,
          isOpen: isJsonModalOpen,
          onChange: setJsonDraft,
          onClose: closeJsonImport,
          onFileSelected: handleJsonFile,
          onImport: handleProjectImport,
          onStartNew: handleStartNewProject,
        }}
        exportModal={{
          isOpen: exportModalOpen,
          downloadError: exportState.downloadError,
          errorMessage: exportState.errorMessage,
          isDownloading: exportState.isDownloading,
          isReconnecting: exportState.isReconnecting,
          lineCount,
          onClose: closeExportModal,
          onDownload: () => {
            void runRenderDownload({
              fallbackName: getFallbackRenderFileName(
                projectState.meta.title,
                exportState.transparent,
                exportState.textLayerMode,
              ),
              fileUrl: exportState.fileUrl,
            });
          },
          onRetry: () => {
            void handleStartExport(exportState.transparent, exportState.textLayerMode);
          },
          formatLabel: exportState.transparent
            ? getTextLayerFormat(exportState.textLayerMode).formatLabel
            : "MP4",
          phase: exportState.phase,
          progressPercent: exportProgressPercent,
          projectTitle: projectState.meta.title || "Reel Creator",
          renderStatus: exportState.renderStatus,
          sectionLengthLabel: formatPreciseTime(sectionDuration),
          statusNote: exportState.statusNote,
        }}
      />

      {isYoutubeModalOpen ? (
        <YoutubeSegmentModal
          isOpen={isYoutubeModalOpen}
          onClose={() => setIsYoutubeModalOpen(false)}
          onComplete={handleYoutubeSegmentComplete}
          sourceUrl={youtubeUrl}
        />
      ) : null}
    </div>
    </EditorProvider>
  );
}
