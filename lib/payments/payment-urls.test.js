import { describe, expect, it } from "vitest";

import { buildCheckoutRedirectUrl, buildWebhookUrl } from "./payment-urls.js";

describe("payment URL helpers", () => {
  it("fills the default return path and appends the order id", () => {
    expect(buildCheckoutRedirectUrl("https://example.com", "order-1")).toBe(
      "https://example.com/payment/return?order=order-1",
    );
  });

  it("preserves explicit return paths", () => {
    expect(
      buildCheckoutRedirectUrl("https://example.com/custom-return", "order-1"),
    ).toBe("https://example.com/custom-return?order=order-1");
  });

  it("fills the default webhook path", () => {
    expect(buildWebhookUrl("https://example.com")).toBe(
      "https://example.com/api/webhooks/sumup",
    );
  });
});
