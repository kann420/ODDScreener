import { NextResponse } from "next/server";
import { fetchAllPredictFunMarkets } from "@/lib/predictfun";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-side cache for Predict.fun markets (same pattern as Opinion discover)
 */
const _pfCache = globalThis.__PF_MARKETS_CACHE__ ?? (globalThis.__PF_MARKETS_CACHE__ = {
  data: null,
  fetchedAt: 0,
  building: null,
  TTL: 300_000, // 5 minutes
});
if (!globalThis.__PF_MARKETS_CACHE__) globalThis.__PF_MARKETS_CACHE__ = _pfCache;

export function getPfMarketsCache() {
  return _pfCache;
}

async function _fetchPfMarketsInternal() {
  const startTime = Date.now();
  try {
    const markets = await fetchAllPredictFunMarkets({
      pageSize: 50,
      maxMarkets: 600,
      enrichCategoryEndDate: true,
    });

    // Filter: only visible, open, unresolved
    const filtered = (markets || []).filter((m) => {
      if (!m.isVisible) return false;
      if (m.tradingStatus !== "OPEN") return false;
      if (m.resolution != null) return false;
      return true;
    });

    console.log(`[PF Discover] Fetched ${filtered.length}/${markets.length} active markets in ${Date.now() - startTime}ms`);
    return { error: false, markets: filtered };
  } catch (err) {
    console.error("[PF Discover] Fetch failed:", err?.message || err);
    return { error: true, markets: [] };
  }
}

async function fetchPfMarkets() {
  const now = Date.now();

  if (_pfCache.data && !_pfCache.data.error && (now - _pfCache.fetchedAt) < _pfCache.TTL) {
    return _pfCache.data;
  }

  if (_pfCache.building) {
    return _pfCache.building;
  }

  _pfCache.building = _fetchPfMarketsInternal()
    .then((result) => {
      _pfCache.building = null;
      if (!result.error) {
        _pfCache.data = result;
        _pfCache.fetchedAt = Date.now();
      }
      return result;
    })
    .catch((err) => {
      _pfCache.building = null;
      if (_pfCache.data && !_pfCache.data.error) return _pfCache.data;
      return { error: true, markets: [] };
    });

  return _pfCache.building;
}

/**
 * GET /api/predictfun/discover
 * Returns cached PF markets for progressive loading
 */
export async function GET() {
  try {
    const now = Date.now();
    const cacheIsWarm =
      _pfCache.data && !_pfCache.data.error && (now - _pfCache.fetchedAt) < _pfCache.TTL;

    if (cacheIsWarm) {
      return NextResponse.json({
        status: "ready",
        markets: _pfCache.data.markets,
        count: _pfCache.data.markets.length,
        ts: _pfCache.fetchedAt,
      });
    }

    // Kick off fetch if not already building
    if (!_pfCache.building) {
      fetchPfMarkets().catch(() => {});
    }

    // Return whatever we have (stale or empty)
    if (_pfCache.data?.markets?.length > 0) {
      return NextResponse.json({
        status: "building",
        markets: _pfCache.data.markets,
        count: _pfCache.data.markets.length,
        ts: _pfCache.fetchedAt,
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

// Export for use by PredictFunContent server component
export { fetchPfMarkets };
