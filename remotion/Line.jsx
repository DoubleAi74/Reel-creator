import { resolveFontFamily } from "@/lib/style-presets";

export function Line({ animationProgress, line, styleConfig }) {
  if (!line) {
    return null;
  }

  const translateY =
    (1 - animationProgress) * (styleConfig.animation?.slidePx ?? 40);
  const shadowEnabled = styleConfig.shadow?.enabled ?? true;
  const outlineEnabled = styleConfig.outline?.enabled ?? false;
  const shadowColor = styleConfig.shadow?.color ?? "#000000";
  const shadowOpacity = styleConfig.shadow?.opacity ?? 0.6;
  const shadowBlur = styleConfig.shadow?.blur ?? 8;
  const outlineColor = styleConfig.outline?.color ?? "#000000";
  const outlineWidth = styleConfig.outline?.width ?? 2;
  const fontFamily = resolveFontFamily(styleConfig.font);

  return (
    <div
      style={{
        position: "absolute",
        insetInline: 96,
        top: `${(styleConfig.verticalPosition ?? 0.78) * 100}%`,
        transform: "translateY(-50%)",
      }}
    >
      <div
        style={{
          opacity: animationProgress,
          transform: `translateY(${translateY}px)`,
          textAlign: "center",
        }}
      >
        <p
          style={{
            color: styleConfig.color ?? "#FFFFFF",
            fontFamily,
            fontSize: styleConfig.originalSize ?? 64,
            fontWeight: 650,
            letterSpacing: "-0.03em",
            lineHeight: 1.1,
            margin: 0,
            textShadow: shadowEnabled
              ? `0 0 ${shadowBlur}px rgba(0, 0, 0, ${shadowOpacity}), 0 8px 32px rgba(0, 0, 0, ${shadowOpacity})`
              : "none",
            WebkitTextStroke: outlineEnabled
              ? `${outlineWidth}px ${outlineColor}`
              : undefined,
          }}
        >
          {line.original}
        </p>

        {line.romanization ? (
          <p
            style={{
              color: styleConfig.romanizationColor ?? "#C9D4E0",
              fontFamily,
              fontSize: styleConfig.romanizationSize ?? 40,
              fontStyle: "italic",
              fontWeight: 500,
              lineHeight: 1.2,
              margin: "16px 0 0",
              textShadow: shadowEnabled
                ? `0 0 ${shadowBlur}px rgba(0, 0, 0, ${shadowOpacity}), 0 8px 32px rgba(0, 0, 0, ${shadowOpacity})`
                : "none",
              WebkitTextStroke: outlineEnabled
                ? `${Math.max(1, outlineWidth - 1)}px ${outlineColor}`
                : undefined,
            }}
          >
            {line.romanization}
          </p>
        ) : null}

        {line.translation ? (
          <p
            style={{
              color: styleConfig.translationColor ?? "#D0D0D0",
              fontFamily,
              fontSize: styleConfig.translationSize ?? 44,
              fontWeight: 450,
              lineHeight: 1.25,
              margin: "22px 0 0",
              textShadow: shadowEnabled
                ? `0 0 ${shadowBlur}px rgba(0, 0, 0, ${shadowOpacity}), 0 8px 32px rgba(0, 0, 0, ${shadowOpacity})`
                : "none",
              WebkitTextStroke: outlineEnabled
                ? `${Math.max(1, outlineWidth - 1)}px ${outlineColor}`
                : undefined,
            }}
          >
            {line.translation}
          </p>
        ) : null}
      </div>
    </div>
  );
}
