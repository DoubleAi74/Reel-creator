import { describe, expect, it } from "vitest";

import { LedgerError, validateLedgerChangeInput } from "./balance-ledger.mjs";

const validInput = {
  amountMinor: 100,
  idempotencyKey: "top_up:test",
  reason: "Test top-up",
  session: {},
  type: "TOP_UP",
};

describe("ledger input validation", () => {
  it("accepts non-zero integer pence with an idempotency key", () => {
    expect(() => validateLedgerChangeInput(validInput)).not.toThrow();
  });

  it("rejects non-integer, zero, or unsupported currency changes", () => {
    expect(() =>
      validateLedgerChangeInput({ ...validInput, amountMinor: 1.5 }),
    ).toThrow(LedgerError);
    expect(() =>
      validateLedgerChangeInput({ ...validInput, amountMinor: 0 }),
    ).toThrow("non-zero integer pence");
    expect(() =>
      validateLedgerChangeInput({ ...validInput, currency: "EUR" }),
    ).toThrow("Only GBP");
  });

  it("requires a type, session, reason, and idempotency key", () => {
    expect(() => validateLedgerChangeInput({ ...validInput, type: "OTHER" })).toThrow(
      "Unsupported ledger entry type",
    );
    expect(() => validateLedgerChangeInput({ ...validInput, session: null })).toThrow(
      "session is required",
    );
    expect(() =>
      validateLedgerChangeInput({ ...validInput, idempotencyKey: "" }),
    ).toThrow("idempotencyKey");
    expect(() => validateLedgerChangeInput({ ...validInput, reason: "" })).toThrow(
      "reason",
    );
  });
});
