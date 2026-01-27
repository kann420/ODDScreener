import { opinionFetch, opinionFetchAllMarkets, opinionFetchCategoricalChildren, normalizeMarketList } from "@/lib/opinion";
import { getMultiOutcomeMarkets } from "@/lib/opinionAnalytics";
import MarketListClient from "@/components/MarketListClient";
import DiscoverNewsBar from "@/components/DiscoverNewsBar";

export const dynamic = "force-dynamic";
export const revalidate = 30; // Cache for 30 seconds

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
  const cutoffAtRaw = market?.cutoffAt ?? market?.cutoff_at;
  if (cutoffAtRaw !== null && cutoffAtRaw !== undefined) {
    const cutoffAtMs = toMs(cutoffAtRaw);
    if (cutoffAtMs && cutoffAtMs > 0 && cutoffAtMs < now) {
      return true;
    }
  }

  // 5) Extract date from title - for markets without proper timestamps
  const title = market?.marketTitle ?? market?.tittle ?? market?.title ?? "";
  const titleDateMs = extractDateFromTitle(title);
  if (titleDateMs && titleDateMs < now) {
    return true;
  }

  // 6) If status is a meaningful number, only keep ACTIVATED (2)
  if (Number.isFinite(statusNum) && statusNum > 0 && statusNum !== TOPIC_STATUS.ACTIVATED) {
    return true;
  }

  return false;
}

export default async function Home() {
  const startTime = Date.now();

  // Fetch multiple APIs in parallel:
  // 1) Binary markets by volume (sortBy=5)
  // 2) Binary markets by newest (sortBy=1)
  // 3) Categorical children markets (via Opinion API /market/categorical/{id})
  // 4) Multi-outcome markets from Analytics API (fallback, may be unavailable)
  //
  // NOTE: marketType=0 for binary markets, marketType=1 for categorical parents
  // Categorical children are fetched by getting parents first, then their children
  const [opinionByVolume, opinionByNew, categoricalResult, analyticsResult] = await Promise.all([
    opinionFetchAllMarkets({
      status: "activated",
      sortBy: 5,
      marketType: 0,
      maxPages: 10, // Up to 200 binary markets by volume
    }),
    opinionFetchAllMarkets({
      status: "activated",
      sortBy: 1,
      marketType: 0,
      maxPages: 5, // Up to 100 newest binary markets
    }),
    // Fetch ALL categorical children from Opinion API directly
    // Using high maxParents to get all ~140 parents and their ~600+ children
    opinionFetchCategoricalChildren({
      maxParents: 200,        // Fetch all available parents (currently ~140)
      maxChildrenPerParent: 50, // Up to 50 children each (most have ~5-10)
    }),
    // Also try Analytics API as fallback (may be unavailable)
    getMultiOutcomeMarkets(),
  ]);

  console.log(`[Discover] API fetch took ${Date.now() - startTime}ms`);

  // Check if at least one Opinion API call succeeded
  const volumeOk = opinionByVolume?.errno === 0;
  const newOk = opinionByNew?.errno === 0;
  const categoricalOk = categoricalResult?.errno === 0;
  
  // Log API status
  if (!analyticsResult.success) {
    console.warn(`[Discover] Analytics API unavailable - using Opinion API for categorical markets`);
  }
  if (categoricalOk) {
    console.log(`[Discover] Fetched ${categoricalResult.result?.list?.length || 0} categorical children from ${categoricalResult.result?.parentCount || 0} parents`);
  }
  
  if (!volumeOk && !newOk) {
    return (
      <div className="panel" style={{ padding: 14 }}>
        <p className="muted" style={{ marginTop: 8 }}>
          Failed to load markets. Please try again later.
        </p>
      </div>
    );
  }

  // Normalize both market lists
  const { list: volumeList } = volumeOk ? normalizeMarketList(opinionByVolume) : { list: [] };
  const { list: newList } = newOk ? normalizeMarketList(opinionByNew) : { list: [] };
  
  // Categorical children from Opinion API (primary source)
  const categoricalChildrenRaw = categoricalOk ? (categoricalResult.result?.list || []) : [];
  
  // Normalize categorical children to match our format
  const categoricalChildren = categoricalChildrenRaw.map(child => {
    // Build title: parent title + child outcome
    const parentTitle = child.parentEventTitle || "";
    const outcomeName = child.marketTitle || child.tittle || child.title || child.outcome || "";
    let title = outcomeName;
    if (parentTitle && outcomeName) {
      // Format: "Parent Title - Outcome"
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
      // Multi-outcome markers
      isMultiOutcome: true,
      parentEventId: child.parentEventId,
      parentEventTitle: parentTitle,
    };
  });
  
  // Multi-outcome from Analytics API (fallback, may be empty if API is down)
  const multiOutcomeList = analyticsResult.success ? analyticsResult.data : [];

  // ✅ Merge: volumeList + newList + categoricalChildren + multiOutcome, dedup by marketId
  // newList is added AFTER volumeList so newer markets that might have low volume are included
  const opinionList = [...volumeList, ...newList];

  // Detect bonus markets from list data (check hasBonus flag)
  const bonusIdsFromList = opinionList
    .filter((m) => m.hasBonus === true)
    .map((m) => m.marketId);
  
  console.log(`[Discover] Fetched: ${volumeList.length} by volume, ${newList.length} by new, ${categoricalChildren.length} categorical children`);
  console.log(`[Discover] Found ${bonusIdsFromList.length} bonus markets in list data`);

  // Merge all sources, dedup by marketId
  // Order: categoricalChildren (with volume) -> opinionList (binary) -> multiOutcome (Analytics fallback)
  // Categorical children have the highest volumes, so they should be prioritized
  const baseList = [...(categoricalChildren || []), ...(opinionList || []), ...(multiOutcomeList || [])];

  const byId = new Map();
  for (const m of baseList) {
    const id = m?.marketId;
    if (id === null || id === undefined) continue;
    const k = String(id);
    if (!byId.has(k)) byId.set(k, m);
  }

  const merged = Array.from(byId.values());

  // ✅ Filter out ROOT/PARENT markets (marketType=1)
  // These are categorical parent markets that don't have trading functionality
  // Only child markets (binary or categorical children) should be shown
  const withoutRootMarkets = merged.filter((m) => {
    const mType = m?.marketType ?? m?.market_type;
    // marketType=1 means categorical PARENT (root market) - filter these out
    if (mType === 1 || mType === "1") return false;
    return true;
  });

  const rootMarketsFiltered = merged.length - withoutRootMarkets.length;
  if (rootMarketsFiltered > 0) {
    console.log(`[Discover] Filtered OUT ${rootMarketsFiltered} root/parent markets (marketType=1)`);
  }

  // FAST filter - no API calls, just use existing data + title extraction
  const filtered = withoutRootMarkets.filter((m) => !isExpiredFast(m));

  // Debug: Log some filtered out markets to understand why they were kept or removed
  const filteredOut = merged.filter((m) => isExpiredFast(m));
  if (filteredOut.length > 0) {
    console.log(`[Discover] Filtered OUT ${filteredOut.length} expired/resolved markets`);
    // Log first 5 filtered out markets for debugging
    filteredOut.slice(0, 5).forEach((m) => {
      console.log(`[Discover] Filtered OUT: id=${m.marketId}, status=${m.status}, statusEnum=${m.statusEnum}, resolvedAt=${m.resolvedAt}, title=${(m.title || "").substring(0, 50)}`);
    });
  }

  // Log first 5 kept markets for comparison
  if (filtered.length > 0) {
    console.log(`[Discover] Sample KEPT markets:`);
    filtered.slice(0, 3).forEach((m) => {
      console.log(`[Discover] KEPT: id=${m.marketId}, status=${m.status}, statusEnum=${m.statusEnum}, resolvedAt=${m.resolvedAt}, cutoffAt=${m.cutoffAt}`);
    });
  }

  console.log(`[Discover] Total processing took ${Date.now() - startTime}ms`);
  console.log(`[Discover] Showing ${filtered.length}/${merged.length} markets after fast filter`);

  return (
    <div className="col" style={{ gap: 12, paddingBottom: 72 }}>
      {/* HEADER PANEL: replace Discover/Showing text with News bar */}
      <DiscoverNewsBar initialMarkets={filtered} />

      {/* Markets */}
      <MarketListClient markets={filtered} initialBonusIds={bonusIdsFromList} />
    </div>
  );
}
