import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/credits/credit-service", () => ({
  getBalance: vi.fn(),
}));

describe("GET /api/credits/balance", () => {
  it("returns the credit service balance shape", async () => {
    const creditService = await import("@/lib/credits/credit-service");
    const { GET } = await import("./route");

    creditService.getBalance.mockResolvedValue({
      balanceMinor: 500,
      currency: "GBP",
      enabled: true,
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      balanceMinor: 500,
      currency: "GBP",
      enabled: true,
    });
  });

  it("maps credit service errors to a safe 500 shape", async () => {
    const creditService = await import("@/lib/credits/credit-service");
    const { GET } = await import("./route");

    creditService.getBalance.mockRejectedValue(new Error("boom"));

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "credits_unavailable",
      message: "boom",
    });
  });
});
