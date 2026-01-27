import { NextResponse } from "next/server";
import { scanArbitageOpportunities } from "@/lib/arbitageEngine";

export const dynamic = "force-dynamic";

function toNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * GET /api/arbitage/scan
 * 
 * Auto-scan for arbitrage opportunities between Opinion and Polymarket
 * Uses fuzzy text matching to find similar markets across both exchanges
 * 
 * Query params:
 * - minArbPct: minimum arbitrage percentage (default: 0.1)
 * - minSimilarity: minimum text similarity for matching (default: 0.35, range 0-1)
 * - limit: max results (default: 50, max: 200)
 * - debug: include debug info in response (default: false)
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);

    // Query params
    const minArbPct = toNum(searchParams.get("minArbPct"), 0.1);
    const minSimilarity = Math.max(0.1, Math.min(1, toNum(searchParams.get("minSimilarity"), 0.35)));
    const limit = Math.max(1, Math.min(200, Math.floor(toNum(searchParams.get("limit"), 50))));
    const wantDebug = searchParams.get("debug") === "1" || searchParams.get("debug") === "true";

    const result = await scanArbitageOpportunities({ minArbPct, minSimilarity, limit });

    const rows = Array.isArray(result?.rows) ? result.rows : [];
    const debug = Array.isArray(result?.debug) ? result.debug : [];

    const payload = { 
      ok: true, 
      rows,
      meta: {
        totalFound: rows.length,
        minArbPct,
        minSimilarity,
        scannedAt: new Date().toISOString(),
      }
    };
    
    if (wantDebug) payload.debug = debug;

    return NextResponse.json(payload);
  } catch (e) {
    console.error("[/api/arbitage/scan] server_error:", e);

    const payload = { ok: false, rows: [], error: "server_error" };

    try {
      const url = new URL(req.url);
      const wantDebug = url.searchParams.get("debug") === "1" || url.searchParams.get("debug") === "true";
      if (wantDebug) {
        payload.message = String(e?.message || e);
        payload.stack = String(e?.stack || "");
      }
    } catch {
      // ignore
    }

    return NextResponse.json(payload, { status: 500 });
  }
}
