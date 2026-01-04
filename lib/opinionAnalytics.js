import { opinionFetch } from "./opinion";

// Opinion Analytics API Client
// Base URL: http://opinion.api.predictscan.dev:10001

const ANALYTICS_BASE_URL = "http://opinion.api.predictscan.dev:10001";

// ============ VOLUME CACHE ============
// In-memory cache for volume data to reduce API calls
const volumeCache = {
  data: {},           // marketId -> { volume, volume24h, volume7d, fetchedAt }
  TTL: 60 * 1000,     // Cache TTL: 60 seconds
};

/**
 * Check if cached volume is still valid
 */
function isCacheValid(marketId) {
  const cached = volumeCache.data[marketId];
  if (!cached) return false;
  return (Date.now() - cached.fetchedAt) < volumeCache.TTL;
}

/**
 * Get volume from cache
 */
function getCachedVolume(marketId) {
  if (isCacheValid(marketId)) {
    return volumeCache.data[marketId];
  }
  return null;
}

/**
 * Set volume in cache
 */
function setCachedVolume(marketId, volumeData) {
  volumeCache.data[marketId] = {
    ...volumeData,
    fetchedAt: Date.now(),
  };
}
// ============ END CACHE ============

/**
 * Fetch data from Opinion Analytics API
 */
export async function analyticsFetch(path, options = {}) {
  const url = new URL(ANALYTICS_BASE_URL + path);
  
  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  try {
    const res = await fetch(url.toString(), {
      method: options.method || "GET",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    const data = await res.json();
    return data;
  } catch (error) {
    console.error("Analytics API error:", error);
    return { success: false, error: { message: error.message } };
  }
}

/**
 * Get all markets from Analytics API
 */
export async function getAnalyticsMarkets() {
  return analyticsFetch("/api/markets");
}

/**
 * Get recent orders/transactions
 */
export async function getRecentOrders(params = {}) {
  return analyticsFetch("/api/orders/recent", { params });
}

/**
 * Get top20 analysis data (has volume info) for a specific page
 */
export async function getTop20(timewindow = "24h", page = 1) {
  return analyticsFetch("/api/analyze/top20", { 
    params: { tag: "volume", timewindow, page } 
  });
}

/**
 * Get volume data map from top20 API (fetches multiple pages)
 * Returns a map of yesTokenId -> { volume24h, volume1h, volume4h }
 */
export async function getVolumeData() {
  const MAX_PAGES = 15; // Fetch up to 300 markets (15 pages x 20)
  const volumeMap = {};

  // Helper to process API response
  function processResponse(data, timeKey) {
    if (data?.success && data?.data?.top20) {
      for (const item of data.data.top20) {
        if (item.yesTokenId) {
          if (!volumeMap[item.yesTokenId]) {
            volumeMap[item.yesTokenId] = { volume24h: 0, volume1h: 0, volume4h: 0, volumeAll: 0 };
          }
          volumeMap[item.yesTokenId][timeKey] = item.totalVolume || 0;
          if (timeKey === "volume24h") {
            volumeMap[item.yesTokenId].volumeAll = item.totalVolume || 0;
          }
        }
      }
    }
  }

  // Build all fetch promises for all timewindows and pages
  const fetchPromises = [];
  
  for (let page = 1; page <= MAX_PAGES; page++) {
    fetchPromises.push(
      getTop20("24h", page).then(res => ({ res, timeKey: "volume24h", page }))
    );
    fetchPromises.push(
      getTop20("1h", page).then(res => ({ res, timeKey: "volume1h", page }))
    );
    fetchPromises.push(
      getTop20("4h", page).then(res => ({ res, timeKey: "volume4h", page }))
    );
  }

  // Execute all fetches in parallel
  const results = await Promise.all(fetchPromises);

  // Process all results
  for (const { res, timeKey } of results) {
    processResponse(res, timeKey);
  }

  return volumeMap;
}

/**
 * Normalize analytics market to match our format
 */
export function normalizeAnalyticsMarket(m, volumeData = {}) {
  // Build title: combine parent event title with outcome title if available
  let title = m.title || "";
  if (m.parentEvent?.title) {
    // Replace "..." in parent title with outcome title
    // e.g., "Bitcoin above ... on January 2?" + "84,000" => "Bitcoin above $84,000 on January 2?"
    const parentTitle = m.parentEvent.title;
    if (parentTitle.includes("...")) {
      title = parentTitle.replace("...", `$${m.title}`);
    } else {
      title = `${parentTitle} - ${m.title}`;
    }
  }

  // Get volume from volumeData map
  const volInfo = volumeData[m.yesTokenId] || {};

  // For multi-outcome markets, cutoffAt may be on the parentEvent
  const cutoffAt = m.cutoffAt || m.parentEvent?.cutoffAt || null;
  const resolvedAt = m.resolvedAt || m.parentEvent?.resolvedAt || null;

  return {
    marketId: String(m.marketId),
    title: title,
    status: m.status,
    statusEnum: m.statusEnum || "",
    volume24h: volInfo.volume24h || 0,
    volume1h: volInfo.volume1h || 0,
    volume4h: volInfo.volume4h || 0,
    volume: volInfo.volumeAll || volInfo.volume24h || parseFloat(m.volume || 0),
    cutoffAt: cutoffAt,
    resolvedAt: resolvedAt,
    yesTokenId: m.yesTokenId || null,
    noTokenId: m.noTokenId || null,
    yesLabel: m.yesLabel || "YES",
    noLabel: m.noLabel || "NO",
    // Multi-outcome specific
    isMultiOutcome: !!m.parentEventId,
    parentEventId: m.parentEventId || null,
    parentEventTitle: m.parentEvent?.title || null,
    // Source identifier
    source: "analytics",
  };
}

/**
 * Fetch volume data for a single market from Opinion Trade API
 */
async function fetchMarketVolume(marketId) {
  // Check cache first
  const cached = getCachedVolume(String(marketId));
  if (cached) {
    return {
      marketId: String(marketId),
      volume: cached.volume,
      volume24h: cached.volume24h,
      volume7d: cached.volume7d,
      fromCache: true,
    };
  }

  try {
    const response = await opinionFetch(`/market/${marketId}`);
    if (response?.errno === 0 && response?.result?.data) {
      const data = response.result.data;
      const volumeData = {
        marketId: String(marketId),
        volume: parseFloat(data.volume || 0),
        volume24h: parseFloat(data.volume24h || 0),
        volume7d: parseFloat(data.volume7d || 0),
      };
      
      // Save to cache
      setCachedVolume(String(marketId), volumeData);
      
      return volumeData;
    }
  } catch (e) {
    // Ignore errors for individual market fetches
  }
  return null;
}

/**
 * Fetch volume for multiple markets in parallel
 * Uses cache to avoid redundant API calls
 */
async function fetchVolumesForMarkets(marketIds) {
  const volumeMap = {};
  const needsFetch = [];
  
  // Check cache first for all markets
  for (const id of marketIds) {
    const cached = getCachedVolume(String(id));
    if (cached) {
      volumeMap[String(id)] = cached;
    } else {
      needsFetch.push(id);
    }
  }
  
  // Log cache hit rate
  const cacheHits = marketIds.length - needsFetch.length;
  if (cacheHits > 0) {
    console.log(`[VolumeCache] ${cacheHits}/${marketIds.length} from cache, fetching ${needsFetch.length}`);
  }
  
  // Fetch all missing volumes in parallel (no concurrency limit)
  if (needsFetch.length > 0) {
    const results = await Promise.all(
      needsFetch.map(id => fetchMarketVolume(id))
    );
    
    for (const result of results) {
      if (result) {
        volumeMap[result.marketId] = result;
      }
    }
  }
  
  return volumeMap;
}

/**
 * Get multi-outcome markets (markets with parentEventId)
 * Returns them normalized and ready for display
 * 
 * NOTE: Analytics API may have stale statusEnum data.
 * We filter by statusEnum === "Activated" as initial filter,
 * but the main page.jsx does a second pass with Opinion API detail
 * to ensure resolved markets are filtered out.
 */
export async function getMultiOutcomeMarkets() {
  // Fetch markets from Analytics API
  const marketsResponse = await getAnalyticsMarkets();
  
  if (!marketsResponse.success || !Array.isArray(marketsResponse.data)) {
    return { success: false, data: [], error: marketsResponse.error };
  }

  // Filter only markets with parentEventId (multi-outcome markets)
  // and only activated ones
  const multiOutcomeRaw = marketsResponse.data
    .filter(m => m.parentEventId && m.statusEnum === "Activated");

  // Get all market IDs to fetch volume for
  const marketIds = multiOutcomeRaw.map(m => m.marketId);
  
  // Fetch volume data from Opinion Trade API (uses cache)
  const volumeMap = await fetchVolumesForMarkets(marketIds);

  // Normalize markets with volume data
  const multiOutcomeMarkets = multiOutcomeRaw.map(m => {
    const volData = volumeMap[String(m.marketId)] || {};
    return normalizeAnalyticsMarket(m, {
      [m.yesTokenId]: {
        volume24h: volData.volume24h || 0,
        volume1h: 0,
        volume4h: 0,
        volumeAll: volData.volume || 0,
      }
    });
  });

  return {
    success: true,
    data: multiOutcomeMarkets,
    total: multiOutcomeMarkets.length,
  };
}

/**
 * Get all activated markets from analytics
 */
export async function getAllAnalyticsMarkets() {
  const response = await getAnalyticsMarkets();
  
  if (!response.success || !Array.isArray(response.data)) {
    return { success: false, data: [], error: response.error };
  }

  const markets = response.data
    .filter(m => m.statusEnum === "Activated")
    .map(normalizeAnalyticsMarket);

  return {
    success: true,
    data: markets,
    total: markets.length,
  };
}
