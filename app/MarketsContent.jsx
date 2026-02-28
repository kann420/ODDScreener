import { opinionFetch, opinionFetchAllMarkets, opinionFetchCategoricalChildren, normalizeMarketList } from "@/lib/opinion";
import { getMultiOutcomeMarkets } from "@/lib/opinionAnalytics";
import MarketListClient from "@/components/MarketListClient";

/* ============ SERVER-SIDE MARKETS CACHE ============
 * Cache the full filtered markets list so consecutive page loads
 * (within TTL) return instantly instead of re-fetching 15+ API pages.
 * This single change drops the Discover page TTFB from ~36s → <1s on warm cache.
 */
const _marketsCache = globalThis.__MARKETS_SSR_CACHE__ ?? (globalThis.__MARKETS_SSR_CACHE__ = {
  data: null,     // { filtered, bonusIdsFromList }
  fetchedAt: 0,
  building: null, // dedup concurrent requests
  TTL: 300_000,   // 5 minutes – no cache warmer, so keep data longer
});
if (!globalThis.__MARKETS_SSR_CACHE__) globalThis.__MARKETS_SSR_CACHE__ = _marketsCache;

/**
 * Convert various timestamp formats to milliseconds:
 * - unix seconds
 * - unix milliseconds
 * - numeric string
 * - ISO date string
 */
function toMs(v) {
  if (v === null || v === undefined) return null;

  // number or numeric string
  if (typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v.trim()))) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n < 1e12 ? n * 1000 : n; // auto-detect sec vs ms
  }

  // ISO date string
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }

  return null;
}

/**
 * Opinion Market Status Enum (from SDK):
 * - CREATED = 1
 * - ACTIVATED = 2 (active, tradeable)
 * - RESOLVING = 3 (being resolved)
 * - RESOLVED = 4 (already resolved/expired)
 * - FAILED = 5
 * - DELETED = 6
 */
const TOPIC_STATUS = {
  CREATED: 1,
  ACTIVATED: 2,
  RESOLVING: 3,
  RESOLVED: 4,
  FAILED: 5,
  DELETED: 6,
};

/**
 * Try to extract a date from market title for markets that haven't been resolved yet
 * but their deadline has clearly passed based on the title.
 */
function extractDateFromTitle(title) {
  if (!title) return null;

  const str = String(title).trim();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  const months = {
    january: 0, jan: 0,
    february: 1, feb: 1,
    march: 2, mar: 2,
    april: 3, apr: 3,
    may: 4,
    june: 5, jun: 5,
    july: 6, jul: 6,
    august: 7, aug: 7,
    september: 8, sep: 8, sept: 8,
    october: 9, oct: 9,
    november: 10, nov: 10,
    december: 11, dec: 11,
  };

  // Helper: guess year if month is in past (relative to current date)
  const guessYear = (month) => {
    // If month is in the past (or more than 3 months ago), it's current year
    // If month is > 3 months ahead, it might be previous year
    if (month <= currentMonth) {
      return currentYear; // past month = this year (already happened)
    }
    // Future month - but if we're in 2026 and see "March" without year
    // it could mean March 2025 (past) or March 2026 (future)
    // Conservative: assume past year if > 6 months ahead
    if (month - currentMonth > 6) {
      return currentYear - 1;
    }
    return currentYear;
  };

  // Pattern 1: "Month Day, Year" or "Month Day Year" (e.g., "December 31, 2025", "January 1 2026")
  const pattern1 =
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})\b/i;
  const match1 = str.match(pattern1);
  if (match1) {
    const month = months[match1[1].toLowerCase()];
    const day = parseInt(match1[2], 10);
    const year = parseInt(match1[3], 10);
    if (month !== undefined && day >= 1 && day <= 31 && year >= 2020 && year <= 2030) {
      return new Date(year, month, day, 23, 59, 59, 999).getTime();
    }
  }

  // Pattern 2: "by/before/on Month Day" without year (e.g., "by January 1", "before March 15")
  const pattern2 =
    /\b(?:by|before|on|until)\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i;
  const match2 = str.match(pattern2);
  if (match2) {
    const month = months[match2[1].toLowerCase()];
    const day = parseInt(match2[2], 10);
    if (month !== undefined && day >= 1 && day <= 31) {
      const year = guessYear(month);
      return new Date(year, month, day, 23, 59, 59, 999).getTime();
    }
  }

  // Pattern 3: "Month Day" at end of string or before "?" (e.g., "...by January 1?")
  const pattern3 =
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*\?)?$/i;
  const match3 = str.match(pattern3);
  if (match3) {
    const month = months[match3[1].toLowerCase()];
    const day = parseInt(match3[2], 10);
    if (month !== undefined && day >= 1 && day <= 31) {
      const year = guessYear(month);
      return new Date(year, month, day, 23, 59, 59, 999).getTime();
    }
  }

  // Pattern 4: "in Month Year?" or "in Month?" - end of month
  const pattern4 =
    /\bin\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?:\s+(\d{4}))?\s*\??/i;
  const match4 = str.match(pattern4);
  if (match4) {
    const month = months[match4[1].toLowerCase()];
    let year = match4[2] ? parseInt(match4[2], 10) : guessYear(month);

    if (month !== undefined && year >= 2020 && year <= 2030) {
      const lastDay = new Date(year, month + 1, 0).getDate();
      return new Date(year, month, lastDay, 23, 59, 59, 999).getTime();
    }
  }

  // Pattern 5: Just year at end like "...2025?" or "...2025"
  const pattern5 = /\b(202[0-5])\s*\??$/;
  const match5 = str.match(pattern5);
  if (match5) {
    const year = parseInt(match5[1], 10);
    // End of that year
    return new Date(year, 11, 31, 23, 59, 59, 999).getTime();
  }

  // Pattern 6: Q1/Q2/Q3/Q4 Year (e.g., "Q1 2025", "Q4 2025?")
  const pattern6 = /\bQ([1-4])\s*(\d{4})\b/i;
  const match6 = str.match(pattern6);
  if (match6) {
    const quarter = parseInt(match6[1], 10);
    const year = parseInt(match6[2], 10);
    // End of quarter
    const endMonth = quarter * 3 - 1; // Q1=2 (Mar), Q2=5 (Jun), Q3=8 (Sep), Q4=11 (Dec)
    const lastDay = new Date(year, endMonth + 1, 0).getDate();
    return new Date(year, endMonth, lastDay, 23, 59, 59, 999).getTime();
  }

  return null;
}

/**
 * FAST filter using only list data (no detail fetch needed)
 * This uses: status, resolvedAt, resultTokenId from list + title extraction
 */
function isExpiredFast(market) {
  if (!market) return true;

  const now = Date.now();

  // 1) Check status - handle both number AND string
  const statusRaw = market?.status;
  const statusNum = Number(statusRaw);
  
  // If status is a number
  if (Number.isFinite(statusNum) && statusNum > 0) {
    if (statusNum === TOPIC_STATUS.RESOLVED) return true;  // 4
    if (statusNum === TOPIC_STATUS.RESOLVING) return true; // 3
    if (statusNum >= TOPIC_STATUS.FAILED) return true;     // 5, 6
  }

  // Check statusEnum (string like "Resolved", "Activated", etc.)
  const statusEnum = String(market?.statusEnum ?? market?.status_enum ?? "").toLowerCase();
  if (statusEnum === "resolved" || statusEnum === "resolving" || statusEnum === "failed" || statusEnum === "deleted") {
    return true;
  }

  // 2) Check resultTokenId - if has result, it's resolved
  const resultTokenId = market?.resultTokenId ?? market?.result_token_id;
  if (resultTokenId !== null && resultTokenId !== undefined && resultTokenId !== "" && resultTokenId !== 0) {
    return true;
  }

  // 3) Check resolvedAt - market đã đáo hạn nếu resolvedAt khác 0/null
  const resolvedAtRaw = market?.resolvedAt ?? market?.resolved_at;
  if (resolvedAtRaw !== null && resolvedAtRaw !== undefined && resolvedAtRaw !== 0 && resolvedAtRaw !== "") {
    const resolvedNum = Number(resolvedAtRaw);
    if (Number.isFinite(resolvedNum) && resolvedNum > 0) return true;
  }

  // 4) Check cutoffAt if available - market đã hết hạn betting
  //    Grace period: if status=2 (Activated) and cutoff was < 48h ago, keep showing.
  //    Esports/event markets set cutoffAt to midnight on match day while the event
  //    runs later that day. But if cutoff was > 48h ago and still status=2,
  //    it's a stale market that Opinion forgot to resolve.
  const CUTOFF_GRACE_MS = 48 * 60 * 60 * 1000; // 48 hours
  const cutoffAtRaw = market?.cutoffAt ?? market?.cutoff_at;
  if (cutoffAtRaw !== null && cutoffAtRaw !== undefined) {
    const cutoffAtMs = toMs(cutoffAtRaw);
    if (cutoffAtMs && cutoffAtMs > 0 && cutoffAtMs < now) {
      const pastCutoffMs = now - cutoffAtMs;
      // Keep status=2 markets within grace period, filter everything else
      if (statusNum !== TOPIC_STATUS.ACTIVATED || pastCutoffMs > CUTOFF_GRACE_MS) {
        return true;
      }
    }
  }

  // 5) Extract date from title - for markets without proper timestamps
  //    Same grace period logic for status=2
  const title = market?.marketTitle ?? market?.tittle ?? market?.title ?? "";
  const titleDateMs = extractDateFromTitle(title);
  if (titleDateMs && titleDateMs < now) {
    const pastTitleMs = now - titleDateMs;
    if (statusNum !== TOPIC_STATUS.ACTIVATED || pastTitleMs > CUTOFF_GRACE_MS) {
      return true;
    }
  }

  // 6) If status is a meaningful number, only keep ACTIVATED (2)
  if (Number.isFinite(statusNum) && statusNum > 0 && statusNum !== TOPIC_STATUS.ACTIVATED) {
    return true;
  }

  return false;
}

/**
 * Expose the raw cache object so the discover API route can check
 * the cache state without awaiting any in-flight builds.
 */
export function getMarketsCache() {
  return _marketsCache;
}

/**
 * Async function to fetch and process markets (with server-side caching)
 * Separated for use with Suspense
 */
export async function fetchMarkets() {
  const now = Date.now();

  // --- Return cached data if still fresh (skip cached errors) ---
  if (_marketsCache.data && !_marketsCache.data.error && (now - _marketsCache.fetchedAt) < _marketsCache.TTL) {
    console.log(`[Discover] Cache HIT (age ${Math.round((now - _marketsCache.fetchedAt) / 1000)}s)`);
    return _marketsCache.data;
  }

  // --- Dedup concurrent requests (SSR streaming can fire multiple) ---
  if (_marketsCache.building) {
    console.log(`[Discover] Waiting for in-flight fetch...`);
    return _marketsCache.building;
  }

  _marketsCache.building = _fetchMarketsInternal()
    .then((result) => {
      _marketsCache.building = null;
      // Only cache successful results — never cache errors to avoid
      // serving stale errors for 90s when the API has transient failures.
      if (!result.error) {
        _marketsCache.data = result;
        _marketsCache.fetchedAt = Date.now();
      } else {
        console.warn(`[Discover] Fetch returned error — NOT caching (stale data preserved if any)`);
      }
      return result;
    })
    .catch((err) => {
      _marketsCache.building = null;
      console.error(`[Discover] Fetch failed:`, err.message);
      // Return stale data if available
      if (_marketsCache.data && !_marketsCache.data.error) {
        console.log(`[Discover] Returning stale cache`);
        return _marketsCache.data;
      }
      return { error: true, filtered: [], bonusIdsFromList: [] };
    });

  return _marketsCache.building;
}

/* ============ BACKGROUND CACHE WARMING ============
 * Keeps the Discover cache perpetually warm so users never hit cold path.
 * Runs a setInterval that refreshes the cache before TTL expires.
 * Only effective on persistent servers (Render, self-hosted Node).
 * On serverless (Vercel), the interval dies with the function – harmless but useless.
 */
// NOTE: Background cache warmer removed — it was racing with progressive
// loading polls (invalidating fetchedAt while the client polls, causing
// the client to see "building" indefinitely). The cache now warms
// naturally via SSR cold path + fetchMarkets() triggered by the
// /api/opinion/discover route on first poll.

/**
 * Internal: actual API fetch logic (called by fetchMarkets when cache misses)
 */
async function _fetchMarketsInternal() {
  const startTime = Date.now();

  // Fetch multiple APIs in parallel:
  const [opinionByVolume, opinionByNew, categoricalResult, analyticsResult] = await Promise.all([
    opinionFetchAllMarkets({
      status: "activated",
      sortBy: 5,
      marketType: 0,
      maxPages: 10,
    }),
    opinionFetchAllMarkets({
      status: "activated",
      sortBy: 1,
      marketType: 0,
      maxPages: 5,
    }),
    opinionFetchCategoricalChildren({
      maxParents: 200,
      maxChildrenPerParent: 50,
    }),
    getMultiOutcomeMarkets(),
  ]);

  console.log(`[Discover] API fetch took ${Date.now() - startTime}ms`);

  // Check if at least one Opinion API call succeeded
  const volumeOk = opinionByVolume?.errno === 0;
  const newOk = opinionByNew?.errno === 0;
  const categoricalOk = categoricalResult?.errno === 0;
  
  if (!analyticsResult.success) {
    console.warn(`[Discover] Analytics API unavailable - using Opinion API for categorical markets`);
  }
  if (categoricalOk) {
    console.log(`[Discover] Fetched ${categoricalResult.result?.list?.length || 0} categorical children from ${categoricalResult.result?.parentCount || 0} parents`);
  }
  
  if (!volumeOk && !newOk) {
    return { error: true, filtered: [], bonusIdsFromList: [] };
  }

  // Normalize both market lists
  const { list: volumeList } = volumeOk ? normalizeMarketList(opinionByVolume) : { list: [] };
  const { list: newList } = newOk ? normalizeMarketList(opinionByNew) : { list: [] };
  
  // Categorical children from Opinion API (primary source)
  const categoricalChildrenRaw = categoricalOk ? (categoricalResult.result?.list || []) : [];
  
  // Normalize categorical children to match our format
  const categoricalChildren = categoricalChildrenRaw.map(child => {
    const parentTitle = child.parentEventTitle || "";
    const outcomeName = child.marketTitle || child.tittle || child.title || child.outcome || "";
    let title = outcomeName;
    if (parentTitle && outcomeName) {
      title = `${parentTitle} - ${outcomeName}`;
    } else if (parentTitle) {
      title = parentTitle;
    }
    
    return {
      marketId: child.marketId,
      title: title,
      status: child.status,
      statusEnum: child.statusEnum || "",
      marketType: child.marketType,
      volume24h: Number(child.volume24h || child.vol24h || 0),
      volume: Number(child.volume || child.volTotal || 0),
      createdAt: child.createdAt || child.created_at || null,
      cutoffAt: child.cutoffAt || child.cutoff_at || null,
      resolvedAt: child.resolvedAt || child.resolved_at || null,
      resultTokenId: child.resultTokenId || null,
      yesTokenId: child.yesTokenId || null,
      noTokenId: child.noTokenId || null,
      hasBonus: false,
      isMultiOutcome: true,
      parentEventId: child.parentEventId,
      parentEventTitle: parentTitle,
    };
  });
  
  // Multi-outcome from Analytics API (fallback)
  const multiOutcomeList = analyticsResult.success ? analyticsResult.data : [];

  const opinionList = [...volumeList, ...newList];

  // Detect bonus markets
  const bonusIdsFromList = opinionList
    .filter((m) => m.hasBonus === true)
    .map((m) => m.marketId);
  
  console.log(`[Discover] Fetched: ${volumeList.length} by volume, ${newList.length} by new, ${categoricalChildren.length} categorical children`);
  console.log(`[Discover] Found ${bonusIdsFromList.length} bonus markets in list data`);

  // Merge all sources, dedup by marketId
  const baseList = [...(categoricalChildren || []), ...(opinionList || []), ...(multiOutcomeList || [])];

  const byId = new Map();
  for (const m of baseList) {
    const id = m?.marketId;
    if (id === null || id === undefined) continue;
    const k = String(id);
    if (!byId.has(k)) byId.set(k, m);
  }

  const merged = Array.from(byId.values());

  // Filter out ROOT/PARENT markets (marketType=1)
  const withoutRootMarkets = merged.filter((m) => {
    const mType = m?.marketType ?? m?.market_type;
    if (mType === 1 || mType === "1") return false;
    return true;
  });

  const rootMarketsFiltered = merged.length - withoutRootMarkets.length;
  if (rootMarketsFiltered > 0) {
    console.log(`[Discover] Filtered OUT ${rootMarketsFiltered} root/parent markets (marketType=1)`);
  }

  // FAST filter
  const filtered = withoutRootMarkets.filter((m) => !isExpiredFast(m));

  console.log(`[Discover] Total processing took ${Date.now() - startTime}ms`);
  console.log(`[Discover] Showing ${filtered.length}/${merged.length} markets after fast filter`);

  return { error: false, filtered, bonusIdsFromList };
}

/**
 * Quick initial fetch: just page 1 of volume-sorted markets (1 API call, ~200ms)
 * Used for progressive loading when the full cache is cold.
 */
async function _fetchQuickInitial() {
  const startTime = Date.now();
  try {
    const result = await opinionFetch("/market", {
      params: { status: "activated", sortBy: 5, limit: 20, page: 1, marketType: 0 },
    });

    if (result?.errno !== 0) {
      return { error: true, filtered: [], bonusIdsFromList: [] };
    }

    const { list } = normalizeMarketList(result);
    const filtered = list.filter((m) => !isExpiredFast(m));
    const bonusIdsFromList = list.filter((m) => m.hasBonus).map((m) => m.marketId);

    console.log(`[Discover] Quick initial: ${filtered.length} markets in ${Date.now() - startTime}ms`);
    return { error: false, filtered, bonusIdsFromList };
  } catch (err) {
    console.error(`[Discover] Quick initial failed:`, err.message);
    return { error: true, filtered: [], bonusIdsFromList: [] };
  }
}

/**
 * Server Component that fetches data
 * Used inside Suspense boundary
 *
 * Progressive loading strategy:
 * - Cache warm  → return full dataset immediately (fast path)
 * - Cache cold  → return quick initial (page 1, ~200ms), tell client to fetch full
 *                  Also kick off the full fetch to warm the cache for subsequent requests
 */
async function MarketsContent() {
  const now = Date.now();
  const cacheIsWarm =
    _marketsCache.data && !_marketsCache.data.error && (now - _marketsCache.fetchedAt) < _marketsCache.TTL;

  if (cacheIsWarm) {
    // Fast path: full data available
    const { error, filtered, bonusIdsFromList } = _marketsCache.data;
    console.log(`[Discover] SSR fast path – cache warm (${filtered?.length} markets)`);

    if (error) {
      return (
        <div className="panel" style={{ padding: 14 }}>
          <p className="muted" style={{ marginTop: 8 }}>
            Failed to load markets. Please try again later.
          </p>
        </div>
      );
    }

    return (
      <MarketListClient
        markets={filtered}
        initialBonusIds={bonusIdsFromList}
        needsFullFetch={false}
      />
    );
  }

  // Cold path: quick initial + background full fetch
  console.log(`[Discover] SSR cold path – sending quick initial, full fetch in background`);

  // Kick off full fetch in background (warms cache for next request + API route)
  // Don't await – we want SSR to return quickly
  fetchMarkets().catch(() => {});

  const { error, filtered, bonusIdsFromList } = await _fetchQuickInitial();

  if (error) {
    // Quick fetch failed too – fall back to waiting for full fetch
    console.warn(`[Discover] Quick initial failed, falling back to full fetch`);
    const full = await fetchMarkets();
    return (
      <MarketListClient
        markets={full.filtered || []}
        initialBonusIds={full.bonusIdsFromList || []}
        needsFullFetch={false}
      />
    );
  }

  return (
    <MarketListClient
      markets={filtered}
      initialBonusIds={bonusIdsFromList}
      needsFullFetch={true}
    />
  );
}

export { MarketsContent };
