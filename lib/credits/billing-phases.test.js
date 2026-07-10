import { describe, expect, it } from "vitest";

import {
  BILLING_PHASES,
  LEDGER_TYPE_OF_PHASE,
  getLedgerTypeForBillingPhase,
  normalizeBillingPhase,
} from "./billing-phases.js";

describe("billing phase mapping", () => {
  it("maps live lyric phases to AI ledger types", () => {
    expect(BILLING_PHASES).toEqual(["transcribe", "enrich", "time"]);
    expect(LEDGER_TYPE_OF_PHASE).toEqual({
      enrich: "AI_ENRICH",
      time: "AI_TIMING",
      transcribe: "AI_TRANSCRIBE",
    });
    expect(getLedgerTypeForBillingPhase(" transcribe ")).toBe("AI_TRANSCRIBE");
    expect(getLedgerTypeForBillingPhase("ENRICH")).toBe("AI_ENRICH");
    expect(getLedgerTypeForBillingPhase("time")).toBe("AI_TIMING");
  });

  it("rejects unsupported phases", () => {
    expect(() => normalizeBillingPhase("full")).toThrow("Unsupported billing phase");
    expect(() => getLedgerTypeForBillingPhase(null)).toThrow("Billing phase");
  });
});
