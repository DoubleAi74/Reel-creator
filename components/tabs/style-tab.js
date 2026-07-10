"use client";

import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { StatusBadge } from "@/components/ui/status-badge";
import { StyleColorField } from "@/components/ui/style-color-field";
import { StyleSlider } from "@/components/ui/style-slider";
import { isBackgroundMediaType } from "@/lib/editor-format";
import {
  DEFAULT_LYRIC_LEAD_IN_MS,
  MAX_LYRIC_LEAD_IN_MS,
  MIN_LYRIC_LEAD_IN_MS,
} from "@/lib/timing";

export function StyleTab({ background, textDisplay }) {
  const {
    onApplyPreset,
    onUpdateStyle,
    onUpdateTiming,
    presetEntries,
    style,
    timing,
  } = textDisplay;

  const {
    onImageFile,
    onPickImage,
    onPickVideo,
    onSelectType,
    onUpdateBackground,
    onVideoFile,
    settings,
    upload,
    uploadCopy,
  } = background;

  const renderTextDisplayControls = () => (
    <div className="grid gap-4">
      <div className="rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
        <p className="text-sm font-medium text-[var(--muted)]">Presets</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {presetEntries.map(([presetId, preset]) => {
            const selected = style.preset === presetId;

            return (
              <button
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  selected
                    ? "bg-[var(--accent)] text-[var(--on-accent)]"
                    : "bg-[var(--surface-2)] text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                }`}
                key={presetId}
                onClick={() => onApplyPreset(presetId)}
                type="button"
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <StyleSlider
          label="Original size"
          max={92}
          min={40}
          onChange={(event) =>
            onUpdateStyle({
              originalSize: Number(event.target.value),
              preset: "custom",
            })
          }
          step={1}
          value={style.originalSize}
        />
        <StyleSlider
          label="Translation size"
          max={64}
          min={26}
          onChange={(event) =>
            onUpdateStyle({
              translationSize: Number(event.target.value),
              preset: "custom",
            })
          }
          step={1}
          value={style.translationSize}
        />
        <StyleSlider
          label="Romanization size"
          max={64}
          min={22}
          onChange={(event) =>
            onUpdateStyle({
              romanizationSize: Number(event.target.value),
              preset: "custom",
            })
          }
          step={1}
          value={style.romanizationSize ?? 40}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <StyleColorField
          label="Primary color"
          onChange={(event) =>
            onUpdateStyle({ color: event.target.value, preset: "custom" })
          }
          value={style.color}
        />
        <StyleColorField
          label="Translation color"
          onChange={(event) =>
            onUpdateStyle({
              translationColor: event.target.value,
              preset: "custom",
            })
          }
          value={style.translationColor}
        />
        <StyleColorField
          label="Romanization color"
          onChange={(event) =>
            onUpdateStyle({
              romanizationColor: event.target.value,
              preset: "custom",
            })
          }
          value={style.romanizationColor ?? "#C9D4E0"}
        />
      </div>

      <StyleSlider
        label="Vertical position"
        max={0.9}
        min={0.1}
        onChange={(event) =>
          onUpdateStyle({
            verticalPosition: Number(event.target.value),
            preset: "custom",
          })
        }
        step={0.01}
        value={style.verticalPosition}
      />

      <StyleSlider
        label="Lyric lead-in"
        max={MAX_LYRIC_LEAD_IN_MS}
        min={MIN_LYRIC_LEAD_IN_MS}
        onChange={(event) =>
          onUpdateTiming({
            lyricLeadInMs: Number(event.target.value),
          })
        }
        step={10}
        value={timing?.lyricLeadInMs ?? DEFAULT_LYRIC_LEAD_IN_MS}
        valueLabel={`${
          timing?.lyricLeadInMs ?? DEFAULT_LYRIC_LEAD_IN_MS
        } ms`}
      />
    </div>
  );

  const renderBackgroundControls = () => (
    <div className="grid gap-4">
      <div className="rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
        <p className="text-sm font-medium text-[var(--muted)]">Background mode</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {["solid", "gradient", "image", "video"].map((backgroundType) => {
            const selected = settings.type === backgroundType;

            return (
              <button
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  selected
                    ? "bg-[var(--accent)] text-[var(--on-accent)]"
                    : "bg-[var(--surface-2)] text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                }`}
                key={backgroundType}
                onClick={() => onSelectType(backgroundType)}
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

      {settings.type === "solid" ? (
        <StyleColorField
          label="Solid color"
          onChange={(event) =>
            onUpdateBackground({
              color: event.target.value,
              type: "solid",
            })
          }
          value={settings.color}
        />
      ) : null}

      {settings.type === "gradient" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <StyleColorField
              label="Gradient from"
              onChange={(event) =>
                onUpdateBackground((currentBackground) => ({
                  ...currentBackground,
                  type: "gradient",
                  gradient: {
                    ...currentBackground.gradient,
                    from: event.target.value,
                  },
                }))
              }
              value={settings.gradient.from}
            />
            <StyleColorField
              label="Gradient to"
              onChange={(event) =>
                onUpdateBackground((currentBackground) => ({
                  ...currentBackground,
                  type: "gradient",
                  gradient: {
                    ...currentBackground.gradient,
                    to: event.target.value,
                  },
                }))
              }
              value={settings.gradient.to}
            />
          </div>

          <StyleSlider
            label="Gradient angle"
            max={360}
            min={0}
            onChange={(event) =>
              onUpdateBackground((currentBackground) => ({
                ...currentBackground,
                type: "gradient",
                gradient: {
                  ...currentBackground.gradient,
                  angle: Number(event.target.value),
                },
              }))
            }
            step={1}
            value={settings.gradient.angle}
          />
        </>
      ) : null}

      {isBackgroundMediaType(settings.type) ? (
        <>
          <div
            className="rounded-[1.25rem] border border-dashed border-[var(--border)] bg-[var(--surface)] p-4 text-center"
            onDragOver={(event) => {
              event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (settings.type === "video") {
                void onVideoFile(event.dataTransfer.files?.[0] ?? null);
                return;
              }

              void onImageFile(event.dataTransfer.files?.[0] ?? null);
            }}
          >
            <p className="text-sm font-medium text-[var(--text)]">
              {uploadCopy.uploadLabel}
            </p>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              <button
                className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--on-accent)] transition hover:opacity-90"
                onClick={() =>
                  settings.type === "video" ? onPickVideo() : onPickImage()
                }
                type="button"
              >
                {uploadCopy.buttonLabel}
              </button>
              <StatusBadge
                tone={
                  upload.status === "success"
                    ? "success"
                    : upload.status === "error"
                      ? "danger"
                      : "neutral"
                }
              >
                {upload.status}
              </StatusBadge>
            </div>
          </div>

          <StyleSlider
            label="Legibility scrim"
            max={0.8}
            min={0}
            onChange={(event) =>
              onUpdateBackground((currentBackground) => ({
                ...currentBackground,
                scrim: {
                  ...currentBackground.scrim,
                  opacity: Number(event.target.value),
                },
              }))
            }
            step={0.05}
            value={settings.scrim.opacity}
          />
        </>
      ) : null}
    </div>
  );

  return (
    <div className="grid gap-3">
      <CollapsibleSection
        onToggle={textDisplay.onToggle}
        open={textDisplay.open}
        title="Text display"
      >
        {renderTextDisplayControls()}
      </CollapsibleSection>

      <CollapsibleSection
        onToggle={background.onToggle}
        open={background.open}
        title="Background"
      >
        {renderBackgroundControls()}
      </CollapsibleSection>
    </div>
  );
}
