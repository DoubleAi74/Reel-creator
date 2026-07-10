import WebhookEventsTable from "../../../components/admin/WebhookEventsTable.jsx";
import { serializeWebhookEvent } from "../../../lib/admin/serialize-webhook-event.mjs";
import { connectToDatabase } from "../../../lib/db/mongoose.mjs";
import { WebhookEvent } from "../../../lib/models/WebhookEvent.mjs";

export const dynamic = "force-dynamic";

async function loadInitialWebhookEvents() {
  try {
    await connectToDatabase();

    const events = await WebhookEvent.find({})
      .sort({ createdAt: -1 })
      .limit(75)
      .lean();

    return {
      events: events.map(serializeWebhookEvent),
      message: null,
    };
  } catch {
    return {
      events: [],
      message: "Unable to load webhook events.",
    };
  }
}

export default async function AdminWebhooksPage() {
  const initialData = await loadInitialWebhookEvents();

  return (
    <main className="min-h-screen bg-paper px-4 py-6 text-ink sm:px-6 lg:px-8">
      <section className="mx-auto w-full max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink/10 pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/50">
              Admin
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal">
              Webhook events
            </h1>
          </div>
          <a
            className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm font-semibold shadow-panel transition hover:border-mint/50"
            href="/admin/orders"
          >
            Orders
          </a>
        </div>
        <WebhookEventsTable
          initialEvents={initialData.events}
          initialMessage={initialData.message}
        />
      </section>
    </main>
  );
}
