import { NextResponse } from "next/server";

export const runtime = "nodejs";

function jsonOk(payload) {
  return NextResponse.json({ ok: true, ...payload });
}

function toNumber(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTransaction(transaction) {
  return {
    id: String(transaction.id ?? transaction.reference ?? transaction.created_at ?? `${Date.now()}`),
    reference: transaction.reference ?? "-",
    amount: toNumber(transaction.amount) / 100,
    currency: transaction.currency ?? "GHS",
    status: transaction.status ?? "unknown",
    channel: transaction.channel ?? "unknown",
    customerName:
      transaction.customer?.first_name || transaction.customer?.last_name
        ? `${transaction.customer?.first_name ?? ""} ${transaction.customer?.last_name ?? ""}`.trim()
        : transaction.customer?.email ?? "Unknown customer",
    customerEmail: transaction.customer?.email ?? null,
    paidAt: transaction.paid_at ?? transaction.created_at ?? null,
    createdAt: transaction.created_at ?? null,
  };
}

export async function GET(request) {
  const secretKey =
    process.env.PAYSTACK_SECRET_KEY ||
    process.env.PAYSTACK_TEST_SECRET_KEY ||
    process.env.PAYSTACK_LIVE_SECRET_KEY ||
    "";
  const baseUrl = process.env.PAYSTACK_BASE_URL || "https://api.paystack.co";

  if (!secretKey) {
    return jsonOk({
      configured: false,
      note: "Set PAYSTACK_SECRET_KEY to enable live Paystack transactions.",
      transactions: [],
      fetchedAt: new Date().toISOString(),
    });
  }

  if (!secretKey.startsWith("sk_")) {
    return jsonOk({
      configured: false,
      note: "Invalid Paystack secret key format. Use an sk_test_* or sk_live_* key in PAYSTACK_SECRET_KEY.",
      transactions: [],
      fetchedAt: new Date().toISOString(),
    });
  }

  const url = new URL("/transaction", baseUrl);
  const perPage = Number.parseInt(request.nextUrl.searchParams.get("perPage") ?? "8", 10);
  url.searchParams.set("perPage", String(Number.isFinite(perPage) && perPage > 0 ? Math.min(perPage, 20) : 8));
  url.searchParams.set("page", request.nextUrl.searchParams.get("page") ?? "1");

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return jsonOk({
        configured: true,
        note: payload.message || "Unable to reach Paystack right now.",
        transactions: [],
        fetchedAt: new Date().toISOString(),
      });
    }

    const transactions = Array.isArray(payload.data) ? payload.data.map(normalizeTransaction) : [];

    return jsonOk({
      configured: true,
      note: payload.message || "Live feed loaded successfully.",
      transactions,
      fetchedAt: new Date().toISOString(),
    });
  } catch {
    return jsonOk({
      configured: true,
      note: "Unable to reach Paystack right now.",
      transactions: [],
      fetchedAt: new Date().toISOString(),
    });
  }
}