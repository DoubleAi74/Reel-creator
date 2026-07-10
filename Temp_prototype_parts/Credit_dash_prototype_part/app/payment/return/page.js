import PaymentReturnClient from "../../../components/PaymentReturnClient";

export const dynamic = "force-dynamic";

export default async function PaymentReturnPage({ searchParams }) {
  const params = await searchParams;
  const orderId = typeof params?.order === "string" ? params.order : "";

  return <PaymentReturnClient orderId={orderId} />;
}
