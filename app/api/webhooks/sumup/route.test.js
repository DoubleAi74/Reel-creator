import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { initializeDatabaseIndexes } from "../../../../lib/db/bootstrap.js";
import { connectToDatabase, disconnectFromDatabase } from "../../../../lib/db/mongoose.js";
import { Balance } from "../../../../lib/models/Balance.js";
import { CreditLedger } from "../../../../lib/models/CreditLedger.js";
import { PaymentOrder } from "../../../../lib/models/PaymentOrder.js";
import { WebhookEvent } from "../../../../lib/models/WebhookEvent.js";
import { retrieveCheckout } from "../../../../lib/payments/sumup-client.js";
import { resetSumUpEnvironmentForTests } from "../../../../lib/payments/sumup-env.js";
import { POST } from "./route";

vi.mock("../../../../lib/payments/sumup-client.js", async (importOriginal) => {
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

function paidCheckout(overrides = {}) {
  return {
    amount: 5,
    checkout_reference: "order-webhook",
    currency: "GBP",
    id: "checkout-webhook",
    merchant_code: "merchant-123",
    status: "PAID",
    transactions: [{ transaction_code: "T123" }],
    ...overrides,
  };
}

async function createOrder() {
  return PaymentOrder.create({
    amountMinor: 500,
    currency: "GBP",
    description: "Credit dashboard top-up",
    publicReference: "order-webhook",
    status: "PAYMENT_PENDING",
    sumupCheckoutId: "checkout-webhook",
    sumupCheckoutReference: "order-webhook",
    sumupCheckoutStatus: "PENDING",
  });
}

describe("POST /api/webhooks/sumup", () => {
  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        storageEngine: "wiredTiger",
      },
    });
    process.env.MONGODB_URI = replSet.getUri();
    process.env.MONGODB_DB_NAME = `webhook_route_stage6_${Date.now()}`;

    await connectToDatabase();
    await initializeDatabaseIndexes();
  }, 60000);

  beforeEach(async () => {
    await Balance.deleteMany({});
    await CreditLedger.deleteMany({});
    await PaymentOrder.deleteMany({});
    await WebhookEvent.deleteMany({});
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

  it("acknowledges malformed webhook bodies without storing raw payloads", async () => {
    const response = await POST(
      new Request("http://localhost/api/webhooks/sumup", {
        body: JSON.stringify({ status: "PAID" }),
        method: "POST",
      }),
    );

    await expect(response.json()).resolves.toEqual({ received: true });
    expect(await WebhookEvent.findOne().lean()).toMatchObject({
      checkoutId: null,
      checkoutReference: null,
      processingStatus: "IGNORED",
      safeErrorCode: "MISSING_IDENTIFIER",
    });
    expect(await CreditLedger.countDocuments()).toBe(0);
  });

  it("re-queries SumUp and credits exactly once across duplicate webhooks", async () => {
    await createOrder();
    retrieveCheckout.mockResolvedValue(paidCheckout());

    for (let index = 0; index < 2; index += 1) {
      const response = await POST(
        new Request("http://localhost/api/webhooks/sumup", {
          body: JSON.stringify({
            checkout_id: "checkout-webhook",
            event_type: "checkout.updated",
            status: "PAID_FROM_BODY_SHOULD_NOT_BE_TRUSTED",
          }),
          method: "POST",
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ received: true });
    }

    // REP-302: verification is background; wait for settlement.
    await vi.waitFor(async () => {
      expect(await CreditLedger.countDocuments()).toBe(1);
    });

    expect(await WebhookEvent.countDocuments()).toBe(2);
    await vi.waitFor(async () => {
      const events = await WebhookEvent.find({}).sort({ createdAt: 1 }).lean();
      expect(events).toEqual([
        expect.objectContaining({
          checkoutId: "checkout-webhook",
          processingStatus: "VERIFIED_PAID",
          safeErrorCode: null,
        }),
        expect.objectContaining({
          checkoutId: "checkout-webhook",
          processingStatus: "VERIFIED_PAID",
          safeErrorCode: null,
        }),
      ]);
    });
    expect(await Balance.findById("shared").lean()).toMatchObject({
      amountMinor: 1000,
    });
  });

  it("does not credit when the re-queried checkout is not paid", async () => {
    await createOrder();
    retrieveCheckout.mockResolvedValue(paidCheckout({ status: "PENDING" }));

    const response = await POST(
      new Request("http://localhost/api/webhooks/sumup", {
        body: JSON.stringify({
          checkout_id: "checkout-webhook",
          event_type: "checkout.updated",
          status: "PAID",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await vi.waitFor(async () => {
      expect(await WebhookEvent.findOne().lean()).toMatchObject({
        processingStatus: "MATCHED",
        safeErrorCode: "CHECKOUT_NOT_PAID",
      });
    });
    expect(await CreditLedger.countDocuments()).toBe(0);
  });
});
