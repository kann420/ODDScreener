// API: Check device access
// GET /api/arbitage/access/check

import { NextResponse } from "next/server";
import { checkDeviceAccess } from "@/lib/accessCodeDb";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const deviceId = searchParams.get("deviceId");
    
    if (!deviceId) {
      return NextResponse.json(
        { hasAccess: false, error: "Device ID is required" },
        { status: 400 }
      );
    }
    
    const result = await checkDeviceAccess(deviceId);
    
    return NextResponse.json(result);
    
  } catch (error) {
    console.error("[Access Check] Error:", error);
    return NextResponse.json(
      { hasAccess: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
