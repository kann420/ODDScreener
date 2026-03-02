/* =============================================
   GP2: Instant skeleton while server fetches data
   Next.js automatically shows this during navigation
   to /market/[marketId] while page.jsx is loading.
============================================= */

export default function MarketDetailLoading() {
  return (
    <div className="col" style={{ gap: 12, paddingBottom: 120 }}>
      {/* ── Header skeleton ── */}
      <div className="detail-header-grid">
        <div
          className="panel detail-header-panel-left"
          style={{ padding: "4px 12px", display: "flex", alignItems: "center" }}
        >
          <div className="detail-header" style={{ width: "100%" }}>
            <div className="detail-header-left">
              {/* Thumbnail placeholder */}
              <div
                className="skeleton"
                style={{
                  width: 78,
                  height: 78,
                  borderRadius: 8,
                  flexShrink: 0,
                }}
              />

              <div
                className="detail-info"
                style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 }}
              >
                {/* Market ID line */}
                <div className="skeleton" style={{ width: 90, height: 12, borderRadius: 6 }} />
                {/* Title line 1 */}
                <div className="skeleton" style={{ width: "80%", height: 16, borderRadius: 6 }} />
                {/* Title line 2 (shorter) */}
                <div className="skeleton" style={{ width: "50%", height: 16, borderRadius: 6 }} />
                {/* Buttons row */}
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <div className="skeleton" style={{ width: 120, height: 28, borderRadius: 8 }} />
                </div>
              </div>
            </div>

            {/* Desktop inline stats */}
            <div className="detail-stats-inline">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="detail-stat-item">
                  <div className="skeleton" style={{ width: 48, height: 10, borderRadius: 4, marginBottom: 4 }} />
                  <div className="skeleton" style={{ width: 64, height: 14, borderRadius: 4 }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Main grid: chart + orderbook + trades ── */}
      <div className="detail-grid">
        {/* Chart placeholder */}
        <div className="chart-wrapper">
          <div className="panel" style={{ padding: 12 }}>
            {/* Range buttons row */}
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="skeleton" style={{ width: 36, height: 26, borderRadius: 8 }} />
              ))}
            </div>
            {/* Chart area */}
            <div className="skeleton" style={{ width: "100%", height: 260, borderRadius: 10 }} />
            {/* Price + change row */}
            <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
              <div className="skeleton" style={{ width: 80, height: 18, borderRadius: 6 }} />
              <div className="skeleton" style={{ width: 60, height: 18, borderRadius: 6 }} />
            </div>
          </div>
        </div>

        {/* Orderbook placeholder */}
        <div className="panel orderbook-panel" style={{ padding: 12 }}>
          {/* Header row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div className="skeleton" style={{ width: 80, height: 16, borderRadius: 6 }} />
            <div style={{ display: "flex", gap: 4 }}>
              <div className="skeleton" style={{ width: 50, height: 28, borderRadius: 8 }} />
              <div className="skeleton" style={{ width: 50, height: 28, borderRadius: 8 }} />
            </div>
          </div>
          {/* Column header */}
          <div style={{ display: "grid", gridTemplateColumns: "74px 1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div className="skeleton" style={{ width: 40, height: 11, borderRadius: 4 }} />
            <div className="skeleton" style={{ width: 50, height: 11, borderRadius: 4, justifySelf: "center" }} />
            <div className="skeleton" style={{ width: 40, height: 11, borderRadius: 4, justifySelf: "end" }} />
          </div>
          {/* Ask rows */}
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={`a${i}`} style={{ marginBottom: 6 }}>
              <div className="skeleton" style={{ height: 44, borderRadius: 10 }} />
            </div>
          ))}
          {/* Spread */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0" }}>
            <div className="skeleton" style={{ width: 50, height: 12, borderRadius: 4 }} />
            <div className="skeleton" style={{ width: 30, height: 12, borderRadius: 4 }} />
          </div>
          {/* Bid rows */}
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={`b${i}`} style={{ marginBottom: 6 }}>
              <div className="skeleton" style={{ height: 44, borderRadius: 10 }} />
            </div>
          ))}
        </div>

        {/* Trades panel placeholder — spans full width */}
        <div className="panel trades-panel" style={{ padding: 0 }}>
          {/* Tab row */}
          <div className="tabs">
            <div className="tab active">Rules</div>
            <div className="tab">Trades</div>
            <div className="tab">Top Traders</div>
            <div className="tab">Holders</div>
          </div>
          {/* Content skeleton */}
          <div style={{ padding: "16px" }}>
            <div className="skeleton" style={{ width: "90%", height: 13, borderRadius: 5, marginBottom: 10 }} />
            <div className="skeleton" style={{ width: "75%", height: 13, borderRadius: 5, marginBottom: 10 }} />
            <div className="skeleton" style={{ width: "60%", height: 13, borderRadius: 5, marginBottom: 10 }} />
            <div className="skeleton" style={{ width: "80%", height: 13, borderRadius: 5 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
