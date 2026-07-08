import { describe, expect, it } from "vitest";

import { isSafeHostedCheckoutUrl } from "./sumup-client.mjs";

describe("SumUp hosted checkout URL validation", () => {
  it("accepts HTTPS SumUp hosted checkout URLs", () => {
    expect(isSafeHostedCheckoutUrl("https://checkout.sumup.com/pay/checkout-id")).toBe(
      true,
    );
    expect(
      isSafeHostedCheckoutUrl(
        "https://merchant.checkout.sumup.com/pay/checkout-id",
      ),
    ).toBe(true);
  });

  it("rejects non-SumUp, non-HTTPS, and malformed URLs", () => {
    expect(isSafeHostedCheckoutUrl("http://checkout.sumup.com/pay/checkout-id")).toBe(
      false,
    );
    expect(isSafeHostedCheckoutUrl("https://checkout.sumup.com.evil.test")).toBe(
      false,
    );
    expect(isSafeHostedCheckoutUrl("not a url")).toBe(false);
  });
});
