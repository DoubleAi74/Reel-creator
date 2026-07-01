"use client";

import { startTransition, useEffect, useEffectEvent, useRef, useState } from "react";

import { EditorProvider } from "@/components/editor-context";
import { useEditorState } from "@/components/editor-state";
import { PreviewPlayer } from "@/components/preview-player";
import { ProjectJsonModal } from "@/components/project-json-modal";
import { RenderExportModal } from "@/components/render-export-modal";
import { WaveformTimeline } from "@/components/waveform-timeline";
import { WordBoard } from "@/components/word-board/word-board";
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
import {
  AUTOSAVE_STORAGE_KEY,
  decodeAutosave,
  encodeAutosave,
} from "@/lib/autosave";
import { mergeMeaningWordsWithTiming } from "@/lib/word-meanings";
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
  DEFAULT_LYRIC_LEAD_IN_MS,
  findActiveLine,
  getSectionBounds,
  getSectionDurationInFrames,
  getSectionFrameFromTime,
  isSectionWithinLimit,
  MAX_LYRIC_LEAD_IN_MS,
  MAX_SECTION_DURATION_SECONDS,
  MIN_LYRIC_LEAD_IN_MS,
  normalizeAudioSection,
} from "@/lib/timing";
import {
  applyStylePreset,
  FONT_OPTIONS,
  STYLE_PRESETS,
} from "@/lib/style-presets";
import { VIDEO_FPS } from "@/remotion/constants";

const SECTIONS = [
  {
    id: "audio",
    label: "Audio",
    tabs: [
      { id: "track-upload", label: "Track upload" },
      { id: "get-lyrics", label: "Get lyrics" },
    ],
  },
  {
    id: "lyrics",
    label: "Lyrics",
    tabs: [
      { id: "edit-text", label: "Edit Text" },
      { id: "timings", label: "Timings" },
      { id: "words", label: "Words" },
    ],
  },
  {
    id: "style",
    label: "Style",
    tabs: [
      { id: "text-display", label: "Text display" },
      { id: "background", label: "Background" },
    ],
  },
];

const SUB_TABS = SECTIONS.flatMap((section) =>
  section.tabs.map((tab) => ({ ...tab, section: section.id })),
);

// Bundled demo assets. The MP3 is copied into /public/samples so it can be
// fetched and pushed through the normal audio upload pipeline; the project JSON
// is loaded on demand via dynamic import.
const SAMPLE_AUDIO_NAME = "Aaj-Se-Teri-Lyrical-Padman-Aksha.mp3";
const SAMPLE_AUDIO_URL = `/samples/${SAMPLE_AUDIO_NAME}`;

function getSectionForSubTab(subTabId) {
  return (
    SUB_TABS.find((tab) => tab.id === subTabId)?.section ?? SECTIONS[0].id
  );
}

const SOURCE_LANGUAGE_OPTIONS = [
  { id: "auto", label: "Auto-detect" },
  { id: "hi", label: "Hindi" },
  { id: "es", label: "Spanish" },
  { id: "fr", label: "French" },
  { id: "ja", label: "Japanese" },
  { id: "ko", label: "Korean" },
  { id: "ar", label: "Arabic" },
  { id: "zh", label: "Chinese" },
  { id: "other", label: "Other" },
];

// Mobile-only bottom-sheet snap heights (ignored at lg+, where the editor fills its grid column).
const SHEET_SNAPS = [
  { height: "120px", label: "Peek · tap to expand" },
  { height: "44vh", label: "Half · tap to expand" },
  { height: "74vh", label: "Full · tap to collapse" },
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

function formatTime(totalSeconds) {
  const wholeSeconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const seconds = wholeSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatPreciseTime(totalSeconds) {
  if (!Number.isFinite(totalSeconds)) {
    return "";
  }

  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds - minutes * 60;

  return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(2).padStart(5, "0")}`;
}

function formatBytes(sizeBytes) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "0 B";
  }

  if (sizeBytes < 1024 * 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`;
  }

  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

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

function formatSectionRelativeTime(totalSeconds, audio = {}) {
  if (!Number.isFinite(totalSeconds)) {
    return "";
  }

  const { startOffset } = getSectionBounds(audio);

  return formatPreciseTime(Math.max(0, totalSeconds - startOffset));
}

function buildAudioOffsetDrafts(audio = {}) {
  const normalizedAudio = normalizeAudioSection(audio);

  return {
    endOffset:
      audio.endOffset == null ? "" : formatPreciseTime(normalizedAudio.endOffset),
    startOffset: formatPreciseTime(normalizedAudio.startOffset),
  };
}

function cloneProject(project) {
  return structuredClone(project);
}

function buildSessionAssetUrl(assetId) {
  return assetId ? `/api/assets/${assetId}` : null;
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

function isBackgroundMediaType(backgroundType) {
  return backgroundType === "image" || backgroundType === "video";
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

function createIdleWordTimingState() {
  return {
    duration: 0,
    errorMessage: "",
    language: "",
    status: "idle",
    words: [],
  };
}

function normalizeWordTimings(rawWords) {
  return (Array.isArray(rawWords) ? rawWords : [])
    .map((word, index) => ({
      end: Number(word?.end),
      index,
      start: Number(word?.start),
      word: String(word?.word ?? word?.text ?? "").trim(),
    }))
    .filter(
      (word) =>
        word.word && Number.isFinite(word.start) && Number.isFinite(word.end),
    );
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

function getFlattenedLineWords(result) {
  return (Array.isArray(result?.lines) ? result.lines : []).flatMap((line) =>
    normalizeLineWords(line?.words).map((word) => ({
      end: word.end,
      start: word.start,
      word: word.text,
    })),
  );
}

// Build a populated word-timings state from a pipeline result or explicit Load
// words call so the Words tab is filled without needing a separate Whisper run.
function buildWordTimingState(result) {
  const transcriptWords = normalizeWordTimings(result?.words);
  const words = transcriptWords.length
    ? transcriptWords
    : normalizeWordTimings(getFlattenedLineWords(result));

  if (words.length === 0) {
    return null;
  }

  return {
    duration: Number.isFinite(result?.duration) ? result.duration : 0,
    errorMessage: "",
    language: typeof result?.language === "string" ? result.language : "",
    status: "success",
    words,
  };
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

function getLineSummary(line) {
  if (!line) {
    return "";
  }

  return line.translation
    ? `${line.original} — ${line.translation}`
    : line.original;
}

function StatusBadge({ children, tone = "neutral" }) {
  const toneClasses =
    tone === "accent"
      ? "border-[var(--accent)] bg-[var(--surface-active)] text-[var(--accent)]"
      : tone === "success"
        ? "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]"
        : tone === "danger"
          ? "border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]"
          : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]";

  return (
    <span
      className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] ${toneClasses}`}
    >
      {children}
    </span>
  );
}

function StyleSlider({
  label,
  max,
  min,
  onChange,
  step,
  value,
  valueLabel = value,
}) {
  return (
    <label className="block rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium text-[var(--muted)]">{label}</span>
        <span className="text-sm text-[var(--muted)]">{valueLabel}</span>
      </div>
      <input
        className="mt-4 w-full accent-[var(--accent)]"
        max={max}
        min={min}
        onChange={onChange}
        step={step}
        type="range"
        value={value}
      />
    </label>
  );
}

function StyleColorField({ label, onChange, value }) {
  return (
    <label className="block rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
      <span className="text-sm font-medium text-[var(--muted)]">{label}</span>
      <div className="mt-4 flex items-center gap-3">
        <input
          className="h-11 w-16 rounded-lg border border-[var(--border)] bg-transparent"
          onChange={onChange}
          type="color"
          value={value}
        />
        <code className="text-sm text-[var(--muted)]">{value}</code>
      </div>
    </label>
  );
}

// Textarea that starts one line tall and grows to fit its content.
function AutoGrowTextarea({ className = "", onChange, value, ...props }) {
  const ref = useRef(null);

  useEffect(() => {
    const element = ref.current;

    if (element) {
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight}px`;
    }
  }, [value]);

  return (
    <textarea
      className={className}
      onChange={onChange}
      ref={ref}
      rows={1}
      style={{ overflow: "hidden", resize: "none" }}
      value={value}
      {...props}
    />
  );
}

function TimingRow({
  displayTime,
  index,
  isActive,
  isHeard,
  line,
  onClear,
  onDraftChange,
  onDraftCommit,
  onDraftReset,
  onMark,
  onNudge,
  onSelect,
  rowRef,
  timeValue,
}) {
  return (
    <div
      className={`rounded-[1rem] border px-2.5 py-2 transition ${
        isActive
          ? "border-[var(--accent)] bg-[var(--surface-active)] shadow-[var(--shadow-soft)]"
          : isHeard
            ? "border-[var(--border)] bg-[var(--surface-2)]"
            : "border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)]"
      }`}
      onClick={onSelect}
      ref={rowRef}
      role="button"
      tabIndex={0}
      title={getLineSummary(line)}
    >
      <div className="flex items-center gap-2.5">
        {isActive ? (
          <input
            className="w-[74px] rounded-md border border-[var(--accent)] bg-[var(--surface-active)] px-2 py-1 font-mono text-[11px] text-[var(--accent)] outline-none"
            onBlur={() => onDraftCommit(line.id)}
            onChange={(event) => onDraftChange(line.id, event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onFocus={onSelect}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                // Enter always stamps the playhead + advances (identical to
                // Mark), whether or not this line is already timed. Discard any
                // in-progress typed value; commit a typed time with Tab / blur.
                event.preventDefault();
                onDraftReset(line.id);
                onMark();
                return;
              }

              if (event.key === "Escape") {
                event.preventDefault();
                onDraftReset(line.id);
              }
            }}
            value={timeValue}
          />
        ) : (
          <span
            className={`rounded-md px-2 py-1 font-mono text-[11px] ${
              Number.isFinite(line.start)
                ? "bg-[var(--surface-2)] text-[var(--muted)]"
                : "bg-[var(--surface-2)] text-[var(--muted)]"
            }`}
          >
            {Number.isFinite(line.start) ? displayTime : "—:—"}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[13px] font-medium text-[var(--text)] sm:text-sm">
              {line.original || `Line ${index + 1}`}
            </p>
            {isActive ? (
              <span className="shrink-0 text-[9px] uppercase tracking-[0.28em] text-[var(--accent)]">
                Active
              </span>
            ) : null}
          </div>
          <p className="truncate text-[11px] text-[var(--muted)]">
            {line.translation || "No translation"}
          </p>
        </div>
      </div>

      {isActive ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {[-0.5, -0.05, 0.05, 0.5].map((delta) => (
            <button
              className="flex-1 rounded-md border border-[var(--border)] px-2 py-1 font-mono text-[11px] text-[var(--muted)] transition hover:bg-[var(--surface-hover)]"
              key={delta}
              onClick={(event) => {
                event.stopPropagation();
                onNudge(delta);
              }}
              type="button"
            >
              {delta > 0 ? "+" : ""}
              {Math.abs(delta) === 0.5 ? delta.toFixed(1) : delta.toFixed(2)}
            </button>
          ))}

          <button
            className="rounded-md border border-[var(--accent)] bg-[var(--surface-active)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent)] transition hover:bg-[var(--surface-hover)]"
            onClick={(event) => {
              event.stopPropagation();
              onMark();
            }}
            type="button"
          >
            {Number.isFinite(line.start) ? "Re-time" : "Mark"}
          </button>
          <button
            className="rounded-md border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)]"
            onClick={(event) => {
              event.stopPropagation();
              onClear();
            }}
            type="button"
          >
            Clear
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function EditorShell({ debugProbe = null, project }) {
  const [activeSubTab, setActiveSubTab] = useState("track-upload");
  const activeSection = getSectionForSubTab(activeSubTab);
  const [audioUpload, setAudioUpload] = useState({
    asset: null,
    message: "Upload an MP3 to replace the sample track metadata.",
    status: "idle",
  });
  const [backgroundUpload, setBackgroundUpload] = useState(() =>
    createBackgroundUploadState(project.background),
  );
  const [audioObjectUrl, setAudioObjectUrl] = useState(null);
  const [isLoadingSample, setIsLoadingSample] = useState(false);
  const [currentAudioTime, setCurrentAudioTime] = useState(
    getInitialTransportTime(project),
  );
  const [isTransportPlaying, setIsTransportPlaying] = useState(false);
  const [isJsonModalOpen, setIsJsonModalOpen] = useState(false);
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonImportError, setJsonImportError] = useState("");
  const [jsonNotice, setJsonNotice] = useState({
    message: "",
    status: "idle",
  });
  const [audioSectionNotice, setAudioSectionNotice] = useState({
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
  const [audioOffsetDrafts, setAudioOffsetDrafts] = useState(() =>
    buildAudioOffsetDrafts(project.audio),
  );
  const [timingDrafts, setTimingDrafts] = useState({});
  const [tapTimingSession, setTapTimingSession] = useState(
    createIdleTapTimingSession,
  );
  const [autoFollowEnabled, setAutoFollowEnabled] = useState(true);
  const [sheetSnapIndex, setSheetSnapIndex] = useState(1);
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);
  const [exportState, setExportState] = useState(createIdleExportState);
  const [autoLyricsState, setAutoLyricsState] = useState(
    createIdleAutoLyricsState,
  );
  const [autoTimingState, setAutoTimingState] = useState(
    createIdleAutoTimingState,
  );
  // Pointer to the background transcription/timing job that the poll effect
  // drives: { jobId, mode: "lyrics" | "timing", status: "running" | "done"
  // | "error", appliedJobId }. Survives sleep/reload via autosave so a job can
  // be resumed (or its finished result recovered) after the editor remounts.
  const [transcription, setTranscription] = useState(null);
  const [wordTimingState, setWordTimingState] = useState(
    createIdleWordTimingState,
  );
  const [sourceLanguage, setSourceLanguage] = useState("");
  const [otherSourceLanguage, setOtherSourceLanguage] = useState("");
  const [romanizeState, setRomanizeState] = useState({
    message: "",
    status: "idle",
  });
  const [wordMeaningsState, setWordMeaningsState] = useState({
    message: "",
    status: "idle",
  });
  const [timingControlsOpen, setTimingControlsOpen] = useState(false);
  // Independent visibility for the two workspace panes. On wide desktop both can
  // be on at once (preview, board, both, or neither). When the viewport is narrow
  // enough that only one fits, the toggle handlers + an effect keep them mutually
  // exclusive (turning one on turns the other off).
  const [showPreview, setShowPreview] = useState(true);
  const [showWordBoard, setShowWordBoard] = useState(true);
  const [isNarrowWorkspace, setIsNarrowWorkspace] = useState(false);
  const [projectState, setProjectState] = useState(() => cloneProject(project));
  const [selectedTimingLineId, setSelectedTimingLineId] = useState(() =>
    getDefaultTimingLineId(project.lines),
  );
  const audioInputRef = useRef(null);
  const backgroundImageInputRef = useRef(null);
  const backgroundVideoInputRef = useRef(null);
  const editorScrollRef = useRef(null);
  const previewPlayerRef = useRef(null);
  const programmaticScrollTimeoutRef = useRef(null);
  const suppressManualScrollRef = useRef(false);
  const timingRowRefs = useRef(new Map());
  const autoDownloadedJobIdRef = useRef(null);
  // Guards against importing a completed transcription result more than once
  // across repeated polls or remounts (mirrors the persisted appliedJobId).
  const appliedTranscribeJobIdRef = useRef(null);
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
      : getDefaultTimingLineId(projectState.lines);
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
      : resolvedSelectedTimingLineId;
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
  const isTimingTab = activeSubTab === "timings";

  // Publish cross-cutting signals into the shared editor context so the Word
  // Board can read project lines + playback + follow state without prop drilling.
  // One-directional (shell → context); the board's selection flows back in P6.
  const editorActions = editor.actions;
  const heardLineId = heardLine?.id ?? null;
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

  // Track whether the workspace is narrow enough to fit only one pane. Matches
  // the CSS breakpoint that collapses the workspace to a single column.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return undefined;
    }
    const query = window.matchMedia("(max-width: 999.98px)");
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
    }
  }, [isNarrowWorkspace, showPreview, showWordBoard]);

  // Each pane toggles independently on wide desktop; on narrow, turning one on
  // turns the other off (and turning the only-on one off shows neither).
  const handleTogglePreview = () => {
    const next = !showPreview;
    setShowPreview(next);
    if (next && isNarrowWorkspace) {
      setShowWordBoard(false);
    }
  };
  const handleToggleWordBoard = () => {
    const next = !showWordBoard;
    setShowWordBoard(next);
    if (next && isNarrowWorkspace) {
      setShowPreview(false);
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
  const wordTimingBusy = wordTimingState.status === "running";
  const sourceLanguageRequired = sourceLanguage.trim().length === 0;
  const otherSourceLanguageRequired =
    sourceLanguage === "other" && otherSourceLanguage.trim().length === 0;
  const autoLyricsLanguageRequirementMessage = sourceLanguageRequired
    ? "Select a source language before generating and timing."
    : otherSourceLanguageRequired
      ? "Type the source language to use Other."
      : "";
  const canGenerateAutoLyrics =
    audioUpload.status === "success" &&
    Boolean(audioUpload.asset?.assetId) &&
    !autoLyricsBusy &&
    !autoTimingBusy &&
    !sourceLanguageRequired &&
    !otherSourceLanguageRequired;
  const canAutoTimeLyrics =
    audioUpload.status === "success" &&
    Boolean(audioUpload.asset?.assetId) &&
    lineCount > 0 &&
    !autoLyricsBusy &&
    !autoTimingBusy &&
    !otherSourceLanguageRequired;
  const canLoadWordTimings =
    audioUpload.status === "success" &&
    Boolean(audioUpload.asset?.assetId) &&
    !wordTimingBusy &&
    !otherSourceLanguageRequired;

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

  const applySectionAudio = (audioPatch, successMessage) => {
    const nextAudio = normalizeAudioSection({
      ...projectState.audio,
      ...audioPatch,
    });
    const { clampedCount, lines } = clampLineStartsToSection(
      projectState.lines,
      nextAudio,
    );
    const lineClampMessage =
      clampedCount > 0
        ? ` ${clampedCount} timed ${clampedCount === 1 ? "line was" : "lines were"} clamped inside the new section.`
        : "";

    setProjectState((currentProject) => ({
      ...currentProject,
      audio: nextAudio,
      lines,
    }));
    setAudioOffsetDrafts(buildAudioOffsetDrafts(nextAudio));
    setCurrentAudioTime((currentTime) => clampTimeToSection(currentTime, nextAudio));
    setTimingDrafts({});
    setAutoFollowEnabled(true);
    setAudioSectionNotice({
      message: `${successMessage}${lineClampMessage}`,
      status:
        clampedCount > 0 || !isSectionWithinLimit(nextAudio) ? "warning" : "success",
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

    return nextAudio;
  };

  const resetAudioOffsetDraft = (field) => {
    const currentDrafts = buildAudioOffsetDrafts(projectState.audio);

    setAudioOffsetDrafts((drafts) => ({
      ...drafts,
      [field]: currentDrafts[field],
    }));
  };

  const commitAudioOffsetDraft = (field) => {
    const draftValue = audioOffsetDrafts[field]?.trim() ?? "";

    if (field === "startOffset" && draftValue.length === 0) {
      applySectionAudio(
        {
          startOffset: 0,
        },
        "Section start reset to 00:00.00.",
      );
      return;
    }

    if (field === "endOffset" && draftValue.length === 0) {
      applySectionAudio(
        {
          endOffset: null,
        },
        "Section end reset to the full track.",
      );
      return;
    }

    const parsedTime = parseTypedTime(draftValue);

    if (!Number.isFinite(parsedTime)) {
      setAudioSectionNotice({
        message: `Type the ${field === "startOffset" ? "start" : "end"} offset as seconds or mm:ss.ss.`,
        status: "danger",
      });
      return;
    }

    const previewAudio = normalizeAudioSection({
      ...projectState.audio,
      [field]: parsedTime,
    });
    const wasClamped =
      field === "startOffset"
        ? Math.abs(previewAudio.startOffset - parsedTime) >= 0.0001
        : Math.abs((previewAudio.endOffset ?? previewAudio.duration) - parsedTime) >=
          0.0001;
    const formattedValue = formatPreciseTime(
      field === "startOffset"
        ? previewAudio.startOffset
        : previewAudio.endOffset ?? previewAudio.duration,
    );

    applySectionAudio(
      {
        [field]: parsedTime,
      },
      wasClamped
        ? `Section ${field === "startOffset" ? "start" : "end"} was clamped to ${formattedValue}.`
        : `Section ${field === "startOffset" ? "start" : "end"} set to ${formattedValue}.`,
    );
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

  const moveLine = (lineId, direction) => {
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
    setProjectState((currentProject) => ({
      ...currentProject,
      lines: currentProject.lines.filter((line) => line.id !== lineId),
    }));
  };

  const addLine = () => {
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
    setSelectedTimingLineId(getDefaultTimingLineId(debugProbe.project.lines));
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
    setSelectedTimingLineId(line.id);
    setTapTimingSession((currentSession) =>
      currentSession.active
        ? {
            ...currentSession,
            cursorLineId: line.id,
          }
        : currentSession,
    );
    setTimingNotice({
      message: "",
      status: "idle",
    });

    if (Number.isFinite(line.start)) {
      setCurrentAudioTime(clampTimeToSection(line.start, projectState.audio));
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
      activeSubTab !== "timings" ||
      !isTransportPlaying ||
      !autoFollowEnabled ||
      suppressManualScrollRef.current
    ) {
      return;
    }

    setAutoFollowEnabled(false);
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
      setAudioUpload({
        asset: null,
        message:
          "Project imported. Re-upload the matching MP3 to restore waveform playback and export.",
        status: "idle",
      });
      setBackgroundUpload(createBackgroundUploadState(importedProject.background));
      setCurrentAudioTime(getInitialTransportTime(importedProject));
      setIsTransportPlaying(false);
      setSelectedTimingLineId(getDefaultTimingLineId(importedProject.lines));
      setAudioOffsetDrafts(buildAudioOffsetDrafts(importedProject.audio));
      setTimingDrafts({});
      setAutoFollowEnabled(true);
      setTimingNotice({
        message: "",
        status: "idle",
      });
      setAudioSectionNotice({
        message: "",
        status: "idle",
      });
      setAutoLyricsState(createIdleAutoLyricsState());
      setAutoTimingState(createIdleAutoTimingState());
      setWordTimingState(createIdleWordTimingState());
      setJsonImportError("");
      setJsonNotice({
        message: needsImageReupload
          ? "Project imported successfully. Re-upload the matching MP3 and background image when you're ready to preview or export."
          : needsVideoReupload
            ? "Project imported successfully. Re-upload the matching MP3 and background video when you're ready to preview or export."
            : "Project imported successfully. Re-upload the matching MP3 when you're ready to time or export.",
        status: "success",
      });
      setActiveSubTab("get-lyrics");
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
    setAudioUpload({
      asset: null,
      message: "Upload an MP3 to start a new project.",
      status: "idle",
    });
    setBackgroundUpload(createBackgroundUploadState(blankProject.background));
    setCurrentAudioTime(getInitialTransportTime(blankProject));
    setIsTransportPlaying(false);
    setSelectedTimingLineId(getDefaultTimingLineId(blankProject.lines));
    setAudioOffsetDrafts(buildAudioOffsetDrafts(blankProject.audio));
    setTimingDrafts({});
    setTranscription(null);
    setAutoFollowEnabled(true);
    setTimingNotice({ message: "", status: "idle" });
    setAudioSectionNotice({ message: "", status: "idle" });
    setAutoLyricsState(createIdleAutoLyricsState());
    setAutoTimingState(createIdleAutoTimingState());
    setWordTimingState(createIdleWordTimingState());
    setJsonImportError("");
    setJsonDraft("");
    setJsonNotice({
      message: "Started a new blank project.",
      status: "success",
    });
    setActiveSubTab("track-upload");
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
    setAudioUpload({
      asset: null,
      message: "Track cleared. Upload an MP3 to start again.",
      status: "idle",
    });
    setAudioOffsetDrafts(buildAudioOffsetDrafts(blankAudio));
    setCurrentAudioTime(0);
    setIsTransportPlaying(false);
    setTranscription(null);
    setAutoLyricsState(createIdleAutoLyricsState());
    setAutoTimingState(createIdleAutoTimingState());
    setWordTimingState(createIdleWordTimingState());
    setTimingNotice({ message: "", status: "idle" });
    setAudioSectionNotice({ message: "", status: "idle" });
  };

  // Clear only the lyric lines (and the board/timing/meaning state derived from
  // them) while leaving the loaded MP3 intact.
  const handleClearLyrics = () => {
    setProjectState((currentProject) => ({
      ...currentProject,
      lines: [],
    }));
    editorActions.clearSelectedWord();
    setSelectedTimingLineId(getDefaultTimingLineId([]));
    setTimingDrafts({});
    setRomanizeState({ message: "", status: "idle" });
    setWordMeaningsState({ message: "", status: "idle" });
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
      setAudioOffsetDrafts(buildAudioOffsetDrafts(nextAudio));
      setCurrentAudioTime(getInitialTransportTime(nextProject));
      setIsTransportPlaying(false);
      setSelectedTimingLineId(getDefaultTimingLineId(nextProject.lines));
      setTimingDrafts({});
      setTranscription(null);
      setAutoFollowEnabled(true);
      setTimingNotice({ message: "", status: "idle" });
      setAudioSectionNotice({ message: "", status: "idle" });
      setAutoLyricsState(createIdleAutoLyricsState());
      setAutoTimingState(createIdleAutoTimingState());
      setWordTimingState(createIdleWordTimingState());
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

  // POST to start (or, on 409, adopt the already-running job for this session +
  // asset) a background transcription job and return its jobId. The poll effect
  // drives progress + completion, decoupled from this request, so a dropped
  // connection (sleep / reload / navigation) no longer cancels the work.
  const startTranscriptionJob = async (body) => {
    const response = await fetch("/api/ai/transcribe", {
      body: JSON.stringify(body),
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const payload = await response.json().catch(() => ({}));

    if (response.status === 409 && typeof payload.jobId === "string") {
      return payload.jobId;
    }

    if (!response.ok || typeof payload.jobId !== "string" || !payload.jobId) {
      throw new Error(payload.error ?? "Transcription could not be started.");
    }

    return payload.jobId;
  };

  const beginTranscriptionTracking = (jobId, mode) => {
    // Fresh job: clear the idempotency guard so its result applies exactly once.
    appliedTranscribeJobIdRef.current = null;
    setTranscription({ appliedJobId: null, jobId, mode, status: "running" });
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

    const generatedWordState = buildWordTimingState(finalPayload);

    if (generatedWordState) {
      setWordTimingState(generatedWordState);
    }

    const nextLines = finalPayload.lines.map((line) =>
      createLine({
        confidence: String(line?.confidence ?? ""),
        end: Number.isFinite(line?.end) ? line.end : null,
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

    setProjectState((currentProject) => ({
      ...currentProject,
      lines: nextLines,
    }));
    setSelectedTimingLineId(getDefaultTimingLineId(nextLines));
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

  const handleGenerateAutoLyrics = async () => {
    if (!audioUpload.asset?.assetId || autoLyricsBusy || autoTimingBusy) {
      return;
    }

    if (autoLyricsLanguageRequirementMessage) {
      setAutoLyricsState({
        detail: "",
        lineCount: 0,
        message: autoLyricsLanguageRequirementMessage,
        status: "error",
        title: "Auto-lyrics unavailable",
      });
      return;
    }

    setAutoLyricsState({
      detail: "Preparing the uploaded MP3 for transcription.",
      lineCount: 0,
      message: "",
      status: "running",
      title: "Starting auto-lyrics",
    });

    try {
      // Romanize automatically except for languages already written in Latin
      // script, where a romanization would just duplicate the original.
      const includeRomanization =
        sourceLanguage !== "es" && sourceLanguage !== "fr";
      const jobId = await startTranscriptionJob({
        audio: projectState.audio,
        audioAssetId: audioUpload.asset.assetId,
        includeRomanization,
        otherLanguage: otherSourceLanguage.trim(),
        sourceLanguage,
      });

      beginTranscriptionTracking(jobId, "lyrics");
    } catch (error) {
      setAutoLyricsState({
        detail: "",
        lineCount: 0,
        message:
          error instanceof Error
            ? error.message
            : "Auto-lyrics generation failed unexpectedly.",
        status: "error",
        title: "Auto-lyrics failed",
      });
    }
  };

  // Apply a completed auto-time result by merging returned timing into the
  // existing lines (matched by id), preserving gloss/roman. An effect event so
  // the poll loop and mount recovery can both invoke it with the latest lines.
  const applyAutoTimingResult = useEffectEvent((payload) => {
    if (!Array.isArray(payload?.lines) || payload.lines.length === 0) {
      setAutoTimingState({
        detail: "",
        lineCount,
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

    const autoTimeWordState = buildWordTimingState(payload);

    if (autoTimeWordState) {
      setWordTimingState(autoTimeWordState);
    }

    const returnedLinesById = new Map(
      payload.lines
        .filter((line) => typeof line?.id === "string" && line.id)
        .map((line) => [line.id, line]),
    );

    setProjectState((currentProject) => ({
      ...currentProject,
      lines: currentProject.lines.map((line) => {
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
      }),
    }));
    setTimingDrafts((currentDrafts) => {
      const nextDrafts = { ...currentDrafts };

      for (const lineId of returnedLinesById.keys()) {
        delete nextDrafts[lineId];
      }

      return nextDrafts;
    });

    const timingSummary = buildPipelineTimingSummary(payload, lineCount);
    const firstUntimedLine = projectState.lines.find((line) => {
      const timedLine = returnedLinesById.get(line.id);

      return !Number.isFinite(timedLine?.start);
    });

    setSelectedTimingLineId(firstUntimedLine?.id ?? projectState.lines[0]?.id ?? null);
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

  const handleAutoTimeCurrentLines = async () => {
    if (!canAutoTimeLyrics) {
      setAutoTimingState({
        detail: "",
        lineCount,
        message: !audioUpload.asset?.assetId
          ? "Upload an MP3 before auto-timing lyrics."
          : otherSourceLanguageRequired
            ? "Type the source language to use Other."
            : "Add lyric lines before auto-timing.",
        status: "error",
        title: "Auto-time unavailable",
      });
      return;
    }

    setAutoTimingState({
      detail: "Running the unified lyric timing pipeline.",
      lineCount,
      message: "",
      status: "running",
      title: "Auto-timing lyrics",
    });
    setTimingNotice({
      message: "",
      status: "idle",
    });

    try {
      const jobId = await startTranscriptionJob({
        audio: projectState.audio,
        audioAssetId: audioUpload.asset.assetId,
        includeRomanization: false,
        lines: projectState.lines.map((line) => ({
          id: line.id,
          original: line.original,
          romanization: line.romanization,
          translation: line.translation,
        })),
        otherLanguage: otherSourceLanguage.trim(),
        sourceLanguage,
      });

      beginTranscriptionTracking(jobId, "timing");
    } catch (error) {
      setAutoTimingState({
        detail: "",
        lineCount,
        message:
          error instanceof Error ? error.message : "Auto-timing failed unexpectedly.",
        status: "error",
        title: "Auto-time failed",
      });
      setTimingNotice({
        message:
          error instanceof Error ? error.message : "Auto-timing failed unexpectedly.",
        status: "danger",
      });
    }
  };

  const handleRomanizeLyrics = async () => {
    const lines = projectState.lines
      .map((line) => ({ id: line.id, original: line.original }))
      .filter((line) => line.original.trim());

    if (lines.length === 0) {
      setRomanizeState({
        message: "Add lyric lines before romanizing.",
        status: "error",
      });
      return;
    }

    if (otherSourceLanguageRequired) {
      setRomanizeState({
        message: "Type the source language to use Other.",
        status: "error",
      });
      return;
    }

    setRomanizeState({ message: "Romanizing lyrics…", status: "running" });

    try {
      const response = await fetch("/api/ai/romanize", {
        body: JSON.stringify({
          lines,
          otherLanguage: otherSourceLanguage.trim(),
          sourceLanguage,
        }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error ?? "Romanizing lyrics failed.");
      }

      const romanizationById = new Map(
        (Array.isArray(payload.romanizations) ? payload.romanizations : [])
          .filter((entry) => typeof entry?.id === "string")
          .map((entry) => [
            entry.id,
            typeof entry.romanization === "string" ? entry.romanization : "",
          ]),
      );

      setProjectState((current) => ({
        ...current,
        lines: current.lines.map((line) =>
          romanizationById.has(line.id)
            ? { ...line, romanization: romanizationById.get(line.id) }
            : line,
        ),
      }));

      setRomanizeState({
        message: `Romanized ${romanizationById.size} line${
          romanizationById.size === 1 ? "" : "s"
        }.`,
        status: "success",
      });
    } catch (error) {
      setRomanizeState({
        message:
          error instanceof Error
            ? error.message
            : "Romanizing lyrics failed unexpectedly.",
        status: "error",
      });
    }
  };

  // Re-runnable per-word gloss/roman for the Word Board (P6 / T06.4). Fills the
  // merged words[] on each line; timing (start/end) is preserved/best-effort.
  const handleGenerateWordMeanings = async () => {
    const requestLines = projectState.lines
      .filter((line) => line.original.trim())
      .map((line) => ({
        id: line.id,
        original: line.original,
        romanization: line.romanization,
        translation: line.translation,
      }));

    if (requestLines.length === 0) {
      setWordMeaningsState({
        message: "Add lyric lines before generating word meanings.",
        status: "error",
      });
      return;
    }

    if (otherSourceLanguageRequired) {
      setWordMeaningsState({
        message: "Type the source language to use Other.",
        status: "error",
      });
      return;
    }

    setWordMeaningsState({
      message: "Generating word meanings…",
      status: "running",
    });

    try {
      const response = await fetch("/api/ai/word-meanings", {
        body: JSON.stringify({
          lines: requestLines,
          otherLanguage: otherSourceLanguage.trim(),
          sourceLanguage,
        }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error ?? "Generating word meanings failed.");
      }

      const wordsByLineId = new Map();
      (Array.isArray(payload.lines) ? payload.lines : []).forEach((entry) => {
        const requestLine = requestLines[entry?.line_number - 1];
        if (requestLine && Array.isArray(entry?.words)) {
          wordsByLineId.set(requestLine.id, entry.words);
        }
      });

      setProjectState((current) => ({
        ...current,
        lines: current.lines.map((line) =>
          wordsByLineId.has(line.id)
            ? {
                ...line,
                words: mergeMeaningWordsWithTiming(
                  line.words,
                  wordsByLineId.get(line.id),
                ),
              }
            : line,
        ),
      }));

      setWordMeaningsState({
        message: `Added word meanings to ${wordsByLineId.size} line${
          wordsByLineId.size === 1 ? "" : "s"
        }.`,
        status: "success",
      });
    } catch (error) {
      setWordMeaningsState({
        message:
          error instanceof Error
            ? error.message
            : "Generating word meanings failed unexpectedly.",
        status: "error",
      });
    }
  };

  const handleLoadWordTimings = async () => {
    if (!canLoadWordTimings) {
      setWordTimingState({
        duration: 0,
        errorMessage: !audioUpload.asset?.assetId
          ? "Upload an MP3 before loading word timings."
          : otherSourceLanguageRequired
            ? "Type the source language to use Other."
            : "Word timings are not available right now.",
        language: "",
        status: "error",
        words: [],
      });
      return;
    }

    setWordTimingState({
      duration: 0,
      errorMessage: "",
      language: "",
      status: "running",
      words: [],
    });

    try {
      const response = await fetch("/api/ai/word-timings", {
        body: JSON.stringify({
          audio: projectState.audio,
          audioAssetId: audioUpload.asset.assetId,
          otherLanguage: otherSourceLanguage.trim(),
          sourceLanguage,
        }),
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error ?? "Word timing transcription failed.");
      }

      const words = Array.isArray(payload.words)
        ? payload.words
            .map((word, index) => ({
              end: Number(word?.end),
              index,
              start: Number(word?.start),
              word: String(word?.word ?? "").trim(),
            }))
            .filter(
              (word) =>
                word.word &&
                Number.isFinite(word.start) &&
                Number.isFinite(word.end),
            )
        : [];

      setWordTimingState({
        duration: Number.isFinite(payload.duration) ? payload.duration : 0,
        errorMessage: "",
        language: typeof payload.language === "string" ? payload.language : "",
        status: "success",
        words,
      });
    } catch (error) {
      setWordTimingState({
        duration: 0,
        errorMessage:
          error instanceof Error
            ? error.message
            : "Word timing transcription failed unexpectedly.",
        language: "",
        status: "error",
        words: [],
      });
    }
  };

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
    setAudioSectionNotice({
      message: "",
      status: "idle",
    });
    setAutoLyricsState(createIdleAutoLyricsState());
    setAutoTimingState(createIdleAutoTimingState());
    setWordTimingState(createIdleWordTimingState());

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
      setAudioOffsetDrafts(buildAudioOffsetDrafts(nextAudio));
      setAudioUpload({
        asset: nextAsset,
        message: `${payload.name} uploaded successfully.`,
        status: "success",
      });
      setAudioSectionNotice(
        clampedCount > 0
          ? {
              message: `${clampedCount} timed ${
                clampedCount === 1 ? "line was" : "lines were"
              } clamped to the new track length.`,
              status: "warning",
            }
          : {
              message: "",
              status: "idle",
            },
      );
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

  const setTranscriptionProgress = useEffectEvent((mode, payload) => {
    const setState = mode === "timing" ? setAutoTimingState : setAutoLyricsState;

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

  const failTranscription = useEffectEvent((mode, message) => {
    const resolved = message || "Transcription failed unexpectedly.";

    if (mode === "timing") {
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
    const { jobId, mode } = transcription;

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
              mode,
              payload.error ??
                "That transcription is no longer available. Start it again.",
            );
            settle({ status: "error" });
            return;
          }

          throw new Error(
            payload.error ?? "Transcription status could not be refreshed.",
          );
        }

        if (payload.status === "done") {
          // Idempotent apply: the in-memory ref blocks repeated polls within a
          // session; the persisted appliedJobId blocks re-apply across remounts;
          // and the apply itself (replace lines / merge by id) is outcome-stable.
          if (appliedTranscribeJobIdRef.current !== jobId) {
            appliedTranscribeJobIdRef.current = jobId;

            if (mode === "timing") {
              applyAutoTimingResult(payload.result);
            } else {
              applyAutoLyricsResult(payload.result);
            }
          }

          settle({ appliedJobId: jobId, status: "done" });
          return;
        }

        if (payload.status === "error") {
          failTranscription(mode, payload.error);
          settle({ status: "error" });
          return;
        }

        consecutiveFailures = 0;
        setTranscriptionProgress(mode, payload);
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
            mode,
            error instanceof Error
              ? error.message
              : "Transcription status could not be refreshed.",
          );
          settle({ status: "error" });
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
      setSelectedTimingLineId(getDefaultTimingLineId(restoredProject.lines));
      setAudioOffsetDrafts(buildAudioOffsetDrafts(restoredProject.audio));
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
        const { appliedJobId, jobId, mode } = restored.transcription;

        appliedTranscribeJobIdRef.current = appliedJobId ?? null;

        if (appliedJobId && appliedJobId === jobId) {
          // Already applied before the remount — keep it settled, no re-poll.
          setTranscription({ appliedJobId, jobId, mode, status: "done" });
        } else {
          // Re-confirm with the server: the poll effect resumes, recovers a
          // completed result, or surfaces that the job failed/expired.
          const resumeState = {
            detail: "Reconnecting to the job that was still running.",
            lineCount: 0,
            message: "",
            status: "running",
            title: mode === "timing" ? "Auto-timing lyrics" : "Starting auto-lyrics",
          };

          if (mode === "timing") {
            setAutoTimingState(resumeState);
          } else {
            setAutoLyricsState(resumeState);
          }

          setTranscription({
            appliedJobId: appliedJobId ?? null,
            jobId,
            mode,
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
    setSelectedTimingLineId(getDefaultTimingLineId(debugProbe.project.lines));
    setDebugMarkEvents([]);
    setDebugProbeRunStatus("idle");
    setDebugWaveSurferOnsets(null);
    setActiveSubTab("timings");
    setTimingDrafts({});
    setAutoFollowEnabled(true);
    setJsonNotice({
      message: "",
      status: "idle",
    });
    setAudioSectionNotice({
      message: "",
      status: "idle",
    });
    setAutoLyricsState(createIdleAutoLyricsState());
    setAutoTimingState(createIdleAutoTimingState());
    setWordTimingState(createIdleWordTimingState());
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
      setSelectedTimingLineId(getDefaultTimingLineId(importedProject.lines));
      setActiveSubTab("timings");
      setTimingDrafts({});
      setAutoFollowEnabled(true);
      setJsonNotice({
        message: "",
        status: "idle",
      });
      setAudioSectionNotice({
        message: "",
        status: "idle",
      });
      setAutoLyricsState(createIdleAutoLyricsState());
      setAutoTimingState(createIdleAutoTimingState());
      setWordTimingState(createIdleWordTimingState());
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
    if (!tapTimingSession.active || activeSubTab === "timings") {
      return;
    }

    handleStopTapTimingEffect({
      message: null,
    });
  }, [activeSubTab, tapTimingSession.active]);

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
    if (activeSubTab !== "timings" || !autoFollowEnabled || !followTimingLineId) {
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
  }, [activeSubTab, autoFollowEnabled, followTimingLineId]);

  useEffect(() => {
    if (activeSubTab !== "timings" || isJsonModalOpen) {
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
    activeSubTab,
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
    setAudioOffsetDrafts(buildAudioOffsetDrafts(nextAudio));
    setCurrentAudioTime((currentTime) => clampTimeToSection(currentTime, nextAudio));

    if (clampedCount > 0) {
      setAudioSectionNotice({
        message: `${clampedCount} timed ${
          clampedCount === 1 ? "line was" : "lines were"
        } clamped when the browser confirmed the track duration.`,
        status: "warning",
      });
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

  const renderTrackUploadTab = () => (
    <div className="grid gap-4">
      <div
        className="rounded-[1.5rem] border border-dashed border-[var(--border)] bg-[var(--surface)] p-5 text-center"
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          handleAudioFile(event.dataTransfer.files?.[0] ?? null);
        }}
      >
        <p className="text-sm font-medium text-[var(--text)]">
          Drag an MP3 here or choose one from your computer
        </p>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Up to 25 MB. The uploaded track drives the persistent waveform dock,
          timing workflow, and later export.
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <button
            className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--on-accent)] transition hover:opacity-90"
            onClick={() => audioInputRef.current?.click()}
            type="button"
          >
            Choose MP3
          </button>
          <button
            className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isLoadingSample}
            onClick={() => {
              void handleLoadSample();
            }}
            type="button"
          >
            {isLoadingSample ? "Loading sample…" : "Load sample"}
          </button>
          {projectState.audio.name ||
          audioUpload.asset?.assetId ||
          audioObjectUrl ? (
            <button
              className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-sm font-medium text-[var(--danger)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isLoadingSample}
              onClick={handleClearAudio}
              type="button"
            >
              Clear track
            </button>
          ) : null}
          <StatusBadge
            tone={
              audioUpload.status === "success"
                ? "success"
                : audioUpload.status === "error"
                  ? "danger"
                  : "neutral"
            }
          >
            {audioUpload.status}
          </StatusBadge>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Track name</p>
          <p className="mt-2 text-sm font-medium text-[var(--muted)]">
            {projectState.audio.name || "No uploaded file yet"}
          </p>
        </div>
        <div className="rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Duration</p>
          <p className="mt-2 text-sm font-medium text-[var(--muted)]">
            {projectState.audio.duration > 0
              ? formatTime(projectState.audio.duration)
              : "Waiting for audio metadata"}
          </p>
        </div>
      </div>

      <div className="rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-[var(--muted)]">Section offsets</p>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
              Timing and preview now count from this section start. In the Timing
              tab, <span className="text-[var(--muted)]">00:00.00</span> maps to track
              time <span className="text-[var(--muted)]">{formatPreciseTime(sectionBounds.startOffset)}</span>.
            </p>
          </div>
          <StatusBadge tone={sectionWithinLimit ? "success" : "danger"}>
            {sectionWithinLimit ? "Within 6:00" : "Trim to 6:00"}
          </StatusBadge>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block rounded-[1rem] border border-[var(--border)] bg-[var(--surface)] px-4 py-4">
            <span className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">
              Start offset
            </span>
            <input
              className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!hasAudioDuration}
              onBlur={() => commitAudioOffsetDraft("startOffset")}
              onChange={(event) =>
                setAudioOffsetDrafts((currentDrafts) => ({
                  ...currentDrafts,
                  startOffset: event.target.value,
                }))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitAudioOffsetDraft("startOffset");
                }

                if (event.key === "Escape") {
                  event.preventDefault();
                  resetAudioOffsetDraft("startOffset");
                }
              }}
              placeholder="00:00.00"
              type="text"
              value={audioOffsetDrafts.startOffset}
            />
          </label>

          <label className="block rounded-[1rem] border border-[var(--border)] bg-[var(--surface)] px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">
                End offset (optional)
              </span>
              <button
                className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-[0.65rem] font-medium uppercase tracking-[0.22em] text-[var(--muted)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!hasAudioDuration}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setAudioOffsetDrafts((currentDrafts) => ({
                    ...currentDrafts,
                    endOffset: "",
                  }));
                  applySectionAudio(
                    {
                      endOffset: null,
                    },
                    "Section end reset to the full track.",
                  );
                }}
                type="button"
              >
                Use track end
              </button>
            </div>
            <input
              className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!hasAudioDuration}
              onBlur={() => commitAudioOffsetDraft("endOffset")}
              onChange={(event) =>
                setAudioOffsetDrafts((currentDrafts) => ({
                  ...currentDrafts,
                  endOffset: event.target.value,
                }))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitAudioOffsetDraft("endOffset");
                }

                if (event.key === "Escape") {
                  event.preventDefault();
                  resetAudioOffsetDraft("endOffset");
                }
              }}
              placeholder="Track end"
              type="text"
              value={audioOffsetDrafts.endOffset}
            />
          </label>
        </div>

        <p className="mt-3 text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
          Press Enter or click away to apply. Leave the end blank to use the full
          track.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-[1rem] border border-[var(--border)] bg-[var(--surface)] px-4 py-4">
            <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">Section start</p>
            <p className="mt-2 text-sm font-medium text-[var(--muted)]">
              {formatPreciseTime(sectionBounds.startOffset)}
            </p>
          </div>
          <div className="rounded-[1rem] border border-[var(--border)] bg-[var(--surface)] px-4 py-4">
            <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">Section end</p>
            <p className="mt-2 text-sm font-medium text-[var(--muted)]">
              {projectState.audio.endOffset == null
                ? `Track end (${formatPreciseTime(sectionBounds.endOffset)})`
                : formatPreciseTime(sectionBounds.endOffset)}
            </p>
          </div>
          <div className="rounded-[1rem] border border-[var(--border)] bg-[var(--surface)] px-4 py-4">
            <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">Section length</p>
            <p className="mt-2 text-sm font-medium text-[var(--muted)]">
              {formatPreciseTime(sectionDuration)}
            </p>
          </div>
        </div>

        {audioSectionNotice.message ? (
          <p
            className={`mt-4 text-sm leading-6 ${
              audioSectionNotice.status === "danger"
                ? "text-[var(--danger)]"
                : audioSectionNotice.status === "warning"
                  ? "text-[var(--accent)]"
                  : "text-[var(--muted)]"
            }`}
          >
            {audioSectionNotice.message}
          </p>
        ) : null}

        {!hasAudioDuration ? (
          <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
            Upload or import track metadata first to unlock section offsets.
          </p>
        ) : null}

        {!sectionWithinLimit ? (
          <p className="mt-4 text-sm leading-6 text-[var(--danger)]">
            Export stays blocked: this section is {formatPreciseTime(sectionDuration)}.
            Move the start forward or trim the end until it is {formatPreciseTime(
              MAX_SECTION_DURATION_SECONDS,
            )} or shorter.
          </p>
        ) : null}
      </div>

      <div className="rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-[var(--muted)]">Upload status</p>
            <p
              className={`mt-2 text-sm leading-6 ${
                audioUpload.status === "error"
                  ? "text-[var(--danger)]"
                  : audioUpload.status === "success"
                    ? "text-[var(--muted)]"
                    : "text-[var(--muted)]"
              }`}
            >
              {audioUpload.message}
            </p>
          </div>
          <div className="grid gap-2 text-right">
            <span className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
              Session asset
            </span>
            <span className="text-sm font-medium text-[var(--muted)]">
              {audioUpload.asset?.assetId ?? "Pending"}
            </span>
            <span className="text-xs text-[var(--muted)]">
              {audioUpload.asset?.sizeBytes
                ? formatBytes(audioUpload.asset.sizeBytes)
                : "No upload yet"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  const renderGetLyricsTab = () => (
    <div className="grid gap-4">
      <div className="rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-[var(--muted)]">Auto-lyrics</p>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Transcribe the uploaded MP3 and replace the current lyric lines with
              English translations.
            </p>
          </div>
          <StatusBadge
            tone={
              autoLyricsState.status === "running"
                ? "accent"
                : autoLyricsState.status === "success"
                  ? "success"
                  : autoLyricsState.status === "error"
                    ? "danger"
                    : "neutral"
            }
          >
            {autoLyricsState.status === "running"
              ? "Running"
              : autoLyricsState.status}
          </StatusBadge>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="grid gap-3">
            <label className="block">
              <span className="text-[10px] font-medium uppercase tracking-[0.24em] text-[var(--muted)]">
                Source language
              </span>
              <select
                className="mt-2 w-full min-w-[11rem] rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none disabled:cursor-not-allowed disabled:opacity-50"
                disabled={autoLyricsBusy || autoTimingBusy}
                onChange={(event) => {
                  setSourceLanguage(event.target.value);
                  setWordTimingState(createIdleWordTimingState());
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
                }}
                value={sourceLanguage}
              >
                <option disabled value="">
                  Select language
                </option>
                {SOURCE_LANGUAGE_OPTIONS.map((languageOption) => (
                  <option key={languageOption.id} value={languageOption.id}>
                    {languageOption.label}
                  </option>
                ))}
              </select>
            </label>

            {sourceLanguage === "other" ? (
              <label className="block">
                <span className="text-[10px] font-medium uppercase tracking-[0.24em] text-[var(--muted)]">
                  Other language
                </span>
                <input
                  className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={autoLyricsBusy || autoTimingBusy}
                  onChange={(event) => {
                    setOtherSourceLanguage(event.target.value);
                    setWordTimingState(createIdleWordTimingState());
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
                  }}
                  placeholder="e.g. Tamil"
                  type="text"
                  value={otherSourceLanguage}
                />
              </label>
            ) : null}
          </div>

          <button
            className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--on-accent)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!canGenerateAutoLyrics}
            onClick={() => {
              void handleGenerateAutoLyrics();
            }}
            title={
              canGenerateAutoLyrics
                ? undefined
                : !audioUpload.asset?.assetId
                  ? "Upload an MP3 before generating and timing lyrics."
                  : autoLyricsLanguageRequirementMessage || undefined
            }
            type="button"
          >
            {autoLyricsBusy ? "Generating & timing..." : "Generate & time lyrics"}
          </button>
        </div>

        <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
          Romanization is added automatically for non-Latin scripts.
        </p>

        {autoLyricsState.status !== "idle" ? (
          <div
            className={`mt-4 rounded-[1rem] border px-4 py-3 ${
              autoLyricsState.status === "error"
                ? "border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]"
                : autoLyricsState.status === "success"
                  ? "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]"
                  : "border-[var(--accent)] bg-[var(--surface-active)] text-[var(--accent)]"
            }`}
          >
            <p className="text-sm font-medium">{autoLyricsState.title}</p>
            {autoLyricsState.message ? (
              <p className="mt-1 text-sm leading-6">{autoLyricsState.message}</p>
            ) : null}
            {autoLyricsState.detail ? (
              <p className="mt-1 text-sm leading-6 opacity-80">
                {autoLyricsState.detail}
              </p>
            ) : null}
          </div>
        ) : null}

        {!audioUpload.asset?.assetId ? (
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            Upload an MP3 first to enable generation.
          </p>
        ) : autoLyricsLanguageRequirementMessage ? (
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            {autoLyricsLanguageRequirementMessage}
          </p>
        ) : null}
      </div>

      <div className="rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
        <p className="text-sm font-medium text-[var(--muted)]">Lyrics data</p>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Import a project JSON to load existing lyrics and timings, or export the
          current project to a file.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            className="rounded-full bg-[var(--surface-2)] px-4 py-2 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)]"
            onClick={openJsonImport}
            type="button"
          >
            Import JSON
          </button>
          <button
            className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)]"
            onClick={handleProjectExport}
            type="button"
          >
            Export JSON
          </button>
          <button
            className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-sm font-medium text-[var(--danger)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={projectState.lines.length === 0}
            onClick={handleClearLyrics}
            type="button"
          >
            Clear lyrics
          </button>
        </div>
        {showInlineJsonNotice ? (
          <div className="mt-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm leading-6 text-[var(--text)]">
            {jsonNotice.message}
          </div>
        ) : null}
      </div>
    </div>
  );

  const renderLyricsTab = () => (
    <div className="grid gap-3">
      <div className="rounded-[1.15rem] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm leading-6 text-[var(--muted)]">
        Edit the original text, romanization, and translation for each line. The
        Timings sub-tab handles tap-along and auto-timing.
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-[1.15rem] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
        <button
          className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--on-accent)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          disabled={romanizeState.status === "running"}
          onClick={() => {
            void handleRomanizeLyrics();
          }}
          type="button"
        >
          {romanizeState.status === "running"
            ? "Romanizing…"
            : "Romanize lyrics"}
        </button>
        <span className="text-xs text-[var(--muted)]">
          Adds a Latin-script reading (pinyin, romaji, IAST…) under each line
          using the selected source language.
        </span>
        {romanizeState.message ? (
          <p
            className={`w-full text-xs leading-5 ${
              romanizeState.status === "error"
                ? "text-[var(--danger)]"
                : romanizeState.status === "success"
                  ? "text-[var(--muted)]"
                  : "text-[var(--accent)]"
            }`}
          >
            {romanizeState.message}
          </p>
        ) : null}
        <button
          className="rounded-full border border-[var(--accent)] bg-[var(--surface-active)] px-4 py-2 text-sm font-semibold text-[var(--accent)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          disabled={wordMeaningsState.status === "running"}
          onClick={() => {
            void handleGenerateWordMeanings();
          }}
          type="button"
        >
          {wordMeaningsState.status === "running"
            ? "Generating…"
            : "Generate word meanings"}
        </button>
        <span className="text-xs text-[var(--muted)]">
          Fills per-word meanings + romanization for the Word Board, using the
          selected source language.
        </span>
        {wordMeaningsState.message ? (
          <p
            className={`w-full text-xs leading-5 ${
              wordMeaningsState.status === "error"
                ? "text-[var(--danger)]"
                : wordMeaningsState.status === "success"
                  ? "text-[var(--muted)]"
                  : "text-[var(--accent)]"
            }`}
          >
            {wordMeaningsState.message}
          </p>
        ) : null}
      </div>

      {projectState.lines.map((line, index) => (
        <div
          className="rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4"
          key={line.id}
        >
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-medium text-[var(--muted)]">Line {index + 1}</p>
            <div className="flex items-center gap-2">
              <button
                className="rounded-full bg-[var(--surface-2)] px-3 py-1.5 text-xs font-medium uppercase tracking-[0.24em] text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                onClick={() => moveLine(line.id, -1)}
                type="button"
              >
                Up
              </button>
              <button
                className="rounded-full bg-[var(--surface-2)] px-3 py-1.5 text-xs font-medium uppercase tracking-[0.24em] text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                onClick={() => moveLine(line.id, 1)}
                type="button"
              >
                Down
              </button>
              <button
                className="rounded-full bg-[var(--danger-soft)] px-3 py-1.5 text-xs font-medium uppercase tracking-[0.24em] text-[var(--danger)] transition hover:bg-[var(--danger-soft)]"
                onClick={() => deleteLine(line.id)}
                type="button"
              >
                Delete
              </button>
            </div>
          </div>

          <div className="mt-3 grid gap-2">
            <label className="block">
              <span className="block text-right text-[9px] font-medium uppercase tracking-[0.18em] text-[var(--muted)]">
                Original
              </span>
              <AutoGrowTextarea
                className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none"
                onChange={(event) =>
                  updateLine(line.id, { original: event.target.value })
                }
                value={line.original}
              />
            </label>

            <label className="block">
              <span className="block text-right text-[9px] font-medium uppercase tracking-[0.18em] text-[var(--muted)]">
                Romanization
              </span>
              <AutoGrowTextarea
                className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm italic text-[var(--muted)] outline-none"
                onChange={(event) =>
                  updateLine(line.id, { romanization: event.target.value })
                }
                placeholder="Romanized text (optional)"
                value={line.romanization ?? ""}
              />
            </label>

            <label className="block">
              <span className="block text-right text-[9px] font-medium uppercase tracking-[0.18em] text-[var(--muted)]">
                Translation
              </span>
              <AutoGrowTextarea
                className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none"
                onChange={(event) =>
                  updateLine(line.id, {
                    translation: event.target.value,
                  })
                }
                value={line.translation}
              />
            </label>

            <label className="block">
              <span className="block text-right text-[9px] font-medium uppercase tracking-[0.18em] text-[var(--muted)]">
                Start time (track seconds)
              </span>
              <input
                className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none"
                min="0"
                onChange={(event) =>
                  updateLine(line.id, {
                    start:
                      event.target.value === "" ? null : Number(event.target.value),
                  })
                }
                step="0.05"
                type="number"
                value={line.start ?? ""}
              />
            </label>
          </div>
        </div>
      ))}

      <button
        className="rounded-[1.25rem] border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-4 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--surface)]"
        onClick={addLine}
        type="button"
      >
        Add lyric line
      </button>
    </div>
  );

  const timingControlsVisible = timingControlsOpen || tapTimingSession.active;

  const renderTimingTab = () => (
    <div className="grid gap-3">
      {timingControlsVisible ? (
      <div className="sticky top-0 z-10 rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface)] px-3 py-3 shadow-[0_18px_40px_rgba(2,6,23,0.24)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
              autoFollowEnabled
                ? "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-hover)]"
                : "border-[var(--accent)] bg-[var(--surface-active)] text-[var(--accent)] hover:bg-[var(--surface-hover)]"
            }`}
            onClick={handleJumpToCurrentLine}
            type="button"
          >
            ↩ Jump
          </button>
          <span
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
              autoFollowEnabled
                ? "border-[var(--accent)] bg-[var(--surface-active)] text-[var(--accent)]"
                : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                autoFollowEnabled ? "bg-[var(--accent)]" : "bg-[var(--surface-2)]"
              }`}
            />
            {autoFollowEnabled ? "Auto-follow" : "Follow paused"}
          </span>
        </div>

        {tapTimingSession.active ? (
          <div className="mt-3 grid gap-3 border-t border-[var(--border)] pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-[var(--muted)]">
                <span className="rounded-full border border-[var(--accent)] bg-[var(--surface-active)] px-2.5 py-1 text-[var(--accent)]">
                  Line {tapTimingProgress.current} of {tapTimingProgress.total}
                </span>
                {tapTimingSession.paused ? (
                  <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-[var(--muted)]">
                    Paused
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {tapTimingSession.paused ? (
                  <button
                    className="rounded-full bg-[var(--accent)] px-3 py-1.5 text-[11px] font-semibold text-[var(--on-accent)] transition hover:opacity-90"
                    onClick={() => {
                      void resumeTapTimingSession();
                    }}
                    type="button"
                  >
                    Resume
                  </button>
                ) : (
                  <button
                    className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[11px] font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)]"
                    onClick={pauseTapTimingSession}
                    type="button"
                  >
                    Pause
                  </button>
                )}
                <button
                  className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[11px] font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={tapTimingSession.history.length === 0}
                  onClick={undoLastTap}
                  type="button"
                >
                  Undo
                </button>
                <button
                  className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[11px] font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)]"
                  onClick={() => stopTapTimingSession()}
                  type="button"
                >
                  Stop
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end lg:grid-cols-1">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.28em] text-[var(--muted)]">
                  Current
                </p>
                <p className="mt-1 truncate text-base font-semibold text-[var(--text)]">
                  {tapTimingCursorLine?.original ||
                    `Line ${tapTimingProgress.current}`}
                </p>
                <p className="mt-1 truncate text-sm text-[var(--muted)]">
                  {tapTimingCursorLine?.translation || "No translation"}
                </p>
                <p className="mt-2 truncate text-xs text-[var(--muted)]">
                  Next: {tapTimingNextLine?.original || "Complete"}
                </p>
              </div>

              <button
                className="min-h-14 rounded-xl bg-[var(--accent)] px-6 py-4 text-sm font-bold text-[var(--on-accent)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 sm:min-w-44"
                disabled={tapTimingSession.paused}
                onClick={tapNextTimingLine}
                type="button"
              >
                Tap next line
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 grid gap-3 border-t border-[var(--border)] pt-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end lg:grid-cols-1 lg:items-stretch">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
                <span>
                  Line {tapTimingStartLineNumber ?? "—"} of {lineCount}
                </span>
                <span>
                  {timedLineCount} timed · {lineCount - timedLineCount} untimed
                </span>
              </div>
              <p className="mt-1 truncate text-sm font-medium text-[var(--muted)]">
                {tapTimingStartLine?.original || "No lyric lines"}
              </p>
              {tapTimingStartDisabledReason ? (
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {tapTimingStartDisabledReason}
                </p>
              ) : null}
              {autoTimingState.status !== "idle" ? (
                <p
                  className={`mt-2 text-xs leading-5 ${
                    autoTimingState.status === "error"
                      ? "text-[var(--danger)]"
                      : autoTimingState.status === "success"
                        ? "text-[var(--muted)]"
                        : "text-[var(--accent)]"
                  }`}
                >
                  {autoTimingState.title ? `${autoTimingState.title}. ` : ""}
                  {autoTimingState.message || autoTimingState.detail}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <button
                className="rounded-full bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--on-accent)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
                disabled={!canAutoTimeLyrics}
                onClick={() => {
                  void handleAutoTimeCurrentLines();
                }}
                type="button"
              >
                {autoTimingBusy ? "Auto-timing..." : "Auto-time from audio"}
              </button>
              <button
                className="rounded-full border border-[var(--border)] px-4 py-2.5 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-45"
                disabled={!canStartTapTiming || autoTimingBusy}
                onClick={() => {
                  void startTapTimingSession();
                }}
                type="button"
              >
                Start tap timing
              </button>
            </div>
          </div>
        )}

        {timingNotice.message ? (
          <p
            className={`mt-3 text-sm leading-6 ${
              timingNotice.status === "danger" ? "text-[var(--danger)]" : "text-[var(--muted)]"
            }`}
          >
            {timingNotice.message}
          </p>
        ) : null}
      </div>
      ) : null}

      <div className="grid gap-2">
        {projectState.lines.map((line, index) => (
          <TimingRow
            displayTime={formatSectionRelativeTime(line.start, projectState.audio)}
            index={index}
            isActive={activeTimingLineId === line.id}
            isHeard={heardLine?.id === line.id}
            key={line.id}
            line={line}
            onClear={() => {
              clearTimingLineStart(line.id);
              setTimingNotice({
                message: `Cleared line ${index + 1}.`,
                status: "success",
              });
            }}
            onDraftChange={(lineId, nextDraft) => {
              setSelectedTimingLineId(lineId);
              setTimingDrafts((currentDrafts) => ({
                ...currentDrafts,
                [lineId]: nextDraft,
              }));
            }}
            onDraftCommit={handleTimingDraftCommit}
            onDraftReset={handleTimingDraftReset}
            onMark={
              tapTimingSession.active ? tapNextTimingLine : handleMarkCurrentLine
            }
            onNudge={handleNudgeSelectedLine}
            onSelect={() => handleTimingLineSelect(line)}
            rowRef={(node) => {
              if (node) {
                timingRowRefs.current.set(line.id, node);
                return;
              }

              timingRowRefs.current.delete(line.id);
            }}
            timeValue={
              timingDrafts[line.id] ??
              (Number.isFinite(line.start)
                ? formatSectionRelativeTime(line.start, projectState.audio)
                : "")
            }
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-[var(--muted)]">
        <p>
          Press <span className="text-[var(--muted)]">Enter</span> or tap{" "}
          <span className="text-[var(--muted)]">Mark</span> to time the active line.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {timedLineCount} timed · {lineCount - timedLineCount} untimed
          </span>
          <button
            className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--muted)]"
            onClick={handleClearAllTimes}
            type="button"
          >
            Clear all
          </button>
        </div>
      </div>
    </div>
  );

  const renderStyleTab = () => (
    <div className="grid gap-4">
      <div className="rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
        <p className="text-sm font-medium text-[var(--muted)]">Presets</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {stylePresetEntries.map(([presetId, preset]) => {
            const selected = projectState.style.preset === presetId;

            return (
              <button
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  selected
                    ? "bg-[var(--accent)] text-[var(--on-accent)]"
                    : "bg-[var(--surface-2)] text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                }`}
                key={presetId}
                onClick={() => applyPreset(presetId)}
                type="button"
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      <label className="block rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
        <span className="text-sm font-medium text-[var(--muted)]">Font</span>
        <select
          className="mt-4 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none"
          onChange={(event) =>
            updateStyle({ font: event.target.value, preset: "custom" })
          }
          value={projectState.style.font}
        >
          {FONT_OPTIONS.map((fontOption) => (
            <option key={fontOption.id} value={fontOption.id}>
              {fontOption.label}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <StyleSlider
          label="Original size"
          max={92}
          min={40}
          onChange={(event) =>
            updateStyle({
              originalSize: Number(event.target.value),
              preset: "custom",
            })
          }
          step={1}
          value={projectState.style.originalSize}
        />
        <StyleSlider
          label="Translation size"
          max={64}
          min={26}
          onChange={(event) =>
            updateStyle({
              translationSize: Number(event.target.value),
              preset: "custom",
            })
          }
          step={1}
          value={projectState.style.translationSize}
        />
        <StyleSlider
          label="Romanization size"
          max={64}
          min={22}
          onChange={(event) =>
            updateStyle({
              romanizationSize: Number(event.target.value),
              preset: "custom",
            })
          }
          step={1}
          value={projectState.style.romanizationSize ?? 40}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <StyleColorField
          label="Primary color"
          onChange={(event) =>
            updateStyle({ color: event.target.value, preset: "custom" })
          }
          value={projectState.style.color}
        />
        <StyleColorField
          label="Translation color"
          onChange={(event) =>
            updateStyle({
              translationColor: event.target.value,
              preset: "custom",
            })
          }
          value={projectState.style.translationColor}
        />
        <StyleColorField
          label="Romanization color"
          onChange={(event) =>
            updateStyle({
              romanizationColor: event.target.value,
              preset: "custom",
            })
          }
          value={projectState.style.romanizationColor ?? "#C9D4E0"}
        />
      </div>

      <StyleSlider
        label="Vertical position"
        max={0.9}
        min={0.58}
        onChange={(event) =>
          updateStyle({
            verticalPosition: Number(event.target.value),
            preset: "custom",
          })
        }
        step={0.01}
        value={projectState.style.verticalPosition}
      />

      <StyleSlider
        label="Lyric lead-in"
        max={MAX_LYRIC_LEAD_IN_MS}
        min={MIN_LYRIC_LEAD_IN_MS}
        onChange={(event) =>
          updateTiming({
            lyricLeadInMs: Number(event.target.value),
          })
        }
        step={10}
        value={projectState.timing?.lyricLeadInMs ?? DEFAULT_LYRIC_LEAD_IN_MS}
        valueLabel={`${
          projectState.timing?.lyricLeadInMs ?? DEFAULT_LYRIC_LEAD_IN_MS
        } ms`}
      />

      <div className="rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-[var(--muted)]">Shadow</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Keep lyrics legible over bright or busy backgrounds.
            </p>
          </div>
          <button
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              projectState.style.shadow.enabled
                ? "bg-[var(--accent)] text-[var(--on-accent)]"
                : "bg-[var(--surface-2)] text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            }`}
            onClick={() =>
              updateShadow({
                enabled: !projectState.style.shadow.enabled,
              })
            }
            type="button"
          >
            {projectState.style.shadow.enabled ? "On" : "Off"}
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <StyleSlider
            label="Blur"
            max={24}
            min={0}
            onChange={(event) =>
              updateShadow({
                blur: Number(event.target.value),
              })
            }
            step={1}
            value={projectState.style.shadow.blur}
          />
          <StyleSlider
            label="Opacity"
            max={1}
            min={0}
            onChange={(event) =>
              updateShadow({
                opacity: Number(event.target.value),
              })
            }
            step={0.05}
            value={projectState.style.shadow.opacity}
          />
        </div>
      </div>
    </div>
  );

  const renderBackgroundTab = () => (
    <div className="grid gap-4">
      <div className="rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
        <p className="text-sm font-medium text-[var(--muted)]">Background mode</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {["solid", "gradient", "image", "video"].map((backgroundType) => {
            const selected = projectState.background.type === backgroundType;

            return (
              <button
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  selected
                    ? "bg-[var(--accent)] text-[var(--on-accent)]"
                    : "bg-[var(--surface-2)] text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                }`}
                key={backgroundType}
                onClick={() => selectBackgroundType(backgroundType)}
                type="button"
              >
                {backgroundType === "solid"
                  ? "Solid"
                  : backgroundType === "gradient"
                    ? "Gradient"
                    : backgroundType === "image"
                      ? "Image"
                      : "Video loop"}
              </button>
            );
          })}
        </div>
      </div>

      {projectState.background.type === "solid" ? (
        <StyleColorField
          label="Solid color"
          onChange={(event) =>
            updateBackground({
              color: event.target.value,
              type: "solid",
            })
          }
          value={projectState.background.color}
        />
      ) : null}

      {projectState.background.type === "gradient" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <StyleColorField
              label="Gradient from"
              onChange={(event) =>
                updateBackground((currentBackground) => ({
                  ...currentBackground,
                  type: "gradient",
                  gradient: {
                    ...currentBackground.gradient,
                    from: event.target.value,
                  },
                }))
              }
              value={projectState.background.gradient.from}
            />
            <StyleColorField
              label="Gradient to"
              onChange={(event) =>
                updateBackground((currentBackground) => ({
                  ...currentBackground,
                  type: "gradient",
                  gradient: {
                    ...currentBackground.gradient,
                    to: event.target.value,
                  },
                }))
              }
              value={projectState.background.gradient.to}
            />
          </div>

          <StyleSlider
            label="Gradient angle"
            max={360}
            min={0}
            onChange={(event) =>
              updateBackground((currentBackground) => ({
                ...currentBackground,
                type: "gradient",
                gradient: {
                  ...currentBackground.gradient,
                  angle: Number(event.target.value),
                },
              }))
            }
            step={1}
            value={projectState.background.gradient.angle}
          />
        </>
      ) : null}

      {isBackgroundMediaType(projectState.background.type) ? (
        <>
          <div
            className="rounded-[1.25rem] border border-dashed border-[var(--border)] bg-[var(--surface)] p-5 text-center"
            onDragOver={(event) => {
              event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (projectState.background.type === "video") {
                void handleBackgroundVideoFile(event.dataTransfer.files?.[0] ?? null);
                return;
              }

              void handleBackgroundImageFile(event.dataTransfer.files?.[0] ?? null);
            }}
          >
            <p className="text-sm font-medium text-[var(--text)]">
              {activeBackgroundUploadCopy.uploadLabel}
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {activeBackgroundUploadCopy.helperText}
            </p>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <button
                className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--on-accent)] transition hover:opacity-90"
                onClick={() =>
                  projectState.background.type === "video"
                    ? backgroundVideoInputRef.current?.click()
                    : backgroundImageInputRef.current?.click()
                }
                type="button"
              >
                {activeBackgroundUploadCopy.buttonLabel}
              </button>
              <StatusBadge
                tone={
                  activeBackgroundUpload.status === "success"
                    ? "success"
                    : activeBackgroundUpload.status === "error"
                      ? "danger"
                      : "neutral"
                }
              >
                {activeBackgroundUpload.status}
              </StatusBadge>
            </div>
          </div>

          <StyleSlider
            label="Legibility scrim"
            max={0.8}
            min={0}
            onChange={(event) =>
              updateBackground((currentBackground) => ({
                ...currentBackground,
                scrim: {
                  ...currentBackground.scrim,
                  opacity: Number(event.target.value),
                },
              }))
            }
            step={0.05}
            value={projectState.background.scrim.opacity}
          />

          <div className="rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-[var(--muted)]">
                  {activeBackgroundUploadCopy.statusLabel}
                </p>
                <p
                  className={`mt-2 text-sm leading-6 ${
                    activeBackgroundUpload.status === "error"
                      ? "text-[var(--danger)]"
                      : activeBackgroundUpload.status === "success"
                        ? "text-[var(--muted)]"
                        : "text-[var(--muted)]"
                  }`}
                >
                  {activeBackgroundUpload.message}
                </p>
              </div>
              <div className="grid gap-2 text-right">
                <span className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                  Session asset
                </span>
                <span className="text-sm font-medium text-[var(--muted)]">
                  {activeBackgroundAsset?.assetId ?? "Pending"}
                </span>
                <span className="text-xs text-[var(--muted)]">
                  {activeBackgroundAsset?.sizeBytes
                    ? formatBytes(activeBackgroundAsset.sizeBytes)
                    : projectState.background.assetName || "No upload yet"}
                </span>
              </div>
            </div>

            <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
              Current scrim opacity:{" "}
              <span className="font-mono text-[var(--muted)]">
                {Math.round((projectState.background.scrim.opacity ?? 0) * 100)}%
              </span>
              . Lower values keep more of the background visible; higher values
              push lyrics forward.
            </p>

            {!activeBackgroundAsset ? (
              <p className="mt-4 text-sm leading-6 text-[var(--accent)]">
                {activeBackgroundUploadCopy.missingMessage}
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );

  const renderWordsTab = () => (
    <div className="grid gap-3">
      <div className="rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-[var(--muted)]">Word timings</p>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              The word-level transcript from your last Generate or Auto-time run.
              Use Load words to fetch it fresh from the uploaded MP3.
            </p>
          </div>
          <button
            className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--on-accent)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!canLoadWordTimings}
            onClick={() => {
              void handleLoadWordTimings();
            }}
            type="button"
          >
            {wordTimingBusy ? "Loading..." : "Load words"}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-[var(--muted)]">
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1">
            {wordTimingState.words.length} words
          </span>
          {wordTimingState.language ? (
            <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1">
              {wordTimingState.language}
            </span>
          ) : null}
          {Number.isFinite(wordTimingState.duration) && wordTimingState.duration > 0 ? (
            <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1">
              {formatPreciseTime(wordTimingState.duration)}
            </span>
          ) : null}
        </div>

        {!audioUpload.asset?.assetId ? (
          <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
            Upload an MP3 first to load word timings.
          </p>
        ) : otherSourceLanguageRequired ? (
          <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
            Type the source language to use Other.
          </p>
        ) : null}

        {wordTimingState.status === "error" ? (
          <p className="mt-4 text-sm leading-6 text-[var(--danger)]">
            {wordTimingState.errorMessage}
          </p>
        ) : null}
      </div>

      {wordTimingState.words.length ? (
        <div className="overflow-hidden rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface)]">
          <div className="grid grid-cols-[4rem_minmax(0,1fr)_5rem_5rem_5rem] gap-2 border-b border-[var(--border)] px-3 py-2 text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
            <span>#</span>
            <span>Word</span>
            <span>Start</span>
            <span>End</span>
            <span>Dur</span>
          </div>
          <div className="max-h-[58vh] overflow-y-auto">
            {wordTimingState.words.map((word) => (
              <div
                className="grid grid-cols-[4rem_minmax(0,1fr)_5rem_5rem_5rem] gap-2 border-b border-[var(--border)] px-3 py-2 font-mono text-[11px] text-[var(--muted)] last:border-b-0"
                key={`${word.index}-${word.start}-${word.word}`}
              >
                <span className="text-[var(--muted)]">{word.index + 1}</span>
                <span className="truncate font-sans text-sm text-[var(--muted)]">
                  {word.word}
                </span>
                <span>{formatPreciseTime(word.start)}</span>
                <span>{formatPreciseTime(word.end)}</span>
                <span>{Math.max(0, word.end - word.start).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : wordTimingState.status === "running" ? (
        <div className="rounded-[1.25rem] border border-[var(--accent)] bg-[var(--surface-active)] px-4 py-4 text-sm text-[var(--accent)]">
          Loading word timings from the uploaded MP3.
        </div>
      ) : null}
    </div>
  );

  const renderActiveTab = () => {
    switch (activeSubTab) {
      case "track-upload":
        return renderTrackUploadTab();
      case "get-lyrics":
        return renderGetLyricsTab();
      case "edit-text":
        return renderLyricsTab();
      case "timings":
        return renderTimingTab();
      case "words":
        return renderWordsTab();
      case "text-display":
        return renderStyleTab();
      case "background":
        return renderBackgroundTab();
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

  return (
    <EditorProvider value={editor}>
    <div className="app-frame relative flex h-dvh flex-col overflow-hidden bg-[var(--page)] text-[var(--text)]">
      <div
        className="app-responsive mx-auto flex h-full w-full max-w-[1720px] flex-col lg:gap-3 lg:px-5 lg:py-4"
        style={
          layoutNoticeCount
            ? { "--layout-notice-offset": `${layoutNoticeCount * 62}px` }
            : undefined
        }
      >
        <header className="top-frame absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-3 bg-gradient-to-b from-[var(--page)] via-[var(--page)]/70 to-transparent px-4 pb-7 pt-4 lg:static lg:rounded-2xl lg:border lg:border-[var(--border)] lg:bg-[var(--shell)] lg:px-4 lg:py-2.5 lg:shadow-[var(--shadow-soft)]">
          <div className="top-inner">
          <div className="brand-lockup flex min-w-0 items-center gap-3">
            <div className="brand-mark flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-bold text-[var(--on-accent)] lg:h-9 lg:w-9 lg:rounded-xl lg:text-sm">
              RC
            </div>
            <div className="brand-copy min-w-0 leading-tight">
              <p className="text-[9px] uppercase tracking-[0.3em] text-[var(--muted)] lg:text-[10px]">
                Vertical lyric video maker
              </p>
              <div className="flex items-baseline gap-2">
                <h1 className="truncate text-sm font-semibold tracking-tight lg:text-base">
                  {projectState.meta.title || "Reel Creator"}
                </h1>
                {projectState.meta.artist ? (
                  <span className="hidden truncate text-xs text-[var(--muted)] lg:inline">
                    · {projectState.meta.artist}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div
            className="mobile-view-toggle"
            role="group"
            aria-label="Show or hide the preview and word board"
          >
            <button
              className={showPreview ? "is-active" : ""}
              type="button"
              data-wsview="preview"
              aria-pressed={showPreview}
              onClick={handleTogglePreview}
            >
              Preview
            </button>
            <button
              className={showWordBoard ? "is-active" : ""}
              type="button"
              data-wsview="board"
              aria-pressed={showWordBoard}
              onClick={handleToggleWordBoard}
            >
              Word board
            </button>
          </div>

          </div>
        </header>

        {!sectionWithinLimit || showGlobalJsonNotice ? (
        <div className="absolute inset-x-3 top-[4.25rem] z-30 space-y-2 lg:static lg:inset-auto lg:space-y-3">
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
          <section
            className={`preview-col ${
              isPreviewFullscreen
                ? "fixed inset-0 z-50 flex min-h-0 flex-col items-center justify-center bg-black/95 p-4 backdrop-blur-sm"
                : "relative z-0 flex min-h-[74dvh] flex-none flex-col overflow-hidden bg-transparent lg:static lg:order-2 lg:min-h-0 lg:flex-1 lg:items-center lg:justify-center lg:rounded-2xl lg:border lg:border-white/8 lg:bg-white/[0.03] lg:p-4"
            }`}
          >
            {isPreviewFullscreen ? (
              <button
                aria-label="Close full-screen preview"
                className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/10 text-lg text-white transition hover:bg-white/20"
                onClick={() => setIsPreviewFullscreen(false)}
                type="button"
              >
                ✕
              </button>
            ) : null}

            <div
              className={`relative flex min-h-0 w-full flex-1 items-center justify-center ${
                isPreviewFullscreen ? "gap-5" : ""
              }`}
            >
              <div
                className={`preview-screen relative overflow-hidden bg-[linear-gradient(180deg,#1a1a2e_0%,#13102a_52%,#0a0816_100%)] ${
                  isPreviewFullscreen
                    ? "aspect-[9/16] h-full max-h-full w-auto max-w-full rounded-[1.75rem] border border-white/12 shadow-[0_40px_120px_rgba(0,0,0,0.6)]"
                    : "h-full w-full lg:aspect-[9/16] lg:h-full lg:max-h-full lg:w-auto lg:max-w-full lg:rounded-[2rem] lg:border lg:border-white/12 lg:shadow-[0_30px_70px_rgba(0,0,0,0.5)]"
                }`}
              >
                <div className="absolute inset-0">
                  <PreviewPlayer
                    backgroundDurationSec={activeBackgroundAsset?.durationSec ?? null}
                    backgroundUrl={backgroundPreviewUrl}
                    playerRef={previewPlayerRef}
                    project={projectState}
                    targetFrame={previewCurrentFrame}
                  />
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-950/55 to-transparent" />
              </div>

              {/* D-Modal: fullscreen preview shows the phone + Word Board. */}
              {isPreviewFullscreen ? (
                <div className="hidden h-full max-h-full min-w-0 flex-1 items-center justify-center lg:flex">
                  <WordBoard
                    lines={projectState.lines}
                    selectedWordId={editor.state.selection.selectedWord?.id ?? null}
                    onSelectWord={(word) => editor.actions.setSelectedWord(word)}
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
                  onClick={() => setIsPreviewFullscreen(true)}
                  type="button"
                >
                  Preview
                </button>
                <button
                  className="top-action preview-under-action"
                  disabled={!exportReadiness.canExport || exportBusy}
                  onClick={() => {
                    void handleStartExport(false);
                  }}
                  type="button"
                >
                  {exportBusy ? "Exporting..." : "Export MP4"}
                </button>
              </div>
            ) : null}
          </section>

          {!isPreviewFullscreen ? (
            <section className="wb-slot hidden min-h-0 flex-none flex-col overflow-hidden lg:order-2 lg:flex lg:min-h-0 lg:flex-1 lg:items-center lg:justify-center lg:rounded-2xl lg:p-2">
              <WordBoard
                lines={projectState.lines}
                selectedWordId={editor.state.selection.selectedWord?.id ?? null}
                onSelectWord={(word) => editor.actions.setSelectedWord(word)}
                currentTime={currentAudioTime}
                followAudioResetKey={wordBoardFollowAudioResetKey}
              />
            </section>
          ) : null}
            </div>
          </section>

          <section
            className="side-panel relative z-20 -mt-[18vh] flex flex-none flex-col overflow-visible rounded-t-[1.5rem] border-t border-[var(--border)] bg-[var(--shell)] shadow-[0_-20px_60px_rgba(28,26,24,0.18)] backdrop-blur-xl lg:static lg:mt-0 lg:min-h-0 lg:overflow-hidden lg:rounded-2xl lg:border lg:border-[var(--border)] lg:bg-[var(--shell)] lg:shadow-[var(--shadow-panel)] lg:backdrop-blur-none xl:w-[420px] lg:w-[420px]"
            style={{ minHeight: SHEET_SNAPS[sheetSnapIndex].height }}
          >
            <button
              className="flex flex-none flex-col items-center gap-1 pb-1 pt-2.5 lg:hidden"
              onClick={() =>
                setSheetSnapIndex((index) => (index + 1) % SHEET_SNAPS.length)
              }
              type="button"
            >
              <span className="h-1 w-10 rounded-full bg-[var(--border-strong)]" />
              <span className="text-[9px] uppercase tracking-[0.3em] text-[var(--muted)]">
                {SHEET_SNAPS[sheetSnapIndex].label}
              </span>
            </button>

            <div className="panel-tabs flex flex-none flex-col gap-1.5 border-b border-[var(--border)] px-4 pb-2.5 pt-2 lg:px-3 lg:py-3">
              <div className="no-scrollbar flex flex-wrap items-center gap-1.5">
                {SECTIONS.map((section) => {
                  const selected = section.id === activeSection;

                  return (
                    <button
                      className={`section-tab rounded-full px-3 py-1.5 text-[11px] font-semibold transition lg:px-3.5 lg:text-xs ${
                        selected
                          ? "active-tab bg-[var(--accent)] text-[var(--on-accent)]"
                          : "tab-link text-[var(--muted)] hover:bg-[var(--surface-hover)]"
                      }`}
                      aria-selected={selected}
                      key={section.id}
                      onClick={() => setActiveSubTab(section.tabs[0].id)}
                      role="tab"
                      type="button"
                    >
                      {section.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <div className="sub-tabs no-scrollbar flex flex-wrap items-center gap-1.5">
                  {(
                    SECTIONS.find((section) => section.id === activeSection)
                      ?.tabs ?? []
                  ).map((tab) => {
                    const selected = tab.id === activeSubTab;

                    return (
                      <button
                        className={`sub-tab rounded-full border px-3 py-1 text-[11px] font-medium transition lg:text-xs ${
                          selected
                            ? "border-[var(--accent)] bg-[var(--surface-active)] text-[var(--accent)]"
                            : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-hover)]"
                        }`}
                        aria-selected={selected}
                        key={tab.id}
                        onClick={() => setActiveSubTab(tab.id)}
                        role="tab"
                        type="button"
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                {activeSubTab === "timings" && !tapTimingSession.active ? (
                  <button
                    className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition lg:text-xs ${
                      timingControlsVisible
                        ? "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-hover)]"
                        : "border-[var(--accent)] bg-[var(--surface-active)] text-[var(--accent)] hover:opacity-90"
                    }`}
                    onClick={() => setTimingControlsOpen((open) => !open)}
                    type="button"
                  >
                    {timingControlsVisible ? "Hide times" : "Set times"}
                  </button>
                ) : null}
              </div>
            </div>

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
              className="editor-panel-content px-4 pb-4 pt-3 lg:no-scrollbar lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:px-3.5 lg:py-4"
              onTouchMove={handleManualTimingScroll}
              onWheel={handleManualTimingScroll}
              ref={editorScrollRef}
            >
              {renderActiveTab()}
            </div>
          </section>
        </main>

        <section className="flex-none">
          <WaveformTimeline
            activeLineId={activeTimingLineId}
            audio={projectState.audio}
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
            onDurationChange={handleWaveformDuration}
            onMark={handleMarkCurrentLine}
            onPlayingChange={setIsTransportPlaying}
            onTimeChange={setCurrentAudioTime}
            onWaveformPeaks={handleWaveformPeaks}
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

      <ProjectJsonModal
        draft={jsonDraft}
        errorMessage={jsonImportError}
        isOpen={isJsonModalOpen}
        onChange={setJsonDraft}
        onClose={closeJsonImport}
        onFileSelected={handleJsonFile}
        onImport={handleProjectImport}
        onStartNew={handleStartNewProject}
      />

      {exportModalOpen ? (
        <RenderExportModal
          downloadError={exportState.downloadError}
          errorMessage={exportState.errorMessage}
          isDownloading={exportState.isDownloading}
          isReconnecting={exportState.isReconnecting}
          lineCount={lineCount}
          onClose={closeExportModal}
          onDownload={() => {
            void runRenderDownload({
              fallbackName: getFallbackRenderFileName(
                projectState.meta.title,
                exportState.transparent,
                exportState.textLayerMode,
              ),
              fileUrl: exportState.fileUrl,
            });
          }}
          onRetry={() => {
            void handleStartExport(exportState.transparent, exportState.textLayerMode);
          }}
          formatLabel={
            exportState.transparent
              ? getTextLayerFormat(exportState.textLayerMode).formatLabel
              : "MP4"
          }
          phase={exportState.phase}
          progressPercent={exportProgressPercent}
          projectTitle={projectState.meta.title || "Reel Creator"}
          renderStatus={exportState.renderStatus}
          sectionLengthLabel={formatPreciseTime(sectionDuration)}
          statusNote={exportState.statusNote}
        />
      ) : null}
    </div>
    </EditorProvider>
  );
}
