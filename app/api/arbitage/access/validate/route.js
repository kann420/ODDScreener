// API: Validate access code
// POST /api/arbitage/access/validate

import { NextResponse } from "next/server";
import { validateAndActivateCode } from "@/lib/accessCodeDb";
import { checkRateLimit } from "@/lib/apiRateLimit";
import { clearArbitrageSessionCookie, setArbitrageSessionCookie } from "@/lib/arbitrageAccessSession";

// Max 10 attempts per minute per IP
const RATE_LIMIT_OPTS = { windowMs: 60_000, maxRequests: 10 };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  try {
    // Rate limit check
    const rl = checkRateLimit(request, "access-validate", RATE_LIMIT_OPTS);
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetMs / 1000)) } }
      );
    }

    const body = await request.json();
    const { code, deviceId } = body;
    
    if (!code || typeof code !== "string" || code.length > 100) {
      return NextResponse.json(
        { error: "Invalid access code" },
        { status: 400 }
      );
    }
    
    if (!deviceId || typeof deviceId !== "string" || deviceId.length > 255) {
      return NextResponse.json(
        { error: "Invalid device ID" },
        { status: 400 }
      );
    }
    
    const result = await validateAndActivateCode(code, deviceId);
    
    if (!result.valid) {
      const response = NextResponse.json(
        { error: result.error, valid: false },
        { status: 403 }
      );
      clearArbitrageSessionCookie(response);
      return response;
    }
    
    const response = NextResponse.json({
      valid: true,
      expiresAt: result.expiresAt,
      message: result.newlyActivated 
        ? "Access granted! Code activated successfully." 
        : "Access verified.",
    });
    setArbitrageSessionCookie(response, deviceId);
    return response;
    
  } catch (error) {
    console.error("[Access Validate] Error:", error);
    const response = NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
    clearArbitrageSessionCookie(response);
    return response;
  }
}
