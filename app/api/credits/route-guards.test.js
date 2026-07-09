/**
 * REP-701 — Route protection invariants: kill-switch (402), throttles (301/405/406).
 */
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { initializeDatabaseIndexes } from "../../../lib/db/bootstrap.js";
import { connectToDatabase, disconnectFromDatabase } from "../../../lib/db/mongoose.js";
import { PaymentOrder } from "../../../lib/models/PaymentOrder.js";
import { resetSumUpEnvironmentForTests } from "../../../lib/payments/sumup-env.js";
import {
  resetGenerationRateLimitForTests,
} from "../../../lib/credits/rate-limit.js";

const ORIGINAL_ENV = { ...process.env };

let replSet;

function stubSumUp() {
  resetSumUpEnvironmentForTests();
  vi.stubEnv("SUMUP_API_KEY", "sk_test_example");
  vi.stubEnv("SUMUP_API_BASE_URL", "https://api.sumup.test");
  vi.stubEnv("SUMUP_CHECKOUT_RETURN_URL", "https://example.com/payment/return");
  vi.stubEnv("SUMUP_CURRENCY", "GBP");
  vi.stubEnv("SUMUP_MERCHANT_CODE", "merchant-123");
  vi.stubEnv("SUMUP_MODE", "sandbox");
  vi.stubEnv("SUMUP_WEBHOOK_URL", "https://example.com/api/webhooks/sumup");
}

function checkoutResponse(id = "checkout-g") {
  return new Response(
    JSON.stringify({
      hosted_checkout_url: `https://checkout.sumup.com/pay/${id}`,
      id,
      status: "PENDING",
      valid_until: new Date(Date.now() + 60_000).toISOString(),
    }),
    { headers: { "Content-Type": "application/json" }, status: 200 },
  );
}

describe("REP-701 route guards", () => {
  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
    });
    process.env.MONGODB_URI = replSet.getUri();
    process.env.MONGODB_DB_NAME = `route_guards_${Date.now()}`;
    await connectToDatabase();
    await initializeDatabaseIndexes();
  }, 60000);

  beforeEach(async () => {
    await PaymentOrder.deleteMany({});
    resetGenerationRateLimitForTests();
    stubSumUp();
    process.env.CREDITS_ENABLED = "true";
    process.env.CHECKOUT_RATE_MAX = "2";
    process.env.CHECKOUT_RATE_WINDOW_SECONDS = "600";
    process.env.ORDER_RATE_MAX = "2";
    process.env.ORDER_RATE_WINDOW_SECONDS = "60";
    process.env.UNLOCK_RATE_MAX = "2";
    process.env.UNLOCK_RATE_WINDOW_SECONDS = "300";
    process.env.GENERATION_PASSWORD = "shared-password";
    process.env.GENERATION_UNLOCK_SECRET = "test-secret-for-unlock";
    vi.stubGlobal("fetch", vi.fn(async () => checkoutResponse(crypto.randomUUID())));
  });

  afterAll(async () => {
    resetSumUpEnvironmentForTests();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await disconnectFromDatabase();
    await replSet?.stop();
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("kill-switch: credits routes return disabled when CREDITS_ENABLED=false", async () => {
    process.env.CREDITS_ENABLED = "false";
    const checkout = await import("./checkout/route.js");
    const orders = await import("./orders/[orderId]/route.js");
    const unlock = await import("./unlock/route.js");
    const webhook = await import("../webhooks/sumup/route.js");
    const dashboard = await import("../dashboard/state/route.js");
    const media = await import("../media/generations/[id]/route.js");

    const checkoutRes = await checkout.POST(
      new Request("http://localhost/api/credits/checkout", {
        body: JSON.stringify({ amountMinor: 500 }),
        method: "POST",
      }),
    );
    expect(checkoutRes.status).toBe(404);
    await expect(checkoutRes.json()).resolves.toMatchObject({ enabled: false });

    const orderRes = await orders.GET(
      new Request("http://localhost/api/credits/orders/order_x"),
      { params: Promise.resolve({ orderId: "order_x" }) },
    );
    expect(orderRes.status).toBe(404);

    const unlockRes = await unlock.POST(
      new Request("http://localhost/api/credits/unlock", {
        body: JSON.stringify({ password: "shared-password" }),
        method: "POST",
      }),
    );
    expect(unlockRes.status).toBe(200);
    await expect(unlockRes.json()).resolves.toEqual({ enabled: false });

    const webhookRes = await webhook.POST(
      new Request("http://localhost/api/webhooks/sumup", {
        body: JSON.stringify({ checkout_id: "c1" }),
        method: "POST",
      }),
    );
    expect(webhookRes.status).toBe(404);

    const dashRes = await dashboard.GET();
    expect(dashRes.status).toBe(200);
    await expect(dashRes.json()).resolves.toMatchObject({
      enabled: false,
      generations: [],
    });

    const mediaRes = await media.GET(
      new Request("http://localhost/api/media/generations/000000000000000000000001"),
      { params: Promise.resolve({ id: "000000000000000000000001" }) },
    );
    expect(mediaRes.status).toBe(404);
  });

  it("checkout throttle: distinct-amount burst returns 429; single top-up passes", async () => {
    const { POST } = await import("./checkout/route.js");

    const first = await POST(
      new Request("http://localhost/api/credits/checkout", {
        body: JSON.stringify({ amountMinor: 100 }),
        headers: { "x-forwarded-for": "198.51.100.10" },
        method: "POST",
      }),
    );
    expect([200, 201]).toContain(first.status);

    const second = await POST(
      new Request("http://localhost/api/credits/checkout", {
        body: JSON.stringify({ amountMinor: 200 }),
        headers: { "x-forwarded-for": "198.51.100.10" },
        method: "POST",
      }),
    );
    expect([200, 201]).toContain(second.status);

    const third = await POST(
      new Request("http://localhost/api/credits/checkout", {
        body: JSON.stringify({ amountMinor: 300 }),
        headers: { "x-forwarded-for": "198.51.100.10" },
        method: "POST",
      }),
    );
    expect(third.status).toBe(429);
    await expect(third.json()).resolves.toMatchObject({ error: "rate_limited" });
  });

  it("checkout reuse path is not throttled", async () => {
    const { POST } = await import("./checkout/route.js");
    const headers = { "x-forwarded-for": "198.51.100.20" };

    const create = await POST(
      new Request("http://localhost/api/credits/checkout", {
        body: JSON.stringify({ amountMinor: 750 }),
        headers,
        method: "POST",
      }),
    );
    expect([200, 201]).toContain(create.status);
    const created = await create.json();

    // Exhaust limit with other amounts
    await POST(
      new Request("http://localhost/api/credits/checkout", {
        body: JSON.stringify({ amountMinor: 751 }),
        headers,
        method: "POST",
      }),
    );
    const blocked = await POST(
      new Request("http://localhost/api/credits/checkout", {
        body: JSON.stringify({ amountMinor: 752 }),
        headers,
        method: "POST",
      }),
    );
    expect(blocked.status).toBe(429);

    // Same amount reuses pending order without creating a new SumUp checkout
    const reused = await POST(
      new Request("http://localhost/api/credits/checkout", {
        body: JSON.stringify({ amountMinor: 750 }),
        headers,
        method: "POST",
      }),
    );
    expect(reused.status).toBe(200);
    await expect(reused.json()).resolves.toMatchObject({
      orderId: created.orderId,
      reused: true,
    });
  });

  it("order re-query throttle returns 429 under enumeration burst", async () => {
    const { GET } = await import("./orders/[orderId]/route.js");
    const headers = { "x-forwarded-for": "198.51.100.30" };

    const first = await GET(
      new Request("http://localhost/api/credits/orders/missing-1", { headers }),
      { params: Promise.resolve({ orderId: "missing-1" }) },
    );
    // 404 not found still counts as a limited attempt
    expect([404, 429]).toContain(first.status);

    await GET(
      new Request("http://localhost/api/credits/orders/missing-2", { headers }),
      { params: Promise.resolve({ orderId: "missing-2" }) },
    );
    const third = await GET(
      new Request("http://localhost/api/credits/orders/missing-3", { headers }),
      { params: Promise.resolve({ orderId: "missing-3" }) },
    );
    expect(third.status).toBe(429);
    await expect(third.json()).resolves.toMatchObject({ error: "rate_limited" });
  });

  it("unlock brute-force throttle returns 429 after repeated attempts", async () => {
    // Use real unlock path (no rate-limit mock)
    vi.resetModules();
    process.env.CREDITS_ENABLED = "true";
    const { POST } = await import("./unlock/route.js");
    const headers = { "x-forwarded-for": "198.51.100.40" };

    const wrong1 = await POST(
      new Request("http://localhost/api/credits/unlock", {
        body: JSON.stringify({ password: "wrong" }),
        headers,
        method: "POST",
      }),
    );
    expect([401, 429]).toContain(wrong1.status);

    const wrong2 = await POST(
      new Request("http://localhost/api/credits/unlock", {
        body: JSON.stringify({ password: "wrong" }),
        headers,
        method: "POST",
      }),
    );
    expect([401, 429]).toContain(wrong2.status);

    const wrong3 = await POST(
      new Request("http://localhost/api/credits/unlock", {
        body: JSON.stringify({ password: "wrong" }),
        headers,
        method: "POST",
      }),
    );
    expect(wrong3.status).toBe(429);
    await expect(wrong3.json()).resolves.toMatchObject({ error: "rate_limited" });
  });
});
