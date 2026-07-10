export function isCreditsEnabled() {
  return ["1", "true", "yes", "on"].includes(
    String(process.env.CREDITS_ENABLED ?? "").trim().toLowerCase(),
  );
}

export function getMinimumGenerationBalanceMinor() {
  const rawValue = process.env.MIN_GENERATION_BALANCE_MINOR;

  if (rawValue == null || rawValue === "") {
    return 1;
  }

  const parsedValue = Number(rawValue);

  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new Error("MIN_GENERATION_BALANCE_MINOR must be a non-negative integer pence value.");
  }

  return parsedValue;
}
