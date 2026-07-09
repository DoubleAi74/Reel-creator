import { afterEach, describe, expect, it } from "vitest";

import { MICROS_PER_MINOR } from "../money.js";
import {
  PRICE_TABLE_VERSION,
  PricingError,
  computeCallCostMicros,
  getOpenAiPriceTable,
  hasPrice,
  roundMicrosToPenceHalfUp,
} from "./openai-pricing.js";

const ORIGINAL_PRICE_TABLE_JSON = process.env.OPENAI_PRICE_TABLE_JSON;

describe("OpenAI price table", () => {
  afterEach(() => {
    if (ORIGINAL_PRICE_TABLE_JSON == null) {
      delete process.env.OPENAI_PRICE_TABLE_JSON;
    } else {
      process.env.OPENAI_PRICE_TABLE_JSON = ORIGINAL_PRICE_TABLE_JSON;
    }
  });

  it("covers all default OpenAI models used by the lyric pipeline", () => {
    delete process.env.OPENAI_PRICE_TABLE_JSON;

    for (const model of [
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4o-transcribe",
      "gpt-5.4",
      "gpt-5.4-mini",
      "whisper-1",
    ]) {
      expect(hasPrice(model), model).toBe(true);
    }

    expect(getOpenAiPriceTable().version).toBe(PRICE_TABLE_VERSION);
  });

  it("computes response-token cost in integer micro-pence", () => {
    expect(
      computeCallCostMicros({
        inputTokens: 1_000_000,
        model: "gpt-5.4-mini",
        outputTokens: 1_000_000,
        totalTokens: 2_000_000,
        usageType: "tokens",
      }),
    ).toBe(525 * MICROS_PER_MINOR);
  });

  it("computes audio duration and audio token costs", () => {
    expect(
      computeCallCostMicros({
        audioSeconds: 30,
        model: "whisper-1",
        usageType: "duration",
      }),
    ).toBe(300_000);
    expect(
      computeCallCostMicros({
        inputTokens: 1000,
        model: "gpt-4o-transcribe",
        outputTokens: 500,
        totalTokens: 1500,
        usageType: "tokens",
      }),
    ).toBe(750_000);
  });

  it("uses absent audio usage only when a duration fallback exists", () => {
    expect(
      computeCallCostMicros({
        audioSeconds: 10,
        model: "whisper-1",
        usageType: "none",
      }),
    ).toBe(100_000);
    expect(
      computeCallCostMicros({
        audioSeconds: null,
        model: "whisper-1",
        usageType: "none",
      }),
    ).toBe(0);
  });

  it("fails closed for missing models or unsupported price units", () => {
    expect(() =>
      computeCallCostMicros({
        inputTokens: 1,
        model: "not-priced",
        outputTokens: 1,
        usageType: "tokens",
      }),
    ).toThrow(PricingError);
    expect(() =>
      computeCallCostMicros({
        inputTokens: 1,
        model: "whisper-1",
        outputTokens: 1,
        usageType: "tokens",
      }),
    ).toThrow("token pricing");
  });

  it("merges OPENAI_PRICE_TABLE_JSON overrides and keeps their version", () => {
    process.env.OPENAI_PRICE_TABLE_JSON = JSON.stringify({
      models: {
        "custom-model": {
          inputPerMTokensMicros: 1_000_000,
          outputPerMTokensMicros: 2_000_000,
          perAudioMinuteMicros: 60_000,
        },
      },
      version: "test-prices",
    });

    expect(hasPrice("custom-model")).toBe(true);
    expect(getOpenAiPriceTable().version).toBe("test-prices");
    expect(
      computeCallCostMicros({
        inputTokens: 1_000_000,
        model: "custom-model",
        outputTokens: 500_000,
        usageType: "tokens",
      }),
    ).toBe(2_000_000);
  });

  it("validates malformed OPENAI_PRICE_TABLE_JSON", () => {
    process.env.OPENAI_PRICE_TABLE_JSON = "{";
    expect(() => getOpenAiPriceTable()).toThrow("valid JSON");

    process.env.OPENAI_PRICE_TABLE_JSON = JSON.stringify({
      "custom-model": {
        inputPerMTokensMicros: 1.5,
      },
    });
    expect(() => getOpenAiPriceTable()).toThrow("invalid inputPerMTokensMicros");
  });

  it("rounds each completed phase half-up from micro-pence to pence", () => {
    expect(roundMicrosToPenceHalfUp(499_999)).toBe(0);
    expect(roundMicrosToPenceHalfUp(500_000)).toBe(1);
    expect(roundMicrosToPenceHalfUp(250_000 + 250_000)).toBe(1);
    expect(roundMicrosToPenceHalfUp(1_499_999)).toBe(1);
    expect(roundMicrosToPenceHalfUp(1_500_000)).toBe(2);
  });
});
