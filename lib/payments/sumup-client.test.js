import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SumUpApiError,
  createHostedCheckout,
  isSafeHostedCheckoutUrl,
  retrieveCheckout,
} from "./sumup-client.js";
import { resetSumUpEnvironmentForTests } from "./sumup-env.js";

function stubEnvironment() {
  resetSumUpEnvironmentForTests();
  vi.stubEnv("SUMUP_API_KEY", "sk_test_example");
  vi.stubEnv("SUMUP_API_BASE_URL", "https://api.sumup.test");
  vi.stubEnv("SUMUP_CHECKOUT_RETURN_URL", "https://example.com/payment/return");
  vi.stubEnv("SUMUP_CURRENCY", "GBP");
  vi.stubEnv("SUMUP_MERCHANT_CODE", "merchant-123");
  vi.stubEnv("SUMUP_MODE", "sandbox");
  vi.stubEnv("SUMUP_WEBHOOK_URL", "https://example.com/api/webhooks/sumup");
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json",
    },
    status,
  });
}

describe("SumUp client wrappers", () => {
  afterEach(() => {
    resetSumUpEnvironmentForTests();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("validates hosted checkout URLs", () => {
    expect(isSafeHostedCheckoutUrl("https://checkout.sumup.com/pay/checkout-id")).toBe(
      true,
    );
    expect(
      isSafeHostedCheckoutUrl(
        "https://merchant.checkout.sumup.com/pay/checkout-id",
      ),
    ).toBe(true);
    expect(isSafeHostedCheckoutUrl("http://checkout.sumup.com/pay/checkout-id")).toBe(
      false,
    );
    expect(isSafeHostedCheckoutUrl("https://checkout.sumup.com.evil.test")).toBe(
      false,
    );
  });

  it("creates hosted checkouts with server-authoritative fields", async () => {
    stubEnvironment();
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        hosted_checkout_url: "https://checkout.sumup.com/pay/checkout-id",
        id: "checkout-id",
        status: "PENDING",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createHostedCheckout({
        amount: 5,
        checkoutReference: "order-123",
        currency: "GBP",
        description: "Credit dashboard top-up",
        redirectUrl: "https://example.com/payment/return?order=order-123",
        returnUrl: "https://example.com/api/webhooks/sumup",
      }),
    ).resolves.toMatchObject({
      hosted_checkout_url: "https://checkout.sumup.com/pay/checkout-id",
      id: "checkout-id",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.sumup.test/v0.1/checkouts",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      amount: 5,
      checkout_reference: "order-123",
      currency: "GBP",
      merchant_code: "merchant-123",
    });
  });

  it("retrieves checkouts and maps HTTP errors safely", async () => {
    stubEnvironment();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "denied" }, 403)),
    );

    await expect(retrieveCheckout("checkout-id")).rejects.toBeInstanceOf(
      SumUpApiError,
    );
  });
});
