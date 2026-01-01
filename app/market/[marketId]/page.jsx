import OrderbookView from "@/components/OrderbookView";
import { opinionFetch } from "@/lib/opinion";

export const dynamic = "force-dynamic";

function pickMarketFromApi(payload) {
  return payload?.result?.data ?? payload?.result ?? payload?.data ?? payload ?? {};
}

export default async function MarketPage({ params }) {
  const marketId = params?.marketId;

  // Use opinionFetch directly instead of fetching internal API route
  // This avoids localhost issues in production
  const r = await opinionFetch(`/market/${marketId}`);
  
  const ok =
    (typeof r?.errno === "number" && r.errno === 0) ||
    (typeof r?.code === "number" && r.code === 0);

  const j = ok 
    ? { errno: 0, errormsg: "", result: { data: r?.result?.data ?? r?.result ?? r } }
    : { errno: -1, errormsg: "market_detail_failed", debug: r };

  if (j?.errno !== 0) {
    return (
      <div className="panel" style={{ padding: 14 }}>
        <div style={{ fontWeight: 900, fontSize: 14 }}>Market #{marketId}</div>
        <p className="muted" style={{ marginTop: 8 }}>
          Failed to load market detail from Opinion. (Endpoint:{" "}
          <span className="mono">/market/{marketId}</span>)
        </p>
        <div className="panel" style={{ padding: 12, marginTop: 10 }}>
          <div className="mono" style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>
            {JSON.stringify(j, null, 2)}
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <a className="btn" href="/">
            ← Back
          </a>
        </div>
      </div>
    );
  }

  const m = pickMarketFromApi(j);
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
