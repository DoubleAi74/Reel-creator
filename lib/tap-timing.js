export function getTapTimingStartLineId(lines = [], selectedLineId = null) {
  const selectedLine = selectedLineId
    ? lines.find((line) => line.id === selectedLineId)
    : null;

  if (selectedLine) {
    return selectedLine.id;
  }

  const firstUntimedLine = lines.find((line) => !Number.isFinite(line?.start));

  return firstUntimedLine?.id ?? lines[0]?.id ?? null;
}

export function getNextTapTimingLineId(lines = [], currentLineId = null) {
  const currentIndex = lines.findIndex((line) => line.id === currentLineId);

  if (currentIndex === -1) {
    return getTapTimingStartLineId(lines);
  }

  return lines[currentIndex + 1]?.id ?? null;
}

export function getTapTimingLineProgress(lines = [], lineId = null) {
  const lineIndex = lines.findIndex((line) => line.id === lineId);

  return {
    current: lineIndex === -1 ? 0 : lineIndex + 1,
    total: lines.length,
  };
}
