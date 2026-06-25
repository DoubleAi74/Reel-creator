export const DEFAULT_TEXT_LAYER_MODE = "alpha";
export const TEXT_LAYER_CHROMA_COLOR = "#00ff00";
export const TEXT_LAYER_RENDER_FPS = 30;
export const TEXT_LAYER_RENDER_HEIGHT = 1280;
export const TEXT_LAYER_RENDER_WIDTH = 720;
export const TEXT_LAYER_RENDER_SCALE = TEXT_LAYER_RENDER_WIDTH / 1080;

const TEXT_LAYER_FORMATS = {
  alpha: {
    extension: "mov",
    formatLabel: "transparent ProRes text layer (.mov)",
    mimeType: "video/quicktime",
  },
  chroma: {
    extension: "mp4",
    formatLabel: "green-screen text layer (.mp4)",
    mimeType: "video/mp4",
  },
};

export function normalizeTextLayerMode(textLayerMode) {
  return textLayerMode && TEXT_LAYER_FORMATS[textLayerMode]
    ? textLayerMode
    : DEFAULT_TEXT_LAYER_MODE;
}

export function getTextLayerFormat(textLayerMode = DEFAULT_TEXT_LAYER_MODE) {
  return TEXT_LAYER_FORMATS[normalizeTextLayerMode(textLayerMode)];
}
