import { describe, expect, it } from "vitest";

import { applyFireToDashboardState } from "./dashboardState";

describe("dashboard fire state", () => {
  it("adds one card and stops exactly at zero", () => {
    const createCard = () => ({
      id: "new-card",
      title: "Test card",
      number: 100,
      colour: "#000000",
    });
    const startingState = {
      balanceMinor: 2,
      cards: [{ id: "existing-card" }],
    };

    const firstFire = applyFireToDashboardState(startingState, createCard);
    const secondFire = applyFireToDashboardState(firstFire.state, createCard);

    expect(firstFire.fired).toBe(true);
    expect(firstFire.state.balanceMinor).toBe(0);
    expect(firstFire.state.cards).toHaveLength(2);
    expect(secondFire.fired).toBe(false);
    expect(secondFire.state.balanceMinor).toBe(0);
    expect(secondFire.state.cards).toHaveLength(2);
  });
});
