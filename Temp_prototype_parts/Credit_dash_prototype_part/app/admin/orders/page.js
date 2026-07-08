import OrdersTable from "../../../components/admin/OrdersTable.jsx";
import { getPaymentAuditSummary } from "../../../lib/admin/payment-audit.mjs";
import { serializeAdminOrder } from "../../../lib/admin/serialize-admin-order.mjs";
import { connectToDatabase } from "../../../lib/db/mongoose.mjs";
import { PaymentOrder } from "../../../lib/models/PaymentOrder.mjs";

export const dynamic = "force-dynamic";

async function loadInitialAdminOrders() {
  try {
    await connectToDatabase();

    const [orders, audit] = await Promise.all([
      PaymentOrder.find({}).sort({ createdAt: -1 }).limit(50).lean(),
      getPaymentAuditSummary(),
    ]);

    return {
      audit,
      message: null,
      orders: orders.map(serializeAdminOrder),
    };
  } catch {
    return {
      audit: null,
      message: "Unable to load admin data.",
      orders: [],
    };
  }
}

export default async function AdminOrdersPage() {
  const initialData = await loadInitialAdminOrders();

  return (
    <main className="min-h-screen bg-paper px-4 py-6 text-ink sm:px-6 lg:px-8">
      <section className="mx-auto w-full max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink/10 pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/50">
              Admin
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal">
              Payment orders
            </h1>
          </div>
          <a
            className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm font-semibold shadow-panel transition hover:border-mint/50"
            href="/admin/webhooks"
          >
            Webhooks
          </a>
        </div>
        <OrdersTable
          initialAudit={initialData.audit}
          initialMessage={initialData.message}
          initialOrders={initialData.orders}
        />
      </section>
    </main>
  );
}
