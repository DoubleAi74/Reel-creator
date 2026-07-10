// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import DashboardClient from "./DashboardClient";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DashboardClient dev controls", () => {
  it("hides the Set balance form when test controls are disabled", () => {
    render(
      createElement(DashboardClient, {
        loadInitialState: false,
        testControlsEnabled: false,
      }),
    );

    expect(screen.queryByTestId("dev-set-balance")).toBe(null);
  });

  it("sets the local balance when test controls are enabled", async () => {
    const user = userEvent.setup();
    render(
      createElement(DashboardClient, {
        loadInitialState: false,
        testControlsEnabled: true,
      }),
    );

    expect(screen.getByTestId("dev-set-balance")).toBeTruthy();

    const input = screen.getByLabelText("Set balance");
    await user.clear(input);
    await user.type(input, "0.01");
    await user.click(screen.getByRole("button", { name: "Set" }));

    expect(screen.getByText("£0.01")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fire" }).disabled).toBe(true);
  });
});

describe("DashboardClient top-up checkout", () => {
  it("rejects out-of-range top-ups before calling the server", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      createElement(DashboardClient, {
        loadInitialState: false,
        testControlsEnabled: false,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Add money" }));
    const input = screen.getByLabelText(/Amount/);
    await user.clear(input);
    await user.type(input, "101.00");
    await user.click(screen.getByRole("button", { name: "Go to checkout" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "Enter £0.01 to £100.00.",
    );
  });

  it("posts integer pence and redirects to the server-returned checkout URL", async () => {
    const user = userEvent.setup();
    const checkoutUrl = "https://checkout.sumup.com/pay/test-checkout";
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        checkoutUrl,
        orderId: "order_test",
      }),
      ok: true,
    });
    const redirectSpy = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      createElement(DashboardClient, {
        loadInitialState: false,
        onCheckoutRedirect: redirectSpy,
        testControlsEnabled: false,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Add money" }));
    const input = screen.getByLabelText(/Amount/);
    await user.clear(input);
    await user.type(input, "12.34");
    await user.click(screen.getByRole("button", { name: "Go to checkout" }));

    await waitFor(() => expect(redirectSpy).toHaveBeenCalledWith(checkoutUrl));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/payments/sumup/checkout",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      amountMinor: 1234,
    });
  });
});

describe("DashboardClient card creation", () => {
  it("uses the paid fire path when the visible Add card button is clicked", async () => {
    const user = userEvent.setup();

    render(
      createElement(DashboardClient, {
        loadInitialState: false,
        testControlsEnabled: false,
      }),
    );

    expect(screen.getByText("£5.00")).toBeTruthy();
    expect(screen.getByText("6 on dashboard")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Add card" }));

    expect(screen.getByText("£4.98")).toBeTruthy();
    expect(screen.getByText("7 on dashboard")).toBeTruthy();
  });
});
