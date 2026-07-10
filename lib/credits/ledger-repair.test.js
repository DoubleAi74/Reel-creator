import { describe, expect, it } from "vitest";

import { buildHistoricalTopUpLedgerEntry } from "./ledger-repair.js";

describe("ledger-repair historical entries (REP-205)", () => {
  it("stamps repairedHistoricalEntry and marks balanceAfterMinor as indicative", () => {
    const order = {
      _id: { toString: () => "order-abc" },
      amountMinor: 500,
      currency: "GBP",
      paidAt: new Date("2026-01-01T00:00:00.000Z"),
      sumupCheckoutId: "chk_1",
      sumupCheckoutReference: "ref_1",
    };

    const entry = buildHistoricalTopUpLedgerEntry({
      balanceAfterMinor: 1200,
      order,
    });

    expect(entry).toMatchObject({
      amountMinor: 500,
      balanceAfterMinor: 1200,
      idempotencyKey: "top_up:order-abc",
      metadata: {
        balanceAfterMinorIndicative: true,
        repairedHistoricalEntry: true,
      },
      type: "TOP_UP",
    });
    // Repair never mutates balance — only writes an audit ledger row.
    expect(entry.amountMinor).toBe(order.amountMinor);
  });
});
