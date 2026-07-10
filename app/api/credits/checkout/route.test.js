import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { initializeDatabaseIndexes } from "../../../../lib/db/bootstrap.js";
import { connectToDatabase, disconnectFromDatabase } from "../../../../lib/db/mongoose.js";
import { PaymentOrder } from "../../../../lib/models/PaymentOrder.js";
import { resetSumUpEnvironmentForTests } from "../../../../lib/payments/sumup-env.js";
import { POST } from "./route";

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

function checkoutResponse(id = "checkout-test") {
  return new Response(
    JSON.stringify({
      hosted_checkout_url: `https://checkout.sumup.com/pay/${id}`,
      id,
      status: "PENDING",
      valid_until: new Date(Date.now() + 60_000).toISOString(),
    }),
    {
      headers: {
        "Content-Type": "application/json",
      },
      status: 200,
    },
  );
}

describe("POST /api/credits/checkout", () => {
  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        storageEngine: "wiredTiger",
      },
    });
    process.env.MONGODB_URI = replSet.getUri();
    process.env.MONGODB_DB_NAME = `checkout_route_stage6_${Date.now()}`;

    await connectToDatabase();
    await initializeDatabaseIndexes();
  }, 60000);

  beforeEach(async () => {
    await PaymentOrder.deleteMany({});
    stubSumUpEnvironment();
    process.env.CREDITS_ENABLED = "true";
    vi.stubGlobal("fetch", vi.fn(async () => checkoutResponse()));
  });

  afterAll(async () => {
    resetSumUpEnvironmentForTests();
    vi.restoreAllMocks();
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

  it("rejects invalid top-up amounts before touching SumUp", async () => {
    const response = await POST(
      new Request("http://localhost/api/credits/checkout", {
        body: JSON.stringify({ amountMinor: 0 }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(await PaymentOrder.countDocuments()).toBe(0);
  });

  it("fails closed before creating an order when SumUp config is incomplete", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    resetSumUpEnvironmentForTests();
    vi.stubEnv("SUMUP_API_KEY", "");
    vi.stubEnv("SUMUP_API_KEY_TEST", "");
    vi.stubEnv("SUMUP_API_KEY_LIVE", "");
    vi.stubEnv("SUMUP_MERCHANT_CODE", "");
    vi.stubEnv("SUMUP_MERCHANT_CODE_TEST", "");
    vi.stubEnv("SUMUP_MERCHANT_CODE_LIVE", "");
    vi.stubEnv("SUMUP_CHECKOUT_RETURN_URL", "");
    vi.stubEnv("SUMUP_WEBHOOK_URL", "");
    fetch.mockClear();

    const response = await POST(
      new Request("http://localhost/api/credits/checkout", {
        body: JSON.stringify({ amountMinor: 500 }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Unable to create checkout.",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(await PaymentOrder.countDocuments()).toBe(0);
    consoleErrorSpy.mockRestore();
  });

  it("creates a SumUp checkout and reuses a recent pending checkout", async () => {
    const response = await POST(
      new Request("http://localhost/api/credits/checkout", {
        body: JSON.stringify({ amountMinor: 500 }),
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.checkoutUrl).toBe("https://checkout.sumup.com/pay/checkout-test");
    expect(body.orderId).toMatch(/^order_/);
    expect(await PaymentOrder.countDocuments()).toBe(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      amount: 5,
      checkout_reference: body.orderId,
      currency: "GBP",
      merchant_code: "merchant-123",
    });

    fetch.mockClear();
    const reusedResponse = await POST(
      new Request("http://localhost/api/credits/checkout", {
        body: JSON.stringify({ amountMinor: 500 }),
        method: "POST",
      }),
    );

    await expect(reusedResponse.json()).resolves.toMatchObject({
      checkoutUrl: "https://checkout.sumup.com/pay/checkout-test",
      orderId: body.orderId,
      reused: true,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
