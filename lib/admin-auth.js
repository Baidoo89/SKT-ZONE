import crypto from "node:crypto";

export const ADMIN_SESSION_COOKIE = "dataflow_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function base64UrlEncode(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signValue(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a, b) {
  const aBuffer = Buffer.from(a, "utf8");
  const bBuffer = Buffer.from(b, "utf8");
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function getSessionSecret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_ACTION_KEY || null;
}

export function isSessionAuthConfigured() {
  return Boolean(process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD && getSessionSecret());
}

export function verifyAdminCredentials(username, password) {
  const expectedUser = process.env.ADMIN_USERNAME;
  const expectedPassword = process.env.ADMIN_PASSWORD;

  if (!expectedUser || !expectedPassword) {
    return false;
  }

  return safeEqual(username, expectedUser) && safeEqual(password, expectedPassword);
}

export function createSessionToken(username) {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET is required for session auth.");
  }

  const payload = {
    username,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signValue(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function parseSessionToken(token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  const secret = getSessionSecret();
  if (!secret) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [encodedPayload, signature] = parts;
  const expectedSignature = signValue(encodedPayload, secret);
  if (!safeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (!payload?.username || typeof payload.exp !== "number") {
      return null;
    }

    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function getSessionFromRequest(request) {
  const cookieToken = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  return parseSessionToken(cookieToken);
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export function getAuthStatus(request) {
  const sessionAuthEnabled = isSessionAuthConfigured();
  const session = getSessionFromRequest(request);

  return {
    sessionAuthEnabled,
    authenticated: Boolean(session),
    user: session?.username ?? null,
  };
}

export function authorizeActionRequest(request) {
  const status = getAuthStatus(request);

  if (status.sessionAuthEnabled && status.authenticated) {
    return null;
  }

  const configuredKey = process.env.ADMIN_ACTION_KEY;
  if (configuredKey) {
    const requestKey = request.headers.get("x-admin-key") ?? "";
    if (safeEqual(requestKey, configuredKey)) {
      return null;
    }
  }

  if (status.sessionAuthEnabled) {
    return { ok: false, error: "Login required for write actions.", status: 401 };
  }

  if (configuredKey) {
    return { ok: false, error: "Unauthorized action key.", status: 401 };
  }

  return null;
}
