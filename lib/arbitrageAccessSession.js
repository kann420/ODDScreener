import crypto from "crypto";
import { checkDeviceAccess } from "@/lib/accessCodeDb";

export const ARBITRAGE_SESSION_COOKIE = "odd_arb_session";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function getSessionSecret() {
  const secret = process.env.ARBITRAGE_SESSION_SECRET || process.env.ADMIN_SECRET;
  if (!secret) {
    throw new Error("ARBITRAGE_SESSION_SECRET or ADMIN_SECRET must be set");
  }
  return secret;
}

function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function signTokenPayload(payload) {
  return crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}

function buildToken(deviceId) {
  const payload = Buffer.from(
    JSON.stringify({
      deviceId,
      issuedAt: Date.now(),
    }),
    "utf8"
  ).toString("base64url");

  return `${payload}.${signTokenPayload(payload)}`;
}

function parseToken(token) {
  if (!token || typeof token !== "string") {
    return { valid: false, error: "missing_session" };
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false, error: "invalid_session" };
  }

  const [payload, signature] = parts;
  const expectedSignature = signTokenPayload(payload);
  if (!safeCompare(signature, expectedSignature)) {
    return { valid: false, error: "invalid_signature" };
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const deviceId = typeof parsed?.deviceId === "string" ? parsed.deviceId.trim() : "";
    const issuedAt = Number(parsed?.issuedAt);

    if (!deviceId || deviceId.length > 255) {
      return { valid: false, error: "invalid_device_id" };
    }

    if (!Number.isFinite(issuedAt)) {
      return { valid: false, error: "invalid_issued_at" };
    }

    const now = Date.now();
    if (issuedAt - now > MAX_CLOCK_SKEW_MS) {
      return { valid: false, error: "issued_in_future" };
    }
    if (now - issuedAt > SESSION_TTL_MS) {
      return { valid: false, error: "session_expired" };
    }

    return { valid: true, deviceId, issuedAt };
  } catch (error) {
    console.error("[ArbAuth] Failed to parse session token:", error.message);
    return { valid: false, error: "invalid_payload" };
  }
}

function getCookieValue(request, name) {
  const direct = request.cookies?.get?.(name)?.value;
  if (direct) return direct;

  const cookieHeader = request.headers.get("cookie") || "";
  const cookies = cookieHeader.split(";").map((part) => part.trim());
  for (const cookie of cookies) {
    if (!cookie) continue;
    const eqIndex = cookie.indexOf("=");
    if (eqIndex === -1) continue;
    const key = cookie.slice(0, eqIndex).trim();
    if (key !== name) continue;
    return decodeURIComponent(cookie.slice(eqIndex + 1));
  }
  return null;
}

function getClientIp(request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function getRequestPath(request) {
  try {
    return new URL(request.url).pathname;
  } catch {
    return request.url || "unknown";
  }
}

function logDeniedRequest(request, reason) {
  const ip = getClientIp(request);
  const userAgent = (request.headers.get("user-agent") || "").slice(0, 160);
  const referer = request.headers.get("referer") || "";
  console.warn(
    `[ArbAuth] Denied ${getRequestPath(request)} reason=${reason} ip=${ip} ua="${userAgent}" referer="${referer}"`
  );
}

export function setArbitrageSessionCookie(response, deviceId) {
  response.cookies.set({
    name: ARBITRAGE_SESSION_COOKIE,
    value: buildToken(deviceId),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return response;
}

export function clearArbitrageSessionCookie(response) {
  response.cookies.set({
    name: ARBITRAGE_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function requireArbitrageAccess(request) {
  try {
    const token = getCookieValue(request, ARBITRAGE_SESSION_COOKIE);
    const parsed = parseToken(token);

    if (!parsed.valid) {
      logDeniedRequest(request, parsed.error);
      return { ok: false, status: 401, error: "access_required", reason: parsed.error };
    }

    const access = await checkDeviceAccess(parsed.deviceId);
    if (!access?.hasAccess) {
      logDeniedRequest(request, "device_access_missing");
      return { ok: false, status: 401, error: "access_required", reason: "device_access_missing" };
    }

    return {
      ok: true,
      deviceId: parsed.deviceId,
      expiresAt: access.expiresAt ?? null,
    };
  } catch (error) {
    console.error("[ArbAuth] Access verification failed:", error.message);
    return { ok: false, status: 500, error: "auth_error", reason: "auth_error" };
  }
}
