import { MICROS_PER_MINOR, roundMicrosToPenceHalfUp } from "../money.js";

export { roundMicrosToPenceHalfUp };

export const PRICE_TABLE_VERSION = "openai-seed-2026-07-09-user-review-required";
export const TOKENS_PER_MILLION = 1_000_000;
export const AUDIO_COST_SECONDS_DENOMINATOR = 60_000;

// Seed values are pence-denominated equivalents for all live default model
// names. OPENAI_PRICE_TABLE_JSON is the authoritative override before enablement.
export const DEFAULT_OPENAI_PRICE_TABLE = Object.freeze({
  "gpt-4o": {
    inputPerMTokensMicros: 250 * MICROS_PER_MINOR,
    outputPerMTokensMicros: 1000 * MICROS_PER_MINOR,
  },
  "gpt-4o-mini": {
    inputPerMTokensMicros: 15 * MICROS_PER_MINOR,
    outputPerMTokensMicros: 60 * MICROS_PER_MINOR,
  },
  "gpt-4o-mini-transcribe": {
    inputPerMTokensMicros: 125 * MICROS_PER_MINOR,
    outputPerMTokensMicros: 500 * MICROS_PER_MINOR,
    perAudioMinuteMicros: 300_000,
  },
  "gpt-4o-transcribe": {
    inputPerMTokensMicros: 250 * MICROS_PER_MINOR,
    outputPerMTokensMicros: 1000 * MICROS_PER_MINOR,
    perAudioMinuteMicros: 600_000,
  },
  "gpt-5.4": {
    inputPerMTokensMicros: 250 * MICROS_PER_MINOR,
    outputPerMTokensMicros: 1500 * MICROS_PER_MINOR,
  },
  "gpt-5.4-mini": {
    inputPerMTokensMicros: 75 * MICROS_PER_MINOR,
    outputPerMTokensMicros: 450 * MICROS_PER_MINOR,
  },
  "whisper-1": {
    perAudioMinuteMicros: 600_000,
  },
});

export class PricingError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "PricingError";
    this.code = code;
  }
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function assertPriceValue(value, fieldName, model) {
  if (value == null) {
    return;
  }

  if (!isNonNegativeInteger(value)) {
    throw new PricingError(
      `OPENAI_PRICE_TABLE_JSON has invalid ${fieldName} for ${model}.`,
      "PRICE_TABLE_INVALID",
    );
  }
}

function normalizePriceEntry(model, entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new PricingError(
      `OPENAI_PRICE_TABLE_JSON entry for ${model} must be an object.`,
      "PRICE_TABLE_INVALID",
    );
  }

  const normalizedEntry = {
    inputPerMTokensMicros: entry.inputPerMTokensMicros,
    outputPerMTokensMicros: entry.outputPerMTokensMicros,
    perAudioMinuteMicros: entry.perAudioMinuteMicros,
  };

  assertPriceValue(normalizedEntry.inputPerMTokensMicros, "inputPerMTokensMicros", model);
  assertPriceValue(normalizedEntry.outputPerMTokensMicros, "outputPerMTokensMicros", model);
  assertPriceValue(normalizedEntry.perAudioMinuteMicros, "perAudioMinuteMicros", model);

  if (
    normalizedEntry.inputPerMTokensMicros == null &&
    normalizedEntry.outputPerMTokensMicros == null &&
    normalizedEntry.perAudioMinuteMicros == null
  ) {
    throw new PricingError(
      `OPENAI_PRICE_TABLE_JSON entry for ${model} has no supported price fields.`,
      "PRICE_TABLE_INVALID",
    );
  }

  return Object.fromEntries(
    Object.entries(normalizedEntry).filter(([, value]) => value != null),
  );
}

function parsePriceTableOverride(rawOverride) {
  if (!rawOverride) {
    return {
      models: {},
      version: null,
    };
  }

  let parsedOverride;

  try {
    parsedOverride = JSON.parse(rawOverride);
  } catch (error) {
    const wrappedError = new PricingError(
      "OPENAI_PRICE_TABLE_JSON must be valid JSON.",
      "PRICE_TABLE_INVALID",
    );
    wrappedError.cause = error;
    throw wrappedError;
  }

  const models = parsedOverride?.models ?? parsedOverride;

  if (!models || typeof models !== "object" || Array.isArray(models)) {
    throw new PricingError(
      "OPENAI_PRICE_TABLE_JSON must be an object or {version, models}.",
      "PRICE_TABLE_INVALID",
    );
  }

  return {
    models: Object.fromEntries(
      Object.entries(models).map(([model, entry]) => [
        model,
        normalizePriceEntry(model, entry),
      ]),
    ),
    version:
      typeof parsedOverride?.version === "string" && parsedOverride.version.trim()
        ? parsedOverride.version.trim()
        : null,
  };
}

export function getOpenAiPriceTable() {
  const override = parsePriceTableOverride(process.env.OPENAI_PRICE_TABLE_JSON);

  return {
    models: {
      ...DEFAULT_OPENAI_PRICE_TABLE,
      ...override.models,
    },
    version: override.version ?? PRICE_TABLE_VERSION,
  };
}

export function getPriceTableVersion() {
  return getOpenAiPriceTable().version;
}

export function getModelPrice(model, { priceTable = getOpenAiPriceTable() } = {}) {
  if (typeof model !== "string" || !model.trim()) {
    return null;
  }

  return priceTable.models[model.trim()] ?? null;
}

export function hasPrice(model, options = {}) {
  return Boolean(getModelPrice(model, options));
}

function multiplyDivideRoundHalfUp(multiplier, multiplicand, denominator) {
  if (!isNonNegativeInteger(multiplier) || !isNonNegativeInteger(multiplicand)) {
    throw new PricingError("Usage values must be non-negative integers.", "INVALID_USAGE");
  }

  const numerator = BigInt(multiplier) * BigInt(multiplicand);
  const divisor = BigInt(denominator);

  return Number((numerator + divisor / 2n) / divisor);
}

function normalizeTokenCount(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function normalizeAudioMilliseconds(audioSeconds) {
  if (!Number.isFinite(audioSeconds) || audioSeconds <= 0) {
    return 0;
  }

  return Math.round(audioSeconds * 1000);
}

export function computeCallCostMicros({
  audioSeconds = null,
  inputTokens = null,
  model,
  outputTokens = null,
  priceTable = getOpenAiPriceTable(),
  totalTokens = null,
  usageType,
}) {
  const price = getModelPrice(model, { priceTable });

  if (!price) {
    throw new PricingError(`No OpenAI price configured for model: ${model}`, "PRICE_UNAVAILABLE");
  }

  if (usageType === "tokens") {
    const normalizedInputTokens = normalizeTokenCount(inputTokens);
    const normalizedOutputTokens = normalizeTokenCount(outputTokens);
    const normalizedTotalTokens = normalizeTokenCount(totalTokens);

    if (normalizedInputTokens > 0 && price.inputPerMTokensMicros == null) {
      throw new PricingError(
        `Model ${model} does not have input token pricing configured.`,
        "PRICE_UNIT_UNAVAILABLE",
      );
    }

    if (normalizedOutputTokens > 0 && price.outputPerMTokensMicros == null) {
      throw new PricingError(
        `Model ${model} does not have output token pricing configured.`,
        "PRICE_UNIT_UNAVAILABLE",
      );
    }

    if (
      normalizedTotalTokens > 0 &&
      price.inputPerMTokensMicros == null &&
      price.outputPerMTokensMicros == null
    ) {
      throw new PricingError(
        `Model ${model} does not have token pricing configured.`,
        "PRICE_UNIT_UNAVAILABLE",
      );
    }

    const inputCostMicros = multiplyDivideRoundHalfUp(
      normalizedInputTokens,
      price.inputPerMTokensMicros ?? 0,
      TOKENS_PER_MILLION,
    );
    const outputCostMicros = multiplyDivideRoundHalfUp(
      normalizedOutputTokens,
      price.outputPerMTokensMicros ?? 0,
      TOKENS_PER_MILLION,
    );

    return inputCostMicros + outputCostMicros;
  }

  if (usageType === "duration" || usageType === "none") {
    const audioMilliseconds = normalizeAudioMilliseconds(audioSeconds);

    if (audioMilliseconds === 0) {
      return 0;
    }

    if (price.perAudioMinuteMicros == null) {
      throw new PricingError(
        `Model ${model} does not have audio duration pricing configured.`,
        "PRICE_UNIT_UNAVAILABLE",
      );
    }

    return multiplyDivideRoundHalfUp(
      audioMilliseconds,
      price.perAudioMinuteMicros,
      AUDIO_COST_SECONDS_DENOMINATOR,
    );
  }

  throw new PricingError(`Unsupported usage type: ${usageType}`, "INVALID_USAGE");
}
