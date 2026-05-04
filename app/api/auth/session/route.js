import { NextResponse } from "next/server";
import { getAuthStatus } from "../../../../lib/admin-auth.js";

export const runtime = "nodejs";

export async function GET(request) {
  const status = getAuthStatus(request);
  return NextResponse.json({ ok: true, ...status });
}
