import OrderbookView from "@/components/OrderbookView";
import { opinionFetch } from "@/lib/opinion";
import { analyticsFetch } from "@/lib/opinionAnalytics";

export const dynamic = "force-dynamic";

function pickMarketFromApi(payload) {
  return payload?.result?.data ?? payload?.result ?? payload?.data ?? payload ?? {};
}

async function fetchMarketFromAnalytics(marketId) {
  const response = await analyticsFetch("/api/markets");
  if (!response.success || !Array.isArray(response.data)) {
    return null;
  }
  
  const market = response.data.find(m => String(m.marketId) === String(marketId));
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
    rules: market.rules,
    cutoffAt: market.cutoffAt,
    volume: market.volume,
    isMultiOutcome: !!market.parentEventId,
    parentEventTitle: market.parentEvent?.title,
  };
}

export default async function MarketPage({ params }) {
  const marketId = params?.marketId;

  // Try Opinion API first
  const r = await opinionFetch(`/market/${marketId}`);
  
  const ok =
    (typeof r?.errno === "number" && r.errno === 0) ||
    (typeof r?.code === "number" && r.code === 0);

  let m = null;
  let fromAnalytics = false;

  if (ok) {
    m = pickMarketFromApi({ errno: 0, result: { data: r?.result?.data ?? r?.result ?? r } });
  } else {
    // Fallback to Analytics API for multi-outcome markets
    m = await fetchMarketFromAnalytics(marketId);
    fromAnalytics = !!m;
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

  return (
    <OrderbookView
      marketId={marketId}
      title={title}
      yesTokenId={yesTokenId}
      noTokenId={noTokenId}
      marketData={m}
    />
  );
}
