"use client";

import { useState } from "react";

import { formatGbpFromMinor, parseGbpInputToMinor } from "../../lib/money";

function formatDate(value) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function StatusPill({ children }) {
  return (
    <span className="inline-flex rounded-full border border-ink/10 bg-white px-2 py-1 text-xs font-semibold">
      {children}
    </span>
  );
}

function buildOrdersUrl(statusFilter) {
  const params = new URLSearchParams({ limit: "50" });

  if (statusFilter) {
    params.set("status", statusFilter);
  }

  return `/api/admin/orders?${params.toString()}`;
}

export default function OrdersTable({
  initialAudit = null,
  initialMessage = null,
  initialOrders = [],
}) {
  const [orders, setOrders] = useState(initialOrders);
  const [audit, setAudit] = useState(initialAudit);
  const [isLoading, setIsLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState(initialMessage);
  const [statusFilter, setStatusFilter] = useState("");

  async function loadOrders(nextStatusFilter = statusFilter) {
    setIsLoading(true);
    const [ordersResponse, auditResponse] = await Promise.all([
      fetch(buildOrdersUrl(nextStatusFilter), { cache: "no-store" }),
      fetch("/api/admin/audit/payments", { cache: "no-store" }),
    ]);

    if (!ordersResponse.ok || !auditResponse.ok) {
      throw new Error("Unable to load admin data.");
    }

    const [ordersResult, auditResult] = await Promise.all([
      ordersResponse.json(),
      auditResponse.json(),
    ]);

    setOrders(ordersResult.orders);
    setAudit(auditResult);
    setIsLoading(false);
  }

  async function loadOrdersSafely(nextStatusFilter = statusFilter) {
    try {
      await loadOrders(nextStatusFilter);
    } catch {
      setActionMessage("Unable to load admin data.");
      setIsLoading(false);
    }
  }

  async function refreshOrder(orderId) {
    setActionMessage("Refreshing order...");
    const response = await fetch(`/api/admin/orders/${orderId}/refresh`, {
      method: "POST",
    });

    if (!response.ok) {
      setActionMessage("Refresh failed.");
      return;
    }

    await loadOrdersSafely();
    setActionMessage("Order refreshed.");
  }

  async function refundOrder(order) {
    const input = window.prompt(
      "Refund amount in GBP",
      (order.amountMinor / 100).toFixed(2),
    );

    if (input === null) {
      return;
    }

    const amountMinor = parseGbpInputToMinor(input);

    if (!amountMinor) {
      setActionMessage("Refund amount is invalid.");
      return;
    }

    setActionMessage("Requesting refund...");
    const response = await fetch(`/api/admin/orders/${order.orderId}/refund`, {
      body: JSON.stringify({ amountMinor }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      setActionMessage("Refund failed.");
      return;
    }

    const result = await response.json();
    await loadOrdersSafely();
    setActionMessage(
      result.refund.requiresManualReview
        ? "Refund succeeded; credit adjustment needs manual review."
        : "Refund succeeded.",
    );
  }

  return (
    <div className="py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {["", "PAYMENT_PENDING", "PAID", "PAYMENT_FAILED", "PAYMENT_EXPIRED"].map(
            (status) => (
              <button
                className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                  statusFilter === status
                    ? "border-ink bg-ink text-white"
                    : "border-ink/15 bg-white text-ink hover:border-mint/50"
                }`}
                key={status || "all"}
                onClick={() => {
                  setStatusFilter(status);
                  loadOrdersSafely(status);
                }}
                type="button"
              >
                {status || "All"}
              </button>
            ),
          )}
        </div>
        <button
          className="rounded-lg bg-mint px-3 py-2 text-sm font-semibold text-white shadow-panel transition hover:bg-mint/85"
          onClick={() => loadOrdersSafely()}
          type="button"
        >
          Refresh
        </button>
      </div>

      {audit ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {Object.entries(audit).map(([key, value]) => (
            <div
              className="rounded-lg border border-ink/10 bg-white px-4 py-3 shadow-panel"
              key={key}
            >
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
                {key}
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
      ) : null}

      {actionMessage ? (
        <p className="mt-4 rounded-lg border border-ink/10 bg-white px-4 py-3 text-sm font-semibold shadow-panel">
          {actionMessage}
        </p>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-lg border border-ink/10 bg-white shadow-panel">
        <table className="min-w-full divide-y divide-ink/10 text-sm">
          <thead className="bg-ink/[0.03] text-left text-xs uppercase tracking-[0.12em] text-ink/50">
            <tr>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Checkout</th>
              <th className="px-4 py-3">Credited</th>
              <th className="px-4 py-3">Paid</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/10">
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-ink/60" colSpan="8">
                  Loading
                </td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-ink/60" colSpan="8">
                  No orders
                </td>
              </tr>
            ) : (
              orders.map((order) => (
                <tr className="align-top" key={order.orderId}>
                  <td className="whitespace-nowrap px-4 py-3">
                    {formatDate(order.createdAt)}
                  </td>
                  <td className="max-w-64 break-all px-4 py-3 font-mono text-xs">
                    {order.orderId}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold">
                    {formatGbpFromMinor(order.amountMinor)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <StatusPill>{order.status}</StatusPill>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {order.checkoutStatus ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {order.balanceCredited ? "Yes" : "No"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {formatDate(order.paidAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="rounded-lg border border-ink/15 px-3 py-2 text-xs font-semibold transition hover:border-mint/50"
                        onClick={() => refreshOrder(order.orderId)}
                        type="button"
                      >
                        Refresh
                      </button>
                      <button
                        className="rounded-lg border border-ember/30 px-3 py-2 text-xs font-semibold text-ember transition hover:bg-ember/10 disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={
                          order.status !== "PAID" ||
                          !order.balanceCredited ||
                          !order.sumupTransactionIdPresent
                        }
                        onClick={() => refundOrder(order)}
                        type="button"
                      >
                        Refund
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
