import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, getSessionCookieOptions } from "../../../../lib/admin-auth.js";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_SESSION_COOKIE, "", {
    ...getSessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}
