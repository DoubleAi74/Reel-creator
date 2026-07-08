"use client";

import { useState } from "react";

function formatDate(value) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function WebhookEventsTable({
  initialEvents = [],
  initialMessage = null,
}) {
  const [events, setEvents] = useState(initialEvents);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState(initialMessage);

  async function loadEvents() {
    setIsLoading(true);
    const response = await fetch("/api/admin/webhooks?limit=75", {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Unable to load webhook events.");
    }

    const result = await response.json();
    setEvents(result.events);
    setIsLoading(false);
  }

  async function loadEventsSafely() {
    try {
      await loadEvents();
    } catch {
      setMessage("Unable to load webhook events.");
      setIsLoading(false);
    }
  }

  return (
    <div className="py-5">
      <div className="flex justify-end">
        <button
          className="rounded-lg bg-mint px-3 py-2 text-sm font-semibold text-white shadow-panel transition hover:bg-mint/85"
          onClick={() => loadEventsSafely()}
          type="button"
        >
          Refresh
        </button>
      </div>

      {message ? (
        <p className="mt-4 rounded-lg border border-ink/10 bg-white px-4 py-3 text-sm font-semibold shadow-panel">
          {message}
        </p>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-lg border border-ink/10 bg-white shadow-panel">
        <table className="min-w-full divide-y divide-ink/10 text-sm">
          <thead className="bg-ink/[0.03] text-left text-xs uppercase tracking-[0.12em] text-ink/50">
            <tr>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Error</th>
              <th className="px-4 py-3">Checkout id</th>
              <th className="px-4 py-3">Reference</th>
              <th className="px-4 py-3">Matched</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/10">
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-ink/60" colSpan="6">
                  Loading
                </td>
              </tr>
            ) : events.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-ink/60" colSpan="6">
                  No webhook events
                </td>
              </tr>
            ) : (
              events.map((event) => (
                <tr className="align-top" key={event.id}>
                  <td className="whitespace-nowrap px-4 py-3">
                    {formatDate(event.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold">
                    {event.processingStatus}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {event.safeErrorCode ?? "—"}
                  </td>
                  <td className="max-w-64 break-all px-4 py-3 font-mono text-xs">
                    {event.checkoutId ?? "—"}
                  </td>
                  <td className="max-w-64 break-all px-4 py-3 font-mono text-xs">
                    {event.checkoutReference ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {event.paymentOrderIdPresent ? "Yes" : "No"}
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
