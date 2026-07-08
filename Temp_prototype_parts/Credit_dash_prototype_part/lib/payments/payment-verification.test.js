import { describe, expect, it } from "vitest";

import {
  getCheckoutTransactionId,
  majorAmountToMinor,
  mapCheckoutStatusToOrderStatus,
  verifyPaidCheckout,
} from "./payment-verification.mjs";

const order = {
  amountMinor: 500,
  currency: "GBP",
  sumupCheckoutId: "checkout_123",
  sumupCheckoutReference: "order_123",
};

const paidCheckout = {
  amount: 5,
  checkout_reference: "order_123",
  currency: "GBP",
  id: "checkout_123",
  merchant_code: "merchant_123",
  status: "PAID",
};

describe("payment verification", () => {
  it("converts SumUp major-unit amounts back to integer pence", () => {
    expect(majorAmountToMinor(1)).toBe(100);
    expect(majorAmountToMinor(12.34)).toBe(1234);
    expect(majorAmountToMinor(Number.NaN)).toBe(null);
  });

  it("maps provider checkout statuses to internal order statuses", () => {
    expect(mapCheckoutStatusToOrderStatus("PAID")).toBe("PAID");
    expect(mapCheckoutStatusToOrderStatus("FAILED")).toBe("PAYMENT_FAILED");
    expect(mapCheckoutStatusToOrderStatus("EXPIRED")).toBe("PAYMENT_EXPIRED");
    expect(mapCheckoutStatusToOrderStatus("PENDING")).toBe("PAYMENT_PENDING");
  });

  it("accepts only a PAID checkout that exactly matches the stored order", () => {
    expect(
      verifyPaidCheckout({
        checkout: paidCheckout,
        merchantCode: "merchant_123",
        order,
      }),
    ).toEqual({ failures: [], ok: true });

    expect(
      verifyPaidCheckout({
        checkout: {
          ...paidCheckout,
          amount: 11,
        },
        merchantCode: "merchant_123",
        order,
      }),
    ).toEqual({ failures: ["amount"], ok: false });

    expect(
      verifyPaidCheckout({
        checkout: {
          ...paidCheckout,
          status: "PENDING",
        },
        merchantCode: "merchant_123",
        order,
      }),
    ).toEqual({ failures: ["status"], ok: false });
  });

  it("extracts a stable transaction id when SumUp includes one", () => {
    expect(
      getCheckoutTransactionId({
        transactions: [{ status: "PAID", transaction_code: "T123" }],
      }),
    ).toBe("T123");
    expect(getCheckoutTransactionId({ transactions: [] })).toBe(undefined);
  });
});
