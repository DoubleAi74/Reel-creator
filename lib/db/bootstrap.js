import { Balance } from "../models/Balance.js";
import { CreditLedger } from "../models/CreditLedger.js";
import { Generation } from "../models/Generation.js";
import { GenerationCounter } from "../models/GenerationCounter.js";
import { PaymentOrder } from "../models/PaymentOrder.js";
import { RefundRecord } from "../models/RefundRecord.js";
import { UsageRecord } from "../models/UsageRecord.js";
import { WebhookEvent } from "../models/WebhookEvent.js";
import { connectToDatabase } from "./mongoose.js";

export const DEFAULT_INITIAL_BALANCE_MINOR = 500;

const INDEXED_MODELS = [
  Balance,
  CreditLedger,
  Generation,
  GenerationCounter,
  PaymentOrder,
  RefundRecord,
  UsageRecord,
  WebhookEvent,
];

export async function initializeDatabaseIndexes() {
  await connectToDatabase();
  await Promise.all(INDEXED_MODELS.map((model) => model.init()));
}

export async function ensureSharedBalance() {
  await connectToDatabase();

  return Balance.findOneAndUpdate(
    { _id: "shared" },
    {
      $setOnInsert: {
        _id: "shared",
        amountMinor: getInitialBalanceMinor(),
        currency: "GBP",
        updatedAt: new Date(),
      },
    },
    {
      returnDocument: "after",
      upsert: true,
    },
  ).lean();
}

export function getInitialBalanceMinor() {
  const rawInitialBalance = process.env.INITIAL_BALANCE_MINOR;

  if (rawInitialBalance == null || rawInitialBalance === "") {
    return DEFAULT_INITIAL_BALANCE_MINOR;
  }

  const parsedInitialBalance = Number(rawInitialBalance);

  if (!Number.isInteger(parsedInitialBalance) || parsedInitialBalance < 0) {
    throw new Error("INITIAL_BALANCE_MINOR must be a non-negative integer pence value.");
  }

  return parsedInitialBalance;
}
