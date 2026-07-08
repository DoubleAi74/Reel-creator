function serializeDate(value) {
  if (!value) {
    return null;
  }

  if (typeof value.toISOString === "function") {
    return value.toISOString();
  }

  return value;
}

export function serializeAdminOrder(order) {
  return {
    amountMinor: order.amountMinor,
    balanceCredited: Boolean(order.balanceCredited),
    checkoutStatus: order.sumupCheckoutStatus ?? null,
    createdAt: serializeDate(order.createdAt),
    currency: order.currency,
    orderId: order.publicReference,
    paidAt: serializeDate(order.paidAt),
    status: order.status,
    sumupCheckoutIdPresent: Boolean(order.sumupCheckoutId),
    sumupTransactionIdPresent: Boolean(order.sumupTransactionId),
    updatedAt: serializeDate(order.updatedAt),
  };
}
