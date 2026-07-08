import { CreditLedger } from "../models/CreditLedger.mjs";
import { PaymentOrder } from "../models/PaymentOrder.mjs";
import { WebhookEvent } from "../models/WebhookEvent.mjs";

export async function getPaymentAuditSummary({ now = new Date() } = {}) {
  const stalePendingCutoff = new Date(now.getTime() - 30 * 60 * 1000);

  const [stalePendingCount, uncreditedPaidCount, paidCreditedOrders] =
    await Promise.all([
      PaymentOrder.countDocuments({
        createdAt: { $lt: stalePendingCutoff },
        status: "PAYMENT_PENDING",
      }),
      PaymentOrder.countDocuments({
        balanceCredited: false,
        status: "PAID",
      }),
      PaymentOrder.find(
        {
          balanceCredited: true,
          status: "PAID",
        },
        { _id: 1 },
      ).lean(),
    ]);

  const expectedTopUpKeys = paidCreditedOrders.map(
    (order) => `top_up:${order._id.toString()}`,
  );
  const presentTopUpKeys =
    expectedTopUpKeys.length > 0
      ? await CreditLedger.distinct("idempotencyKey", {
          idempotencyKey: { $in: expectedTopUpKeys },
          type: "TOP_UP",
        })
      : [];
  const mismatchCount = await WebhookEvent.countDocuments({
    processingStatus: "ERROR",
    safeErrorCode: "VERIFICATION_MISMATCH",
  });
  const unknownWebhookCount = await WebhookEvent.countDocuments({
    processingStatus: "IGNORED",
    safeErrorCode: "UNKNOWN_CHECKOUT",
  });

  return {
    mismatchCount,
    missingLedgerCount: expectedTopUpKeys.length - presentTopUpKeys.length,
    stalePendingCount,
    uncreditedPaidCount,
    unknownWebhookCount,
  };
}
