import { FIRE_COST_MINOR, canDebitMinor, debitMinor } from "./money";

export function applyFireToDashboardState(state, createCard) {
  if (!canDebitMinor(state.balanceMinor, FIRE_COST_MINOR)) {
    return {
      fired: false,
      state,
    };
  }

  return {
    fired: true,
    state: {
      ...state,
      balanceMinor: debitMinor(state.balanceMinor, FIRE_COST_MINOR),
      cards: [createCard(), ...state.cards],
    },
  };
}
