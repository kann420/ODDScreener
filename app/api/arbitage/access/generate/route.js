// API: Generate access codes (Admin only)
// GET  /api/arbitage/access/generate?secret=...&action=generate&hours=24&count=1
// POST /api/arbitage/access/generate  (x-admin-secret header + JSON body)

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

function checkAdminSecret(secret) {
  if (!ADMIN_SECRET) {
    console.error("[Admin] ADMIN_SECRET env var not set - admin API disabled");
    return false;
  }
  return safeCompare(secret, ADMIN_SECRET);
}

function checkAdminAuth(request) {
  const authHeader = request.headers.get("x-admin-secret");
  return checkAdminSecret(authHeader);
}

// ─── GET handler (browser-friendly, uses ?secret= query param) ───
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const secret = searchParams.get("secret") || "";
    const action = searchParams.get("action") || "generate";

    if (!checkAdminSecret(secret)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    switch (action) {
      case "generate": {
        const durationHours = Math.max(1, Number(searchParams.get("hours")) || 24);
        const count = Math.max(1, Math.min(50, Number(searchParams.get("count")) || 1));
        const note = searchParams.get("note") || "";

        if (count === 1) {
          const newCode = await generateAccessCode(durationHours, note);
          return NextResponse.json({ success: true, code: newCode, durationHours });
        } else {
          const codes = await generateMultipleCodes(count, durationHours, note);
          return NextResponse.json({ success: true, codes, count: codes.length, durationHours });
        }
      }

      case "revoke": {
        const code = searchParams.get("code");
        if (!code) {
          return NextResponse.json({ error: "code param required" }, { status: 400 });
        }
        const success = await revokeCode(code);
        return NextResponse.json({ success, code });
      }

      case "list": {
        const limit = Math.max(1, Number(searchParams.get("limit")) || 100);
        const offset = Math.max(0, Number(searchParams.get("offset")) || 0);
        const includeExpired = searchParams.get("includeExpired") !== "false";
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
    console.error("[Access Generate GET] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST handler (programmatic, uses x-admin-secret header) ───
export async function POST(request) {
  try {
    if (!checkAdminAuth(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    console.error("[Access Generate POST] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET disabled - admin secret must never be sent via query params (logged by servers/CDN/browsers)
// Use POST with x-admin-secret header instead
