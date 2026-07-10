import { NextResponse } from "next/server";

import {
  checkCheckoutRateLimit,
  getRequestIp,
} from "../../../../lib/credits/rate-limit.js";
import { isCreditsEnabled } from "../../../../lib/credits/flags.js";
import { connectToDatabase } from "../../../../lib/db/mongoose.js";
import {
  attachHostedCheckoutToOrder,
  createPendingPaymentOrder,
  findReusablePendingPaymentOrder,
  TOP_UP_DESCRIPTION,
} from "../../../../lib/payments/payment-orders.js";
import {
  buildCheckoutRedirectUrl,
  buildWebhookUrl,
} from "../../../../lib/payments/payment-urls.js";
import {
  createHostedCheckout,
  isSafeHostedCheckoutUrl,
  SumUpApiError,
} from "../../../../lib/payments/sumup-client.js";
import { getSumUpEnvironment } from "../../../../lib/payments/sumup-env.js";
import {
  isValidTopUpMinor,
  minorToMajorUnit,
  TOP_UP_MAX_MINOR,
  TOP_UP_MIN_MINOR,
} from "../../../../lib/money.js";

export const runtime = "nodejs";

function invalidAmountResponse() {
  return NextResponse.json(
    {
      error: `amountMinor must be integer pence from ${TOP_UP_MIN_MINOR} to ${TOP_UP_MAX_MINOR}.`,
    },
    { status: 400 },
  );
}

function safeCheckoutErrorDetails(error) {
  if (error?.code === 11000) {
    return {
      fields: Object.keys(error.keyPattern ?? {}),
      kind: "duplicate_key",
    };
  }

  if (error instanceof SumUpApiError) {
    return {
      kind: "sumup_api",
      status: error.status,
    };
  }

  return {
    kind: error?.name ?? "unknown_error",
    message: error?.message ?? "Unknown checkout error.",
  };
}

export async function POST(request) {
  if (!isCreditsEnabled()) {
    return NextResponse.json({ enabled: false, error: "credits_disabled" }, { status: 404 });
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!isValidTopUpMinor(body?.amountMinor)) {
    return invalidAmountResponse();
  }

  try {
    await connectToDatabase();

    const environment = getSumUpEnvironment();
    const reusableOrder = await findReusablePendingPaymentOrder({
      amountMinor: body.amountMinor,
      currency: environment.SUMUP_CURRENCY,
    });

    if (
      reusableOrder &&
      isSafeHostedCheckoutUrl(reusableOrder.sumupHostedCheckoutUrl)
    ) {
      return NextResponse.json({
        checkoutUrl: reusableOrder.sumupHostedCheckoutUrl,
        orderId: reusableOrder.publicReference,
        reused: true,
      });
    }

    // REP-301: throttle only non-reused checkout creation (SumUp API cost).
    const rateLimit = checkCheckoutRateLimit({
      ip: getRequestIp(request),
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "rate_limited", retryAfter: rateLimit.retryAfter },
        { status: 429 },
      );
    }

    const order = await createPendingPaymentOrder({
      amountMinor: body.amountMinor,
      currency: environment.SUMUP_CURRENCY,
    });
    const checkout = await createHostedCheckout({
      amount: minorToMajorUnit(order.amountMinor),
      checkoutReference: order.sumupCheckoutReference,
      currency: order.currency,
      description: TOP_UP_DESCRIPTION,
      redirectUrl: buildCheckoutRedirectUrl(
        environment.SUMUP_CHECKOUT_RETURN_URL,
        order.publicReference,
      ),
      returnUrl: buildWebhookUrl(environment.SUMUP_WEBHOOK_URL),
    });

    if (!isSafeHostedCheckoutUrl(checkout.hosted_checkout_url)) {
      throw new Error("Unexpected hosted checkout URL.");
    }

    await attachHostedCheckoutToOrder({ checkout, order });

    return NextResponse.json(
      {
        checkoutUrl: checkout.hosted_checkout_url,
        orderId: order.publicReference,
      },
      { status: 201 },
    );
  } catch (error) {
    const status = error instanceof SumUpApiError ? 502 : 500;

    console.error(
      "POST /api/credits/checkout error:",
      safeCheckoutErrorDetails(error),
    );

    return NextResponse.json(
      { error: "Unable to create checkout." },
      { status },
    );
  }
}
