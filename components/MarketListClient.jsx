"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MarketRowV2 from "@/components/MarketRowV2";

const ITEMS_PER_PAGE = 10;
const TRENDING_COUNT = 20;

// ===== helpers =====
function TrendingArrowIcon({ size = 30 }) {
  const gradId = "trendArrowGradient";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#e60073" />
          <stop offset="100%" stopColor="#ff7a00" />
        </linearGradient>
      </defs>
      <path
        d="M4 18.5 11 10l4.5 4.5L21 7v6h2V4h-9v2h5.5l-6 7-4.5-4.5L2 17l2 1.5Z"
        fill={`url(#${gradId})`}
      />
    </svg>
  );
}

function parseCompactNumber(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;

  const s = String(v).trim();
  if (!s) return 0;

  const cleaned = s.replace(/\$/g, "").replace(/,/g, "").trim();
  const m = cleaned.match(/^(-?\d+(?:\.\d+)?)([KMB])?$/i);
  if (!m) {
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }

  const num = Number(m[1]);
  if (!Number.isFinite(num)) return 0;

  const suf = (m[2] || "").toUpperCase();
  const mult = suf === "K" ? 1e3 : suf === "M" ? 1e6 : suf === "B" ? 1e9 : 1;
  return num * mult;
}

function getVolumeValue(m, mode) {
  if (!m) return 0;
  if (mode === "24h") {
    return parseCompactNumber(m?.volume24h ?? m?.vol24h ?? m?.volume_24h ?? 0);
  }
  // ALL
  return parseCompactNumber(m?.volume ?? m?.volTotal ?? m?.volume_total ?? m?.volumeAll ?? 0);
}

/**
 * Extract expiration date from market title
 * Returns Unix timestamp in SECONDS if found, 0 otherwise
 */
function extractExpiresFromTitle(title) {
  if (!title) return 0;
  
  const str = String(title).trim();
  
  const months = {
    'january': 0, 'jan': 0,
    'february': 1, 'feb': 1,
    'march': 2, 'mar': 2,
    'april': 3, 'apr': 3,
    'may': 4,
    'june': 5, 'jun': 5,
    'july': 6, 'jul': 6,
    'august': 7, 'aug': 7,
    'september': 8, 'sep': 8, 'sept': 8,
    'october': 9, 'oct': 9,
    'november': 10, 'nov': 10,
    'december': 11, 'dec': 11,
  };
  
  // Pattern 1: "Month Day, Year" or "Month Day Year" or "Month Day"
  const pattern1 = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?\b/i;
  const match1 = str.match(pattern1);
  if (match1) {
    const month = months[match1[1].toLowerCase()];
    const day = parseInt(match1[2], 10);
    let year = match1[3] ? parseInt(match1[3], 10) : new Date().getFullYear();
    
    const now = new Date();
    const testDate = new Date(year, month, day);
    if (testDate < now && !match1[3]) {
      year = now.getFullYear() + 1;
    }
    
    if (month !== undefined && day >= 1 && day <= 31 && year >= 2020 && year <= 2030) {
      return Math.floor(new Date(year, month, day, 23, 59, 59).getTime() / 1000);
    }
  }
  
  // Pattern 2: "in Month Year?" or "in Month?"
  const pattern2 = /\bin\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?:\s+(\d{4}))?\b/i;
  const match2 = str.match(pattern2);
  if (match2) {
    const month = months[match2[1].toLowerCase()];
    let year = match2[2] ? parseInt(match2[2], 10) : new Date().getFullYear();
    
    const now = new Date();
    if (month < now.getMonth() && !match2[2]) {
      year = now.getFullYear() + 1;
    }
    
    if (month !== undefined && year >= 2020 && year <= 2030) {
      const lastDay = new Date(year, month + 1, 0).getDate();
      return Math.floor(new Date(year, month, lastDay, 23, 59, 59).getTime() / 1000);
    }
  }
  
  // Pattern 3: "by Month Day, Year"
  const pattern3 = /\bby\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?\b/i;
  const match3 = str.match(pattern3);
  if (match3) {
    const month = months[match3[1].toLowerCase()];
    const day = parseInt(match3[2], 10);
    let year = match3[3] ? parseInt(match3[3], 10) : new Date().getFullYear();
    
    const now = new Date();
    const testDate = new Date(year, month, day);
    if (testDate < now && !match3[3]) {
      year = now.getFullYear() + 1;
    }
    
    if (month !== undefined && day >= 1 && day <= 31 && year >= 2020 && year <= 2030) {
      return Math.floor(new Date(year, month, day, 23, 59, 59).getTime() / 1000);
    }
  }
  
  // Pattern 4: "on Month Day"
  const pattern4 = /\bon\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i;
  const match4 = str.match(pattern4);
  if (match4) {
    const month = months[match4[1].toLowerCase()];
    const day = parseInt(match4[2], 10);
    let year = new Date().getFullYear();
    
    const now = new Date();
    const testDate = new Date(year, month, day);
    if (testDate < now) {
      year = now.getFullYear() + 1;
    }
    
    if (month !== undefined && day >= 1 && day <= 31) {
      return Math.floor(new Date(year, month, day, 23, 59, 59).getTime() / 1000);
    }
  }
  
  return 0;
}

/**
 * Get expires timestamp for a market, trying cutoffAt first, then title extraction
 */
function getExpiresTimestamp(m) {
  if (!m) return 0;
  if (m.cutoffAt && m.cutoffAt > 0) return m.cutoffAt;
  if (m.resolvedAt && m.resolvedAt > 0) return m.resolvedAt;
  return extractExpiresFromTitle(m.title);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeReadJson(res) {
  try {
    return await res.json();
  } catch {
    const txt = await res.text();
    try {
      return JSON.parse(txt);
    } catch {
      return null;
    }
  }
}

// simple concurrency runner
async function runWithConcurrency(items, worker, concurrency = 2) {
  const queue = [...items];
  const runners = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export default function MarketListClient({ markets }) {
  // Tab state: "trending" (default) or "all"
  const [activeTab, setActiveTab] = useState("trending");
  
  // Volume mode for ALL tab only
  const [volMode, setVolMode] = useState("24h"); // "24h" | "all"
  
  const [currentPage, setCurrentPage] = useState(1);
  const [visible, setVisible] = useState(6);

  // Default sort: volume desc (so user sees top right away)
  const [sortConfig, setSortConfig] = useState({ key: "volume", direction: "desc" });

  const [chanceMap, setChanceMap] = useState({});
  const [volumeMap, setVolumeMap] = useState({}); // { [marketId]: { volume, volume24h } }
  const [search, setSearch] = useState("");

  // Track if ALL tab has been loaded
  const [allTabLoaded, setAllTabLoaded] = useState(false);

  // guard keys to avoid repeated prefetch loops
  const initTrendingDoneRef = useRef(false);
  const prefetchVolumeKeyRef = useRef("");

  // ===== handlers =====
  const handleChanceLoaded = (marketId, chance) => {
    setChanceMap((prev) => (prev[marketId] === chance ? prev : { ...prev, [marketId]: chance }));
  };

  const handleVolumeLoaded = (marketId, vol) => {
    if (!marketId || !vol) return;
    setVolumeMap((prev) => {
      const next = {
        volume: parseCompactNumber(vol.volume),
        volume24h: parseCompactNumber(vol.volume24h),
      };
      const cur = prev[marketId];
      if (cur && cur.volume === next.volume && cur.volume24h === next.volume24h) return prev;
      return { ...prev, [marketId]: next };
    });
  };

  // ===== Compute Trending markets (top 20 by 24h volume) =====
  const trendingMarkets = useMemo(() => {
    const arr = [...(markets || [])];
    
    // Sort by 24h volume descending
    arr.sort((a, b) => {
      const aOv = volumeMap[String(a.marketId)];
      const bOv = volumeMap[String(b.marketId)];
      const aVal = (aOv?.volume24h ?? 0) || getVolumeValue(a, "24h");
      const bVal = (bOv?.volume24h ?? 0) || getVolumeValue(b, "24h");
      return bVal - aVal;
    });
    
    return arr.slice(0, TRENDING_COUNT);
  }, [markets, volumeMap]);

  // ===== Get current tab's base markets =====
  const currentTabMarkets = useMemo(() => {
    if (activeTab === "trending") {
      return trendingMarkets;
    }
    return markets || [];
  }, [activeTab, trendingMarkets, markets]);

  // ===== search filter (only within current tab) =====
  const filteredMarkets = useMemo(() => {
    const arr = currentTabMarkets;
    const s = search.trim().toLowerCase();
    if (!s) return arr;
    return arr.filter((m) => {
      const title = String(m?.title ?? "").toLowerCase();
      const id = String(m?.marketId ?? "");
      return title.includes(s) || id.includes(s);
    });
  }, [currentTabMarkets, search]);

  // ===== Prefetch volume for Trending tab (only top 30 to get accurate ranking) =====
  useEffect(() => {
    if (initTrendingDoneRef.current) return;
    if (!markets || markets.length === 0) return;

    initTrendingDoneRef.current = true;

    // Prefetch top 30 to ensure we have accurate trending data
    const sortedByVol = [...markets].sort((a, b) => {
      return getVolumeValue(b, "24h") - getVolumeValue(a, "24h");
    });

    const ids = sortedByVol
      .map((m) => String(m.marketId))
      .filter(Boolean)
      .slice(0, 30);

    const run = async () => {
      await runWithConcurrency(
        ids,
        async (id) => {
          try {
            const ov = volumeMap[id];
            if (ov && ov.volume24h > 0) return;

            const res = await fetch(`/api/opinion/market/${encodeURIComponent(id)}`, { cache: "no-store" });
            if (!res.ok) return;

            const j = await safeReadJson(res);
            if (!j) return;

            const data = j?.result?.data ?? j?.result ?? j?.data ?? j ?? {};
            const vAll = Number(data?.volume ?? 0) || 0;
            const v24h = Number(data?.volume24h ?? 0) || 0;

            if (vAll > 0 || v24h > 0) {
              handleVolumeLoaded(id, { volume: vAll, volume24h: v24h });
            }
          } catch {
            // ignore
          } finally {
            await sleep(25);
          }
        },
        3
      );
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markets]);

  // ===== Prefetch volumes when ALL tab is activated (lazy load) =====
  useEffect(() => {
    if (activeTab !== "all") return;
    if (allTabLoaded) return;
    if (!markets || markets.length === 0) return;

    setAllTabLoaded(true);

    // Fetch volumes for markets that don't have volume data yet
    const idsNeed = markets
      .map((m) => String(m.marketId))
      .filter(Boolean)
      .filter((id) => {
        const ov = volumeMap[id];
        return !ov || (ov.volume24h <= 0 && ov.volume <= 0);
      })
      .slice(0, 200);

    if (idsNeed.length === 0) return;

    const run = async () => {
      await runWithConcurrency(
        idsNeed,
        async (id) => {
          try {
            const res = await fetch(`/api/opinion/market/${encodeURIComponent(id)}`, { cache: "no-store" });
            if (!res.ok) return;

            const j = await safeReadJson(res);
            if (!j) return;

            const data = j?.result?.data ?? j?.result ?? j?.data ?? j ?? {};
            const vAll = Number(data?.volume ?? 0) || 0;
            const v24h = Number(data?.volume24h ?? 0) || 0;

            if (vAll > 0 || v24h > 0) {
              handleVolumeLoaded(id, { volume: vAll, volume24h: v24h });
            }
          } catch {
            // ignore
          } finally {
            await sleep(15);
          }
        },
        4
      );
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, markets]);

  // ===== sort =====
  const sortedMarkets = useMemo(() => {
    const arr = [...(filteredMarkets || [])];
    
    // Default: if no sort key set, Trending tab uses 24h volume, ALL tab returns unsorted
    let effectiveSortKey = sortConfig.key;
    let effectiveSortDir = sortConfig.direction;
    
    if (activeTab === "trending" && !sortConfig.key) {
      effectiveSortKey = "volume";
      effectiveSortDir = "desc";
    }

    if (!effectiveSortKey) return arr;

    arr.sort((a, b) => {
      let aVal = 0;
      let bVal = 0;

      if (effectiveSortKey === "chance") {
        aVal = chanceMap[a.marketId] ?? 0;
        bVal = chanceMap[b.marketId] ?? 0;
      } else if (effectiveSortKey === "volume") {
        const aOv = volumeMap[String(a.marketId)];
        const bOv = volumeMap[String(b.marketId)];

        if (volMode === "24h") {
          aVal = (aOv?.volume24h ?? 0) || getVolumeValue(a, "24h");
          bVal = (bOv?.volume24h ?? 0) || getVolumeValue(b, "24h");
        } else {
          aVal = (aOv?.volume ?? 0) || getVolumeValue(a, "all");
          bVal = (bOv?.volume ?? 0) || getVolumeValue(b, "all");
        }
      } else if (effectiveSortKey === "expires") {
        // Use getExpiresTimestamp which tries cutoffAt, then resolvedAt, then title extraction
        // Timestamps are in SECONDS, multiply by 1000 for ms comparison
        const aTsSeconds = getExpiresTimestamp(a);
        const bTsSeconds = getExpiresTimestamp(b);
        aVal = aTsSeconds > 0 ? aTsSeconds * 1000 : Infinity;
        bVal = bTsSeconds > 0 ? bTsSeconds * 1000 : Infinity;
      }

      return effectiveSortDir === "asc" ? aVal - bVal : bVal - aVal;
    });

    return arr;
  }, [activeTab, filteredMarkets, sortConfig, volMode, chanceMap, volumeMap]);

  // ===== pagination =====
  const totalPages = Math.ceil((sortedMarkets.length || 0) / ITEMS_PER_PAGE);

  const pageList = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return sortedMarkets.slice(start, start + ITEMS_PER_PAGE);
  }, [sortedMarkets, currentPage]);

  // staged show
  useEffect(() => {
    const total = pageList.length;
    setVisible(Math.min(6, total));
    const t = setInterval(() => setVisible((v) => (v >= total ? v : Math.min(total, v + 2))), 320);
    return () => clearInterval(t);
  }, [pageList.length, currentPage]);

  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        if (prev.direction === "desc") return { key, direction: "asc" };
        if (prev.direction === "asc") return { key: null, direction: null };
      }
      return { key, direction: "desc" };
    });
    setCurrentPage(1);
  };

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) return "↕";
    return sortConfig.direction === "desc" ? "↓" : "↑";
  };

  // Handle tab change
  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setCurrentPage(1);
    setSearch("");
  };

  // Current volume mode for display
  const displayVolMode = activeTab === "trending" ? "24h" : volMode;

  return (
    <div className="panel" style={{ padding: 12 }}>
      {/* Top Bar: Tabs + Search + Volume Mode */}
      <div style={{ 
        display: "flex", 
        alignItems: "center", 
        gap: 12, 
        flexWrap: "wrap",
        marginBottom: 10 
      }}>
        {/* Tabs: Trending | ALL */}
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => handleTabChange("trending")}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: "1px solid",
              borderColor: activeTab === "trending" ? "rgba(0, 255, 136, 0.5)" : "rgba(255,255,255,0.12)",
              background: activeTab === "trending" ? "rgba(0, 255, 136, 0.15)" : "transparent",
              color: activeTab === "trending" ? "#00ff88" : "#fff",
              cursor: "pointer",
              fontSize: 16,
              fontWeight: 700,
              lineHeight: 1.2,
              transition: "all 0.2s",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <TrendingArrowIcon size={20} /> TRENDING
            </span>
          </button>

          <button
            onClick={() => handleTabChange("all")}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: "1px solid",
              borderColor: activeTab === "all" ? "rgba(0, 136, 255, 0.5)" : "rgba(255,255,255,0.12)",
              background: activeTab === "all" ? "rgba(0, 136, 255, 0.15)" : "transparent",
              color: activeTab === "all" ? "#0088ff" : "#fff",
              cursor: "pointer",
              fontSize: 15,
              fontWeight: 600,
              lineHeight: 1.2,
              transition: "all 0.2s",
            }}
          >
            ALL
          </button>
        </div>

        {/* Search - flex grow to fill space */}
        <div style={{ flex: 1, minWidth: 200 }}>
          <input
            type="text"
            placeholder={`Search in ${activeTab === "trending" ? "Trending" : "All"} Markets...`}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCurrentPage(1);
            }}
            style={{
              width: "100%",
              padding: "10px 16px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.04)",
              color: "#fff",
              outline: "none",
              fontSize: 14,
              fontWeight: 500,
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Volume mode toggle - only show in ALL tab */}
        {activeTab === "all" && (
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 12, marginRight: 4 }}>Volume:</span>
            <button
              className="btn ghost"
              onClick={() => setVolMode("24h")}
              style={{
                padding: "6px 10px",
                fontSize: 12,
                borderColor: volMode === "24h" ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.10)",
                background: volMode === "24h" ? "rgba(255,255,255,0.10)" : "transparent",
              }}
            >
              24h
            </button>
            <button
              className="btn ghost"
              onClick={() => setVolMode("all")}
              style={{
                padding: "6px 10px",
                fontSize: 12,
                borderColor: volMode === "all" ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.10)",
                background: volMode === "all" ? "rgba(255,255,255,0.10)" : "transparent",
              }}
            >
              ALL
            </button>
          </div>
        )}
      </div>

      {/* Header */}
      <div
        style={{
          position: "sticky",
          top: 64,
          zIndex: 20,
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
          <div className="muted">Chart</div>

          <div
            className="muted"
            onClick={() => handleSort("chance")}
            style={{ 
              cursor: "pointer", 
              userSelect: "none", 
              display: "flex", 
              alignItems: "center", 
              gap: 4 
            }}
          >
            Chance <span style={{ fontSize: 10, opacity: sortConfig.key === "chance" ? 1 : 0.5 }}>{getSortIcon("chance")}</span>
          </div>

          <div
            className="muted"
            onClick={() => handleSort("volume")}
            style={{ 
              cursor: "pointer", 
              userSelect: "none", 
              display: "flex", 
              alignItems: "center", 
              gap: 4 
            }}
          >
            {displayVolMode === "all" ? "Volume (ALL)" : "Volume (24h)"}{" "}
            <span style={{ fontSize: 10, opacity: sortConfig.key === "volume" ? 1 : 0.5 }}>{getSortIcon("volume")}</span>
          </div>

          <div
            className="muted"
            onClick={() => handleSort("expires")}
            style={{ 
              cursor: "pointer", 
              userSelect: "none", 
              display: "flex", 
              alignItems: "center", 
              gap: 4 
            }}
          >
            Expires <span style={{ fontSize: 10, opacity: sortConfig.key === "expires" ? 1 : 0.5 }}>{getSortIcon("expires")}</span>
          </div>
        </div>
      </div>

      {/* List */}
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
        {pageList.length === 0 ? (
          <div className="muted" style={{ textAlign: "center", padding: 20 }}>
            {search ? "No markets found" : "Loading..."}
          </div>
        ) : (
          pageList.slice(0, visible).map((m, idx) => (
            <MarketRowV2
              key={m.marketId}
              market={m}
              volMode={displayVolMode}
              volumeOverride={volumeMap[String(m.marketId)]}
              priority={idx < 6}
              onChanceLoaded={handleChanceLoaded}
              onVolumeLoaded={handleVolumeLoaded}
              onOpen={(mk) => (window.location.href = `/market/${mk.marketId}`)}
            />
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 16 }}>
          <button
            className="btn ghost"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            style={{ opacity: currentPage === 1 ? 0.4 : 1 }}
          >
            ←
          </button>

          <div className="muted" style={{ paddingTop: 8 }}>
            Page {currentPage} / {totalPages}
          </div>

          <button
            className="btn ghost"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            style={{ opacity: currentPage === totalPages ? 0.4 : 1 }}
          >
            →
          </button>
        </div>
      )}

      {/* Tab info */}
      <div className="muted" style={{ textAlign: "center", marginTop: 12, fontSize: 11 }}>
        {activeTab === "trending" 
          ? `Top ${Math.min(TRENDING_COUNT, sortedMarkets.length)} markets by 24h volume`
          : `${sortedMarkets.length} markets total`
        }
      </div>
    </div>
  );
}
