import mongoose from "mongoose";

import { ensureSharedBalance } from "../db/bootstrap.mjs";
import { applyLedgeredBalanceChange } from "../ledger/balance-ledger.mjs";
import { PaymentOrder } from "../models/PaymentOrder.mjs";
import { retrieveCheckout } from "./sumup-client.mjs";
import { getSumUpEnvironment } from "./sumup-env.mjs";

export function majorAmountToMinor(amount) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    return null;
  }

  return Math.round(amount * 100);
}

export function mapCheckoutStatusToOrderStatus(status) {
  if (status === "PAID") {
    return "PAID";
  }

  if (status === "FAILED") {
    return "PAYMENT_FAILED";
  }

  if (status === "EXPIRED") {
    return "PAYMENT_EXPIRED";
  }

  return "PAYMENT_PENDING";
}

export function getCheckoutTransactionId(checkout) {
  const transaction = checkout?.transactions?.find(
    (candidate) => candidate?.id || candidate?.transaction_code,
  );

  return transaction?.id ?? transaction?.transaction_code ?? undefined;
}

export function verifyPaidCheckout({ checkout, merchantCode, order }) {
  const failures = [];

  if (checkout?.id !== order.sumupCheckoutId) {
    failures.push("checkout_id");
  }

  if (checkout?.checkout_reference !== order.sumupCheckoutReference) {
    failures.push("checkout_reference");
  }

  if (checkout?.merchant_code !== merchantCode) {
    failures.push("merchant_code");
  }

  if (checkout?.currency !== order.currency) {
    failures.push("currency");
  }

  if (majorAmountToMinor(checkout?.amount) !== order.amountMinor) {
    failures.push("amount");
  }

  if (checkout?.status !== "PAID") {
    failures.push("status");
  }

  return {
    failures,
    ok: failures.length === 0,
  };
}

function orderStatusUpdateFromCheckout(checkout) {
  return {
    status: mapCheckoutStatusToOrderStatus(checkout.status),
    sumupCheckoutStatus: checkout.status,
  };
}

export function serializePaymentOrder(order) {
  return {
    amountMinor: order.amountMinor,
    balanceCredited: Boolean(order.balanceCredited),
    checkoutStatus: order.sumupCheckoutStatus ?? null,
    currency: order.currency,
    orderId: order.publicReference,
    paidAt: order.paidAt ?? null,
    status: order.status,
    updatedAt: order.updatedAt ?? null,
  };
}

async function markOrderFromCheckout(order, checkout) {
  const update = orderStatusUpdateFromCheckout(checkout);
  const updatedOrder = await PaymentOrder.findByIdAndUpdate(
    order._id,
    {
      $set: update,
    },
    {
      returnDocument: "after",
    },
  ).lean();

  return updatedOrder ?? order;
}

export async function refreshPaymentOrderFromSumUp(order) {
  if (!order?.sumupCheckoutId) {
    return {
      checkout: null,
      credited: false,
      order,
      verification: {
        failures: ["missing_checkout_id"],
        ok: false,
      },
    };
  }

  const checkout = await retrieveCheckout(order.sumupCheckoutId);

  if (checkout.status !== "PAID") {
    return {
      checkout,
      credited: false,
      order: await markOrderFromCheckout(order, checkout),
      verification: {
        failures: ["status"],
        ok: false,
      },
    };
  }

  const environment = getSumUpEnvironment();
  const verification = verifyPaidCheckout({
    checkout,
    merchantCode: environment.SUMUP_MERCHANT_CODE,
    order,
  });

  if (!verification.ok) {
    return {
      checkout,
      credited: false,
      order: await markOrderFromCheckout(order, checkout),
      verification,
    };
  }

  await ensureSharedBalance();

  const session = await mongoose.startSession();
  let credited = false;
  let updatedOrder = null;

  try {
    await session.withTransaction(async () => {
      const setFields = {
        balanceCredited: true,
        paidAt: new Date(),
        status: "PAID",
        sumupCheckoutStatus: checkout.status,
      };
      const transactionId = getCheckoutTransactionId(checkout);

      if (transactionId) {
        setFields.sumupTransactionId = transactionId;
      }

      updatedOrder = await PaymentOrder.findOneAndUpdate(
        {
          _id: order._id,
          balanceCredited: false,
        },
        {
          $set: setFields,
        },
        {
          returnDocument: "after",
          session,
        },
      ).lean();

      if (!updatedOrder) {
        updatedOrder = await PaymentOrder.findById(order._id)
          .session(session)
          .lean();
        return;
      }

      const ledgerResult = await applyLedgeredBalanceChange({
        amountMinor: order.amountMinor,
        currency: order.currency,
        idempotencyKey: `top_up:${order._id.toString()}`,
        metadata: {
          checkoutId: order.sumupCheckoutId,
          checkoutReference: order.sumupCheckoutReference,
        },
        paymentOrderId: order._id,
        reason: "Verified SumUp top-up",
        session,
        type: "TOP_UP",
      });

      credited = ledgerResult.applied;
    });
  } finally {
    await session.endSession();
  }

  return {
    checkout,
    credited,
    order: updatedOrder ?? order,
    verification,
  };
}
