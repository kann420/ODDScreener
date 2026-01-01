import { opinionFetch, normalizeMarketList } from "@/lib/opinion";
import MarketListClient from "@/components/MarketListClient";

export const dynamic = "force-dynamic";

export default async function Home() {
  const r = await opinionFetch("/market", {
    params: { status: "activated", sortBy: 5, limit: 100 },
  });

  if (r?.errno !== 0) {
    return (
      <div className="panel" style={{ padding: 14 }}>
        <div style={{ fontWeight: 900, fontSize: 14 }}>Discover</div>
        <p className="muted" style={{ marginTop: 8 }}>
          Failed to load markets. Please try again later.
        </p>
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
        </div>
      </div>

      <MarketListClient markets={list} />

    </div>
  );
}
