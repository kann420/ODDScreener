import { NextResponse } from "next/server";
import { getMarketsCache, fetchMarkets } from "@/app/MarketsContent";

/**
 * GET /api/opinion/discover
 *
 * Poll-friendly endpoint for progressive loading.
 * - Cache warm  → returns full dataset immediately (status: "ready")
 * - Cache cold / building → returns { status: "building" } instantly
 *   so the client can poll again in a few seconds instead of hanging
 *   for 60+ seconds on a single request.
 *
 * The SSR cold path already kicks off fetchMarkets() in background,
 * so this route never needs to initiate a fetch itself — just check the cache.
 */
export async function GET() {
  try {
    const cache = getMarketsCache();
    const now = Date.now();
    const isWarm = cache.data && !cache.data.error && (now - cache.fetchedAt) < cache.TTL;

    if (isWarm) {
      const { filtered, bonusIdsFromList } = cache.data;
      return NextResponse.json({
        status: "ready",
        error: false,
        filtered,
        bonusIdsFromList,
        ts: cache.fetchedAt,
      });
    }

    // Cache is cold or building — tell client to poll again
    // Also ensure the background fetch is running
    if (!cache.building) {
      fetchMarkets().catch(() => {});
    }

    return NextResponse.json({
      status: "building",
      error: false,
      filtered: [],
      bonusIdsFromList: [],
      ts: 0,
    });
  } catch (err) {
    console.error("[API /discover] Failed:", err.message);
    return NextResponse.json(
      { status: "error", error: true, message: err.message },
      { status: 500 }
    );
  }
}
