function buildUrlWithFallbackPath(baseUrl, fallbackPath) {
  const url = new URL(baseUrl);

  if (url.pathname === "/" || url.pathname === "") {
    url.pathname = fallbackPath;
  }

  return url;
}

export function buildCheckoutRedirectUrl(baseUrl, orderId) {
  const url = buildUrlWithFallbackPath(baseUrl, "/payment/return");
  url.searchParams.set("order", orderId);

  return url.toString();
}

export function buildWebhookUrl(baseUrl) {
  return buildUrlWithFallbackPath(baseUrl, "/api/webhooks/sumup").toString();
}
