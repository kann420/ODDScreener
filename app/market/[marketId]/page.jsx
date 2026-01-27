import OrderbookView from "@/components/OrderbookView";
import { opinionFetch } from "@/lib/opinion";
import { analyticsFetch } from "@/lib/opinionAnalytics";

export const dynamic = "force-dynamic";

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
 * Fetch parent title from Opinion API for categorical/multi-outcome markets
 * This is used as fallback when Analytics API is unavailable
 */
async function fetchParentTitleFromOpinion(parentId) {
  if (!parentId) return null;
  try {
    const detail = await opinionFetch(`/market/categorical/${parentId}`);
    const fullData = detail?.result?.data;
    if (!fullData) return null;
    return fullData.marketTitle || fullData.tittle || fullData.title || null;
  } catch {
    return null;
  }
}

/**
 * Search ALL categorical parents to find the parent of a given child market
 * This is expensive but necessary when parentEventId is not available
 */
async function searchParentForMarket(childMarketId) {
  const PAGE_SIZE = 20;
  const MAX_PAGES = 10; // Limit search to avoid timeout
  
  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      // Fetch categorical parents (include ALL statuses, not just activated)
      const result = await opinionFetch("/market", {
        params: { sortBy: 5, limit: PAGE_SIZE, page, marketType: 1 },
      });
      
      if (result?.errno !== 0) break;
      
      const parents = result?.result?.list || [];
      if (parents.length === 0) break;
      
      // Check each parent for the child market
      for (const parent of parents) {
        try {
          const catDetail = await opinionFetch(`/market/categorical/${parent.marketId}`);
          const children = catDetail?.result?.data?.childMarkets || [];
          const found = children.find((c) => String(c.marketId) === String(childMarketId));
          
          if (found) {
            const parentTitle = catDetail?.result?.data?.marketTitle || 
                               catDetail?.result?.data?.tittle || 
                               catDetail?.result?.data?.title || "";
            return { parentId: parent.marketId, parentTitle };
          }
        } catch {
          // ignore individual parent fetch errors
        }
      }
      
      if (parents.length < PAGE_SIZE) break;
    } catch {
      break;
    }
  }
  
  return null;
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

    // ✅ FIX 2: If still no parent title, try to fetch from Opinion API using parentEventId
    const parentId = m.parentEventId || m.rootMarketId || m.categoricalParentId;
    if (!analyticsWorked && !parentTitleFromUrl && parentId) {
      try {
        const parentTitle = await fetchParentTitleFromOpinion(parentId);
        if (parentTitle) {
          const outcomeName = m.marketTitle || m.tittle || m.title || "";
          // Build full title: "[parentTitle] - [outcomeName]"
          const fullTitle = `${parentTitle} - ${outcomeName}`;
          m.marketTitle = fullTitle;
          m.title = fullTitle;
          m.parentEventTitle = parentTitle;
          m.isMultiOutcome = true;
        }
      } catch {
        // ignore
      }
    }

    // ✅ FIX 3: If STILL no parent title (API doesn't expose parentEventId), 
    // search through categorical parents to find this market's parent
    if (!analyticsWorked && !parentTitleFromUrl && !m.parentEventTitle) {
      try {
        const parentInfo = await searchParentForMarket(marketId);
        if (parentInfo?.parentTitle) {
          const outcomeName = m.marketTitle || m.tittle || m.title || "";
          const fullTitle = `${parentInfo.parentTitle} - ${outcomeName}`;
          m.marketTitle = fullTitle;
          m.title = fullTitle;
          m.parentEventTitle = parentInfo.parentTitle;
          m.parentEventId = parentInfo.parentId;
          m.isMultiOutcome = true;
        }
      } catch {
        // ignore search errors
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

  return (
    <OrderbookView
      marketId={marketId}
      title={title}
      yesTokenId={yesTokenId}
      noTokenId={noTokenId}
      marketData={m}
      hasBonus={hasBonus}
    />
  );
}
