/**
 * Shared helpers for historical top-up ledger repair (REP-205).
 * balanceAfterMinor on repaired rows is indicative (current shared balance
 * snapshot), not a reconstructed historical post-balance. Rows are stamped
 * with metadata.repairedHistoricalEntry:true.
 */

export function buildHistoricalTopUpLedgerEntry({
  balanceAfterMinor,
  order,
}) {
  return {
    amountMinor: order.amountMinor,
    balanceAfterMinor,
    createdAt: order.paidAt ?? order.updatedAt ?? order.createdAt ?? new Date(),
    currency: order.currency,
    idempotencyKey: `top_up:${order._id.toString()}`,
    metadata: {
      balanceAfterMinorIndicative: true,
      checkoutId: order.sumupCheckoutId,
      checkoutReference: order.sumupCheckoutReference,
      repairedHistoricalEntry: true,
    },
    paymentOrderId: order._id,
    reason: "Historical verified top-up ledger repair",
    type: "TOP_UP",
  };
}
