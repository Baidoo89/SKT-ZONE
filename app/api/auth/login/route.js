import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  createSessionToken,
  getSessionCookieOptions,
  isSessionAuthConfigured,
  verifyAdminCredentials,
} from "../../../../lib/admin-auth.js";

export const runtime = "nodejs";

export async function POST(request) {
  if (!isSessionAuthConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Session authentication is not configured." },
      { status: 400 }
    );
  }

  try {
    const payload = await request.json();
    const username = String(payload?.username ?? "").trim();
    const password = String(payload?.password ?? "");

    if (!username || !password) {
      return NextResponse.json(
        { ok: false, error: "Username and password are required." },
        { status: 400 }
      );
    }

    if (!verifyAdminCredentials(username, password)) {
      return NextResponse.json({ ok: false, error: "Invalid credentials." }, { status: 401 });
    }

    const token = createSessionToken(username);
    const response = NextResponse.json({ ok: true, user: username });
    response.cookies.set(ADMIN_SESSION_COOKIE, token, getSessionCookieOptions());
    return response;
  } catch {
    return NextResponse.json({ ok: false, error: "Login request failed." }, { status: 400 });
  }
}
