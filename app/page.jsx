import { opinionFetch, normalizeMarketList } from "@/lib/opinion";
import { getMultiOutcomeMarkets } from "@/lib/opinionAnalytics";
import MarketListClient from "@/components/MarketListClient";

export const dynamic = "force-dynamic";

export default async function Home() {
  // Fetch from both APIs in parallel
  const [opinionResult, analyticsResult] = await Promise.all([
    opinionFetch("/market", {
      params: { status: "activated", sortBy: 5, limit: 100 },
    }),
    getMultiOutcomeMarkets(),
  ]);

  if (opinionResult?.errno !== 0) {
    return (
      <div className="panel" style={{ padding: 14 }}>
        <div style={{ fontWeight: 900, fontSize: 14 }}>Discover</div>
        <p className="muted" style={{ marginTop: 8 }}>
          Failed to load markets. Please try again later.
        </p>
      </div>
    );
  }

  const { total, list: opinionList } = normalizeMarketList(opinionResult);
  
  // Get multi-outcome markets from Analytics API
  const multiOutcomeList = analyticsResult.success ? analyticsResult.data : [];
  
  // Create a Set of existing marketIds to avoid duplicates
  const existingIds = new Set(opinionList.map(m => String(m.marketId)));
  
  // Filter out duplicates from multi-outcome list
  const uniqueMultiOutcome = multiOutcomeList.filter(
    m => !existingIds.has(String(m.marketId))
  );
  
  // Combine both lists - multi-outcome markets first, then regular markets
  const combinedList = [...uniqueMultiOutcome, ...opinionList];

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
              Top {combinedList.length} markets (initially sorted by 24h volume). Total active: {total}
              {uniqueMultiOutcome.length > 0 && (
                <span style={{ color: "var(--cyan)", marginLeft: 8 }}>
                  +{uniqueMultiOutcome.length} multi-outcome
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <MarketListClient markets={combinedList} />

    </div>
  );
}
