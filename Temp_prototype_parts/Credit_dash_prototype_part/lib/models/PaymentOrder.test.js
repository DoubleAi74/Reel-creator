import { describe, expect, it } from "vitest";

import { PaymentOrder } from "./PaymentOrder.mjs";

describe("PaymentOrder model", () => {
  it("does not default optional provider ids to null", () => {
    const order = new PaymentOrder({
      amountMinor: 100,
      currency: "GBP",
      description: "Credit dashboard top-up",
      publicReference: "order_model_test",
      sumupCheckoutReference: "order_model_test",
    }).toObject();

    expect(order).not.toHaveProperty("sumupCheckoutId");
    expect(order).not.toHaveProperty("sumupTransactionId");
    expect(order).not.toHaveProperty("sumupHostedCheckoutUrl");
    expect(order).not.toHaveProperty("sumupCheckoutStatus");
  });
});
