import { NextResponse } from "next/server";
import { opinionFetch, opinionFetchAllMarkets } from "@/lib/opinion";
import fs from "fs/promises";
import path from "path";

/**
 * Bonus markets detection
 * - A market is considered "Bonus" if market detail contains `incentiveFactor`
 * - Binary detail:      GET /market/{marketId}
 * - Categorical detail: GET /market/categorical/{marketId}
 * - Cache: 12 hours (bonus markets rarely change)
 */

export const runtime = "nodejs";

// ===== CACHE CONFIG =====
const CACHE_MS = 12 * 60 * 60 * 1000; // 12 hours cache (bonus markets don't change often)
const STALE_MS = 6 * 60 * 60 * 1000;  // Return stale after 6 hours, refresh in background
const CACHE_FILE = path.join(process.cwd(), "data", "bonus_cache.json");

// In-memory cache
const cache = {
  ids: [],
  ts: 0,
  refreshing: false,
};

// ===== FILE CACHE HELPERS =====
async function loadCacheFromFile() {
  try {
    const data = await fs.readFile(CACHE_FILE, "utf-8");
    const parsed = JSON.parse(data);
    if (parsed.ids && parsed.ts) {
      cache.ids = parsed.ids;
      cache.ts = parsed.ts;
      console.log(`[Bonus] Loaded ${cache.ids.length} bonus markets from file cache (age: ${Math.round((Date.now() - cache.ts) / 1000 / 60)}min)`);
      return true;
    }
  } catch {
    // File doesn't exist or invalid - will scan fresh
  }
  return false;
}

async function saveCacheToFile() {
  try {
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify({ ids: cache.ids, ts: cache.ts }), "utf-8");
    console.log(`[Bonus] Saved ${cache.ids.length} bonus markets to file cache`);
  } catch (e) {
    console.error(`[Bonus] Failed to save cache:`, e.message);
  }
}

// Load file cache on startup
let cacheLoaded = false;
async function ensureCacheLoaded() {
  if (!cacheLoaded) {
    cacheLoaded = true;
    await loadCacheFromFile();
  }
}

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
  
  // 1) Pull activated markets with pagination (API limit is 20 per page)
  // Calculate maxPages based on limit
  const maxPages = Math.ceil(Math.min(limit, 500) / 20);
  const listPayload = await opinionFetchAllMarkets({
    status: "activated",
    sortBy: 5,
    marketType: 0, // Binary only (categorical children need different approach)
    maxPages,
  });

  // API may return result.list (direct) or result.data.list (nested)
  const list = listPayload?.result?.list || listPayload?.result?.data?.list || listPayload?.result?.data?.data?.list || [];
  
  console.log(`[Bonus] List API returned ${list?.length || 0} markets (maxPages=${maxPages})`);
  
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
    // Ensure file cache is loaded on first request
    await ensureCacheLoaded();
    
    const { searchParams } = new URL(req.url);
    const limit = Math.max(1, Math.min(1000, Number(searchParams.get("limit") || "500")));
    const force = searchParams.get("force") === "1";

    const now = Date.now();
    
    // Check if cache exists (ts > 0 means we have cached data, even if ids is empty)
    const hasCachedData = cache.ts > 0;
    
    // Return cached data if fresh (within 12 hours) - even if ids is empty!
    if (!force && hasCachedData && now - cache.ts < CACHE_MS) {
      const ageHours = Math.round((now - cache.ts) / 1000 / 60 / 60 * 10) / 10;
      console.log(`[Bonus] Returning cached data (${cache.ids.length} ids, age: ${ageHours}h)`);
      return NextResponse.json({ 
        ids: cache.ids, 
        cached: true, 
        ts: cache.ts,
        ageHours,
        nextRefresh: Math.round((CACHE_MS - (now - cache.ts)) / 1000 / 60 / 60 * 10) / 10 + "h"
      });
    }

    // If cache is stale but exists (6-12h old), return it immediately and refresh in background
    if (!force && hasCachedData && now - cache.ts < CACHE_MS * 2 && !cache.refreshing) {
      cache.refreshing = true;
      // Fire and forget background refresh
      scanBonusMarkets(limit).then(async (result) => {
        cache.ids = result.ids;
        cache.ts = Date.now();
        cache.refreshing = false;
        await saveCacheToFile(); // Persist to file
      }).catch(() => {
        cache.refreshing = false;
      });
      return NextResponse.json({ ids: cache.ids, cached: true, stale: true, ts: cache.ts });
    }

    // No cache or forced refresh - scan synchronously
    console.log(`[Bonus] Cache miss or force refresh - scanning...`);
    const result = await scanBonusMarkets(limit);
    
    cache.ids = result.ids;
    cache.ts = now;
    
    // Persist to file for next restart
    await saveCacheToFile();

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

