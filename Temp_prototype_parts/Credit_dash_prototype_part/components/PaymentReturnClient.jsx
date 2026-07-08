"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { formatGbpFromMinor } from "../lib/money";

const terminalStatuses = new Set(["PAID", "PAYMENT_FAILED", "PAYMENT_EXPIRED"]);

function getStatusLabel(status) {
  if (status === "PAID") {
    return "Payment received";
  }

  if (status === "PAYMENT_FAILED") {
    return "Payment unsuccessful";
  }

  if (status === "PAYMENT_EXPIRED") {
    return "Checkout expired";
  }

  return "Confirming payment";
}

export default function PaymentReturnClient({ orderId }) {
  const [attempts, setAttempts] = useState(0);
  const [error, setError] = useState(orderId ? null : "Missing order reference.");
  const [order, setOrder] = useState(null);

  const statusLabel = useMemo(
    () => getStatusLabel(order?.status),
    [order?.status],
  );

  useEffect(() => {
    if (!orderId || terminalStatuses.has(order?.status) || attempts >= 20) {
      return undefined;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      async () => {
        try {
          const response = await fetch(
            `/api/payments/sumup/orders/${encodeURIComponent(orderId)}`,
            {
              cache: "no-store",
              signal: controller.signal,
            },
          );
          const result = await response.json();

          if (!response.ok) {
            throw new Error("Unable to confirm payment.");
          }

          setOrder(result.order);
          setError(null);
        } catch (requestError) {
          if (requestError.name !== "AbortError") {
            setError("Unable to confirm payment yet.");
          }
        } finally {
          setAttempts((currentAttempts) => currentAttempts + 1);
        }
      },
      attempts === 0 ? 0 : 2500,
    );

    return () => {
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [attempts, order?.status, orderId]);

  return (
    <main className="min-h-screen bg-paper text-ink">
      <section className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-4 py-10">
        <div className="border-b border-ink/10 pb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/55">
            Credit dashboard
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">
            {statusLabel}
          </h1>
        </div>

        <div className="py-6">
          {order ? (
            <dl className="grid gap-3 text-sm">
              <div className="flex justify-between gap-4 border-b border-ink/10 pb-3">
                <dt className="text-ink/55">Amount</dt>
                <dd className="font-semibold tabular-nums">
                  {formatGbpFromMinor(order.amountMinor)}
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-ink/10 pb-3">
                <dt className="text-ink/55">Status</dt>
                <dd className="font-semibold">{order.status}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-ink/10 pb-3">
                <dt className="text-ink/55">Balance credited</dt>
                <dd className="font-semibold">
                  {order.balanceCredited ? "Yes" : "Not yet"}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-ink/60">
              Confirming your payment securely with SumUp.
            </p>
          )}

          {error ? (
            <p className="mt-4 text-sm font-medium text-ember" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            className="inline-flex min-h-11 items-center rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white shadow-panel transition hover:bg-ink/85 focus:outline-none focus:ring-2 focus:ring-mint focus:ring-offset-2 focus:ring-offset-paper"
            href="/"
          >
            Back to dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}
