import { describe, expect, it } from "vitest";

import { buildCheckoutRedirectUrl, buildWebhookUrl } from "./payment-urls.mjs";

describe("payment URL builders", () => {
  it("uses conventional app paths when env values only contain a tunnel root", () => {
    expect(buildCheckoutRedirectUrl("https://example.test", "order_123")).toBe(
      "https://example.test/payment/return?order=order_123",
    );
    expect(buildWebhookUrl("https://example.test")).toBe(
      "https://example.test/api/webhooks/sumup",
    );
  });

  it("preserves explicit configured paths", () => {
    expect(
      buildCheckoutRedirectUrl("https://example.test/custom-return", "order_123"),
    ).toBe("https://example.test/custom-return?order=order_123");
    expect(buildWebhookUrl("https://example.test/private-webhook")).toBe(
      "https://example.test/private-webhook",
    );
  });
});
