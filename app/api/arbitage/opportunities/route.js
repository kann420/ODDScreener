import { NextResponse } from "next/server";
import { computeArbitageOpportunities, scanArbitageOpportunities } from "@/lib/arbitageEngine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function toNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * GET /api/arbitage/opportunities
 *
 * Query params:
 * - mode: "manual" (default) uses arbitagePairs.json, "auto" uses fuzzy matching
 * - priceMode: "bids" (default) or "asks" - which price to use for comparison
 * - minArbPct: minimum arbitrage percentage (default: 0.1)
 * - minSimilarity: minimum text similarity for auto mode (default: 0.35)
 * - limit: max results (default: 50)
 * - debug: include debug info (default: false)
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);

    // Query params
    const mode = searchParams.get("mode") || "manual";
    const priceMode = searchParams.get("priceMode") || "bids"; // "bids" or "asks"
    const minArbPct = toNum(searchParams.get("minArbPct"), 1);
    const minSimilarity = Math.max(0.1, Math.min(1, toNum(searchParams.get("minSimilarity"), 0.35)));
    const limit = Math.max(1, Math.min(200, Math.floor(toNum(searchParams.get("limit"), 50))));
    const wantDebug = process.env.NODE_ENV === "development" && (searchParams.get("debug") === "1" || searchParams.get("debug") === "true");
    const predictFunEvent = searchParams.get("predictFunEvent") || "";
    const platformA = searchParams.get("platformA") || "polymarket";
    const platformB = searchParams.get("platformB") || "opinion";

    let result;
    if (mode === "auto") {
      result = await scanArbitageOpportunities({
        minArbPct,
        minSimilarity,
        limit,
        priceMode,
        predictFunEvent,
        platformA,
        platformB,
      });
      // Debug log
      if (result?.rows?.length) {
        console.log(`[AUTO-SCAN] Found ${result.rows.length} rows (${priceMode} mode). Top 3:`);
        result.rows.slice(0, 3).forEach((r, i) => {
          console.log(`  ${i + 1}. "${r.title}" | similarity=${(r.similarity * 100).toFixed(1)}% | arb=${r.arbPct?.toFixed(2)}%`);
          // prices are already in cents (0-100), so display directly
          console.log(`     Poly: YES=${r.prices?.polyYes?.toFixed(1)}¢ NO=${r.prices?.polyNo?.toFixed(1)}¢`);
          console.log(`     Opinion: YES=${r.prices?.opYes?.toFixed(1)}¢ NO=${r.prices?.opNo?.toFixed(1)}¢`);
        });
      }
    } else {
      result = await computeArbitageOpportunities({ minArbPct, limit, priceMode });
    }

    // Engine may return either:
    // - array rows (older versions)
    // - { rows, debug } (newer version)
    const rows = Array.isArray(result) ? result : Array.isArray(result?.rows) ? result.rows : [];
    const debug = Array.isArray(result?.debug) ? result.debug : [];

    const payload = { ok: true, rows };
    if (wantDebug) payload.debug = debug;

    return NextResponse.json(payload);
  } catch (e) {
    // IMPORTANT: show real error in terminal (dev)
    console.error("[/api/arbitage/opportunities] server_error:", e);

    const payload = { ok: false, rows: [], error: "server_error" };

    // Only include error message in development, never stack traces
    if (process.env.NODE_ENV === "development") {
      payload.message = String(e?.message || e);
    }

    return NextResponse.json(payload, { status: 500 });
  }
}
