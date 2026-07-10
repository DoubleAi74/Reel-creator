export function serializeBalance(balance) {
  return {
    amountMinor: balance.amountMinor,
    currency: balance.currency,
    updatedAt: balance.updatedAt?.toISOString?.() ?? balance.updatedAt ?? null,
  };
}
