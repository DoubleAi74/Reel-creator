export const FIRE_COST_MINOR = 2;
export const TOP_UP_MIN_MINOR = 1;
export const TOP_UP_MAX_MINOR = 10000;

export function formatGbpFromMinor(amountMinor) {
  const safeAmountMinor = Number.isInteger(amountMinor) ? amountMinor : 0;
  const sign = safeAmountMinor < 0 ? "-" : "";
  const absoluteMinor = Math.abs(safeAmountMinor);
  const pounds = Math.floor(absoluteMinor / 100);
  const pence = String(absoluteMinor % 100).padStart(2, "0");

  return `${sign}£${pounds}.${pence}`;
}

export function canDebitMinor(balanceMinor, debitMinor) {
  return (
    Number.isInteger(balanceMinor) &&
    Number.isInteger(debitMinor) &&
    debitMinor >= 0 &&
    balanceMinor >= debitMinor
  );
}

export function debitMinor(balanceMinor, debitMinor) {
  if (!canDebitMinor(balanceMinor, debitMinor)) {
    return balanceMinor;
  }

  return balanceMinor - debitMinor;
}

export function clampMinor(amountMinor, minMinor, maxMinor) {
  if (!Number.isInteger(amountMinor)) {
    return minMinor;
  }

  return Math.min(Math.max(amountMinor, minMinor), maxMinor);
}

export function parseGbpInputToMinor(input) {
  const trimmedInput = String(input).trim();
  const match = trimmedInput.match(/^(\d+)(?:\.(\d{0,2}))?$/);

  if (!match) {
    return null;
  }

  const pounds = Number.parseInt(match[1], 10);
  const pence = Number.parseInt((match[2] ?? "").padEnd(2, "0"), 10);

  if (!Number.isSafeInteger(pounds) || !Number.isSafeInteger(pence)) {
    return null;
  }

  return pounds * 100 + pence;
}

export function minorToMajorUnit(amountMinor) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new Error("Invalid minor-unit amount.");
  }

  return amountMinor / 100;
}

export function isValidTopUpMinor(amountMinor) {
  return (
    Number.isInteger(amountMinor) &&
    amountMinor >= TOP_UP_MIN_MINOR &&
    amountMinor <= TOP_UP_MAX_MINOR
  );
}
