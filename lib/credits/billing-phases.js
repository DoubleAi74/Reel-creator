export const BILLING_PHASES = ["transcribe", "enrich", "time"];

export const LEDGER_TYPE_OF_PHASE = {
  enrich: "AI_ENRICH",
  time: "AI_TIMING",
  transcribe: "AI_TRANSCRIBE",
};

export function normalizeBillingPhase(phase) {
  if (typeof phase !== "string") {
    throw new Error("Billing phase is required.");
  }

  const normalizedPhase = phase.trim().toLowerCase();

  if (!BILLING_PHASES.includes(normalizedPhase)) {
    throw new Error(`Unsupported billing phase: ${phase}`);
  }

  return normalizedPhase;
}

export function getLedgerTypeForBillingPhase(phase) {
  return LEDGER_TYPE_OF_PHASE[normalizeBillingPhase(phase)];
}
