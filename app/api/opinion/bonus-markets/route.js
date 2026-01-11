import { NextResponse } from "next/server";
import { opinionFetch } from "@/lib/opinion";

/**
 * Bonus markets detection
 * - A market is considered "Bonus" if market detail contains `incentiveFactor`
 * - Binary detail:      GET /market/{marketId}
 * - Categorical detail: GET /market/categorical/{marketId}
 */

export const runtime = "nodejs";

const CACHE_MS = 2 * 60 * 1000; // 2 min cache
const STALE_MS = 60 * 1000; // Return stale after 1 min, but refresh in background

const cache = {
  ids: [],
  ts: 0,
  refreshing: false,
};

function hasIncentiveFactor(detail) {
  if (!detail || typeof detail !== "object") return false;
  // Check if the field EXISTS (not just has value)
  // Opinion API: if a market has bonus, it includes 'incentiveFactor' field
  return (
    "incentiveFactor" in detail ||
    "incentive_factor" in detail ||
    "incentive" in detail
  );
}

async function fetchMarketDetail(marketId, marketType) {
  // Try binary first, then categorical
  const paths = marketType === 1 
    ? [`/market/categorical/${marketId}`, `/market/${marketId}`]
    : [`/market/${marketId}`, `/market/categorical/${marketId}`];
  
  for (const path of paths) {
    try {
      const payload = await opinionFetch(path);
      const detail = payload?.result?.data;
      if (detail && typeof detail === "object") return detail;
    } catch {
      // try next path
    }
  }
  return null;
}

async function scanBonusMarkets(limit) {
  console.log(`[Bonus] Starting scan with limit=${limit}`);
  
  // 1) Pull a large activated market list (fetch ALL types)
  const listPayload = await opinionFetch("/market", {
    params: { status: "activated", sortBy: 5, limit },
  });

  const list = listPayload?.result?.data?.list || listPayload?.result?.data?.data?.list || [];
  
  console.log(`[Bonus] List API returned ${list?.length || 0} markets`);
  
  if (!Array.isArray(list) || list.length === 0) {
    return { ids: [], scanned: 0, source: "empty" };
  }

  // Debug: log first market to see available fields
  if (list[0]) {
    console.log(`[Bonus] Sample market fields:`, Object.keys(list[0]).join(", "));
  }

  // 2) First pass: check incentiveFactor directly from list (if API returns it)
  // Check if field EXISTS using 'in' operator
  const bonusFromList = list
    .filter((m) => {
      return m && (
        "incentiveFactor" in m ||
        "incentive_factor" in m ||
        "incentive" in m
      );
    })
    .map((m) => m?.marketId)
    .filter(Boolean);

  console.log(`[Bonus] Found ${bonusFromList.length} bonus from list data`);

  if (bonusFromList.length > 0) {
    // List API returned incentiveFactor - use it directly (fast path)
    return { ids: bonusFromList, scanned: list.length, source: "list" };
  }

  // 3) Fallback: fetch details for markets (slow path)
  console.log(`[Bonus] List has no incentiveFactor - scanning details...`);
  
  const entries = list
    .map((m) => ({ marketId: m?.marketId, marketType: m?.marketType }))
    .filter((x) => x.marketId);

  const bonusIds = [];
  const concurrency = 12;
  let i = 0;
  let checked = 0;

  async function worker() {
    while (i < entries.length) {
      const idx = i++;
      const { marketId, marketType } = entries[idx];

      try {
        const detail = await fetchMarketDetail(marketId, marketType);
        checked++;
        if (hasIncentiveFactor(detail)) {
          bonusIds.push(marketId);
          console.log(`[Bonus] Found bonus market: ${marketId}`);
        }
      } catch {
        // ignore failures per market
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  console.log(`[Bonus] Detail scan complete: ${bonusIds.length} bonus found out of ${checked} checked`);

  return { ids: bonusIds, scanned: entries.length, source: "detail" };
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.max(1, Math.min(1000, Number(searchParams.get("limit") || "500")));
    const force = searchParams.get("force") === "1";

    const now = Date.now();
    
    // Return cached data if fresh
    if (!force && cache.ids.length && now - cache.ts < CACHE_MS) {
      return NextResponse.json({ ids: cache.ids, cached: true, ts: cache.ts });
    }

    // If cache is stale but exists, return it immediately and refresh in background
    if (!force && cache.ids.length && now - cache.ts < CACHE_MS * 2 && !cache.refreshing) {
      cache.refreshing = true;
      // Fire and forget background refresh
      scanBonusMarkets(limit).then((result) => {
        cache.ids = result.ids;
        cache.ts = Date.now();
        cache.refreshing = false;
      }).catch(() => {
        cache.refreshing = false;
      });
      return NextResponse.json({ ids: cache.ids, cached: true, stale: true, ts: cache.ts });
    }

    // No cache or forced refresh - scan synchronously
    const result = await scanBonusMarkets(limit);
    
    cache.ids = result.ids;
    cache.ts = now;

    return NextResponse.json({
      ids: result.ids,
      cached: false,
      ts: now,
      scanned: result.scanned,
      source: result.source,
    });
  } catch (e) {
    // On error, return cached data if available
    if (cache.ids.length) {
      return NextResponse.json({ ids: cache.ids, cached: true, error: String(e?.message || e), ts: cache.ts });
    }
    return NextResponse.json({ ids: [], error: String(e?.message || e) }, { status: 500 });
  }
}

