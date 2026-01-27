// API: Validate access code
// POST /api/arbitage/access/validate

import { NextResponse } from "next/server";
import { validateAndActivateCode } from "@/lib/accessCodeDb";

export async function POST(request) {
  try {
    const body = await request.json();
    const { code, deviceId } = body;
    
    if (!code) {
      return NextResponse.json(
        { error: "Access code is required" },
        { status: 400 }
      );
    }
    
    if (!deviceId) {
      return NextResponse.json(
        { error: "Device ID is required" },
        { status: 400 }
      );
    }
    
    const result = await validateAndActivateCode(code, deviceId);
    
    if (!result.valid) {
      return NextResponse.json(
        { error: result.error, valid: false },
        { status: 403 }
      );
    }
    
    return NextResponse.json({
      valid: true,
      expiresAt: result.expiresAt,
      message: result.newlyActivated 
        ? "Access granted! Code activated successfully." 
        : "Access verified.",
    });
    
  } catch (error) {
    console.error("[Access Validate] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
