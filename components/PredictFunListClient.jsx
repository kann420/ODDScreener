"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Link from "next/link";
import PredictFunMarketRow from "@/components/PredictFunMarketRow";
import { getPredictFunDisplayTitleText } from "@/lib/predictfunDisplay";
import { clientGet, clientSet } from "@/lib/clientCache";

const SCROLL_BATCH = 20;
const TRENDING_COUNT = 10;
const NEW_LIMIT = 100;
const INITIAL_ROW_METRICS_BATCH = 12;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function getVolume24h(m) {
  return num(m?.stats?.volume24hUsd ?? 0);
}

function getVolumeTotal(m) {
  return num(m?.stats?.volumeTotalUsd ?? 0);
}

function getBoostDistanceMs(market, now = Date.now()) {
  const startMs = toMs(market?.boostStartsAt);
  if (!startMs) return Number.POSITIVE_INFINITY;
  return Math.abs(startMs - now);
}

function toMs(v) {
  if (!v) return 0;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  const n = Number(v);
  return n < 1e12 ? n * 1000 : n;
}

export default function PredictFunListClient({ initialMarkets, needsFullFetch = false }) {
  const [fullMarkets, setFullMarkets] = useState(null);
  const [isLoadingFull, setIsLoadingFull] = useState(needsFullFetch);
  const markets = fullMarkets ?? (initialMarkets || []);

  const [activeTab, setActiveTab] = useState("boost");
  const [volMode, setVolMode] = useState("24h");
  const [visibleCount, setVisibleCount] = useState(SCROLL_BATCH);
  const [sortConfig, setSortConfig] = useState({ key: "volume", direction: "desc" });
  const sentinelRef = useRef(null);
  const [chanceMap, setChanceMap] = useState({});
  const [liquidityMap, setLiquidityMap] = useState({});
  const [search, setSearch] = useState("");
  const [rowMetricsMap, setRowMetricsMap] = useState({});
  const requestedMetricIdsRef = useRef(new Set());

  // Progressive loading: poll for full dataset when SSR sent partial
  useEffect(() => {
    if (!needsFullFetch) return;

    let cancelled = false;
    let pollTimer = null;
    let attempt = 0;
    const MAX_POLLS = 30;
    const POLL_INTERVAL = 3000;

    const poll = async () => {
      if (cancelled) return;
      attempt++;
      try {
        const res = await fetch("/api/predictfun/discover", { cache: "no-store" });
        if (cancelled || !res.ok) return;
        const json = await res.json();
        if (cancelled) return;

        if (json.status === "ready" && Array.isArray(json.markets) && json.markets.length > 0) {
          setFullMarkets(json.markets);
          setIsLoadingFull(false);
          console.log(`[PF Progressive] Loaded ${json.markets.length} markets (poll #${attempt})`);
          return;
        }

        if (attempt < MAX_POLLS) {
          pollTimer = setTimeout(poll, POLL_INTERVAL);
        } else {
          setIsLoadingFull(false);
        }
      } catch {
        if (!cancelled && attempt < MAX_POLLS) {
          pollTimer = setTimeout(poll, POLL_INTERVAL * 2);
        }
      }
    };

    pollTimer = setTimeout(poll, 2000);
    return () => { cancelled = true; if (pollTimer) clearTimeout(pollTimer); };
  }, [needsFullFetch]);

  // Callbacks
  const handleChanceLoaded = useCallback((marketId, chance) => {
    setChanceMap((prev) => (prev[marketId] === chance ? prev : { ...prev, [marketId]: chance }));
  }, []);

  const handleLiquidityLoaded = useCallback((marketId, liq) => {
    if (!marketId || !Number.isFinite(liq)) return;
    setLiquidityMap((prev) => (prev[marketId] === liq ? prev : { ...prev, [marketId]: liq }));
  }, []);

  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab);
    setVisibleCount(SCROLL_BATCH);
    setSearch("");
    if (tab === "trending" || tab === "all") {
      setSortConfig({ key: "volume", direction: "desc" });
    } else if (tab === "new") {
      setSortConfig({ key: null, direction: null });
    } else if (tab === "boost") {
      setSortConfig({ key: null, direction: null });
    } else {
      setSortConfig({ key: "volume", direction: "desc" });
    }
  }, []);

  const displayVolMode = activeTab === "all" ? volMode : "24h";

  // NEW: newest active markets by createdAt
  const newMarkets = useMemo(() => {
    if (!markets.length) return [];
    return [...markets]
      .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))
      .slice(0, NEW_LIMIT);
  }, [markets]);

  // TRENDING: top 10 by 24h volume
  const trendingMarkets = useMemo(() => {
    if (!markets.length) return [];
    return [...markets]
      .sort((a, b) => getVolume24h(b) - getVolume24h(a))
      .slice(0, TRENDING_COUNT);
  }, [markets]);

  // BOOST: markets with isBoosted or active boost window
  const boostMarkets = useMemo(() => {
    if (!markets.length) return [];
    const now = Date.now();
    return markets
      .filter((m) => {
        if (!m.isBoosted) return false;
        const start = m.boostStartsAt ? Date.parse(m.boostStartsAt) : null;
        const end = m.boostEndsAt ? Date.parse(m.boostEndsAt) : null;
        // Include if: active boost window, OR upcoming (starts within 7 days), OR no window defined
        if (Number.isFinite(start) && Number.isFinite(end)) {
          const sevenDays = 7 * 24 * 60 * 60 * 1000;
          return now < end || (start > now && start - now < sevenDays);
        }
        return true; // isBoosted=true but no window -> include
      })
      .sort((a, b) => {
        const distanceDiff = getBoostDistanceMs(a, now) - getBoostDistanceMs(b, now);
        if (distanceDiff !== 0) return distanceDiff;

        const startDiff = toMs(a?.boostStartsAt) - toMs(b?.boostStartsAt);
        if (startDiff !== 0) return startDiff;

        return getVolume24h(b) - getVolume24h(a);
      });
  }, [markets]);

  // ALL: everything sorted by volume
  const allMarkets = useMemo(() => {
    if (!markets.length) return [];
    return [...markets].sort((a, b) => getVolume24h(b) - getVolume24h(a));
  }, [markets]);

  const currentTabMarkets = useMemo(() => {
    if (activeTab === "new") return newMarkets;
    if (activeTab === "trending") return trendingMarkets;
    if (activeTab === "boost") return boostMarkets;
    return allMarkets;
  }, [activeTab, newMarkets, trendingMarkets, boostMarkets, allMarkets]);

  const filteredMarkets = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return currentTabMarkets;
    return currentTabMarkets.filter((m) => {
      const title = getPredictFunDisplayTitleText(m).toLowerCase();
      const catTitle = String(m?._categoryTitle ?? "").toLowerCase();
      const slug = String(m?.categorySlug ?? "").toLowerCase();
      const id = String(m?.id ?? "");
      return title.includes(s) || catTitle.includes(s) || slug.includes(s) || id.includes(s);
    });
  }, [currentTabMarkets, search]);

  // Sort
  const sortedMarkets = useMemo(() => {
    const arr = [...(filteredMarkets || [])];

    let effectiveSortKey = sortConfig.key;
    let effectiveSortDir = sortConfig.direction;

    if (activeTab === "trending" && !sortConfig.key) {
      effectiveSortKey = "volume";
      effectiveSortDir = "desc";
    }
    if (activeTab === "boost" && !sortConfig.key) {
      return arr; // Keep boost-time priority order from boostMarkets
    }
    if (activeTab === "new" && effectiveSortKey === "volume") {
      return arr; // Keep newest first
    }
    if (!effectiveSortKey) return arr;

    arr.sort((a, b) => {
      let aVal = 0;
      let bVal = 0;

      if (effectiveSortKey === "chance") {
        aVal = chanceMap[a.id] ?? 0;
        bVal = chanceMap[b.id] ?? 0;
      } else if (effectiveSortKey === "volume") {
        if (displayVolMode === "24h") {
          aVal = getVolume24h(a);
          bVal = getVolume24h(b);
        } else {
          aVal = getVolumeTotal(a);
          bVal = getVolumeTotal(b);
        }
      } else if (effectiveSortKey === "liquidity") {
        aVal = liquidityMap[a.id] ?? num(a.stats?.totalLiquidityUsd ?? 0);
        bVal = liquidityMap[b.id] ?? num(b.stats?.totalLiquidityUsd ?? 0);
      } else if (effectiveSortKey === "expires") {
        aVal = a._categoryEndsAt ? Date.parse(a._categoryEndsAt) : Infinity;
        bVal = b._categoryEndsAt ? Date.parse(b._categoryEndsAt) : Infinity;
      }

      return effectiveSortDir === "asc" ? aVal - bVal : bVal - aVal;
    });

    return arr;
  }, [activeTab, filteredMarkets, sortConfig, chanceMap, liquidityMap, displayVolMode]);

  // Count markets per category (across full loaded set) to show related count
  const categoryCountMap = useMemo(() => {
    const map = {};
    for (const m of markets) {
      const slug = m?.categorySlug;
      if (!slug) continue;
      map[slug] = (map[slug] || 0) + 1;
    }
    return map;
  }, [markets]);

  // Infinite scroll: show visibleCount items (trending is always fixed at TRENDING_COUNT)
  const displayList = useMemo(() => {
    if (activeTab === "trending") return sortedMarkets;
    return sortedMarkets.slice(0, visibleCount);
  }, [activeTab, sortedMarkets, visibleCount]);

  useEffect(() => {
    const visibleIds = displayList
      .slice(0, INITIAL_ROW_METRICS_BATCH)
      .map((market) => String(market?.id || "").trim())
      .filter(Boolean);

    if (!visibleIds.length) return;

    const missingIds = [];
    const cachedMetrics = {};

    for (const marketId of visibleIds) {
      if (rowMetricsMap[marketId]) continue;

      const cachedMetric = clientGet(`pf-mid:${marketId}`);
      const cachedChart = clientGet(`pf-chart:${marketId}`);
      if (cachedMetric || cachedChart) {
        cachedMetrics[marketId] = {
          marketId,
          mid: cachedMetric?.mid ?? 0,
          totalLiquidity: cachedMetric?.totalLiquidity ?? null,
          sparkPts: Array.isArray(cachedChart) ? cachedChart : [],
        };
        continue;
      }

      if (requestedMetricIdsRef.current.has(marketId)) continue;
      missingIds.push(marketId);
      requestedMetricIdsRef.current.add(marketId);
    }

    if (Object.keys(cachedMetrics).length > 0) {
      setRowMetricsMap((prev) => ({ ...prev, ...cachedMetrics }));
      setChanceMap((prev) => {
        const next = { ...prev };
        for (const [marketId, metric] of Object.entries(cachedMetrics)) {
          if (metric.mid > 0) next[marketId] = metric.mid;
        }
        return next;
      });
      setLiquidityMap((prev) => {
        const next = { ...prev };
        for (const [marketId, metric] of Object.entries(cachedMetrics)) {
          if (Number.isFinite(metric.totalLiquidity) && metric.totalLiquidity > 0) {
            next[marketId] = metric.totalLiquidity;
          }
        }
        return next;
      });
    }

    if (!missingIds.length) return;

    let cancelled = false;

    fetch(`/api/predictfun/discover/row-metrics?ids=${encodeURIComponent(missingIds.join(","))}`, {
      cache: "no-store",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json?.rows) return;

        const rows = json.rows;
        setRowMetricsMap((prev) => ({ ...prev, ...rows }));
        setChanceMap((prev) => {
          const next = { ...prev };
          for (const [marketId, metric] of Object.entries(rows)) {
            if (metric?.mid > 0) next[marketId] = metric.mid;
          }
          return next;
        });
        setLiquidityMap((prev) => {
          const next = { ...prev };
          for (const [marketId, metric] of Object.entries(rows)) {
            if (Number.isFinite(metric?.totalLiquidity) && metric.totalLiquidity > 0) {
              next[marketId] = metric.totalLiquidity;
            }
          }
          return next;
        });

        for (const [marketId, metric] of Object.entries(rows)) {
          clientSet(`pf-mid:${marketId}`, metric, 30_000);
          if (Array.isArray(metric?.sparkPts) && metric.sparkPts.length > 0) {
            clientSet(`pf-chart:${marketId}`, metric.sparkPts, 60_000);
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;
        for (const marketId of missingIds) {
          requestedMetricIdsRef.current.delete(marketId);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [displayList, rowMetricsMap]);

  const hasMore = activeTab !== "trending" && visibleCount < sortedMarkets.length;

  // Load more when sentinel enters viewport
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((v) => v + SCROLL_BATCH);
        }
      },
      { threshold: 0.1 }
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [hasMore]);

  const handleSort = useCallback((key) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        if (prev.direction === "desc") return { key, direction: "asc" };
        if (prev.direction === "asc") return { key: null, direction: null };
      }
      return { key, direction: "desc" };
    });
    setVisibleCount(SCROLL_BATCH);
  }, []);

  const SortIcon = useCallback(({ sortKey }) => {
    const isActive = sortConfig.key === sortKey;
    const direction = sortConfig.direction;

    if (!isActive) {
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
          <path d="M7 15l5 5 5-5" />
          <path d="M7 9l5-5 5 5" />
        </svg>
      );
    }

    if (direction === "desc") {
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "rgba(139, 92, 246, 1)" }}>
          <path d="M12 5v14" />
          <path d="M19 12l-7 7-7-7" />
        </svg>
      );
    }

    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "rgba(139, 92, 246, 1)" }}>
        <path d="M12 19V5" />
        <path d="M5 12l7-7 7 7" />
      </svg>
    );
  }, [sortConfig.key, sortConfig.direction]);

  return (
    <>
      {/* Mobile Platform Switcher — separate panel, mobile only */}
      <div className="mobile-platform-switcher">
        <Link href="/opinion" className="mobile-platform-btn">
          <img src="/2logo-opinion.webp" alt="Opinion" width={20} height={20} style={{ borderRadius: 4 }} />
          <span>Opinion</span>
        </Link>
        <Link href="/predictfun" className="mobile-platform-btn active-pf">
          <img src="/predictfun_logo.svg" alt="Predict.fun" width={20} height={20} />
          <span>Predict.fun</span>
        </Link>
      </div>

      <div className="panel market-list-panel" style={{ padding: 12 }}>
      {/* Top Bar: Tabs + Search + Volume Mode */}
      <div className="market-topbar">
        {/* Tabs */}
        <div className="market-tabs">
          <button
            type="button"
            onClick={() => handleTabChange("new")}
            aria-pressed={activeTab === "new"}
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              border: "1px solid",
              borderColor: activeTab === "new" ? "rgba(0, 136, 255, 0.5)" : "rgba(255,255,255,0.12)",
              background: activeTab === "new" ? "rgba(0, 136, 255, 0.15)" : "transparent",
              color: activeTab === "new" ? "#0088ff" : "#fff",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 700,
              lineHeight: 1.2,
              transition: "all 0.2s",
              touchAction: "manipulation",
              position: "relative",
              zIndex: 2,
            }}
          >
            NEW
          </button>

          <button
            type="button"
            onClick={() => handleTabChange("trending")}
            aria-pressed={activeTab === "trending"}
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              border: "1px solid",
              borderColor: activeTab === "trending" ? "rgba(0, 255, 136, 0.5)" : "rgba(255,255,255,0.12)",
              background: activeTab === "trending" ? "rgba(0, 255, 136, 0.15)" : "transparent",
              color: activeTab === "trending" ? "#00ff88" : "#fff",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 700,
              lineHeight: 1.2,
              transition: "all 0.2s",
              touchAction: "manipulation",
              position: "relative",
              zIndex: 2,
            }}
          >
            TRENDING
          </button>

          <button
            type="button"
            onClick={() => handleTabChange("boost")}
            aria-pressed={activeTab === "boost"}
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              border: "1px solid",
              borderColor: activeTab === "boost" ? "rgba(139, 92, 246, 0.55)" : "rgba(255,255,255,0.12)",
              background: activeTab === "boost" ? "rgba(139, 92, 246, 0.15)" : "transparent",
              color: activeTab === "boost" ? "#a78bfa" : "#fff",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 700,
              lineHeight: 1.2,
              transition: "all 0.2s",
              touchAction: "manipulation",
              position: "relative",
              zIndex: 2,
            }}
          >
            BOOST
          </button>

          <button
            type="button"
            onClick={() => handleTabChange("all")}
            aria-pressed={activeTab === "all"}
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              border: "1px solid",
              borderColor: activeTab === "all" ? "rgba(0, 136, 255, 0.5)" : "rgba(255,255,255,0.12)",
              background: activeTab === "all" ? "rgba(0, 136, 255, 0.15)" : "transparent",
              color: activeTab === "all" ? "#0088ff" : "#fff",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 700,
              lineHeight: 1.2,
              transition: "all 0.2s",
              touchAction: "manipulation",
              position: "relative",
              zIndex: 2,
            }}
          >
            ALL
          </button>
        </div>

        {/* Search */}
        <div className="market-search-wrap" style={{ position: "relative" }}>
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.4)", pointerEvents: "none" }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder={`Search in ${activeTab === "new" ? "New" : activeTab === "trending" ? "Trending" : activeTab === "boost" ? "Boost" : "All"} Markets...`}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setVisibleCount(SCROLL_BATCH); }}
            style={{
              width: "100%",
              padding: "10px 16px 10px 40px",
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

        {/* Volume mode toggle (only on ALL tab) */}
        {activeTab === "all" && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span className="muted" style={{ fontSize: 12 }}>Volume:</span>
            <button
              type="button"
              onClick={() => setVolMode("24h")}
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: "none",
                background: volMode === "24h" ? "rgba(139, 92, 246, 0.25)" : "rgba(255,255,255,0.06)",
                color: volMode === "24h" ? "#a78bfa" : "rgba(255,255,255,0.5)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              24h
            </button>
            <button
              type="button"
              onClick={() => setVolMode("all")}
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: "none",
                background: volMode === "all" ? "rgba(139, 92, 246, 0.25)" : "rgba(255,255,255,0.06)",
                color: volMode === "all" ? "#a78bfa" : "rgba(255,255,255,0.5)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              ALL
            </button>
          </div>
        )}
      </div>

      {/* Column Headers */}
      <div
        className="market-row-desktop"
        style={{
          display: "grid",
          gridTemplateColumns: "var(--market-desktop-grid-columns, minmax(280px, 1.8fr) 140px 100px 120px 100px 120px)",
          gap: "var(--market-desktop-grid-gap, 12px)",
          padding: "8px 12px 4px",
          fontSize: 12,
          fontWeight: 600,
          color: "rgba(255,255,255,0.5)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div>Market</div>
        <div>Chart</div>
        <div onClick={() => handleSort("chance")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 4, userSelect: "none" }}>
          Chance <SortIcon sortKey="chance" />
        </div>
        <div onClick={() => handleSort("volume")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 4, userSelect: "none" }}>
          Volume ({displayVolMode}) <SortIcon sortKey="volume" />
        </div>
        <div onClick={() => handleSort("liquidity")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 4, userSelect: "none" }}>
          Liquidity <SortIcon sortKey="liquidity" />
        </div>
        <div onClick={() => handleSort("expires")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 4, userSelect: "none" }}>
          Expires <SortIcon sortKey="expires" />
        </div>
      </div>

      {/* Market Rows */}
      <div>
        {displayList.length === 0 && !isLoadingFull ? (
          <div style={{ padding: "24px 12px", textAlign: "center", color: "rgba(255,255,255,0.4)" }}>
            {search ? "No markets found" : activeTab === "boost" ? "No boosted markets currently" : "No markets available"}
          </div>
        ) : null}

        {displayList.map((market, i) => (
          <PredictFunMarketRow
            key={market.id ?? i}
            market={market}
            initialData={rowMetricsMap[String(market.id)] ?? null}
            volMode={displayVolMode}
            isBoost={activeTab === "boost"}
            showBoostTime={activeTab === "boost" || activeTab === "all"}
            priority={i < 3}
            relatedCount={Math.max(0, (categoryCountMap[market.categorySlug] || 1) - 1)}
            onChanceLoaded={handleChanceLoaded}
            onLiquidityLoaded={handleLiquidityLoaded}
          />
        ))}
      </div>

      {/* Infinite scroll sentinel */}
      {hasMore && (
        <div
          ref={sentinelRef}
          style={{ height: 48, display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div style={{ width: 20, height: 20, border: "2px solid rgba(139,92,246,0.3)", borderTopColor: "#a78bfa", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        </div>
      )}

      {/* Footer: market count */}
      <div style={{ textAlign: "center", padding: "4px 0", fontSize: 12, color: "rgba(255,255,255,0.7)" }}>
        {activeTab === "new" && "Top 100 newest active markets"}
        {activeTab === "trending" && "Top 10 markets by 24h volume"}
        {activeTab === "boost" && `${sortedMarkets.length} Boost Point market${sortedMarkets.length !== 1 ? "s" : ""}`}
        {activeTab === "all" && sortedMarkets.length > 0 && `${sortedMarkets.length} markets total`}
      </div>
    </div>
    </>
  );
}
