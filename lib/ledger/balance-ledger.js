import { Balance } from "../models/Balance.js";
import { CREDIT_LEDGER_TYPES, CreditLedger } from "../models/CreditLedger.js";

export class LedgerError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}

export function validateLedgerChangeInput(input) {
  if (!input?.session) {
    throw new LedgerError("A MongoDB session is required.", "SESSION_REQUIRED");
  }

  if (!CREDIT_LEDGER_TYPES.includes(input.type)) {
    throw new LedgerError("Unsupported ledger entry type.", "INVALID_TYPE");
  }

  if (!Number.isInteger(input.amountMinor) || input.amountMinor === 0) {
    throw new LedgerError(
      "Ledger amountMinor must be non-zero integer pence.",
      "INVALID_AMOUNT",
    );
  }

  if (!input.idempotencyKey || typeof input.idempotencyKey !== "string") {
    throw new LedgerError("Ledger idempotencyKey is required.", "INVALID_KEY");
  }

  if (!input.reason || typeof input.reason !== "string") {
    throw new LedgerError("Ledger reason is required.", "INVALID_REASON");
  }

  if (input.currency && input.currency !== "GBP") {
    throw new LedgerError("Only GBP ledger entries are supported.", "INVALID_CURRENCY");
  }
}

function serializeLedgerDocument(document) {
  if (!document) {
    return null;
  }

  if (typeof document.toObject === "function") {
    return document.toObject();
  }

  return document;
}

function normalizeId(value) {
  if (value == null) {
    return null;
  }

  return String(value);
}

function normalizeForStableJson(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForStableJson(item));
  }

  if (value && typeof value === "object" && value.constructor === Object) {
    return Object.keys(value)
      .sort()
      .reduce((normalized, key) => {
        normalized[key] = normalizeForStableJson(value[key]);
        return normalized;
      }, {});
  }

  return value;
}

function stableJsonStringify(value) {
  return JSON.stringify(normalizeForStableJson(value ?? {}));
}

const CLAMP_METADATA_KEYS = new Set([
  "fullCostMinor",
  "settlementMode",
  "writeOffMinor",
]);

function stripClampMetadata(metadata) {
  return Object.keys(metadata ?? {})
    .filter((key) => !CLAMP_METADATA_KEYS.has(key))
    .sort()
    .reduce((normalized, key) => {
      normalized[key] = metadata[key];
      return normalized;
    }, {});
}

function assertReplayMatches(existingLedger, input) {
  const expectedCurrency = input.currency ?? "GBP";
  const expectedMetadata = input.metadata ?? {};

  const matches =
    existingLedger.type === input.type &&
    existingLedger.amountMinor === input.amountMinor &&
    existingLedger.currency === expectedCurrency &&
    existingLedger.reason === input.reason &&
    normalizeId(existingLedger.paymentOrderId) === normalizeId(input.paymentOrderId) &&
    normalizeId(existingLedger.generationId) === normalizeId(input.generationId) &&
    stableJsonStringify(existingLedger.metadata) === stableJsonStringify(expectedMetadata);

  if (!matches) {
    throw new LedgerError(
      "Ledger replay divergence for idempotency key.",
      "LEDGER_REPLAY_DIVERGENCE",
    );
  }
}

function assertClampReplayMatches(existingLedger, input) {
  const expectedCurrency = input.currency ?? "GBP";
  const requestedDebitMinor = Math.abs(input.amountMinor);
  const existingFullCostMinor = existingLedger.metadata?.fullCostMinor;
  const existingWriteOffMinor = existingLedger.metadata?.writeOffMinor ?? 0;
  const existingDebitMinor = Math.abs(existingLedger.amountMinor);

  const matches =
    existingLedger.type === input.type &&
    existingLedger.currency === expectedCurrency &&
    existingLedger.reason === input.reason &&
    normalizeId(existingLedger.paymentOrderId) === normalizeId(input.paymentOrderId) &&
    normalizeId(existingLedger.generationId) === normalizeId(input.generationId) &&
    existingLedger.metadata?.settlementMode === "clamp" &&
    existingFullCostMinor === requestedDebitMinor &&
    Number.isInteger(existingWriteOffMinor) &&
    existingWriteOffMinor >= 0 &&
    existingDebitMinor + existingWriteOffMinor === requestedDebitMinor &&
    stableJsonStringify(stripClampMetadata(existingLedger.metadata)) ===
      stableJsonStringify(stripClampMetadata(input.metadata));

  if (!matches) {
    throw new LedgerError(
      "Ledger replay divergence for idempotency key.",
      "LEDGER_REPLAY_DIVERGENCE",
    );
  }
}

function normalizeSettlementMode(mode) {
  if (mode == null || mode === "reject") {
    return "reject";
  }

  if (mode === "clamp") {
    return "clamp";
  }

  throw new LedgerError("Unsupported ledger settlement mode.", "INVALID_MODE");
}

export async function applyLedgeredBalanceChange(input) {
  validateLedgerChangeInput(input);

  const {
    amountMinor,
    currency = "GBP",
    generationId = null,
    idempotencyKey,
    metadata = {},
    paymentOrderId = null,
    reason,
    session,
    type,
  } = input;
  const settlementMode = normalizeSettlementMode(input.mode);

  if (settlementMode === "clamp" && amountMinor > 0) {
    throw new LedgerError(
      "Clamp settlement mode is only supported for debits.",
      "INVALID_MODE",
    );
  }

  if (typeof session.inTransaction === "function" && !session.inTransaction()) {
    throw new LedgerError(
      "A MongoDB transaction is required for ledgered balance changes.",
      "TRANSACTION_REQUIRED",
    );
  }

  const existingLedger = await CreditLedger.findOne({ idempotencyKey })
    .session(session)
    .lean();

  if (existingLedger) {
    if (settlementMode === "clamp" || existingLedger.metadata?.settlementMode === "clamp") {
      assertClampReplayMatches(existingLedger, {
        amountMinor,
        currency,
        generationId,
        metadata,
        paymentOrderId,
        reason,
        type,
      });
    } else {
      assertReplayMatches(existingLedger, {
        amountMinor,
        currency,
        generationId,
        idempotencyKey,
        metadata,
        paymentOrderId,
        reason,
        type,
      });
    }

    const balance = await Balance.findById("shared").session(session).lean();
    const writeOffMinor = existingLedger.metadata?.writeOffMinor ?? 0;
    const fullCostMinor =
      existingLedger.metadata?.fullCostMinor ?? Math.abs(existingLedger.amountMinor);

    return {
      applied: false,
      balance,
      clamped: writeOffMinor > 0,
      debitMinor: Math.abs(existingLedger.amountMinor),
      fullCostMinor,
      ledger: existingLedger,
      writeOffMinor,
    };
  }

  if (settlementMode === "clamp") {
    return applyClampedDebit({
      amountMinor,
      currency,
      generationId,
      idempotencyKey,
      metadata,
      paymentOrderId,
      reason,
      session,
      type,
    });
  }

  const [ledgerDocument] = await CreditLedger.create(
    [
      {
        amountMinor,
        balanceAfterMinor: 0,
        currency,
        generationId,
        idempotencyKey,
        metadata,
        paymentOrderId,
        reason,
        type,
      },
    ],
    { session },
  );

  const balanceFilter =
    amountMinor < 0
      ? { _id: "shared", amountMinor: { $gte: Math.abs(amountMinor) } }
      : { _id: "shared" };
  const updatedBalance = await Balance.findOneAndUpdate(
    balanceFilter,
    {
      $inc: {
        amountMinor,
      },
      $set: {
        currency,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        _id: "shared",
      },
    },
    {
      returnDocument: "after",
      session,
      upsert: amountMinor > 0,
    },
  ).lean();

  if (!updatedBalance) {
    throw new LedgerError("Insufficient balance.", "INSUFFICIENT_BALANCE");
  }

  ledgerDocument.balanceAfterMinor = updatedBalance.amountMinor;
  await ledgerDocument.save({ session });

  return {
    applied: true,
    balance: updatedBalance,
    clamped: false,
    debitMinor: amountMinor < 0 ? Math.abs(amountMinor) : 0,
    fullCostMinor: amountMinor < 0 ? Math.abs(amountMinor) : 0,
    ledger: serializeLedgerDocument(ledgerDocument),
    writeOffMinor: 0,
  };
}

async function applyClampedDebit({
  amountMinor,
  currency,
  generationId,
  idempotencyKey,
  metadata,
  paymentOrderId,
  reason,
  session,
  type,
}) {
  const fullCostMinor = Math.abs(amountMinor);
  const currentBalance = await Balance.findById("shared").session(session).lean();
  const availableMinor = currentBalance?.amountMinor ?? 0;
  const debitMinor = Math.min(fullCostMinor, availableMinor);
  const writeOffMinor = fullCostMinor - debitMinor;
  const clampMetadata = {
    ...metadata,
    fullCostMinor,
    settlementMode: "clamp",
    writeOffMinor,
  };

  // Full write-off: no money moved, so no ledger row (amountMinor cannot be 0).
  if (debitMinor === 0) {
    return {
      applied: true,
      balance: currentBalance ?? {
        _id: "shared",
        amountMinor: 0,
        currency,
      },
      clamped: true,
      debitMinor: 0,
      fullCostMinor,
      ledger: null,
      writeOffMinor,
    };
  }

  const [ledgerDocument] = await CreditLedger.create(
    [
      {
        amountMinor: -debitMinor,
        balanceAfterMinor: 0,
        currency,
        generationId,
        idempotencyKey,
        metadata: clampMetadata,
        paymentOrderId,
        reason,
        type,
      },
    ],
    { session },
  );

  const updatedBalance = await Balance.findOneAndUpdate(
    { _id: "shared", amountMinor: { $gte: debitMinor } },
    {
      $inc: {
        amountMinor: -debitMinor,
      },
      $set: {
        currency,
        updatedAt: new Date(),
      },
    },
    {
      returnDocument: "after",
      session,
    },
  ).lean();

  // Write conflict / concurrent drain should abort the transaction for retry.
  // Do not fall back to reject semantics for AI clamp mode.
  if (!updatedBalance) {
    throw new LedgerError(
      "Balance changed during clamp settlement; retry the transaction.",
      "CLAMP_RACE",
    );
  }

  ledgerDocument.balanceAfterMinor = updatedBalance.amountMinor;
  await ledgerDocument.save({ session });

  return {
    applied: true,
    balance: updatedBalance,
    clamped: writeOffMinor > 0,
    debitMinor,
    fullCostMinor,
    ledger: serializeLedgerDocument(ledgerDocument),
    writeOffMinor,
  };
}

export function isInsufficientBalanceError(error) {
  return error instanceof LedgerError && error.code === "INSUFFICIENT_BALANCE";
}

export function isLedgerReplayDivergenceError(error) {
  return error instanceof LedgerError && error.code === "LEDGER_REPLAY_DIVERGENCE";
}
