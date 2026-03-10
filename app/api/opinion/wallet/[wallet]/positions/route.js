/**
 * API Route: GET /api/opinion/wallet/[wallet]/positions
 * 
 * Proxy for Opinion OpenAPI positions endpoint.
 * Fetches wallet positions without exposing API key to client.
 * Enriches positions with market thumbnail images.
 * 
 * Query Params:
 * - chainId: Blockchain chain ID (default: 56 for BSC)
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 20, max: 20)
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Get base URL from env or use default (proxy bypasses geo-restrictions on datacenter IPs)
function getOpenApiBase() {
  return (process.env.OPINION_OPENAPI_BASE || process.env.OPINION_BASE_URL || "https://proxy.opinion.trade:8443/openapi").replace(/\/+$/, "");
}

// Get API key from env
function getApiKey() {
  return process.env.OPINION_API_KEY || "";
}

/**
 * Validate wallet address format (basic check)
 * @param {string} address - Wallet address
 * @returns {boolean} - True if valid
 */
function isValidWallet(address) {
  if (!address || typeof address !== "string") return false;
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

// Simple in-memory cache for market thumbnails
const thumbnailCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
let cacheRefreshPromise = null;
let lastRefreshStart = 0;

/**
 * Build market thumbnail cache by fetching markets (non-blocking)
 * Uses Promise-based deduplication to prevent concurrent refresh race conditions.
 * @param {string} apiKey - API key
 * @param {string} baseUrl - Base URL
 */
function startThumbnailCacheRefresh(apiKey, baseUrl) {
  const now = Date.now();
  // Don't start if already refreshing or refreshed recently
  if (cacheRefreshPromise || (now - lastRefreshStart < 60000 && thumbnailCache.size > 0)) {
    return;
  }

  lastRefreshStart = now;
  
  // Run in background - don't await
  (async () => {
    try {
      console.log("[thumbnailCache] Starting cache refresh...");
      // Fetch activated and resolved markets (all types)
      for (const status of ["activated", "resolved"]) {
        let page = 1;
        const maxPages = 10;
        
        while (page <= maxPages) {
          const url = new URL(`${baseUrl}/market`);
          url.searchParams.set("status", status);
          url.searchParams.set("limit", "20");
          url.searchParams.set("page", String(page));
          url.searchParams.set("marketType", "2");
          
          const res = await fetch(url.toString(), {
            method: "GET",
            headers: { "apikey": apiKey, "Accept": "application/json" },
            cache: "no-store",
          });
          
          if (!res.ok) break;
          const data = await res.json();
          if (data.errno !== 0 || !data.result?.list?.length) break;
          
          for (const market of data.result.list) {
            if (market.thumbnailUrl) {
              thumbnailCache.set(String(market.marketId), {
                url: market.thumbnailUrl,
                time: Date.now()
              });
            }
          }
          
          if (data.result.list.length < 20) break;
          page++;
        }
      }

      // Also fetch ALL categorical parent markets (marketType=1) without status filter.
      // Parent markets carry thumbnails for their child outcomes, but may have
      // status=Created which is missed by the activated/resolved queries above.
      {
        let page = 1;
        const maxPages = 20; // Up to 400 parents
        while (page <= maxPages) {
          const url = new URL(`${baseUrl}/market`);
          url.searchParams.set("limit", "20");
          url.searchParams.set("page", String(page));
          url.searchParams.set("marketType", "1");

          const res = await fetch(url.toString(), {
            method: "GET",
            headers: { "apikey": apiKey, "Accept": "application/json" },
            cache: "no-store",
          });

          if (!res.ok) break;
          const data = await res.json();
          if (data.errno !== 0 || !data.result?.list?.length) break;

          for (const market of data.result.list) {
            if (market.thumbnailUrl) {
              thumbnailCache.set(String(market.marketId), {
                url: market.thumbnailUrl,
                time: Date.now()
              });
            }
          }

          if (data.result.list.length < 20) break;
          page++;
        }
      }

      console.log(`[thumbnailCache] Loaded ${thumbnailCache.size} markets`);
    } catch (error) {
      console.error("[thumbnailCache] Error:", error);
    } finally {
      cacheRefreshPromise = null;
    }
  })();
}

/**
 * Get thumbnail for a market ID
 * @param {number|string} marketId - Market ID
 * @returns {string|null} - Thumbnail URL or null
 */
function getThumbnail(marketId) {
  if (!marketId) return null;
  const cached = thumbnailCache.get(String(marketId));
  if (cached && (Date.now() - cached.time) < CACHE_TTL) {
    return cached.url;
  }
  return null;
}

/**
 * Fetch thumbnails on-demand for specific market IDs (categorical endpoint).
 * Used as a synchronous fallback when the background cache misses parent markets.
 * @param {string[]} marketIds - Array of market ID strings
 * @param {string} apiKey - API key
 * @param {string} baseUrl - API base URL
 * @returns {Promise<Map<string, string>>} - Map of marketId -> thumbnailUrl
 */
async function fetchThumbnailsOnDemand(marketIds, apiKey, baseUrl) {
  const result = new Map();
  if (!marketIds.length) return result;

  const fetches = marketIds.map(async (id) => {
    try {
      const res = await fetch(`${baseUrl}/market/categorical/${id}`, {
        method: "GET",
        headers: { "apikey": apiKey, "Accept": "application/json" },
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      const thumb = data.result?.data?.thumbnailUrl;
      if (thumb) {
        result.set(id, thumb);
        thumbnailCache.set(id, { url: thumb, time: Date.now() });
      }
    } catch { /* ignore individual failures */ }
  });

  await Promise.all(fetches);
  return result;
}

export async function GET(request, { params }) {
  try {
    const { wallet } = await params;
    
    // Validate wallet address
    if (!isValidWallet(wallet)) {
      return NextResponse.json(
        { code: -1, msg: "Invalid wallet address format", result: null },
        { status: 400 }
      );
    }
    
    // Check API key
    const apiKey = getApiKey();
    if (!apiKey) {
      return NextResponse.json(
        { code: -1, msg: "API key not configured", result: null },
        { status: 500 }
      );
    }
    
    // Parse query params
    const { searchParams } = new URL(request.url);
    const chainId = searchParams.get("chainId") || "56";
    const page = searchParams.get("page") || "1";
    const limit = Math.min(Number(searchParams.get("limit") || "20"), 20);
    
    // Build upstream URL
    const baseUrl = getOpenApiBase();
    const upstreamUrl = new URL(`${baseUrl}/positions/user/${wallet}`);
    upstreamUrl.searchParams.set("chainId", chainId);
    upstreamUrl.searchParams.set("page", page);
    upstreamUrl.searchParams.set("limit", String(limit));
    
    // Start background cache refresh (non-blocking)
    startThumbnailCacheRefresh(apiKey, baseUrl);
    
    // Fetch from Opinion OpenAPI
    const response = await fetch(upstreamUrl.toString(), {
      method: "GET",
      headers: {
        "apikey": apiKey,
        "Accept": "application/json",
      },
      cache: "no-store",
    });
    
    // Parse response
    const text = await response.text();
    let data;
    
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    
    // Handle non-200 responses
    if (!response.ok) {
      return NextResponse.json(
        { 
          code: -1, 
          msg: `Upstream error: ${response.status}`, 
          result: null
        },
        { status: response.status }
      );
    }
    
    // Enrich positions with displayTitle and thumbnails
    if (data.errno === 0 && data.result?.list?.length > 0) {
      // First pass: enrich from cache
      data.result.list = data.result.list.map((pos) => {
        const mainTitle = pos.rootMarketTitle || "";
        const outcomeName = pos.marketTitle || pos.outcome || "";
        
        let displayTitle;
        if (mainTitle && outcomeName && mainTitle !== outcomeName) {
          displayTitle = `${mainTitle} - ${outcomeName}`;
        } else {
          displayTitle = mainTitle || outcomeName || "Unknown";
        }
        
        // Get thumbnail from cache using rootMarketId (parent market)
        // Fallback to marketId for binary markets
        const thumbnailUrl = getThumbnail(pos.rootMarketId) || getThumbnail(pos.marketId);
        
        return {
          ...pos,
          thumbnailUrl: thumbnailUrl,
          displayTitle: displayTitle,
          fullMarketTitle: mainTitle,
          outcomeName: outcomeName,
        };
      });

      // Second pass: fetch missing thumbnails on-demand for this page
      const missingIds = [...new Set(
        data.result.list
          .filter(p => !p.thumbnailUrl && (p.rootMarketId || p.marketId))
          .map(p => String(p.rootMarketId || p.marketId))
      )];

      if (missingIds.length > 0) {
        const fetched = await fetchThumbnailsOnDemand(missingIds, apiKey, baseUrl);
        if (fetched.size > 0) {
          data.result.list = data.result.list.map(pos => {
            if (pos.thumbnailUrl) return pos;
            const id = String(pos.rootMarketId || pos.marketId);
            const url = fetched.get(id) || null;
            return url ? { ...pos, thumbnailUrl: url } : pos;
          });
        }
      }
    }
    
    // Return data
    return NextResponse.json(data);
    
  } catch (error) {
    console.error("[wallet/positions] Error:", error);
    return NextResponse.json(
      { code: -1, msg: "Internal server error", result: null },
      { status: 500 }
    );
  }
}
