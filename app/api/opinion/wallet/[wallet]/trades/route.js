/**
 * API Route: GET /api/opinion/wallet/[wallet]/trades
 * 
 * Proxy for Opinion OpenAPI trades endpoint.
 * Fetches wallet trade history without exposing API key to client.
 * Enriches trades with market thumbnail images.
 * 
 * Query Params:
 * - chainId: Blockchain chain ID (default: 56 for BSC)
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 20, max: 20)
 */

import { NextResponse } from "next/server";

// Get base URL from env or use default
function getOpenApiBase() {
  return (process.env.OPINION_OPENAPI_BASE || "https://openapi.opinion.trade/openapi").replace(/\/+$/, "");
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
let cacheRefreshing = false;
let lastRefreshStart = 0;

/**
 * Build market thumbnail cache by fetching markets (non-blocking)
 * @param {string} apiKey - API key
 * @param {string} baseUrl - Base URL
 */
function startThumbnailCacheRefresh(apiKey, baseUrl) {
  const now = Date.now();
  // Don't start if already refreshing or refreshed recently
  if (cacheRefreshing || (now - lastRefreshStart < 60000 && thumbnailCache.size > 0)) {
    return;
  }
  
  cacheRefreshing = true;
  lastRefreshStart = now;

  // Run in background - don't await
  (async () => {
    try {
      console.log("[tradesThumbnailCache] Starting cache refresh...");
      // Fetch both activated and resolved markets
      for (const status of ["activated", "resolved"]) {
        let page = 1;
        const maxPages = 10; // Limit to 200 markets per status
        
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
      console.log(`[tradesThumbnailCache] Loaded ${thumbnailCache.size} markets`);
    } catch (error) {
      console.error("[tradesThumbnailCache] Error:", error);
    } finally {
      cacheRefreshing = false;
    }
  })();
}

/**
 * Get thumbnail for a market ID
 * @param {number|string} marketId - Market ID
 * @returns {string|null} - Thumbnail URL or null
 */
function getThumbnail(marketId) {
  const cached = thumbnailCache.get(String(marketId));
  if (cached && (Date.now() - cached.time) < CACHE_TTL) {
    return cached.url;
  }
  return null;
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
    const upstreamUrl = new URL(`${baseUrl}/trade/user/${wallet}`);
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
          result: null,
          upstream: data 
        },
        { status: response.status }
      );
    }
    
    // Enrich trades with displayTitle and thumbnails
    if (data.errno === 0 && data.result?.list?.length > 0) {
      data.result.list = data.result.list.map(trade => {
        // rootMarketTitle = Main market title (e.g. "What price will Bitcoin hit in January?")
        // marketTitle = Outcome name (e.g. "↓ 80,000", "$2B", "Bhumjaithai Party (BJT)")
        const mainTitle = trade.rootMarketTitle || "";
        const outcomeName = trade.marketTitle || trade.outcome || "";
        
        // Build display title: [Root Market Title] - [Outcome]
        let displayTitle;
        if (mainTitle && outcomeName && mainTitle !== outcomeName) {
          displayTitle = `${mainTitle} - ${outcomeName}`;
        } else {
          displayTitle = mainTitle || outcomeName || "Unknown";
        }
        
        // Get thumbnail from cache using rootMarketId (parent market ID)
        const thumbnailUrl = getThumbnail(trade.rootMarketId);
        
        return {
          ...trade,
          thumbnailUrl: thumbnailUrl,
          displayTitle: displayTitle,
          fullMarketTitle: mainTitle,
          outcomeName: outcomeName,
        };
      });
    }
    
    // Return data
    return NextResponse.json(data);
    
  } catch (error) {
    console.error("[wallet/trades] Error:", error);
    return NextResponse.json(
      { code: -1, msg: "Internal server error", result: null },
      { status: 500 }
    );
  }
}
