import OrderbookView from "@/components/OrderbookView";
import { opinionFetch } from "@/lib/opinion";
import { analyticsFetch } from "@/lib/opinionAnalytics";
import { mapWithConcurrency, opinionRateLimiter } from "@/lib/concurrency";

export const dynamic = "force-dynamic";

// ============ CHILD → PARENT CACHE ============
// In-memory cache that maps childMarketId → { parentId, parentTitle, parentRules }
// Built once, refreshed every 10 minutes. Shared across all requests.
const _parentCache = globalThis.__PARENT_CHILD_CACHE__ ?? (globalThis.__PARENT_CHILD_CACHE__ = {
  map: null,        // Map<string, { parentId, parentTitle, parentRules }>
  builtAt: 0,
  building: null,   // Promise while building (dedup concurrent requests)
  TTL: 10 * 60 * 1000, // 10 minutes (increased from 5 – parent/child mapping rarely changes)
});
if (!globalThis.__PARENT_CHILD_CACHE__) globalThis.__PARENT_CHILD_CACHE__ = _parentCache;

/**
 * Build the full child→parent mapping using rate-limited concurrency.
 */
async function _buildParentMap() {
  const PAGE_SIZE = 20;
  const MAX_PAGES = 25;

  // Step 1: collect all categorical parent IDs
  const parentIds = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const result = await opinionFetch("/market", {
        params: { sortBy: 5, limit: PAGE_SIZE, page, marketType: 1 },
      });
      if (result?.errno !== 0) break;
      const list = result?.result?.list || [];
      parentIds.push(...list.map((p) => p.marketId));
      if (list.length < PAGE_SIZE) break;
    } catch {
      break;
    }
  }

  // Step 2: fetch categorical details with rate-limited concurrency
  const map = new Map();
  
  await mapWithConcurrency(parentIds, async (pid) => {
    try {
      const detail = await opinionRateLimiter.run(() =>
        opinionFetch(`/market/categorical/${pid}`)
      );
      const pd = detail?.result?.data;
      if (!pd) return;
      const children = pd.childMarkets || [];
      const parentTitle = pd.marketTitle || pd.tittle || pd.title || "";
      const parentRules = pd.rules || pd.description || pd.marketRules || pd.resolutionRules || "";
      for (const c of children) {
        map.set(String(c.marketId), {
          parentId: pid,
          parentTitle,
          parentRules,
        });
      }
    } catch {
      // ignore individual failures
    }
  }, { concurrency: 10 });

  console.log(`[ParentCache] Built: ${parentIds.length} parents → ${map.size} children`);
  return map;
}

/**
 * Get parent info for a child market from cache (builds cache on first call)
 */
async function getParentForChild(childMarketId) {
  const now = Date.now();

  // If cache is fresh, use it
  if (_parentCache.map && (now - _parentCache.builtAt) < _parentCache.TTL) {
    return _parentCache.map.get(String(childMarketId)) || null;
  }

  // Build (or await in-flight build to dedup concurrent requests)
  if (!_parentCache.building) {
    _parentCache.building = _buildParentMap()
      .then((m) => {
        _parentCache.map = m;
        _parentCache.builtAt = Date.now();
        _parentCache.building = null;
        return m;
      })
      .catch((e) => {
        console.error("[ParentCache] Build failed:", e.message);
        _parentCache.building = null;
        return _parentCache.map || new Map(); // fallback to stale cache
      });
  }

  const map = await _parentCache.building;
  return (map || _parentCache.map)?.get(String(childMarketId)) || null;
}

function pickMarketFromApi(payload) {
  return payload?.result?.data ?? payload?.result ?? payload?.data ?? payload ?? {};
}

/**
 * Check if market has bonus (incentiveFactor field exists)
 */
function checkHasBonus(marketData) {
  return (
    "incentiveFactor" in marketData ||
    "incentive_factor" in marketData ||
    "incentive" in marketData
  );
}

/**
 * Fetch parent detail from Opinion categorical API (single call, fast)
 */
async function fetchParentTitleFromOpinion(parentId) {
  if (!parentId) return null;
  try {
    const detail = await opinionFetch(`/market/categorical/${parentId}`);
    const fullData = detail?.result?.data;
    if (!fullData) return null;
    const title = fullData.marketTitle || fullData.tittle || fullData.title || null;
    const rules = fullData.rules || fullData.description || fullData.marketRules || fullData.resolutionRules || null;
    return { title, rules };
  } catch {
    return null;
  }
}

async function fetchMarketFromAnalytics(marketId) {
  const response = await analyticsFetch("/api/markets");
  if (!response.success || !Array.isArray(response.data)) {
    return null;
  }

  const market = response.data.find((m) => String(m.marketId) === String(marketId));
  if (!market) return null;

  // Build proper title for multi-outcome markets
  let title = market.title || "";
  if (market.parentEvent?.title) {
    const parentTitle = market.parentEvent.title;
    if (parentTitle.includes("...")) {
      title = parentTitle.replace("...", `$${market.title}`);
    } else {
      title = `${parentTitle} - ${market.title}`;
    }
  }

  // ✅ FIX: rules for multi-outcome are often stored on parentEvent, not on child market
  const rules =
    market.rules ||
    market.parentEvent?.rules ||
    market.parentEvent?.description ||
    market.parentEvent?.marketRules ||
    market.parentEvent?.resolutionRules ||
    "";

  return {
    marketId: market.marketId,
    marketTitle: title,
    title: title,
    yesTokenId: market.yesTokenId,
    noTokenId: market.noTokenId,
    yesLabel: market.yesLabel || "YES",
    noLabel: market.noLabel || "NO",
    status: market.status,
    statusEnum: market.statusEnum,
    rules: rules, // ✅ use merged rules
    cutoffAt: market.cutoffAt,
    volume: market.volume,
    isMultiOutcome: !!market.parentEventId,
    parentEventId: market.parentEventId || null,
    parentEventTitle: market.parentEvent?.title,
  };
}

export default async function MarketPage({ params, searchParams }) {
  const marketId = params?.marketId;
  
  // Get parentTitle from URL query params (passed from Discover page for categorical children)
  const parentTitleFromUrl = searchParams?.parentTitle || "";

  // Try Opinion API first
  const r = await opinionFetch(`/market/${marketId}`);

  const ok =
    (typeof r?.errno === "number" && r.errno === 0) ||
    (typeof r?.code === "number" && r.code === 0);

  let m = null;
  let analyticsWorked = false;

  if (ok) {
    // Parse Opinion payload
    m = pickMarketFromApi({ errno: 0, result: { data: r?.result?.data ?? r?.result ?? r } });

    // IMPORTANT FIX:
    // Even when Opinion API succeeds, use Analytics to build full title for multi-outcome markets.
    try {
      const a = await fetchMarketFromAnalytics(marketId);

      if (a?.marketTitle) {
        // Override title fields so OrderbookView shows the full title
        m.marketTitle = a.marketTitle;
        m.title = a.marketTitle;
        analyticsWorked = true;
      }

      // ✅ Also merge rules from analytics when Opinion rules are missing/empty
      if (!m.rules && a?.rules) m.rules = a.rules;

      // Optional merges
      if (!m.cutoffAt && a?.cutoffAt) m.cutoffAt = a.cutoffAt;
      if (!m.volume && a?.volume) m.volume = a.volume;
      if (!m.parentEventTitle && a?.parentEventTitle) m.parentEventTitle = a.parentEventTitle;
      if (!m.parentEventId && a?.parentEventId) m.parentEventId = a.parentEventId;
      if (m.isMultiOutcome === undefined && a?.isMultiOutcome !== undefined)
        m.isMultiOutcome = a.isMultiOutcome;
    } catch {
      // ignore analytics failures
    }

    // ✅ FIX 1: Use parentTitle from URL params if available (passed from Discover page)
    if (!analyticsWorked && parentTitleFromUrl) {
      const outcomeName = m.marketTitle || m.tittle || m.title || "";
      const fullTitle = `${parentTitleFromUrl} - ${outcomeName}`;
      m.marketTitle = fullTitle;
      m.title = fullTitle;
      m.parentEventTitle = parentTitleFromUrl;
      m.isMultiOutcome = true;
    }

    // ✅ FIX 2: If parentEventId is known, fetch parent details directly (fast single call)
    const knownParentId = m.parentEventId || m.rootMarketId || m.categoricalParentId;
    if (knownParentId && (!analyticsWorked || !m.rules || !m.parentEventTitle)) {
      try {
        const parentInfo = await fetchParentTitleFromOpinion(knownParentId);
        if (parentInfo?.title && !m.parentEventTitle) {
          const outcomeName = m.marketTitle || m.tittle || m.title || "";
          m.marketTitle = `${parentInfo.title} - ${outcomeName}`;
          m.title = m.marketTitle;
          m.parentEventTitle = parentInfo.title;
          m.isMultiOutcome = true;
        }
        if (!m.rules && parentInfo?.rules) m.rules = parentInfo.rules;
      } catch {
        // ignore
      }
    }

    // ✅ FIX 3: Use cached child→parent mapping (covers ALL categorical children)
    // This is the main path for markets missing parentEventId in the Opinion API.
    // The cache is built once (~9s), then instant for all subsequent requests.
    if (!m.parentEventTitle || !m.rules) {
      try {
        const cached = await getParentForChild(marketId);
        if (cached) {
          if (!m.parentEventTitle && cached.parentTitle) {
            const outcomeName = m.marketTitle || m.tittle || m.title || "";
            m.marketTitle = `${cached.parentTitle} - ${outcomeName}`;
            m.title = m.marketTitle;
            m.parentEventTitle = cached.parentTitle;
            m.parentEventId = cached.parentId;
            m.isMultiOutcome = true;
          }
          if (!m.rules && cached.parentRules) m.rules = cached.parentRules;
        }
      } catch {
        // ignore cache errors
      }
    }
  } else {
    // Fallback to Analytics API for multi-outcome markets
    m = await fetchMarketFromAnalytics(marketId);
  }

  if (!m) {
    return (
      <div className="panel" style={{ padding: 14 }}>
        <div style={{ fontWeight: 900, fontSize: 14 }}>Market #{marketId}</div>
        <p className="muted" style={{ marginTop: 8 }}>
          Failed to load market detail.
        </p>
        <div style={{ marginTop: 10 }}>
          <a className="btn" href="/">
            ← Back
          </a>
        </div>
      </div>
    );
  }

  const title = m.marketTitle || m.title || m.tittle || m.marketName || `Market ${marketId}`;

  const yesTokenId = m.yesTokenId || m.yes_token_id || m.yesToken || null;
  const noTokenId = m.noTokenId || m.no_token_id || m.noToken || null;
  
  // ✅ Check if market has bonus (incentiveFactor field exists in raw API response)
  const hasBonus = checkHasBonus(m);

  // ✅ Outcome labels – some binary markets use custom names (e.g. "NAVI" / "FNC") instead of YES/NO
  const yesLabel = m.yesLabel || m.yes_label || "YES";
  const noLabel  = m.noLabel  || m.no_label  || "NO";

  return (
    <OrderbookView
      marketId={marketId}
      title={title}
      yesTokenId={yesTokenId}
      noTokenId={noTokenId}
      marketData={m}
      hasBonus={hasBonus}
      yesLabel={yesLabel}
      noLabel={noLabel}
    />
  );
}
