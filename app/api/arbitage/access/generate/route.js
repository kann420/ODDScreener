// API: Generate access codes (Admin only)
// GET  /api/arbitage/access/generate?secret=...&action=...
// POST /api/arbitage/access/generate  (x-admin-secret header + JSON body)

import { NextResponse } from "next/server";
import {
  generateAccessCode,
  generateMultipleCodes,
  listAllCodes,
  getCodeStats,
  revokeCode,
} from "@/lib/accessCodeDb";
import crypto from "crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

function checkAdminSecretFromQuery(request) {
  const { searchParams } = new URL(request.url);
  return checkAdminSecret(searchParams.get("secret"));
}

function parseInteger(value, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseBoolean(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return fallback;
}

async function handleAction(action, input) {
  const {
    durationHours = 24,
    count = 1,
    note = "",
    code = "",
    limit = 100,
    offset = 0,
    includeExpired = true,
  } = input;

  switch (action) {
    case "generate": {
      if (count === 1) {
        const newCode = await generateAccessCode(durationHours, note);
        return NextResponse.json({
          success: true,
          code: newCode,
          durationHours,
        });
      }

      const codes = await generateMultipleCodes(count, durationHours, note);
      return NextResponse.json({
        success: true,
        codes,
        count: codes.length,
        durationHours,
      });
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
}

// Browser-friendly GET handler for the old workflow.
export async function GET(request) {
  try {
    if (!checkAdminSecretFromQuery(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");
    const durationHours = parseInteger(searchParams.get("hours"), 24);
    const count = parseInteger(searchParams.get("count"), 1);
    const limit = parseInteger(searchParams.get("limit"), 100);
    const offset = parseInteger(searchParams.get("offset"), 0);
    const includeExpired = parseBoolean(searchParams.get("includeExpired"), true);
    const note = searchParams.get("note") || "";
    const code = searchParams.get("code") || "";

    return await handleAction(action, {
      durationHours,
      count,
      limit,
      offset,
      includeExpired,
      note,
      code,
    });
  } catch (error) {
    console.error("[Access Generate GET] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST handler (programmatic, uses x-admin-secret header)
export async function POST(request) {
  try {
    if (!checkAdminAuth(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const action = body.action;
    const durationHours = parseInteger(body.durationHours ?? body.hours, 24);
    const count = parseInteger(body.count, 1);
    const limit = parseInteger(body.limit, 100);
    const offset = parseInteger(body.offset, 0);
    const includeExpired = parseBoolean(body.includeExpired, true);

    return await handleAction(action, {
      durationHours,
      count,
      limit,
      offset,
      includeExpired,
      note: body.note || "",
      code: body.code || "",
    });
  } catch (error) {
    console.error("[Access Generate POST] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
