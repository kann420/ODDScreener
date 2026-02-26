const DEFAULT_BASE_URL = "https://proxy.opinion.trade:8443/openapi";

import { mapWithConcurrency, opinionRateLimiter } from "@/lib/concurrency";

function getBaseUrl() {
  return (process.env.OPINION_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function getApiKey() {
  return process.env.OPINION_API_KEY || "";
}

export async function opinionFetch(path, { method = "GET", params, body, _retryCount = 0 } = {}) {
  const MAX_RETRIES = 2;
  const baseUrl = getBaseUrl();
  const apiKey = getApiKey();

  if (!apiKey) {
    return { errno: -1, errormsg: "missing_api_key", result: null };
  }

  const url = new URL(baseUrl + path);

  if (params && typeof params === "object") {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }

  let res;
  let text = "";
  try {
    res = await fetch(url.toString(), {
      method,
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });

    text = await res.text();
  } catch (e) {
    return {
      errno: -1,
      errormsg: "fetch_failed",
      result: null,
    };
  }

  // --- 429 retry with exponential backoff ---
  if (res.status === 429 && _retryCount < MAX_RETRIES) {
    const backoffMs = (2 ** _retryCount) * 1500 + Math.random() * 500;
    console.warn(`[Opinion] 429 on ${path} – retry ${_retryCount + 1} in ${Math.round(backoffMs)}ms`);
    await new Promise(r => setTimeout(r, backoffMs));
    return opinionFetch(path, { method, params, body, _retryCount: _retryCount + 1 });
  }

  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    return {
      errno: -1,
      errormsg: "upstream_http_error",
      result: null,
    };
  }

  return data;
}

/**
 * Fetch all markets with pagination
 * Opinion API has a server-side limit of 20 items per page,
 * so we need to paginate to get all markets.
 * 
 * @param {Object} options - Fetch options
 * @param {string} options.status - Market status (default: "activated")
 * @param {number} options.sortBy - Sort option (default: 5 for volume)
 * @param {number} options.marketType - Market type (0=binary, 1=parent, 2=all)
 * @param {number} options.maxPages - Maximum pages to fetch (default: 10)
 * @returns {Promise<Object>} Combined result with all markets
 */
export async function opinionFetchAllMarkets(options = {}) {
  const {
    status = "activated",
    sortBy = 5,
    marketType = 0,
    maxPages = 10,
  } = options;

  const PAGE_SIZE = 20; // Server enforced limit
  let allMarkets = [];
  let totalAvailable = 0;
  let currentPage = 1;
  
  while (currentPage <= maxPages) {
    const result = await opinionFetch("/market", {
      params: { status, sortBy, limit: PAGE_SIZE, page: currentPage, marketType },
    });
    
    if (result?.errno !== 0) {
      // If first page fails, return error
      if (currentPage === 1) {
        return result;
      }
      // Otherwise, return what we have
      break;
    }
    
    const list = result?.result?.list || [];
    totalAvailable = result?.result?.total || totalAvailable;
    
    allMarkets = allMarkets.concat(list);
    
    // Check if we've fetched all available
    if (list.length < PAGE_SIZE || allMarkets.length >= totalAvailable) {
      break;
    }
    
    currentPage++;
  }
  
  return {
    errno: 0,
    result: {
      list: allMarkets,
      total: totalAvailable,
    },
  };
}

/* ============ CATEGORICAL CACHE ============
 * Caches the full categorical children list to avoid refetching
 * 200+ parent markets on every page load.
 */
const _catCache = globalThis.__CATEGORICAL_CACHE__ ?? (globalThis.__CATEGORICAL_CACHE__ = {
  data: null,
  fetchedAt: 0,
  building: null,
  TTL: 3 * 60 * 1000, // 3 minutes
});
if (!globalThis.__CATEGORICAL_CACHE__) globalThis.__CATEGORICAL_CACHE__ = _catCache;

/**
 * Fetch categorical parent markets and their tradable children
 * 
 * This fetches:
 * 1. ALL categorical parent markets (marketType=1) - uses result.total to know when done
 * 2. For each parent, fetch children via /market/categorical/{id}
 * 
 * NOTE: Parent markets always have status=1 (Created), NOT status=2 (Activated)
 * Only child markets have status=2 when active
 * 
 * @param {Object} options - Fetch options
 * @param {number} options.maxParents - Max parent markets to fetch (default: 200, use Infinity for all)
 * @param {number} options.maxChildrenPerParent - Max children per parent (default: 50)
 * @returns {Promise<Object>} Result with list of child markets
 */
export async function opinionFetchCategoricalChildren(options = {}) {
  const now = Date.now();

  // Return cached data if fresh
  if (_catCache.data && (now - _catCache.fetchedAt) < _catCache.TTL) {
    console.log(`[Categorical] Cache HIT (age ${Math.round((now - _catCache.fetchedAt) / 1000)}s)`);
    return _catCache.data;
  }

  // Dedup concurrent builds
  if (_catCache.building) {
    console.log(`[Categorical] Waiting for in-flight fetch...`);
    return _catCache.building;
  }

  _catCache.building = _fetchCategoricalChildrenInternal(options)
    .then((result) => {
      _catCache.data = result;
      _catCache.fetchedAt = Date.now();
      _catCache.building = null;
      return result;
    })
    .catch((err) => {
      _catCache.building = null;
      console.error(`[Categorical] Fetch failed:`, err.message);
      if (_catCache.data) return _catCache.data; // stale fallback
      return { errno: 0, result: { list: [], total: 0, parentCount: 0 } };
    });

  return _catCache.building;
}

async function _fetchCategoricalChildrenInternal(options = {}) {
  const {
    maxParents = 200, // Increased default to get more parents
    maxChildrenPerParent = 50,
  } = options;

  const PAGE_SIZE = 20;
  let parents = [];
  let currentPage = 1;
  let totalAvailable = 0;
  
  // Step 1: Fetch ALL categorical parent markets (use result.total to paginate correctly)
  // NOTE: Do NOT filter by status="activated" - parent markets always have status=1 (Created)
  while (true) {
    const result = await opinionFetch("/market", {
      params: { 
        // NO status filter - parent markets have status=1 (Created), not "activated"
        sortBy: 5, // volume desc
        limit: PAGE_SIZE, 
        page: currentPage, 
        marketType: 1, // categorical parent
      },
    });
    
    if (result?.errno !== 0) break;
    
    // Get total from first response
    if (currentPage === 1) {
      totalAvailable = result?.result?.total || 0;
      console.log(`[Categorical] Total parents available: ${totalAvailable}`);
    }
    
    const list = result?.result?.list || [];
    if (list.length === 0) break;
    
    // Filter only parents that are NOT resolved
    // Parent status: 1=Created (active), 3+=Resolved/Failed
    for (const m of list) {
      const statusNum = Number(m.status);
      const statusEnum = String(m.statusEnum || '').toLowerCase();
      const resolvedAt = m.resolvedAt;
      
      const isResolved = 
        statusNum === 4 || statusNum === 3 || statusNum >= 5 ||
        statusEnum === 'resolved' || statusEnum === 'resolving' ||
        (resolvedAt && Number(resolvedAt) > 0);
      
      if (!isResolved && m.marketId) {
        parents.push(m);
      }
    }
    
    // Stop if we've fetched all available or reached maxParents
    if (parents.length >= totalAvailable || parents.length >= maxParents) break;
    if (list.length < PAGE_SIZE) break; // No more pages
    
    currentPage++;
    if (currentPage > 20) break; // Safety limit (20 pages * 20 = 400 max)
  }
  
  console.log(`[Categorical] Fetched ${parents.length} active parents`);

  // Step 2: Fetch children for each parent (rate-limited concurrency)
  const allChildren = [];
  
  const childResults = await mapWithConcurrency(parents, async (parent) => {
    try {
      const detail = await opinionRateLimiter.run(() =>
        opinionFetch(`/market/categorical/${parent.marketId}`)
      );
      const fullData = detail?.result?.data;
      if (!fullData) return [];
      
      const parentTitle = fullData.marketTitle || fullData.tittle || fullData.title || parent.marketTitle || "";
      const children = Array.isArray(fullData.childMarkets) ? fullData.childMarkets : [];
      
      // Filter only active children
      const activeChildren = children.filter(child => {
        const statusNum = Number(child.status);
        const statusEnum = String(child.statusEnum || '').toLowerCase();
        const resolvedAt = child.resolvedAt;
        
        const isActive = statusNum === 2 || statusEnum === 'activated';
        const isResolved = 
          statusNum === 4 || statusNum === 3 || statusNum >= 5 ||
          statusEnum === 'resolved' || statusEnum === 'resolving' ||
          (resolvedAt && Number(resolvedAt) > 0);
        
        return isActive && !isResolved;
      });
      
      return activeChildren.slice(0, maxChildrenPerParent).map(child => ({
        ...child,
        parentEventId: parent.marketId,
        parentEventTitle: parentTitle,
        isMultiOutcome: true,
      }));
    } catch {
      return [];
    }
  }, { concurrency: 10 });
  
  for (const children of childResults) {
    allChildren.push(...children);
  }
  
  return {
    errno: 0,
    result: {
      list: allChildren,
      total: allChildren.length,
      parentCount: parents.length,
    },
  };
}

export function normalizeMarketList(raw) {
  const result = raw?.result ?? raw ?? {};
  const srcList = Array.isArray(result?.list)
    ? result.list
    : Array.isArray(raw?.list)
      ? raw.list
      : [];

  const total = Number(result?.total ?? raw?.total ?? srcList.length);

  const list = srcList.map((m) => {
    // Check if market has bonus (incentiveFactor field EXISTS, regardless of value)
    const hasBonus = 
      "incentiveFactor" in m ||
      "incentive_factor" in m ||
      "incentive" in m;

    return {
      marketId: m.marketId ?? m.id ?? m.market_id,
      // ✅ Opinion API uses 'marketTitle' as primary field
      title: m.marketTitle ?? m.tittle ?? m.title ?? m.question ?? m.name ?? "",
      status: m.status ?? "",
      statusEnum: m.statusEnum ?? m.status_enum ?? "",
      // ✅ marketType: 0=binary, 1=categorical parent (root market), 2=categorical child
      // Root markets (marketType=1) should be filtered out in Discover
      marketType: m.marketType ?? m.market_type ?? null,
      volume24h: Number(m.volume24h ?? m.vol24h ?? m.volume_24h ?? 0),
      volume: Number(m.volume ?? m.volTotal ?? m.volume_total ?? 0),
      // ✅ createdAt: timestamp when market was created (used for "New" tab sorting)
      createdAt: m.createdAt ?? m.created_at ?? m.createTime ?? m.create_time ?? null,
      cutoffAt:
        m.cutoffAt ??
        m.cutoff_at ??
        m.closeTime ??
        m.close_time ??
        m.endTime ??
        m.end_time ??
        m.expiresAt ??
        m.expires_at ??
        m.expireAt ??
        m.expire_at ??
        m.expiration ??
        m.expirationTime ??
        m.expiration_time ??
        null,
      resolvedAt: m.resolvedAt ?? m.resolved_at ?? m.resolveTime ?? m.resolve_time ?? null,
      // resultTokenId indicates market has been resolved with a result
      resultTokenId: m.resultTokenId ?? m.result_token_id ?? m.resultToken ?? null,
      yesTokenId: m.yesTokenId ?? m.yes_token_id ?? null,
      noTokenId: m.noTokenId ?? m.no_token_id ?? null,
      // Simple boolean flag for bonus markets
      hasBonus,
    };
  });

  return { total, list };
}
