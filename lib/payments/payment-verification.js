import mongoose from "mongoose";

import {
  assertTransactionsSupported,
  connectToDatabase,
} from "../db/mongoose.js";
import {
  ensureSharedBalance,
  initializeDatabaseIndexes,
} from "../db/bootstrap.js";
import { applyLedgeredBalanceChange } from "../ledger/balance-ledger.js";
import { PaymentOrder } from "../models/PaymentOrder.js";
import { retrieveCheckout } from "./sumup-client.js";
import { getSumUpEnvironment } from "./sumup-env.js";

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
  const updatedOrder = await PaymentOrder.findByIdAndUpdate(
    order._id,
    {
      $set: orderStatusUpdateFromCheckout(checkout),
    },
    {
      returnDocument: "after",
    },
  ).lean();

  return updatedOrder ?? order;
}

async function runTransaction(callback, attempts = 5) {
  await connectToDatabase();
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const session = await mongoose.startSession();

    try {
      let result;
      await session.withTransaction(async () => {
        result = await callback(session);
      });
      return result;
    } catch (error) {
      lastError = error;

      if (!error?.hasErrorLabel?.("TransientTransactionError")) {
        throw error;
      }
    } finally {
      await session.endSession();
    }
  }

  throw lastError;
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

  await initializeDatabaseIndexes();
  await assertTransactionsSupported();
  await ensureSharedBalance();

  let credited = false;
  let updatedOrder = null;

  await runTransaction(async (session) => {
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

  return {
    checkout,
    credited,
    order: updatedOrder ?? order,
    verification,
  };
}
