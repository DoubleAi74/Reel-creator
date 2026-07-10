"use client";

import React, { useEffect, useReducer, useRef, useState } from "react";

import { applyFireToDashboardState } from "../lib/dashboardState";
import {
  FIRE_COST_MINOR,
  TOP_UP_MAX_MINOR,
  TOP_UP_MIN_MINOR,
  canDebitMinor,
  clampMinor,
  formatGbpFromMinor,
  isValidTopUpMinor,
  parseGbpInputToMinor,
} from "../lib/money";

const cardTitles = [
  "Aurora credit",
  "Mint reserve",
  "Studio float",
  "Launch buffer",
  "Signal fund",
  "North star",
  "Tempo pool",
  "Market spark",
  "Orbit stash",
  "Ledger lift",
];

const cardColours = [
  "#f97316",
  "#14b8a6",
  "#8b5cf6",
  "#0ea5e9",
  "#f43f5e",
  "#84cc16",
  "#eab308",
  "#6366f1",
];

const initialCards = [
  {
    id: "seed-aurora",
    title: "Aurora credit",
    number: 214,
    colour: "#f97316",
  },
  {
    id: "seed-mint",
    title: "Mint reserve",
    number: 87,
    colour: "#14b8a6",
  },
  {
    id: "seed-studio",
    title: "Studio float",
    number: 341,
    colour: "#8b5cf6",
  },
  {
    id: "seed-launch",
    title: "Launch buffer",
    number: 52,
    colour: "#0ea5e9",
  },
  {
    id: "seed-signal",
    title: "Signal fund",
    number: 703,
    colour: "#f43f5e",
  },
  {
    id: "seed-north",
    title: "North star",
    number: 129,
    colour: "#84cc16",
  },
];

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function createRandomCard() {
  return {
    id: crypto.randomUUID(),
    title: pickRandom(cardTitles),
    number: Math.floor(Math.random() * 900) + 100,
    colour: pickRandom(cardColours),
  };
}

function dashboardReducer(state, action) {
  switch (action.type) {
    case "add_card":
      return {
        ...state,
        cards: [createRandomCard(), ...state.cards],
      };
    case "insert_card":
      return {
        ...state,
        cards: [action.card, ...state.cards],
      };
    case "remove_card":
      return {
        ...state,
        cards: state.cards.filter((card) => card.id !== action.cardId),
      };
    case "fire_card":
      return applyFireToDashboardState(state, createRandomCard).state;
    case "fire_card_success":
      return {
        ...state,
        balanceMinor: action.balance.amountMinor,
        cards: [action.card, ...state.cards],
      };
    case "replace_balance":
      return {
        ...state,
        balanceMinor: action.balance.amountMinor,
      };
    case "set_balance":
      return {
        ...state,
        balanceMinor: clampMinor(action.amountMinor, 0, 100000),
      };
    case "load_state_success":
      return {
        ...state,
        balanceMinor: action.balance.amountMinor,
        cards: action.cards,
        loadError: null,
        loading: false,
      };
    case "load_state_error":
      return {
        ...state,
        loadError: action.message,
        loading: false,
      };
    default:
      return state;
  }
}

export default function DashboardClient({
  loadInitialState = true,
  onCheckoutRedirect = (checkoutUrl) => window.location.assign(checkoutUrl),
  testControlsEnabled,
}) {
  const [dashboardState, dispatchDashboard] = useReducer(dashboardReducer, {
    cards: loadInitialState ? [] : initialCards,
    balanceMinor: 500,
    loadError: null,
    loading: loadInitialState,
  });
  const [setBalanceInput, setSetBalanceInput] = useState("5.00");
  const [topUpInput, setTopUpInput] = useState("5.00");
  const [isTopUpOpen, setIsTopUpOpen] = useState(false);
  const [isCheckoutStarting, setIsCheckoutStarting] = useState(false);
  const [topUpError, setTopUpError] = useState(null);
  const [isMutating, setIsMutating] = useState(false);
  const [actionError, setActionError] = useState(null);
  const flashTimeoutRef = useRef(null);
  const flashStartTimeoutRef = useRef(null);
  const { cards, balanceMinor } = dashboardState;
  const isLoading = dashboardState.loading;
  const canFire = canDebitMinor(balanceMinor, FIRE_COST_MINOR);
  const isBusy = isLoading || isMutating || isCheckoutStarting;

  async function addCard() {
    if (!loadInitialState) {
      dispatchDashboard({ type: "add_card" });
      return;
    }

    setActionError(null);
    setIsMutating(true);

    try {
      const response = await fetch("/api/dashboard/cards", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Unable to add card.");
      }

      const result = await response.json();
      dispatchDashboard({ type: "insert_card", card: result.card });
    } catch {
      setActionError("Unable to add card.");
    } finally {
      setIsMutating(false);
    }
  }

  async function removeCard(cardId) {
    if (!loadInitialState) {
      dispatchDashboard({ type: "remove_card", cardId });
      return;
    }

    setActionError(null);
    setIsMutating(true);

    try {
      const response = await fetch(`/api/dashboard/cards/${cardId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Unable to remove card.");
      }

      dispatchDashboard({ type: "remove_card", cardId });
    } catch {
      setActionError("Unable to remove card.");
    } finally {
      setIsMutating(false);
    }
  }

  function triggerHeaderFlash() {
    if (flashStartTimeoutRef.current) {
      clearTimeout(flashStartTimeoutRef.current);
    }
    if (flashTimeoutRef.current) {
      clearTimeout(flashTimeoutRef.current);
    }

    flashStartTimeoutRef.current = setTimeout(() => {
      const headerElement = document.querySelector("[data-dashboard-header]");
      if (headerElement) {
        headerElement.classList.remove("dashboard-header-flash");
        headerElement.classList.add("dashboard-header-flash");
      }

      flashTimeoutRef.current = setTimeout(() => {
        document
          .querySelector("[data-dashboard-header]")
          ?.classList.remove("dashboard-header-flash");
      }, 600);
    }, 30);
  }

  async function fireCard() {
    if (!canFire || isLoading || isMutating) {
      return;
    }

    if (!loadInitialState) {
      dispatchDashboard({ type: "fire_card" });
      triggerHeaderFlash();
      return;
    }

    setActionError(null);
    setIsMutating(true);

    try {
      const response = await fetch("/api/dashboard/fire", {
        method: "POST",
      });
      const result = await response.json();

      if (response.status === 409) {
        dispatchDashboard({ type: "replace_balance", balance: result.balance });
        setActionError("Balance too low.");
        return;
      }

      if (!response.ok) {
        throw new Error("Unable to fire card.");
      }

      dispatchDashboard({
        type: "fire_card_success",
        balance: result.balance,
        card: result.card,
      });
      triggerHeaderFlash();
    } catch {
      setActionError("Unable to fire card.");
    } finally {
      setIsMutating(false);
    }
  }

  async function setBalance(event) {
    event.preventDefault();
    const amountMinor = parseGbpInputToMinor(setBalanceInput);

    if (amountMinor === null) {
      return;
    }

    if (!loadInitialState) {
      dispatchDashboard({ type: "set_balance", amountMinor });
      return;
    }

    setActionError(null);
    setIsMutating(true);

    try {
      const response = await fetch("/api/dashboard/balance", {
        body: JSON.stringify({ amountMinor }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Unable to set balance.");
      }

      const result = await response.json();
      dispatchDashboard({ type: "replace_balance", balance: result.balance });
    } catch {
      setActionError("Unable to set balance.");
    } finally {
      setIsMutating(false);
    }
  }

  async function startCheckout(event) {
    event.preventDefault();
    const amountMinor = parseGbpInputToMinor(topUpInput);

    if (!isValidTopUpMinor(amountMinor)) {
      setTopUpError(
        `Enter ${formatGbpFromMinor(TOP_UP_MIN_MINOR)} to ${formatGbpFromMinor(
          TOP_UP_MAX_MINOR,
        )}.`,
      );
      return;
    }

    setActionError(null);
    setTopUpError(null);
    setIsCheckoutStarting(true);

    try {
      const response = await fetch("/api/payments/sumup/checkout", {
        body: JSON.stringify({ amountMinor }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const result = await response.json();

      if (!response.ok || !result.checkoutUrl) {
        throw new Error("Unable to start checkout.");
      }

      onCheckoutRedirect(result.checkoutUrl);
    } catch {
      setTopUpError("Unable to start checkout.");
      setIsCheckoutStarting(false);
    }
  }

  useEffect(() => {
    if (!loadInitialState) {
      return undefined;
    }

    const controller = new AbortController();

    async function loadState() {
      try {
        const response = await fetch("/api/dashboard/state", {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Unable to load dashboard state.");
        }

        const state = await response.json();

        dispatchDashboard({
          type: "load_state_success",
          balance: state.balance,
          cards: state.cards,
        });
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        dispatchDashboard({
          type: "load_state_error",
          message: "Unable to load dashboard state.",
        });
      }
    }

    loadState();

    return () => {
      controller.abort();
    };
  }, [loadInitialState]);

  useEffect(() => {
    return () => {
      if (flashStartTimeoutRef.current) {
        clearTimeout(flashStartTimeoutRef.current);
      }
      if (flashTimeoutRef.current) {
        clearTimeout(flashTimeoutRef.current);
      }
    };
  }, []);

  return (
    <main className="min-h-screen bg-paper text-ink">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header
          className="-mx-3 flex flex-col gap-5 rounded-lg border-b border-ink/10 px-3 py-3 transition-colors duration-[600ms] sm:flex-row sm:items-center sm:justify-between"
          data-dashboard-header="true"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/55">
              Prototype
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal sm:text-4xl">
              Credit dashboard
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:justify-end">
            <div
              aria-label={`Balance ${formatGbpFromMinor(balanceMinor)}`}
              className="rounded-lg border border-ink/10 bg-white px-4 py-2 shadow-panel"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">
                Balance
              </p>
              <p className="text-xl font-semibold tabular-nums">
                {formatGbpFromMinor(balanceMinor)}
              </p>
            </div>
            <button
              aria-label="Fire"
              className="grid h-12 w-12 place-items-center rounded-lg bg-ember text-xl shadow-panel transition hover:bg-ember/85 focus:outline-none focus:ring-2 focus:ring-ember focus:ring-offset-2 focus:ring-offset-paper disabled:cursor-not-allowed disabled:bg-ink/20 disabled:saturate-0"
              disabled={!canFire || isBusy}
              onClick={fireCard}
              title={canFire ? "Fire" : "Balance too low"}
              type="button"
            >
              🔥
            </button>
            <button
              className="inline-flex min-h-12 items-center rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white shadow-panel transition hover:bg-ink/85 focus:outline-none focus:ring-2 focus:ring-mint focus:ring-offset-2 focus:ring-offset-paper"
              aria-expanded={isTopUpOpen}
              aria-controls="top-up-panel"
              onClick={() => {
                setIsTopUpOpen((currentValue) => !currentValue);
                setTopUpError(null);
              }}
              type="button"
            >
              Add money
            </button>
          </div>
        </header>

        {isTopUpOpen ? (
          <form
            className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-mint/25 bg-white/85 p-3 shadow-panel"
            id="top-up-panel"
            onSubmit={startCheckout}
          >
            <label className="grid gap-1 text-sm font-medium" htmlFor="top-up-amount">
              Amount
              <span className="flex h-10 items-center rounded-lg border border-ink/15 bg-white px-3 focus-within:border-mint focus-within:ring-2 focus-within:ring-mint/30">
                <span className="text-ink/50">£</span>
                <input
                  className="h-full w-28 border-0 bg-transparent px-2 text-sm tabular-nums outline-none"
                  id="top-up-amount"
                  inputMode="decimal"
                  disabled={isBusy}
                  onChange={(event) => setTopUpInput(event.target.value)}
                  placeholder="5.00"
                  type="text"
                  value={topUpInput}
                />
              </span>
            </label>
            <button
              className="inline-flex h-10 items-center rounded-lg bg-mint px-4 text-sm font-semibold text-white transition hover:bg-mint/85 focus:outline-none focus:ring-2 focus:ring-mint focus:ring-offset-2 focus:ring-offset-paper disabled:cursor-wait disabled:bg-ink/25"
              disabled={isBusy}
              type="submit"
            >
              {isCheckoutStarting ? "Redirecting..." : "Go to checkout"}
            </button>
            {topUpError ? (
              <p className="basis-full text-sm font-medium text-ember" role="alert">
                {topUpError}
              </p>
            ) : null}
          </form>
        ) : null}

        {testControlsEnabled ? (
          <form
            className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-ember/20 bg-white/80 p-3 shadow-panel"
            data-testid="dev-set-balance"
            onSubmit={setBalance}
          >
            <label className="grid gap-1 text-sm font-medium" htmlFor="set-balance">
              Set balance
              <input
                className="h-10 w-32 rounded-lg border border-ink/15 bg-white px-3 text-sm tabular-nums outline-none transition focus:border-mint focus:ring-2 focus:ring-mint/30"
                id="set-balance"
                inputMode="decimal"
                disabled={isBusy}
                onChange={(event) => setSetBalanceInput(event.target.value)}
                placeholder="5.00"
                type="text"
                value={setBalanceInput}
              />
            </label>
            <button
              className="inline-flex h-10 items-center rounded-lg bg-ember px-4 text-sm font-semibold text-white transition hover:bg-ember/85 focus:outline-none focus:ring-2 focus:ring-ember focus:ring-offset-2 focus:ring-offset-paper"
              disabled={isBusy}
              type="submit"
            >
              Set
            </button>
          </form>
        ) : null}

        {actionError ? (
          <div className="mt-4 rounded-lg border border-ember/20 bg-white/80 px-4 py-3 text-sm font-medium text-ember shadow-panel">
            {actionError}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 py-5">
          <div>
            <h2 className="text-lg font-semibold">Cards</h2>
            <p className="text-sm text-ink/55">{cards.length} on dashboard</p>
          </div>
          <button
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white shadow-panel transition hover:bg-ink/85 focus:outline-none focus:ring-2 focus:ring-mint focus:ring-offset-2 focus:ring-offset-paper"
            disabled={!canFire || isBusy}
            onClick={fireCard}
            title={canFire ? "Add card" : "Balance too low"}
            type="button"
          >
            <span aria-hidden="true" className="text-lg leading-none">
              +
            </span>
            Add card
          </button>
        </div>

        <div className="pb-8">
          {dashboardState.loadError ? (
            <div className="grid min-h-60 place-items-center rounded-lg border border-ember/20 bg-white/70 p-8 text-center shadow-panel">
              <div>
                <p className="text-lg font-medium">Could not load dashboard</p>
                <p className="mt-2 text-sm text-ink/60">
                  Refresh the page to try again.
                </p>
              </div>
            </div>
          ) : isLoading ? (
            <div className="grid min-h-60 place-items-center rounded-lg border border-dashed border-ink/20 bg-white/70 p-8 text-center shadow-panel">
              <div>
                <p className="text-lg font-medium">Loading dashboard</p>
                <p className="mt-2 text-sm text-ink/60">
                  Fetching cards and balance.
                </p>
              </div>
            </div>
          ) : cards.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map((card) => (
                <article
                  className="relative min-h-40 rounded-lg border border-ink/10 bg-white p-5 shadow-panel"
                  key={card.id}
                >
                  <div
                    aria-hidden="true"
                    className="h-2 w-16 rounded-full"
                    style={{ backgroundColor: card.colour }}
                  />
                  <button
                    aria-label={`Remove ${card.title} ${card.number}`}
                    className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full border border-ink/10 text-xl leading-none text-ink/55 transition hover:border-ember/40 hover:bg-ember/10 hover:text-ember focus:outline-none focus:ring-2 focus:ring-ember focus:ring-offset-2"
                    data-testid={`remove-card-${card.id}`}
                    disabled={isBusy}
                    onClick={() => removeCard(card.id)}
                    title={`Remove ${card.title}`}
                    type="button"
                  >
                    ×
                  </button>
                  <div className="mt-8 flex items-end justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-semibold tracking-normal">
                        {card.title}
                      </h2>
                      <p className="mt-2 text-sm text-ink/55">
                        Placeholder card
                      </p>
                    </div>
                    <p className="text-3xl font-semibold tabular-nums">
                      {card.number}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="grid min-h-60 place-items-center rounded-lg border border-dashed border-ink/20 bg-white/70 p-8 text-center shadow-panel">
              <div>
                <p className="text-lg font-medium">No cards yet</p>
                <p className="mt-2 text-sm text-ink/60">
                  Add a card to refill the dashboard.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
