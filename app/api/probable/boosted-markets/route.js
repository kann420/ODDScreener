import { NextResponse } from "next/server";
import { fetchProbableBoostedMarketIds } from "@/lib/probable";

/**
 * Probable boosted-points markets API
 * Returns market IDs that belong to events with isBoosted === true.
 * Cached in-memory for 5 minutes (Probable events API is already cached).
 *
 * GET /api/probable/boosted-markets
 * Response: { ids: string[], total: number, ts: number }
 */

export const runtime = "nodejs";

// Simple in-memory response cache (5 min)
const CACHE_MS = 5 * 60 * 1000;
let cache = { ids: [], ts: 0 };

export async function GET() {
  try {
    // Return stale cache if still fresh
    if (cache.ts > 0 && Date.now() - cache.ts < CACHE_MS) {
      return NextResponse.json({
        ids: cache.ids,
        total: cache.ids.length,
        ts: cache.ts,
        cached: true,
      });
    }

    const ids = await fetchProbableBoostedMarketIds();
    cache = { ids, ts: Date.now() };

    console.log(`[API/Probable/Boosted] Returning ${ids.length} boosted market IDs`);

    return NextResponse.json({
      ids,
      total: ids.length,
      ts: cache.ts,
      cached: false,
    });
  } catch (err) {
    console.error("[API/Probable/Boosted] Error:", err);
    return NextResponse.json(
      { ids: [], total: 0, ts: Date.now(), error: "Internal server error" },
      { status: 500 }
    );
  }
}
