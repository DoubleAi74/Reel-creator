import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getSumUpEnvironment,
  resetSumUpEnvironmentForTests,
} from "./sumup-env.mjs";

const requiredEnvironment = {
  APP_BASE_URL: "https://example.com",
  SUMUP_API_BASE_URL: "https://api.sumup.com",
  SUMUP_CHECKOUT_RETURN_URL: "https://example.com/payment/return",
  SUMUP_CURRENCY: "GBP",
  SUMUP_MERCHANT_CODE: "sandbox-merchant",
  SUMUP_WEBHOOK_URL: "https://example.com/api/webhooks/sumup/test-path",
};

function stubEnvironment(apiKey, overrides = {}) {
  resetSumUpEnvironmentForTests();
  vi.stubEnv("SUMUP_API_KEY", apiKey);

  for (const [key, value] of Object.entries({
    ...requiredEnvironment,
    SUMUP_MODE: "sandbox",
    ...overrides,
  })) {
    vi.stubEnv(key, value);
  }
}

describe("SumUp environment validation", () => {
  afterEach(() => {
    resetSumUpEnvironmentForTests();
    vi.unstubAllEnvs();
  });

  it("accepts SumUp sandbox/server secret key formats", () => {
    stubEnvironment("sk_test_example");
    expect(getSumUpEnvironment().SUMUP_API_KEY).toBe("sk_test_example");
    expect(getSumUpEnvironment().SUMUP_MODE).toBe("sandbox");

    stubEnvironment("sup_sk_example");
    expect(getSumUpEnvironment().SUMUP_API_KEY).toBe("sup_sk_example");
  });

  it("rejects live, public, and affiliate key shapes in sandbox mode", () => {
    for (const apiKey of ["sk_live_example", "sup_pk_example", "sup_afk_example"]) {
      stubEnvironment(apiKey);
      expect(() => getSumUpEnvironment()).toThrow("SUMUP_API_KEY");
    }
  });

  it("rejects sandbox keys in live mode", () => {
    stubEnvironment("sk_test_example", {
      SUMUP_MODE: "live",
    });

    expect(() => getSumUpEnvironment()).toThrow(
      "live server secret key when SUMUP_MODE=live",
    );
  });

  it("rejects localhost and temporary tunnel URLs in live mode", () => {
    stubEnvironment("sk_live_example", {
      APP_BASE_URL: "http://localhost:3000",
      SUMUP_CHECKOUT_RETURN_URL: "https://local.trycloudflare.com/payment/return",
      SUMUP_MODE: "live",
      SUMUP_WEBHOOK_URL: "https://local.trycloudflare.com/api/webhooks/sumup",
    });

    expect(() => getSumUpEnvironment()).toThrow(
      "must be a stable production HTTPS URL",
    );
  });

  it("accepts live mode with live keys and stable HTTPS URLs", () => {
    stubEnvironment("sk_live_example", {
      APP_BASE_URL: "https://credits.example.com",
      SUMUP_CHECKOUT_RETURN_URL: "https://credits.example.com/payment/return",
      SUMUP_MODE: "live",
      SUMUP_WEBHOOK_URL: "https://credits.example.com/api/webhooks/sumup",
    });

    expect(getSumUpEnvironment().SUMUP_MODE).toBe("live");
  });

  it("allows temporary live URLs only with the explicit override", () => {
    stubEnvironment("sk_live_example", {
      ALLOW_TEMP_LIVE_PAYMENT_URLS: "true",
      APP_BASE_URL: "http://localhost:3000",
      SUMUP_CHECKOUT_RETURN_URL: "https://local.trycloudflare.com/payment/return",
      SUMUP_MODE: "live",
      SUMUP_WEBHOOK_URL: "https://local.trycloudflare.com/api/webhooks/sumup",
    });

    expect(getSumUpEnvironment().ALLOW_TEMP_LIVE_PAYMENT_URLS).toBe(true);
  });

  it("selects test credentials from the new split env names in sandbox mode", () => {
    resetSumUpEnvironmentForTests();
    vi.stubEnv("SUMUP_API_KEY_TEST", "sk_test_split_example");
    vi.stubEnv("SUMUP_MERCHANT_CODE_TEST", "test-merchant");

    for (const [key, value] of Object.entries({
      ...requiredEnvironment,
      SUMUP_MERCHANT_CODE: "",
      SUMUP_MODE: " Sandbox ",
    })) {
      vi.stubEnv(key, value);
    }

    expect(getSumUpEnvironment()).toEqual(
      expect.objectContaining({
        SUMUP_API_KEY: "sk_test_split_example",
        SUMUP_API_KEY_SOURCE: "SUMUP_API_KEY_TEST",
        SUMUP_MERCHANT_CODE: "test-merchant",
        SUMUP_MODE: "sandbox",
      }),
    );
  });

  it("selects live credentials from the new split env names with case-insensitive mode", () => {
    resetSumUpEnvironmentForTests();
    vi.stubEnv("SUMUP_API_KEY_LIVE", "sup_sk_generic_live_example");
    vi.stubEnv("SUMUP_MERCHANT_CODE_LIVE", "live-merchant");

    for (const [key, value] of Object.entries({
      ...requiredEnvironment,
      APP_BASE_URL: "https://credits.example.com",
      SUMUP_CHECKOUT_RETURN_URL: "https://credits.example.com/payment/return",
      SUMUP_MERCHANT_CODE: "",
      SUMUP_MODE: "Live",
      SUMUP_WEBHOOK_URL: "https://credits.example.com/api/webhooks/sumup",
    })) {
      vi.stubEnv(key, value);
    }

    expect(getSumUpEnvironment()).toEqual(
      expect.objectContaining({
        SUMUP_API_KEY: "sup_sk_generic_live_example",
        SUMUP_API_KEY_SOURCE: "SUMUP_API_KEY_LIVE",
        SUMUP_MERCHANT_CODE: "live-merchant",
        SUMUP_MODE: "live",
      }),
    );
  });

  it("still rejects visibly sandbox keys even when they are put in the live slot", () => {
    resetSumUpEnvironmentForTests();
    vi.stubEnv("SUMUP_API_KEY_LIVE", "sk_test_wrong_slot");
    vi.stubEnv("SUMUP_MERCHANT_CODE_LIVE", "live-merchant");

    for (const [key, value] of Object.entries({
      ...requiredEnvironment,
      APP_BASE_URL: "https://credits.example.com",
      SUMUP_CHECKOUT_RETURN_URL: "https://credits.example.com/payment/return",
      SUMUP_MERCHANT_CODE: "",
      SUMUP_MODE: "live",
      SUMUP_WEBHOOK_URL: "https://credits.example.com/api/webhooks/sumup",
    })) {
      vi.stubEnv(key, value);
    }

    expect(() => getSumUpEnvironment()).toThrow(
      "live server secret key when SUMUP_MODE=live",
    );
  });
});
