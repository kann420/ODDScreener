"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import MarketRowV2 from "@/components/MarketRowV2";
import PredictFunMarketRow from "@/components/PredictFunMarketRow";
import { isValidWalletAddress } from "@/lib/walletTracker/format";

const PLATFORM_PF = "predictfun";
const PLATFORM_OPINION = "opinion";
const SEARCH_TYPE_MARKET = "market";
const SEARCH_TYPE_WALLET = "wallet";
const TRENDING_COUNT = 10;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function SearchPage() {
  const router = useRouter();
  const inputRef = useRef(null);

  const [platform, setPlatform] = useState(PLATFORM_PF);
  const [searchType, setSearchType] = useState(SEARCH_TYPE_MARKET);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [walletError, setWalletError] = useState("");

  // Trending data
  const [trendingPF, setTrendingPF] = useState([]);
  const [trendingOpinion, setTrendingOpinion] = useState([]);
  const [trendingLoading, setTrendingLoading] = useState(true);

  // Chance/liquidity maps for row components
  const [chanceMap, setChanceMap] = useState({});
  const [liquidityMap, setLiquidityMap] = useState({});
  const [volumeMap, setVolumeMap] = useState({});

  // Mobile detection
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Auto-focus search input on mount
  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  // Fetch trending data for both platforms on mount
  useEffect(() => {
    let cancelled = false;

    async function fetchTrending() {
      setTrendingLoading(true);
      try {
        const [pfRes, opRes] = await Promise.all([
          fetch("/api/predictfun/discover", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).catch(() => null),
          fetch("/api/opinion/trending-markets?limit=10", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).catch(() => null),
        ]);

        if (cancelled) return;

        // PredictFun trending: sort by 24h volume, take top 10
        if (pfRes?.markets && Array.isArray(pfRes.markets)) {
          const sorted = [...pfRes.markets]
            .sort((a, b) => num(b?.stats?.volume24hUsd) - num(a?.stats?.volume24hUsd))
            .slice(0, TRENDING_COUNT);
          setTrendingPF(sorted);
        }

        // Opinion trending from API
        if (opRes?.markets && Array.isArray(opRes.markets)) {
          const normalized = opRes.markets.map((m) => ({
            ...m,
            title: m.title || m.marketTitle || m.tittle || "",
            volume24h: Number(m.volume24h || m.vol24h || 0),
            volume: Number(m.volume || m.volTotal || 0),
          }));
          setTrendingOpinion(normalized.slice(0, TRENDING_COUNT));
        }
      } catch (err) {
        console.error("[Search] Trending fetch error:", err);
      } finally {
        if (!cancelled) setTrendingLoading(false);
      }
    }

    fetchTrending();
    return () => { cancelled = true; };
  }, []);

  // Debounced search
  const searchTimerRef = useRef(null);

  const doSearch = useCallback(async (q, plat, type) => {
    if (!q.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    // Wallet search: validate and redirect
    if (type === SEARCH_TYPE_WALLET) {
      const trimmed = q.trim();
      if (!isValidWalletAddress(trimmed)) {
        setWalletError("Invalid wallet address (0x + 40 hex characters)");
        setResults([]);
        setHasSearched(true);
        return;
      }
      setWalletError("");
      if (plat === PLATFORM_PF) {
        router.push(`/wallet/predictfun/${trimmed}`);
      } else {
        router.push(`/wallet/${trimmed}`);
      }
      return;
    }

    // Market search
    setSearching(true);
    setHasSearched(true);
    setWalletError("");

    try {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(q.trim())}&platform=${plat}&type=market`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      setResults(data.results || []);
    } catch (err) {
      console.error("[Search] Error:", err);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [router]);

  const handleInputChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    setWalletError("");

    if (searchType === SEARCH_TYPE_MARKET) {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      if (val.trim().length >= 2) {
        searchTimerRef.current = setTimeout(() => doSearch(val, platform, SEARCH_TYPE_MARKET), 400);
      } else {
        setResults([]);
        setHasSearched(false);
      }
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    doSearch(query, platform, searchType);
  };

  const handlePlatformChange = (plat) => {
    setPlatform(plat);
    setResults([]);
    setHasSearched(false);
    if (query.trim().length >= 2 && searchType === SEARCH_TYPE_MARKET) {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchTimerRef.current = setTimeout(() => doSearch(query, plat, SEARCH_TYPE_MARKET), 300);
    }
  };

  const handleSearchTypeChange = (type) => {
    setSearchType(type);
    setResults([]);
    setHasSearched(false);
    setWalletError("");
  };

  // Row callbacks
  const handleChanceLoaded = useCallback((id, chance) => {
    setChanceMap((prev) => (prev[id] === chance ? prev : { ...prev, [id]: chance }));
  }, []);
  const handleLiquidityLoaded = useCallback((id, liq) => {
    if (!id || !Number.isFinite(liq)) return;
    setLiquidityMap((prev) => (prev[id] === liq ? prev : { ...prev, [id]: liq }));
  }, []);
  const handleVolumeLoaded = useCallback((id, vol) => {
    if (!id) return;
    setVolumeMap((prev) => ({ ...prev, [String(id)]: vol }));
  }, []);

  // Current trending based on selected platform
  const trending = platform === PLATFORM_PF ? trendingPF : trendingOpinion;

  // Show trending when not searching
  const showTrending = !hasSearched && !query.trim();

  return (
    <div className="col" style={{ gap: 12, paddingBottom: 72, maxWidth: 1200, margin: "0 auto" }}>
      {/* Search Header */}
      <div className="panel" style={{ padding: isMobile ? "16px 12px" : "20px 20px" }}>
        {/* Title */}
        <h1 style={{
          fontSize: isMobile ? 20 : 24,
          fontWeight: 800,
          margin: "0 0 16px 0",
          letterSpacing: "-0.02em",
        }}>
          Search
        </h1>

        {/* Platform Toggle */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button
            type="button"
            onClick={() => handlePlatformChange(PLATFORM_PF)}
            className="search-platform-btn"
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid",
              borderColor: platform === PLATFORM_PF ? "rgba(139, 92, 246, 0.5)" : "rgba(255,255,255,0.12)",
              background: platform === PLATFORM_PF ? "rgba(139, 92, 246, 0.15)" : "transparent",
              color: platform === PLATFORM_PF ? "#A78BFA" : "rgba(255,255,255,0.7)",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 700,
              transition: "all 0.2s",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <img src="/predictfun_logo.svg" alt="" width={18} height={18} style={{ display: "block" }} />
            Predict.fun
          </button>

          <button
            type="button"
            onClick={() => handlePlatformChange(PLATFORM_OPINION)}
            className="search-platform-btn"
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid",
              borderColor: platform === PLATFORM_OPINION ? "rgba(255, 136, 0, 0.5)" : "rgba(255,255,255,0.12)",
              background: platform === PLATFORM_OPINION ? "rgba(255, 136, 0, 0.12)" : "transparent",
              color: platform === PLATFORM_OPINION ? "#ff8800" : "rgba(255,255,255,0.7)",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 700,
              transition: "all 0.2s",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <img src="/2logo-opinion.webp" alt="" width={18} height={18} style={{ display: "block", borderRadius: 4 }} />
            Opinion
          </button>
        </div>

        {/* Search Type Toggle */}
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          <button
            type="button"
            onClick={() => handleSearchTypeChange(SEARCH_TYPE_MARKET)}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid",
              borderColor: searchType === SEARCH_TYPE_MARKET ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.08)",
              background: searchType === SEARCH_TYPE_MARKET ? "rgba(255,255,255,0.10)" : "transparent",
              color: searchType === SEARCH_TYPE_MARKET ? "#fff" : "rgba(255,255,255,0.5)",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              transition: "all 0.2s",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            Markets
          </button>

          <button
            type="button"
            onClick={() => handleSearchTypeChange(SEARCH_TYPE_WALLET)}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid",
              borderColor: searchType === SEARCH_TYPE_WALLET ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.08)",
              background: searchType === SEARCH_TYPE_WALLET ? "rgba(255,255,255,0.10)" : "transparent",
              color: searchType === SEARCH_TYPE_WALLET ? "#fff" : "rgba(255,255,255,0.5)",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              transition: "all 0.2s",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
              <line x1="1" y1="10" x2="23" y2="10" />
            </svg>
            Wallets
          </button>
        </div>

        {/* Search Input */}
        <form onSubmit={handleSubmit} style={{ position: "relative" }}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              position: "absolute",
              left: 14,
              top: "50%",
              transform: "translateY(-50%)",
              color: "rgba(255,255,255,0.35)",
              pointerEvents: "none",
            }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleInputChange}
            placeholder={
              searchType === SEARCH_TYPE_WALLET
                ? "Enter wallet address (0x...)"
                : `Search ${platform === PLATFORM_PF ? "Predict.fun" : "Opinion"} markets...`
            }
            style={{
              width: "100%",
              padding: "12px 48px 12px 44px",
              borderRadius: 10,
              border: "1px solid",
              borderColor: platform === PLATFORM_PF ? "rgba(139, 92, 246, 0.3)" : "rgba(255, 136, 0, 0.3)",
              background: "rgba(255,255,255,0.04)",
              color: "#fff",
              outline: "none",
              fontSize: 15,
              fontWeight: 500,
              boxSizing: "border-box",
              transition: "border-color 0.2s",
            }}
            onFocus={(e) => {
              e.target.style.borderColor = platform === PLATFORM_PF ? "rgba(139, 92, 246, 0.6)" : "rgba(255, 136, 0, 0.6)";
            }}
            onBlur={(e) => {
              e.target.style.borderColor = platform === PLATFORM_PF ? "rgba(139, 92, 246, 0.3)" : "rgba(255, 136, 0, 0.3)";
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(""); setResults([]); setHasSearched(false); setWalletError(""); inputRef.current?.focus(); }}
              style={{
                position: "absolute",
                right: 12,
                top: "50%",
                transform: "translateY(-50%)",
                background: "rgba(255,255,255,0.1)",
                border: "none",
                color: "rgba(255,255,255,0.5)",
                cursor: "pointer",
                borderRadius: 4,
                width: 24,
                height: 24,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
              }}
              aria-label="Clear search"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </form>

        {/* Wallet error */}
        {walletError && (
          <div style={{ color: "#ef4444", fontSize: 13, marginTop: 8, fontWeight: 500 }}>
            {walletError}
          </div>
        )}
      </div>

      {/* Search Results */}
      {hasSearched && searchType === SEARCH_TYPE_MARKET && (
        <div className="panel" style={{ padding: isMobile ? "12px 8px" : "16px 16px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.5)", marginBottom: 12 }}>
            {searching ? "Searching..." : `${results.length} result${results.length !== 1 ? "s" : ""} found`}
          </div>

          {searching ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[...Array(3)].map((_, i) => (
                <div key={i} className="skeleton" style={{ height: 56, borderRadius: 10 }} />
              ))}
            </div>
          ) : results.length === 0 ? (
            <div className="muted" style={{ textAlign: "center", padding: 32 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>No markets found</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Try a different search term or switch platform.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {platform === PLATFORM_PF
                ? results.map((m, idx) => (
                    <PredictFunMarketRow
                      key={m.id || idx}
                      market={m}
                      volMode="24h"
                      priority={idx < 5}
                      onChanceLoaded={handleChanceLoaded}
                      onLiquidityLoaded={handleLiquidityLoaded}
                    />
                  ))
                : results.map((m, idx) => (
                    <MarketRowV2
                      key={m.marketId || idx}
                      market={m}
                      volMode="24h"
                      priority={idx < 5}
                      onChanceLoaded={handleChanceLoaded}
                      onVolumeLoaded={handleVolumeLoaded}
                      onLiquidityLoaded={handleLiquidityLoaded}
                    />
                  ))
              }
            </div>
          )}
        </div>
      )}

      {/* Trending Section - shown when not actively searching */}
      {showTrending && (
        <div className="panel" style={{ padding: isMobile ? "12px 8px" : "16px 16px" }}>
          {/* Trending Header */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 14,
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#00ff88" }}>
              <polyline points="23,6 13.5,15.5 8.5,10.5 1,18" />
              <polyline points="17,6 23,6 23,12" />
            </svg>
            <span style={{ fontSize: 15, fontWeight: 800, color: "#00ff88" }}>
              Top 10 Trending
            </span>
            <span style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.4)" }}>
              by 24h Volume on {platform === PLATFORM_PF ? "Predict.fun" : "Opinion"}
            </span>
          </div>

          {/* Column Header - Desktop only */}
          <div
            className="search-trending-header"
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              background: "rgba(10, 16, 18, 0.65)",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(255,255,255,0.06)",
              marginBottom: 8,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "var(--market-desktop-grid-columns, minmax(280px, 1.8fr) 140px 100px 120px 100px 120px)",
                gap: "var(--market-desktop-grid-gap, 12px)",
                alignItems: "center",
                fontSize: 12,
              }}
            >
              <div className="muted">Market</div>
              <div className="muted">Chart</div>
              <div className="muted">Chance</div>
              <div className="muted">Volume (24h)</div>
              <div className="muted">Liquidity</div>
              <div className="muted">Expires</div>
            </div>
          </div>

          {/* Trending List */}
          {trendingLoading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[...Array(5)].map((_, i) => (
                <div key={i} className="skeleton" style={{ height: 56, borderRadius: 10 }} />
              ))}
            </div>
          ) : trending.length === 0 ? (
            <div className="muted" style={{ textAlign: "center", padding: 32 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Loading trending data...</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Please wait while we fetch the latest markets.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {platform === PLATFORM_PF
                ? trending.map((m, idx) => (
                    <PredictFunMarketRow
                      key={m.id || idx}
                      market={m}
                      volMode="24h"
                      priority={idx < 5}
                      onChanceLoaded={handleChanceLoaded}
                      onLiquidityLoaded={handleLiquidityLoaded}
                    />
                  ))
                : trending.map((m, idx) => (
                    <MarketRowV2
                      key={m.marketId || idx}
                      market={m}
                      volMode="24h"
                      priority={idx < 5}
                      onChanceLoaded={handleChanceLoaded}
                      onVolumeLoaded={handleVolumeLoaded}
                      onLiquidityLoaded={handleLiquidityLoaded}
                    />
                  ))
              }
            </div>
          )}
        </div>
      )}
    </div>
  );
}
