import { NextResponse } from "next/server";

import { isCreditsEnabled } from "../../../../lib/credits/flags.js";
import { connectToDatabase } from "../../../../lib/db/mongoose.js";
import { PaymentOrder } from "../../../../lib/models/PaymentOrder.js";
import { WebhookEvent } from "../../../../lib/models/WebhookEvent.js";
import { refreshPaymentOrderFromSumUp } from "../../../../lib/payments/payment-verification.js";
import { SumUpApiError } from "../../../../lib/payments/sumup-client.js";

export const runtime = "nodejs";

function getWebhookCheckoutId(body) {
  return (
    body?.id ??
    body?.checkout_id ??
    body?.resource_id ??
    body?.payload?.id ??
    body?.checkout?.id ??
    null
  );
}

function getWebhookCheckoutReference(body) {
  return (
    body?.checkout_reference ??
    body?.payload?.checkout_reference ??
    body?.checkout?.checkout_reference ??
    null
  );
}

function getWebhookEventType(body) {
  return body?.event_type ?? body?.type ?? body?.eventType ?? null;
}

function safeWebhookErrorDetails(error) {
  if (error instanceof SumUpApiError) {
    return {
      kind: "sumup_api",
      status: error.status,
    };
  }

  return {
    kind: error?.name ?? "unknown_error",
  };
}

async function updateWebhookEvent(webhookEvent, update) {
  if (!webhookEvent?._id) {
    return;
  }

  await WebhookEvent.findByIdAndUpdate(webhookEvent._id, {
    $set: update,
  });
}

export async function POST(request) {
  // REP-402: ignore webhooks when the credit layer is disabled.
  if (!isCreditsEnabled()) {
    return NextResponse.json({ enabled: false, received: true }, { status: 404 });
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ received: true });
  }

  const checkoutId = getWebhookCheckoutId(body);
  const checkoutReference = getWebhookCheckoutReference(body);
  let webhookEvent = null;

  try {
    await connectToDatabase();

    webhookEvent = await WebhookEvent.create({
      checkoutId,
      checkoutReference,
      eventType: getWebhookEventType(body),
      processingStatus: "IGNORED",
      safeErrorCode: checkoutId || checkoutReference ? null : "MISSING_IDENTIFIER",
    });

    if (!checkoutId && !checkoutReference) {
      return NextResponse.json({ received: true });
    }

    const query = checkoutId
      ? { sumupCheckoutId: checkoutId }
      : { sumupCheckoutReference: checkoutReference };
    const order = await PaymentOrder.findOne(query).lean();

    if (!order) {
      await updateWebhookEvent(webhookEvent, {
        processingStatus: "IGNORED",
        safeErrorCode: "UNKNOWN_CHECKOUT",
      });

      return NextResponse.json({ received: true });
    }

    await updateWebhookEvent(webhookEvent, {
      paymentOrderId: order._id,
      processingStatus: "MATCHED",
      safeErrorCode: null,
    });

    // REP-302: quick-ack after persisting the event; verify asynchronously.
    // Exactly-once credit is still guaranteed by ai/top_up idempotency keys
    // and the return-page re-query path.
    void refreshPaymentOrderFromSumUp(order)
      .then(async (result) => {
        await updateWebhookEvent(webhookEvent, {
          processingStatus: result.verification.ok ? "VERIFIED_PAID" : "MATCHED",
          safeErrorCode: result.verification.ok
            ? null
            : result.verification.failures.includes("status")
              ? "CHECKOUT_NOT_PAID"
              : "VERIFICATION_MISMATCH",
        });
      })
      .catch(async (error) => {
        await updateWebhookEvent(webhookEvent, {
          processingStatus: "ERROR",
          safeErrorCode: safeWebhookErrorDetails(error).kind,
        }).catch(() => {});
        console.error(
          "POST /api/webhooks/sumup background verify error:",
          safeWebhookErrorDetails(error),
        );
      });

    return NextResponse.json({ received: true });
  } catch (error) {
    await updateWebhookEvent(webhookEvent, {
      processingStatus: "ERROR",
      safeErrorCode: safeWebhookErrorDetails(error).kind,
    }).catch(() => {});

    console.error("POST /api/webhooks/sumup error:", safeWebhookErrorDetails(error));

    return NextResponse.json({ received: true });
  }
}
