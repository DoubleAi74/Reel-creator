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

    const balance = await Balance.findById("shared").session(session).lean();

    return {
      applied: false,
      balance,
      ledger: existingLedger,
    };
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
    ledger: serializeLedgerDocument(ledgerDocument),
  };
}

export function isInsufficientBalanceError(error) {
  return error instanceof LedgerError && error.code === "INSUFFICIENT_BALANCE";
}

export function isLedgerReplayDivergenceError(error) {
  return error instanceof LedgerError && error.code === "LEDGER_REPLAY_DIVERGENCE";
}
