function serializeDate(value) {
  if (!value) {
    return null;
  }

  if (typeof value.toISOString === "function") {
    return value.toISOString();
  }

  return value;
}

export function serializeWebhookEvent(event) {
  return {
    checkoutId: event.checkoutId ?? null,
    checkoutReference: event.checkoutReference ?? null,
    createdAt: serializeDate(event.createdAt),
    eventType: event.eventType ?? null,
    id: event._id.toString(),
    paymentOrderIdPresent: Boolean(event.paymentOrderId),
    processingStatus: event.processingStatus,
    provider: event.provider,
    safeErrorCode: event.safeErrorCode ?? null,
  };
}
