// API: Check device access
// GET /api/arbitage/access/check

import { NextResponse } from "next/server";
import { checkDeviceAccess } from "@/lib/accessCodeDb";
import { clearArbitrageSessionCookie, setArbitrageSessionCookie } from "@/lib/arbitrageAccessSession";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const deviceId = searchParams.get("deviceId");
    
    if (!deviceId || deviceId.length > 255) {
      return NextResponse.json(
        { hasAccess: false, error: "Invalid device ID" },
        { status: 400 }
      );
    }
    
    const result = await checkDeviceAccess(deviceId);
    const response = NextResponse.json(result);

    if (result?.hasAccess) {
      setArbitrageSessionCookie(response, deviceId);
    } else {
      clearArbitrageSessionCookie(response);
    }

    return response;
    
  } catch (error) {
    console.error("[Access Check] Error:", error);
    const response = NextResponse.json(
      { hasAccess: false, error: "Internal server error" },
      { status: 500 }
    );
    clearArbitrageSessionCookie(response);
    return response;
  }
}
