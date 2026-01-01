import { opinionFetch, normalizeMarketList } from "@/lib/opinion";
import MarketListClient from "@/components/MarketListClient";

export const dynamic = "force-dynamic";

export default async function Home() {
  const r = await opinionFetch("/market", {
    params: { status: "activated", sortBy: 5, limit: 100 }, // sortBy=5 (24h volume), fetch more for pagination
  });

  if (r?.errno !== 0) {
    return (
      <div className="panel" style={{ padding: 14 }}>
        <div style={{ fontWeight: 900, fontSize: 14 }}>Discover (Opinion)</div>
        <p className="muted" style={{ marginTop: 8 }}>
          Failed to reach Opinion OpenAPI. Please check{" "}
          <span className="mono">OPINION_API_KEY</span> in your{" "}
          <span className="mono">.env</span>.
        </p>

        <div className="panel" style={{ padding: 12, marginTop: 10 }}>
          <div className="mono" style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>
            {JSON.stringify(r, null, 2)}
          </div>
        </div>
      </div>
    );
  }

  const { total, list } = normalizeMarketList(r);

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="panel" style={{ padding: 14 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontWeight: 900, fontSize: 14 }}>Discover</div>
            <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
              Top {list.length} markets (initially sorted by 24h volume). Total active: {total}
            </div>
          </div>
          <a className="btn" href="/embed/kline?marketId=test&outcomeId=yes&interval=1h&theme=dark">
            Open chart iframe demo
          </a>
        </div>
      </div>

      {/* B3.0: client list with realtime metrics + sorting */}
      <MarketListClient markets={list} />

      <div className="muted" style={{ fontSize: 12, padding: "0 4px" }}>
      </div>
    </div>
  );
}
