"use client";

import { useEffect, useMemo, useState } from "react";
import MarketRowV2 from "@/components/MarketRowV2";

const ITEMS_PER_PAGE = 10;

function SkeletonRow() {
  return (
    <div
      className="panel"
      style={{ padding: "12px 12px" }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(320px, 1.6fr) 140px 110px 140px 130px",
          gap: 12,
          alignItems: "center",
        }}
      >
        {/* Market title skeleton */}
        <div style={{ minWidth: 0 }}>
          <div 
            className="skeleton skeleton-text lg" 
            style={{ width: "80%", marginBottom: 8 }} 
          />
          <div 
            className="skeleton skeleton-text sm" 
            style={{ width: "50%" }} 
          />
        </div>

        {/* Chart skeleton */}
        <div>
          <div className="skeleton skeleton-chart" style={{ width: 120 }} />
        </div>

        {/* Chance skeleton */}
        <div>
          <div className="skeleton skeleton-text" style={{ width: 50 }} />
        </div>

        {/* Volume skeleton */}
        <div>
          <div className="skeleton skeleton-text" style={{ width: 70 }} />
        </div>

        {/* Expires skeleton */}
        <div>
          <div className="skeleton skeleton-text" style={{ width: 40 }} />
        </div>
      </div>
    </div>
  );
}

function getChanceValue(m) {
  const price = m?.yesPrice ?? m?.yes_price ?? m?.price ?? m?.lastPrice ?? m?.chance ?? 0;
  return Number(price) || 0;
}

function getVolumeValue(m, mode) {
  if (mode === "1h") {
    return Number(m?.volume1h ?? m?.vol1h ?? m?.volume_1h ?? m?.volume24h ?? m?.vol24h ?? 0) || 0;
  }
  if (mode === "6h") {
    return Number(m?.volume6h ?? m?.vol6h ?? m?.volume_6h ?? m?.volume24h ?? m?.vol24h ?? 0) || 0;
  }
  if (mode === "12h") {
    return Number(m?.volume12h ?? m?.vol12h ?? m?.volume_12h ?? m?.volume24h ?? m?.vol24h ?? 0) || 0;
  }
  if (mode === "24h") {
    return Number(m?.volume24h ?? m?.vol24h ?? m?.volume_24h ?? 0) || 0;
  }
  return Number(m?.volume ?? m?.volTotal ?? m?.volume_total ?? m?.volumeAll ?? 0) || 0;
}

export default function MarketListClient({ markets }) {
  const [volMode, setVolMode] = useState("24h"); // "1h" | "6h" | "12h" | "24h" | "all"
  const [visible, setVisible] = useState(6);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: null }); // { key: 'chance' | 'volume', direction: 'asc' | 'desc' }
  const [chanceMap, setChanceMap] = useState({}); // { marketId: chanceValue }

  const handleChanceLoaded = (marketId, chance) => {
    setChanceMap((prev) => {
      if (prev[marketId] === chance) return prev;
      return { ...prev, [marketId]: chance };
    });
  };

  const sortedMarkets = useMemo(() => {
    const allMarkets = markets || [];
    if (!sortConfig.key) return allMarkets;

    return [...allMarkets].sort((a, b) => {
      let aVal, bVal;
      if (sortConfig.key === "chance") {
        aVal = chanceMap[a.marketId] ?? 0;
        bVal = chanceMap[b.marketId] ?? 0;
      } else if (sortConfig.key === "volume") {
        aVal = getVolumeValue(a, volMode);
        bVal = getVolumeValue(b, volMode);
      }
      
      if (sortConfig.direction === "asc") {
        return aVal - bVal;
      }
      return bVal - aVal;
    });
  }, [markets, sortConfig, volMode, chanceMap]);

  const totalPages = Math.ceil((sortedMarkets?.length || 0) / ITEMS_PER_PAGE);

  const list = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    return sortedMarkets.slice(start, end);
  }, [sortedMarkets, currentPage]);

  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        // Cycle: desc -> asc -> none
        if (prev.direction === "desc") return { key, direction: "asc" };
        if (prev.direction === "asc") return { key: null, direction: null };
      }
      return { key, direction: "desc" };
    });
    setCurrentPage(1); // Reset to first page when sorting
  };

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) return "↕";
    return sortConfig.direction === "desc" ? "↓" : "↑";
  };

  useEffect(() => {
    const total = list.length;
    setVisible(Math.min(6, total));

    const t = setInterval(() => {
      setVisible((v) => (v >= total ? v : Math.min(total, v + 2)));
    }, 320);

    return () => clearInterval(t);
  }, [list.length, currentPage]);

  return (
    <div className="panel" style={{ padding: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontWeight: 900 }}>Discover</div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div className="muted" style={{ fontSize: 12 }}>
            Volume
          </div>

          <button
            className="btn ghost"
            disabled
            title="Coming soon - API not available yet"
            style={{
              padding: "8px 10px",
              borderColor: "rgba(255,255,255,0.06)",
              background: "transparent",
              opacity: 0.4,
              cursor: "not-allowed",
            }}
          >
            1h
          </button>

          <button
            className="btn ghost"
            disabled
            title="Coming soon - API not available yet"
            style={{
              padding: "8px 10px",
              borderColor: "rgba(255,255,255,0.06)",
              background: "transparent",
              opacity: 0.4,
              cursor: "not-allowed",
            }}
          >
            6h
          </button>

          <button
            className="btn ghost"
            disabled
            title="Coming soon - API not available yet"
            style={{
              padding: "8px 10px",
              borderColor: "rgba(255,255,255,0.06)",
              background: "transparent",
              opacity: 0.4,
              cursor: "not-allowed",
            }}
          >
            12h
          </button>

          <button
            className="btn ghost"
            onClick={() => setVolMode("24h")}
            style={{
              padding: "8px 10px",
              borderColor: volMode === "24h" ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.10)",
              background: volMode === "24h" ? "rgba(255,255,255,0.08)" : "transparent",
            }}
          >
            24h
          </button>

          <button
            className="btn ghost"
            onClick={() => setVolMode("all")}
            style={{
              padding: "8px 10px",
              borderColor: volMode === "all" ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.10)",
              background: volMode === "all" ? "rgba(255,255,255,0.08)" : "transparent",
            }}
          >
            ALL
          </button>
        </div>
      </div>

      <div
        style={{
          position: "sticky",
          top: 64,
          zIndex: 20,
          marginTop: 10,
          padding: "10px 12px",
          borderRadius: 12,
          background: "rgba(10, 16, 18, 0.65)",
          backdropFilter: "blur(8px)",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(320px, 1.6fr) 140px 110px 140px 130px",
            gap: 12,
            alignItems: "center",
            fontSize: 12,
          }}
        >
          <div className="muted">Market</div>
          <div className="muted" style={{ textAlign: "left" }}>
            Chart
          </div>
          <div 
            className="muted" 
            onClick={() => handleSort("chance")}
            style={{ 
              cursor: "pointer", 
              userSelect: "none",
              display: "flex",
              alignItems: "center",
              gap: 4,
              transition: "color 0.15s ease",
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = "#e9eef5"}
            onMouseLeave={(e) => e.currentTarget.style.color = ""}
          >
            Chance
            <span style={{ 
              fontSize: 10, 
              opacity: sortConfig.key === "chance" ? 1 : 0.5,
              color: sortConfig.key === "chance" ? "#22c55e" : "inherit"
            }}>
              {getSortIcon("chance")}
            </span>
          </div>
          <div 
            className="muted"
            onClick={() => handleSort("volume")}
            style={{ 
              cursor: "pointer", 
              userSelect: "none",
              display: "flex",
              alignItems: "center",
              gap: 4,
              transition: "color 0.15s ease",
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = "#e9eef5"}
            onMouseLeave={(e) => e.currentTarget.style.color = ""}
          >
            {volMode === "all" ? "Volume (ALL)" : `Volume (${volMode})`}
            <span style={{ 
              fontSize: 10, 
              opacity: sortConfig.key === "volume" ? 1 : 0.5,
              color: sortConfig.key === "volume" ? "#22c55e" : "inherit"
            }}>
              {getSortIcon("volume")}
            </span>
          </div>
          <div className="muted">Expires</div>
        </div>
      </div>

      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
        {(!markets || markets.length === 0) && (
          <>
            {Array.from({ length: 6 }).map((_, idx) => (
              <SkeletonRow key={`skeleton-${idx}`} />
            ))}
          </>
        )}

        {markets && markets.length > 0 && list.slice(0, visible).map((m, idx) => (
          <MarketRowV2
            key={m.marketId}
            market={m}
            volMode={volMode}
            priority={idx < 4}
            onChanceLoaded={handleChanceLoaded}
            onOpen={(mk) => {
              window.location.href = `/market/${mk.marketId}`;
            }}
          />
        ))}
      </div>

      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 8,
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <button
            className="btn ghost"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            style={{
              padding: "8px 12px",
              opacity: currentPage === 1 ? 0.4 : 1,
              cursor: currentPage === 1 ? "not-allowed" : "pointer",
            }}
          >
            ←
          </button>

          {(() => {
            const pages = [];
            const maxVisible = 5;
            let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
            let end = Math.min(totalPages, start + maxVisible - 1);
            
            if (end - start + 1 < maxVisible) {
              start = Math.max(1, end - maxVisible + 1);
            }

            if (start > 1) {
              pages.push(
                <button
                  key={1}
                  className="btn ghost"
                  onClick={() => setCurrentPage(1)}
                  style={{
                    padding: "8px 12px",
                    minWidth: 40,
                  }}
                >
                  1
                </button>
              );
              if (start > 2) {
                pages.push(
                  <span key="dots-start" className="muted" style={{ padding: "0 4px" }}>
                    ...
                  </span>
                );
              }
            }

            for (let i = start; i <= end; i++) {
              pages.push(
                <button
                  key={i}
                  className="btn ghost"
                  onClick={() => setCurrentPage(i)}
                  style={{
                    padding: "8px 12px",
                    minWidth: 40,
                    background: currentPage === i ? "rgba(34, 197, 94, 0.2)" : "transparent",
                    borderColor: currentPage === i ? "rgba(34, 197, 94, 0.5)" : "rgba(255,255,255,0.10)",
                    color: currentPage === i ? "#22c55e" : "inherit",
                    fontWeight: currentPage === i ? 700 : 400,
                  }}
                >
                  {i}
                </button>
              );
            }

            if (end < totalPages) {
              if (end < totalPages - 1) {
                pages.push(
                  <span key="dots-end" className="muted" style={{ padding: "0 4px" }}>
                    ...
                  </span>
                );
              }
              pages.push(
                <button
                  key={totalPages}
                  className="btn ghost"
                  onClick={() => setCurrentPage(totalPages)}
                  style={{
                    padding: "8px 12px",
                    minWidth: 40,
                  }}
                >
                  {totalPages}
                </button>
              );
            }

            return pages;
          })()}

          <button
            className="btn ghost"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            style={{
              padding: "8px 12px",
              opacity: currentPage === totalPages ? 0.4 : 1,
              cursor: currentPage === totalPages ? "not-allowed" : "pointer",
            }}
          >
            →
          </button>

          <span className="muted" style={{ fontSize: 12, marginLeft: 12 }}>
            Page {currentPage} of {totalPages}
          </span>
        </div>
      )}
    </div>
  );
}
