import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { initializeDatabaseIndexes } from "../db/bootstrap.js";
import { connectToDatabase, disconnectFromDatabase } from "../db/mongoose.js";
import { Balance } from "../models/Balance.js";
import { CreditLedger } from "../models/CreditLedger.js";
import { PaymentOrder } from "../models/PaymentOrder.js";
import { retrieveCheckout } from "./sumup-client.js";
import { resetSumUpEnvironmentForTests } from "./sumup-env.js";
import {
  getCheckoutTransactionId,
  majorAmountToMinor,
  mapCheckoutStatusToOrderStatus,
  refreshPaymentOrderFromSumUp,
  verifyPaidCheckout,
} from "./payment-verification.js";

vi.mock("./sumup-client.js", async (importOriginal) => {
  const actual = await importOriginal();

  return {
    ...actual,
    retrieveCheckout: vi.fn(),
  };
});

const ORIGINAL_MONGODB_URI = process.env.MONGODB_URI;
const ORIGINAL_MONGODB_DB_NAME = process.env.MONGODB_DB_NAME;
const ORIGINAL_INITIAL_BALANCE_MINOR = process.env.INITIAL_BALANCE_MINOR;

let replSet;

function stubSumUpEnvironment() {
  resetSumUpEnvironmentForTests();
  vi.stubEnv("SUMUP_API_KEY", "sk_test_example");
  vi.stubEnv("SUMUP_API_BASE_URL", "https://api.sumup.test");
  vi.stubEnv("SUMUP_CHECKOUT_RETURN_URL", "https://example.com/payment/return");
  vi.stubEnv("SUMUP_CURRENCY", "GBP");
  vi.stubEnv("SUMUP_MERCHANT_CODE", "merchant-123");
  vi.stubEnv("SUMUP_MODE", "sandbox");
  vi.stubEnv("SUMUP_WEBHOOK_URL", "https://example.com/api/webhooks/sumup");
}

function paidCheckout(overrides = {}) {
  return {
    amount: 5,
    checkout_reference: "order-test",
    currency: "GBP",
    id: "checkout-test",
    merchant_code: "merchant-123",
    status: "PAID",
    transactions: [{ transaction_code: "T123" }],
    ...overrides,
  };
}

async function createOrder(overrides = {}) {
  return PaymentOrder.create({
    amountMinor: 500,
    currency: "GBP",
    description: "Credit dashboard top-up",
    publicReference: "order-test",
    status: "PAYMENT_PENDING",
    sumupCheckoutId: "checkout-test",
    sumupCheckoutReference: "order-test",
    sumupCheckoutStatus: "PENDING",
    ...overrides,
  });
}

describe("payment verification", () => {
  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        storageEngine: "wiredTiger",
      },
    });
    process.env.MONGODB_URI = replSet.getUri();
    process.env.MONGODB_DB_NAME = `payment_stage6_${Date.now()}`;

    await connectToDatabase();
    await initializeDatabaseIndexes();
  }, 60000);

  beforeEach(async () => {
    await Balance.deleteMany({});
    await CreditLedger.deleteMany({});
    await PaymentOrder.deleteMany({});
    delete process.env.INITIAL_BALANCE_MINOR;
    retrieveCheckout.mockReset();
    stubSumUpEnvironment();
  });

  afterAll(async () => {
    resetSumUpEnvironmentForTests();
    vi.unstubAllEnvs();
    await disconnectFromDatabase();
    await replSet?.stop();

    if (ORIGINAL_MONGODB_URI == null) {
      delete process.env.MONGODB_URI;
    } else {
      process.env.MONGODB_URI = ORIGINAL_MONGODB_URI;
    }

    if (ORIGINAL_MONGODB_DB_NAME == null) {
      delete process.env.MONGODB_DB_NAME;
    } else {
      process.env.MONGODB_DB_NAME = ORIGINAL_MONGODB_DB_NAME;
    }

    if (ORIGINAL_INITIAL_BALANCE_MINOR == null) {
      delete process.env.INITIAL_BALANCE_MINOR;
    } else {
      process.env.INITIAL_BALANCE_MINOR = ORIGINAL_INITIAL_BALANCE_MINOR;
    }
  });

  it("validates checkout helpers", () => {
    const order = {
      amountMinor: 500,
      currency: "GBP",
      sumupCheckoutId: "checkout-test",
      sumupCheckoutReference: "order-test",
    };

    expect(majorAmountToMinor(12.34)).toBe(1234);
    expect(mapCheckoutStatusToOrderStatus("FAILED")).toBe("PAYMENT_FAILED");
    expect(getCheckoutTransactionId({ transactions: [{ id: "txn-id" }] })).toBe(
      "txn-id",
    );
    expect(
      verifyPaidCheckout({
        checkout: paidCheckout(),
        merchantCode: "merchant-123",
        order,
      }),
    ).toEqual({ failures: [], ok: true });
    expect(
      verifyPaidCheckout({
        checkout: paidCheckout({ amount: 4 }),
        merchantCode: "merchant-123",
        order,
      }),
    ).toEqual({ failures: ["amount"], ok: false });
  });

  it("credits a verified paid checkout exactly once across concurrent refreshes", async () => {
    const order = await createOrder();
    retrieveCheckout.mockResolvedValue(paidCheckout());

    const results = await Promise.all([
      refreshPaymentOrderFromSumUp(order.toObject()),
      refreshPaymentOrderFromSumUp(order.toObject()),
    ]);

    expect(results.filter((result) => result.credited)).toHaveLength(1);
    expect(results.every((result) => result.verification.ok)).toBe(true);
    expect(await CreditLedger.countDocuments()).toBe(1);
    expect(await CreditLedger.findOne().lean()).toMatchObject({
      amountMinor: 500,
      idempotencyKey: `top_up:${order._id.toString()}`,
      type: "TOP_UP",
    });
    expect(await Balance.findById("shared").lean()).toMatchObject({
      amountMinor: 1000,
      currency: "GBP",
    });
    expect(await PaymentOrder.findById(order._id).lean()).toMatchObject({
      balanceCredited: true,
      status: "PAID",
      sumupTransactionId: "T123",
    });
  });

  it("does not credit paid checkouts with amount or currency mismatches", async () => {
    const order = await createOrder();
    retrieveCheckout.mockResolvedValue(paidCheckout({ amount: 4 }));

    const result = await refreshPaymentOrderFromSumUp(order.toObject());

    expect(result.credited).toBe(false);
    expect(result.verification).toEqual({ failures: ["amount"], ok: false });
    expect(await CreditLedger.countDocuments()).toBe(0);
    expect(await Balance.findById("shared")).toBeNull();
  });

  it("updates non-paid checkouts without crediting", async () => {
    const order = await createOrder();
    retrieveCheckout.mockResolvedValue(paidCheckout({ status: "EXPIRED" }));

    const result = await refreshPaymentOrderFromSumUp(order.toObject());

    expect(result.credited).toBe(false);
    expect(result.verification).toEqual({ failures: ["status"], ok: false });
    expect(result.order).toMatchObject({
      status: "PAYMENT_EXPIRED",
      sumupCheckoutStatus: "EXPIRED",
    });
    expect(await CreditLedger.countDocuments()).toBe(0);
  });
});
