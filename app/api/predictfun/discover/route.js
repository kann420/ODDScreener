import { NextResponse } from "next/server";
import {
  fetchPredictFunDiscoverFull,
  fetchPredictFunDiscoverQuickInitial,
  getPredictFunDiscoverCache,
} from "@/lib/predictfunDiscover";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/predictfun/discover
 * Returns cached PF markets for progressive loading
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const warmOnly = searchParams.get("warm") === "1";
    const cache = getPredictFunDiscoverCache();
    const now = Date.now();
    const fullIsWarm =
      cache.fullData &&
      !cache.fullData.error &&
      (now - cache.fullFetchedAt) < cache.fullTtl;

    if (fullIsWarm) {
      if (warmOnly) {
        return NextResponse.json({
          status: "ready",
          warmed: true,
          count: cache.fullData.markets.length,
          ts: cache.fullFetchedAt,
        });
      }

      return NextResponse.json({
        status: "ready",
        markets: cache.fullData.markets,
        count: cache.fullData.markets.length,
        ts: cache.fullFetchedAt,
      });
    }

    if (!cache.fullBuilding) {
      fetchPredictFunDiscoverFull().catch(() => {});
    }

    if (warmOnly) {
      return NextResponse.json({
        status: "warming",
        warmed: false,
      });
    }

    const partial =
      (cache.quickData &&
        !cache.quickData.error &&
        (now - cache.quickFetchedAt) < cache.quickTtl
        ? cache.quickData
        : await fetchPredictFunDiscoverQuickInitial().catch(() => null));

    if (partial?.markets?.length > 0) {
      return NextResponse.json({
        status: "building",
        markets: partial.markets,
        count: partial.markets.length,
        ts: cache.quickFetchedAt || Date.now(),
      });
    }

    if (cache.fullData?.markets?.length > 0) {
      return NextResponse.json({
        status: "building",
        markets: cache.fullData.markets,
        count: cache.fullData.markets.length,
        ts: cache.fullFetchedAt,
      });
    }

    return NextResponse.json({
      status: "building",
      markets: [],
      count: 0,
    });
  } catch (err) {
    console.error("[PF Discover API] Error:", err);
    return NextResponse.json({ status: "error", markets: [], error: "Internal server error" }, { status: 500 });
  }
}
