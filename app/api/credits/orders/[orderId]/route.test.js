import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { initializeDatabaseIndexes } from "../../../../../lib/db/bootstrap.js";
import {
  connectToDatabase,
  disconnectFromDatabase,
} from "../../../../../lib/db/mongoose.js";
import { Balance } from "../../../../../lib/models/Balance.js";
import { CreditLedger } from "../../../../../lib/models/CreditLedger.js";
import { PaymentOrder } from "../../../../../lib/models/PaymentOrder.js";
import { retrieveCheckout } from "../../../../../lib/payments/sumup-client.js";
import { resetSumUpEnvironmentForTests } from "../../../../../lib/payments/sumup-env.js";
import { GET } from "./route";

vi.mock("../../../../../lib/payments/sumup-client.js", async (importOriginal) => {
  const actual = await importOriginal();

  return {
    ...actual,
    retrieveCheckout: vi.fn(),
  };
});

const ORIGINAL_MONGODB_URI = process.env.MONGODB_URI;
const ORIGINAL_MONGODB_DB_NAME = process.env.MONGODB_DB_NAME;

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

async function createOrder() {
  return PaymentOrder.create({
    amountMinor: 500,
    currency: "GBP",
    description: "Credit dashboard top-up",
    publicReference: "order-route",
    status: "PAYMENT_PENDING",
    sumupCheckoutId: "checkout-route",
    sumupCheckoutReference: "order-route",
    sumupCheckoutStatus: "PENDING",
  });
}

describe("GET /api/credits/orders/[orderId]", () => {
  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        storageEngine: "wiredTiger",
      },
    });
    process.env.MONGODB_URI = replSet.getUri();
    process.env.MONGODB_DB_NAME = `orders_route_stage6_${Date.now()}`;

    await connectToDatabase();
    await initializeDatabaseIndexes();
  }, 60000);

  beforeEach(async () => {
    await Balance.deleteMany({});
    await CreditLedger.deleteMany({});
    await PaymentOrder.deleteMany({});
    retrieveCheckout.mockReset();
    stubSumUpEnvironment();
    process.env.CREDITS_ENABLED = "true";
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
  });

  it("returns 404 for unknown order references", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: { orderId: "missing" },
    });

    expect(response.status).toBe(404);
    expect(retrieveCheckout).not.toHaveBeenCalled();
  });

  it("re-queries SumUp and credits a paid order", async () => {
    await createOrder();
    retrieveCheckout.mockResolvedValue({
      amount: 5,
      checkout_reference: "order-route",
      currency: "GBP",
      id: "checkout-route",
      merchant_code: "merchant-123",
      status: "PAID",
      transactions: [{ transaction_code: "T123" }],
    });

    const response = await GET(new Request("http://localhost"), {
      params: { orderId: "order-route" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      credited: true,
      order: {
        amountMinor: 500,
        balanceCredited: true,
        orderId: "order-route",
        status: "PAID",
      },
      verificationOk: true,
    });
    expect(await CreditLedger.countDocuments()).toBe(1);
  });
});
