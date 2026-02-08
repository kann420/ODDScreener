// API: Generate access codes (Admin only)
// POST /api/arbitage/access/generate
// Requires admin secret in header

import { NextResponse } from "next/server";
import { generateAccessCode, generateMultipleCodes, listAllCodes, getCodeStats, revokeCode } from "@/lib/accessCodeDb";
import crypto from "crypto";

// Admin secret - MUST be set in environment variable, no fallback for security
const ADMIN_SECRET = process.env.ADMIN_SECRET;

/** Constant-time string comparison to prevent timing attacks */
function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function checkAdminAuth(request) {
  if (!ADMIN_SECRET) {
    console.error("[Admin] ADMIN_SECRET env var not set - admin API disabled");
    return false;
  }
  const authHeader = request.headers.get("x-admin-secret");
  return safeCompare(authHeader, ADMIN_SECRET);
}

export async function POST(request) {
  try {
    // Check admin auth
    if (!checkAdminAuth(request)) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }
    
    const body = await request.json();
    const { action, durationHours = 24, count = 1, note = "", code } = body;
    
    switch (action) {
      case "generate": {
        if (count === 1) {
          const newCode = await generateAccessCode(durationHours, note);
          return NextResponse.json({ 
            success: true, 
            code: newCode,
            durationHours,
          });
        } else {
          const codes = await generateMultipleCodes(count, durationHours, note);
          return NextResponse.json({ 
            success: true, 
            codes,
            count: codes.length,
            durationHours,
          });
        }
      }
      
      case "revoke": {
        if (!code) {
          return NextResponse.json(
            { error: "Code is required for revoke action" },
            { status: 400 }
          );
        }
        const success = await revokeCode(code);
        return NextResponse.json({ success, code });
      }
      
      case "list": {
        const { limit = 100, offset = 0, includeExpired = true } = body;
        const codes = await listAllCodes({ limit, offset, includeExpired });
        const stats = await getCodeStats();
        return NextResponse.json({ codes, stats });
      }
      
      case "stats": {
        const stats = await getCodeStats();
        return NextResponse.json(stats);
      }
      
      default:
        return NextResponse.json(
          { error: "Invalid action. Use: generate, revoke, list, stats" },
          { status: 400 }
        );
    }
    
  } catch (error) {
    console.error("[Access Generate] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// GET for easy testing in browser (admin only via query param)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const secret = searchParams.get("secret");
    
    if (!safeCompare(secret, ADMIN_SECRET)) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }
    
    const action = searchParams.get("action") || "stats";
    const durationHours = parseInt(searchParams.get("hours") || "24", 10);
    const count = parseInt(searchParams.get("count") || "1", 10);
    const note = searchParams.get("note") || "";
    const code = searchParams.get("code") || "";
    
    if (action === "generate") {
      if (count === 1) {
        const newCode = await generateAccessCode(durationHours, note);
        return NextResponse.json({ success: true, code: newCode, durationHours });
      } else {
        const codes = await generateMultipleCodes(count, durationHours, note);
        return NextResponse.json({ success: true, codes, count: codes.length, durationHours });
      }
    }
    
    if (action === "revoke") {
      if (!code) {
        return NextResponse.json(
          { error: "Code is required. Use ?action=revoke&code=ABCD1234" },
          { status: 400 }
        );
      }
      const success = await revokeCode(code);
      return NextResponse.json({ 
        success, 
        code: code.toUpperCase().trim(),
        message: success ? "Code revoked successfully" : "Code not found"
      });
    }
    
    if (action === "list") {
      const codes = await listAllCodes({ limit: 100 });
      const stats = await getCodeStats();
      return NextResponse.json({ codes, stats });
    }
    
    const stats = await getCodeStats();
    return NextResponse.json(stats);
    
  } catch (error) {
    console.error("[Access Generate GET] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
