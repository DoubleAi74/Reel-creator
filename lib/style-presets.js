export const FONT_OPTIONS = [
  {
    id: "geist-world",
    label: "Noto Sans",
    family:
      '"Noto Sans", "Noto Sans Devanagari", "Noto Sans JP", "Noto Sans KR", "Noto Sans Arabic", sans-serif',
  },
  {
    id: "noto-world",
    label: "Noto World",
    family:
      '"Noto Sans", "Noto Sans Devanagari", "Noto Sans JP", "Noto Sans KR", "Noto Sans Arabic", sans-serif',
  },
  {
    id: "mono-world",
    label: "Mono Subtitle",
    family:
      '"SFMono-Regular", "SF Mono", "IBM Plex Mono", "Roboto Mono", "Noto Sans", "Noto Sans Devanagari", monospace',
  },
];

export const STYLE_PRESETS = {
  clean: {
    label: "Clean",
    style: {
      font: "noto-world",
      originalSize: 64,
      romanizationSize: 40,
      translationSize: 44,
      color: "#FFF9EE",
      romanizationColor: "#E4ECFA",
      translationColor: "#C9D7F2",
      verticalPosition: 0.74,
      shadow: {
        enabled: true,
        blur: 12,
        color: "#000000",
        opacity: 0.55,
      },
    },
  },
  bold: {
    label: "Bold",
    style: {
      font: "noto-world",
      originalSize: 72,
      romanizationSize: 44,
      translationSize: 48,
      color: "#FFF8F2",
      romanizationColor: "#FCE7DA",
      translationColor: "#FFD7C3",
      verticalPosition: 0.72,
      shadow: {
        enabled: true,
        blur: 18,
        color: "#1A0C0E",
        opacity: 0.72,
      },
    },
  },
  subtitle: {
    label: "Subtitle",
    style: {
      font: "mono-world",
      originalSize: 54,
      romanizationSize: 32,
      translationSize: 34,
      color: "#F8FAFC",
      romanizationColor: "#DDE3FB",
      translationColor: "#C7D2FE",
      verticalPosition: 0.82,
      shadow: {
        enabled: true,
        blur: 10,
        color: "#020617",
        opacity: 0.72,
      },
    },
  },
};

export function resolveFontFamily(fontId) {
  return (
    FONT_OPTIONS.find((option) => option.id === fontId)?.family ??
    FONT_OPTIONS[0].family
  );
}

export function applyStylePreset(currentStyle, presetId) {
  const preset = STYLE_PRESETS[presetId];

  if (!preset) {
    return currentStyle;
  }

  return {
    ...currentStyle,
    ...preset.style,
    preset: presetId,
    shadow: {
      ...currentStyle.shadow,
      ...(preset.style.shadow ?? {}),
    },
  };
}
