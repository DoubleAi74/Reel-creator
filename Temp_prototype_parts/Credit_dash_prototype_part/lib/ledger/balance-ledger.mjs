import { Balance } from "../models/Balance.mjs";
import { CREDIT_LEDGER_TYPES, CreditLedger } from "../models/CreditLedger.mjs";

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

export async function applyLedgeredBalanceChange(input) {
  validateLedgerChangeInput(input);

  const {
    amountMinor,
    cardId = null,
    currency = "GBP",
    idempotencyKey,
    metadata = {},
    paymentOrderId = null,
    reason,
    session,
    type,
  } = input;

  const existingLedger = await CreditLedger.findOne({ idempotencyKey })
    .session(session)
    .lean();

  if (existingLedger) {
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
        cardId,
        currency,
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
