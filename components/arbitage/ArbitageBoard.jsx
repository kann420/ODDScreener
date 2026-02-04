"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import ArbCalculatorModal from "./ArbCalculatorModal";
import { getOptimizedImageUrl } from "@/components/OptimizedImage";
import { getBonusCache, setBonusCache } from "@/lib/clientCache";

// Cache key for sessionStorage
const CACHE_KEY = "arbitrage_cache";

// Get cache from sessionStorage (persists across page navigation)
function getCache() {
  if (typeof window === "undefined") return { bids: {}, asks: {} };
  try {
    const stored = sessionStorage.getItem(CACHE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Validate cache has correct structure
      if (parsed.bids && parsed.asks) {
        return parsed;
      }
    }
  } catch {}
  return { bids: { rows: null, timestamp: null }, asks: { rows: null, timestamp: null } };
}

// Save cache to sessionStorage
function saveCache(mode, rows, timestamp) {
  if (typeof window === "undefined") return;
  try {
    const cache = getCache();
    cache[mode] = { rows, timestamp };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return null;
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return "over a day ago";
}

// Sort icon component - 12px outline style SVG icons per guidelines
function ArbSortIcon({ active, direction }) {
  // Neutral state (double chevron)
  if (!active) {
    return (
      <svg 
        width="12" 
        height="12" 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke="currentColor" 
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ opacity: 0.4, marginLeft: 4 }}
      >
        <path d="M7 15l5 5 5-5" />
        <path d="M7 9l5-5 5 5" />
      </svg>
    );
  }
  
  // Active desc (arrow down) - sortAsc=false means highest first
  if (!direction) {
    return (
      <svg 
        width="12" 
        height="12" 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke="currentColor" 
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ color: "rgba(255,180,50,1)", marginLeft: 4 }}
      >
        <path d="M12 5v14" />
        <path d="M19 12l-7 7-7-7" />
      </svg>
    );
  }
  
  // Active asc (arrow up)
  return (
    <svg 
      width="12" 
      height="12" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: "rgba(255,180,50,1)", marginLeft: 4 }}
    >
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  );
}

export default function ArbitageBoard() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [priceMode, setPriceMode] = useState("bids"); // "bids" or "asks"
  const [sortAsc, setSortAsc] = useState(false); // false = descending (highest first)
  const [sortField, setSortField] = useState("arbPct"); // "arbPct" or "endDate"
  const [lastScanTime, setLastScanTime] = useState(null);
  const [, forceUpdate] = useState(0); // For updating "X ago" display
  const [initialized, setInitialized] = useState(false);
  
  // Filter settings
  const [minArbPct, setMinArbPct] = useState(0.1); // Min arb percentage
  const [minShares, setMinShares] = useState(0); // Min shares on orderbook
  const [showFilters, setShowFilters] = useState(true); // Toggle filter panel - default open
  const [scanMode, setScanMode] = useState("quick"); // "quick" (100 markets) or "full" (all markets)
  
  // Track if user has ever scanned
  const [hasScanned, setHasScanned] = useState(false);
  
  // Search filter
  const [searchQuery, setSearchQuery] = useState("");
  
  // Calculator modal
  const [calculatorRow, setCalculatorRow] = useState(null); // Row to show in calculator
  
  // SSE streaming state
  const [progress, setProgress] = useState(null); // { phase, current, total, message }
  const [streamingRows, setStreamingRows] = useState([]); // Rows received while streaming
  const eventSourceRef = useRef(null);
  
  // Bonus markets filter
  const [bonusIds, setBonusIds] = useState([]);
  const [bonusOnly, setBonusOnly] = useState(false);
  const [bonusScanStatus, setBonusScanStatus] = useState(""); // "", "scanning", "done"
  const bonusSet = useMemo(() => new Set((bonusIds || []).map((x) => String(x))), [bonusIds]);
  
  // Keep a ref to bonusIds for async scan function
  const bonusIdsRef = useRef(bonusIds);
  useEffect(() => { bonusIdsRef.current = bonusIds; }, [bonusIds]);

  // Update "X ago" display every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => forceUpdate((n) => n + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  // Scan bonus markets for given market IDs by fetching market detail and checking incentiveFactor
  const scanBonusForMarkets = useCallback(async (marketIds) => {
    if (!marketIds || marketIds.length === 0) return;
    
    // Filter out already known bonus markets (use ref to get latest)
    const currentBonus = new Set((bonusIdsRef.current || []).map((x) => String(x)));
    const toScan = marketIds.filter((id) => id && !currentBonus.has(String(id)));
    if (toScan.length === 0) {
      console.log(`[Arb-Bonus] All ${marketIds.length} markets already checked`);
      return;
    }
    
    setBonusScanStatus("scanning");
    console.log(`[Arb-Bonus] Scanning ${toScan.length} markets for bonus...`);
    
    const foundBonus = [];
    const batchSize = 5;
    
    for (let i = 0; i < toScan.length; i += batchSize) {
      const batch = toScan.slice(i, i + batchSize);
      
      const results = await Promise.allSettled(
        batch.map(async (marketId) => {
          try {
            const res = await fetch(`/api/opinion/market/${encodeURIComponent(marketId)}`, { cache: "no-store" });
            if (!res.ok) return null;
            const j = await res.json();
            const data = j?.result?.data ?? j?.result ?? j?.data ?? j ?? {};
            // Check if incentiveFactor field exists
            if ("incentiveFactor" in data || "incentive_factor" in data || "incentive" in data) {
              return marketId;
            }
            return null;
          } catch {
            return null;
          }
        })
      );
      
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) {
          foundBonus.push(r.value);
        }
      }
      
      // Small delay between batches
      if (i + batchSize < toScan.length) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    
    if (foundBonus.length > 0) {
      console.log(`[Arb-Bonus] Found ${foundBonus.length} bonus markets:`, foundBonus);
      setBonusIds((prev) => {
        const newIds = foundBonus.filter((id) => !prev.includes(id) && !prev.includes(String(id)));
        if (newIds.length === 0) return prev;
        const updated = [...prev, ...newIds];
        setBonusCache(updated); // Save to cache
        return updated;
      });
    } else {
      console.log(`[Arb-Bonus] No bonus markets found in scanned set`);
    }
    
    setBonusScanStatus("done");
  }, []); // No deps - uses refs for latest state

  // Load bonus IDs from cache or API (for bonus market detection)
  useEffect(() => {
    const cachedBonus = getBonusCache();
    if (cachedBonus?.ids && cachedBonus.ids.length > 0) {
      setBonusIds(cachedBonus.ids);
      console.log("[Arb] Loaded bonus IDs from cache:", cachedBonus.ids.length);
      return;
    }

    // Fetch from API if no cache
    (async () => {
      try {
        const res = await fetch(`/api/opinion/bonus-markets?limit=1000`, { cache: "no-store" });
        const j = await res.json();
        const ids = j?.ids || j?.result?.ids || [];
        if (Array.isArray(ids) && ids.length > 0) {
          setBonusIds(ids);
          setBonusCache(ids);
          console.log("[Arb] Fetched bonus IDs from API:", ids.length);
        }
      } catch (e) {
        console.error("[Arb] Failed to fetch bonus IDs:", e);
      }
    })();
  }, []);

  // Load from sessionStorage cache when switching modes or on mount
  useEffect(() => {
    const cache = getCache();
    const cached = cache[priceMode];
    if (cached?.rows && cached.rows.length > 0) {
      setRows(cached.rows);
      setLastScanTime(cached.timestamp);
      setLoading(false);
      setInitialized(true);
      setHasScanned(true); // Cache exists = user has scanned before
      
      // Scan bonus for cached rows (defer to avoid race condition)
      setTimeout(() => {
        const marketIds = [...new Set(cached.rows.map((r) => r.opinionMarketId).filter(Boolean))];
        if (marketIds.length > 0) {
          scanBonusForMarkets(marketIds);
        }
      }, 200);
    } else {
      // No cache, wait for user to scan
      setRows([]);
      setLastScanTime(null);
      setInitialized(true);
      setHasScanned(false); // Reset hasScanned when switching to mode without cache
    }
  }, [priceMode]); // scanBonusForMarkets is stable (no deps)

  // Cleanup SSE on unmount or mode change
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [priceMode]);

  const loadDataStreaming = useCallback(() => {
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setLoading(true);
    setErr("");
    setProgress({ phase: "connecting", message: "Connecting..." });
    setStreamingRows([]);

    const url = `/api/arbitage/stream?priceMode=${encodeURIComponent(priceMode)}&minArbPct=${encodeURIComponent(minArbPct)}&limit=100&scanMode=${encodeURIComponent(scanMode)}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.addEventListener("progress", (e) => {
      try {
        const data = JSON.parse(e.data);
        setProgress(data);
      } catch {}
    });

    es.addEventListener("match", (e) => {
      try {
        const match = JSON.parse(e.data);
        setStreamingRows((prev) => {
          // Dedupe by id
          if (prev.some((r) => r.id === match.id)) return prev;
          const newRows = [...prev, match];
          // Sort by arbPct descending
          newRows.sort((a, b) => (b.arbPct ?? 0) - (a.arbPct ?? 0));
          return newRows;
        });
      } catch {}
    });

    es.addEventListener("batch", (e) => {
      try {
        const { rows: batchRows } = JSON.parse(e.data);
        if (Array.isArray(batchRows) && batchRows.length > 0) {
          setStreamingRows((prev) => {
            const ids = new Set(prev.map((r) => r.id));
            const newOnes = batchRows.filter((r) => !ids.has(r.id));
            if (newOnes.length === 0) return prev;
            const combined = [...prev, ...newOnes];
            combined.sort((a, b) => (b.arbPct ?? 0) - (a.arbPct ?? 0));
            return combined;
          });
        }
      } catch {}
    });

    es.addEventListener("done", () => {
      es.close();
      eventSourceRef.current = null;
      
      // Finalize: save to cache
      setStreamingRows((finalRows) => {
        const now = Date.now();
        saveCache(priceMode, finalRows, now);
        setRows(finalRows);
        setLastScanTime(now);
        setHasScanned(true);
        
        // Extract unique opinionMarketIds for bonus scan (defer to after state update)
        setTimeout(() => {
          const marketIds = [...new Set(finalRows.map((r) => r.opinionMarketId).filter(Boolean))];
          if (marketIds.length > 0) {
            scanBonusForMarkets(marketIds);
          }
        }, 100);
        
        return finalRows;
      });
      
      setLoading(false);
      setProgress(null);
    });

    es.addEventListener("error", (e) => {
      try {
        const data = JSON.parse(e.data);
        setErr(data.message || "Scan failed");
      } catch {
        setErr("Connection lost");
      }
      es.close();
      eventSourceRef.current = null;
      setLoading(false);
      setProgress(null);
    });

    es.onerror = () => {
      // SSE connection error
      if (es.readyState === EventSource.CLOSED) {
        // Normal close, ignore
        return;
      }
      setErr("Connection error");
      es.close();
      eventSourceRef.current = null;
      setLoading(false);
      setProgress(null);
    };
  }, [priceMode, minArbPct, scanMode]);

  // Fallback: use regular fetch if SSE fails
  const loadDataFallback = useCallback(async () => {
    try {
      setLoading(true);
      setErr("");
      setProgress({ phase: "loading", message: "Loading..." });

      const url = `/api/arbitage/opportunities?mode=auto&priceMode=${encodeURIComponent(priceMode)}&minArbPct=${encodeURIComponent(minArbPct)}&limit=50&t=${Date.now()}`;
      
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();

      if (!res.ok || !json?.ok) {
        setErr("Failed to load arbitrage data.");
        setRows([]);
        return;
      }

      const newRows = Array.isArray(json.rows) ? json.rows : [];
      const now = Date.now();
      
      // Save to sessionStorage cache
      saveCache(priceMode, newRows, now);
      
      setRows(newRows);
      setLastScanTime(now);
    } catch (e) {
      setErr("Failed to load arbitrage data.");
      setRows([]);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }, [priceMode, minArbPct]);

  function handleRefresh() {
    // Use streaming by default
    setHasScanned(true);
    loadDataStreaming();
  }

  // Display rows: show streaming rows while loading, otherwise show cached rows
  const displayRows = loading && streamingRows.length > 0 ? streamingRows : rows;

  const sorted = useMemo(() => {
    const arr = Array.isArray(displayRows) ? [...displayRows] : [];
    
    // Sort by selected field
    arr.sort((a, b) => {
      if (sortField === "endDate") {
        const dateA = a.endDate ? new Date(a.endDate).getTime() : Infinity;
        const dateB = b.endDate ? new Date(b.endDate).getTime() : Infinity;
        return sortAsc ? dateA - dateB : dateB - dateA;
      } else {
        return sortAsc 
          ? (a.arbPct ?? 0) - (b.arbPct ?? 0) 
          : (b.arbPct ?? 0) - (a.arbPct ?? 0);
      }
    });
    return arr.filter((r) => {
      // Filter by min arb %
      if ((r.arbPct ?? 0) < minArbPct) return false;
      
      // Filter by min shares at best bid/ask level
      // Both sides of the arbitrage trade must have at least minShares
      if (minShares > 0 && r.sizes) {
        const strategyStr = Array.isArray(r.strategy) ? r.strategy.join(" ") : (r.strategy || "");
        const relevantSizes = [];
        
        // Check which sides are involved in this arb strategy
        if (strategyStr.includes("YES (Poly)")) relevantSizes.push(r.sizes.polyYes);
        if (strategyStr.includes("NO (Poly)")) relevantSizes.push(r.sizes.polyNo);
        if (strategyStr.includes("YES (Opinion)") || strategyStr.includes("YES (Op)")) relevantSizes.push(r.sizes.opYes);
        if (strategyStr.includes("NO (Opinion)") || strategyStr.includes("NO (Op)")) relevantSizes.push(r.sizes.opNo);
        
        // Filter out if we have no size data or any relevant side has less than minShares
        const validSizes = relevantSizes.filter(s => Number.isFinite(s) && s > 0);
        if (validSizes.length === 0) return false; // No valid size data
        
        const minAvailable = Math.min(...validSizes);
        if (minAvailable < minShares) return false;
      }
      return true;
    });
  }, [displayRows, sortAsc, sortField, minArbPct, minShares]);

  // Apply bonus filter
  const filteredSorted = useMemo(() => {
    let result = sorted;
    
    // Apply bonus filter
    if (bonusOnly) {
      result = result.filter((r) => {
        const marketId = String(r.opinionMarketId || "");
        return bonusSet.has(marketId);
      });
    }
    
    return result;
  }, [sorted, bonusOnly, bonusSet]);

  // Apply search filter
  const searchFilteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return filteredSorted;
    
    return filteredSorted.filter((r) => {
      // Search across all title fields
      const title = String(r?.title ?? "").toLowerCase();
      const opinionTitle = String(r?.opinionTitle ?? "").toLowerCase();
      const polyTitle = String(r?.polyTitle ?? "").toLowerCase();
      const parentTitle = String(r?.parentTitle ?? "").toLowerCase();
      const outcome = String(r?.outcome ?? "").toLowerCase();
      const marketId = String(r?.opinionMarketId ?? "");
      
      return title.includes(query) || 
             opinionTitle.includes(query) || 
             polyTitle.includes(query) || 
             parentTitle.includes(query) || 
             outcome.includes(query) || 
             marketId.includes(query);
    });
  }, [filteredSorted, searchQuery]);

  // Count bonus markets in current results
  const bonusCount = useMemo(() => {
    return sorted.filter((r) => bonusSet.has(String(r.opinionMarketId || ""))).length;
  }, [sorted, bonusSet]);

  // Progress bar percentage
  const progressPct = progress?.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="arb-board" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header */}
      <div className="panel arb-header" style={{ padding: 16 }}>
        <div className="arb-header-top" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div className="arb-header-left">
            <div className="arb-title" style={{ fontSize: 22, fontWeight: 900 }}>Arbitrage</div>
            <div className="muted arb-subtitle" style={{ fontSize: 12, marginTop: 6 }}>
              {priceMode === "bids" 
                ? <>Using best <b>BID</b> prices from Opinion & Polymarket.</>
                : <>Using best <b>ASK</b> prices from Opinion & Polymarket.</>
              }
              {loading && progress?.message && (
                <span style={{ marginLeft: 8, color: "rgba(255,180,50,0.9)" }}>
                  {progress.message}
                </span>
              )}
            </div>
            {err ? (
              <div style={{ marginTop: 8, fontSize: 12, fontWeight: 800, color: "rgba(255,120,120,0.95)" }}>{err}</div>
            ) : null}
          </div>

          <div className="arb-header-right" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {/* Filter toggle */}
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className="btn ghost arb-filter-btn"
              aria-label={showFilters ? "Hide filters" : "Show filters"}
              aria-expanded={showFilters}
              style={{
                padding: "8px 14px",
                fontSize: 12,
                fontWeight: 800,
                background: showFilters ? "rgba(255,180,50,0.15)" : "transparent",
                border: showFilters ? "1px solid rgba(255,180,50,0.4)" : "1px solid rgba(255,255,255,0.1)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <svg 
                width="16" 
                height="16" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="4" y1="21" x2="4" y2="14" />
                <line x1="4" y1="10" x2="4" y2="3" />
                <line x1="12" y1="21" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12" y2="3" />
                <line x1="20" y1="21" x2="20" y2="16" />
                <line x1="20" y1="12" x2="20" y2="3" />
                <line x1="1" y1="14" x2="7" y2="14" />
                <line x1="9" y1="8" x2="15" y2="8" />
                <line x1="17" y1="16" x2="23" y2="16" />
              </svg>
              Filters
            </button>
            {/* Price Mode Toggle */}
            <div className="arb-mode-toggle" role="group" aria-label="Price mode selection" style={{ display: "flex", gap: 4, background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: 3 }}>
              <button
                type="button"
                onClick={() => setPriceMode("bids")}
                aria-pressed={priceMode === "bids"}
                aria-label="Use best bid prices"
                style={{
                  padding: "8px 14px",
                  fontSize: 12,
                  fontWeight: 800,
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  background: priceMode === "bids" ? "rgba(80,200,120,0.8)" : "transparent",
                  color: priceMode === "bids" ? "#ffffff" : "rgba(233,238,245,0.7)",
                }}
              >
                Bids Mode
              </button>
              <button
                type="button"
                onClick={() => setPriceMode("asks")}
                aria-pressed={priceMode === "asks"}
                aria-label="Use best ask prices"
                style={{
                  padding: "8px 14px",
                  fontSize: 12,
                  fontWeight: 800,
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  background: priceMode === "asks" ? "rgba(181, 53, 56, 0.9)" : "transparent",
                  color: priceMode === "asks" ? "#ffffff" : "rgba(233,238,245,0.7)",
                }}
              >
                Asks Mode
              </button>
            </div>
            <div className="pill arb-min-arb-pill">
              Min Arb: <b>{minArbPct.toFixed(2)}%</b>
              {minShares > 0 && <> • Min: <b>{minShares}</b> shares</>}
            </div>
            <div className="arb-scan-btn-wrap" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <button 
                className="btn ghost" 
                type="button" 
                onClick={handleRefresh}
                disabled={loading}
                style={{ opacity: loading ? 0.5 : 1 }}
              >
                {loading ? "Scanning..." : "SCAN NOW"}
              </button>
              {lastScanTime && !loading && (
                <div className="muted" style={{ fontSize: 10, fontWeight: 700 }}>
                  scanned {formatTimeAgo(lastScanTime)}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Filter Panel (Collapsible) */}
        {showFilters && (
          <div style={{ 
            marginTop: 16, 
            padding: 16, 
            background: "rgba(255,255,255,0.03)", 
            borderRadius: 12, 
            border: "1px solid rgba(255,255,255,0.08)" 
          }}>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start", rowGap: 16 }}>
              {/* Min Arb % */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 11, fontWeight: 800, color: "rgba(233,238,245,0.6)", height: 13 }}>
                  MIN ARB %
                </label>
                <input
                  type="number"
                  value={minArbPct}
                  onChange={(e) => setMinArbPct(Math.max(0, parseFloat(e.target.value) || 0))}
                  step="0.1"
                  min="0"
                  style={{
                    width: 90,
                    height: 38,
                    padding: "0 10px",
                    fontSize: 13,
                    fontWeight: 700,
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: 6,
                    color: "#e9eef5",
                    outline: "none",
                  }}
                />
              </div>

              {/* Min Shares */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 11, fontWeight: 800, color: "rgba(233,238,245,0.6)", height: 13 }}>
                  MIN SHARES
                </label>
                <input
                  type="number"
                  value={minShares}
                  onChange={(e) => setMinShares(Math.max(0, parseInt(e.target.value) || 0))}
                  step="100"
                  min="0"
                  placeholder="0"
                  style={{
                    width: 90,
                    height: 38,
                    padding: "0 10px",
                    fontSize: 13,
                    fontWeight: 700,
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: 6,
                    color: "#e9eef5",
                    outline: "none",
                  }}
                />
              </div>

              {/* Scan Mode */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 11, fontWeight: 800, color: "rgba(233,238,245,0.6)", height: 13 }}>
                  SCAN MODE
                </label>
                <div style={{ display: "flex", gap: 8, height: 38, alignItems: "stretch" }}>
                  <label 
                    style={{ 
                      display: "flex", 
                      alignItems: "center", 
                      gap: 6, 
                      cursor: "pointer",
                      padding: "0 12px",
                      borderRadius: 6,
                      background: scanMode === "quick" ? "rgba(80,200,120,0.15)" : "rgba(0,0,0,0.2)",
                      border: scanMode === "quick" ? "1px solid rgba(80,200,120,0.4)" : "1px solid rgba(255,255,255,0.1)",
                    }}
                  >
                    <input
                      type="radio"
                      name="scanMode"
                      value="quick"
                      checked={scanMode === "quick"}
                      onChange={() => setScanMode("quick")}
                      style={{ accentColor: "rgb(80,200,120)" }}
                    />
                    <span style={{ fontSize: 12, fontWeight: 700, color: scanMode === "quick" ? "rgba(80,200,120,0.95)" : "rgba(233,238,245,0.7)" }}>
                      Quick Scan
                    </span>
                  </label>
                  <label 
                    style={{ 
                      display: "flex", 
                      alignItems: "center", 
                      gap: 6, 
                      cursor: "pointer",
                      padding: "0 12px",
                      borderRadius: 6,
                      background: scanMode === "full" ? "rgba(255,180,50,0.15)" : "rgba(0,0,0,0.2)",
                      border: scanMode === "full" ? "1px solid rgba(255,180,50,0.4)" : "1px solid rgba(255,255,255,0.1)",
                    }}
                  >
                    <input
                      type="radio"
                      name="scanMode"
                      value="full"
                      checked={scanMode === "full"}
                      onChange={() => setScanMode("full")}
                      style={{ accentColor: "rgb(255,180,50)" }}
                    />
                    <span style={{ fontSize: 12, fontWeight: 700, color: scanMode === "full" ? "rgba(255,180,50,0.95)" : "rgba(233,238,245,0.7)" }}>
                      Full Scan
                    </span>
                  </label>
                </div>
              </div>

              {/* Bonus Only Filter */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 11, fontWeight: 800, color: "rgba(233,238,245,0.6)", height: 13 }}>
                  BONUS FILTER
                </label>
                <button
                  type="button"
                  onClick={() => setBonusOnly((v) => !v)}
                  style={{
                    height: 38,
                    padding: "0 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    borderRadius: 6,
                    cursor: "pointer",
                    background: bonusOnly ? "rgba(245, 200, 75, 0.15)" : "rgba(0,0,0,0.2)",
                    border: bonusOnly ? "1px solid rgba(245, 200, 75, 0.5)" : "1px solid rgba(255,255,255,0.1)",
                    color: bonusOnly ? "#F5C84B" : "rgba(233,238,245,0.7)",
                    fontSize: 12,
                    fontWeight: 700,
                    transition: "all 0.2s",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img 
                    src="/gift_icon_24.svg" 
                    alt="" 
                    width={32} 
                    height={32} 
                    style={{ opacity: bonusOnly ? 1 : 0.5 }}
                  />
                  <span>Bonus Only</span>
                  {bonusScanStatus === "scanning" ? (
                    <span style={{ 
                      padding: "2px 6px", 
                      borderRadius: 4, 
                      background: "rgba(100,150,255,0.2)",
                      fontSize: 10,
                      fontWeight: 800,
                      color: "rgba(150,200,255,0.9)",
                    }}>
                      Scanning...
                    </span>
                  ) : bonusCount > 0 && (
                    <span style={{ 
                      padding: "2px 6px", 
                      borderRadius: 4, 
                      background: bonusOnly ? "rgba(245, 200, 75, 0.25)" : "rgba(255,255,255,0.1)",
                      fontSize: 11,
                      fontWeight: 800,
                    }}>
                      {bonusCount}
                    </span>
                  )}
                </button>
              </div>
            </div>
            {/* Scan mode description - moved outside to avoid height mismatch */}
            <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(233,238,245,0.6)", marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              {scanMode === "quick" 
                ? "Quick scan: Top 100 markets. Results available almost instantly."
                : "Full scan: All markets. May take up to 1 minute."
              }
            </div>
          </div>
        )}

        {/* Progress bar during streaming */}
        {loading && progress && (
          <div style={{ marginTop: 12 }}>
            <div style={{ 
              height: 4, 
              background: "rgba(255,255,255,0.1)", 
              borderRadius: 2, 
              overflow: "hidden" 
            }}>
              <div 
                style={{ 
                  height: "100%", 
                  width: `${progressPct}%`, 
                  background: "rgba(255,180,50,0.9)",
                  borderRadius: 2,
                  transition: "width 0.3s ease"
                }} 
              />
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
              {progress.phase === "discovering" && "Scanning markets..."}
              {progress.phase === "matching" && `Found ${progress.total} potential pairs`}
              {progress.phase === "processing" && `Processing ${progress.current}/${progress.total} pairs`}
              {streamingRows.length > 0 && (
                <span style={{ marginLeft: 8, color: "rgba(80,200,120,0.95)", fontWeight: 800 }}>
                  • {streamingRows.length} opportunities found
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Search Bar */}
      <div className="panel" style={{ padding: 16 }}>
        <div style={{ position: "relative" }}>
          {/* Search Icon */}
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              color: "rgba(255,255,255,0.4)",
              pointerEvents: "none",
            }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search arbitrage opportunities..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
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
      </div>

      {/* Table Header */}
      <div
        className="panel arb-table-header"
        style={{
          padding: "12px 14px",
          display: "grid",
          gridTemplateColumns: "1.25fr 0.65fr 0.35fr 0.35fr",
          gap: 14,
          alignItems: "center",
          borderBottom: "2px solid rgba(255,255,255,0.06)",
        }}
      >
        <div style={{ fontWeight: 900, color: "rgba(233,238,245,0.9)" }}>Title</div>
        <div style={{ fontWeight: 900, color: "rgba(233,238,245,0.9)" }}>Strategy</div>
        <div 
          style={{ 
            fontWeight: 900, 
            color: sortField === "endDate" ? "rgba(255,180,50,1)" : "rgba(233,238,245,0.9)", 
            textAlign: "center",
            cursor: "pointer",
            userSelect: "none",
          }}
          onClick={() => {
            if (sortField === "endDate") {
              setSortAsc((v) => !v);
            } else {
              setSortField("endDate");
              setSortAsc(true); // Start with soonest first
            }
          }}
          title="Click to sort by expiration date"
        >
          <span style={{ display: "flex", alignItems: "center" }}>
            Expires
            <ArbSortIcon active={sortField === "endDate"} direction={sortAsc} />
          </span>
        </div>
        <div 
          style={{ 
            fontWeight: 900, 
            color: sortField === "arbPct" ? "rgba(255,180,50,1)" : "rgba(233,238,245,0.9)", 
            textAlign: "right",
            cursor: "pointer",
            userSelect: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 4,
          }}
          onClick={() => {
            if (sortField === "arbPct") {
              setSortAsc((v) => !v);
            } else {
              setSortField("arbPct");
              setSortAsc(false); // Start with highest first
            }
          }}
          title="Click to sort by arbitrage percentage"
        >
          <span style={{ display: "flex", alignItems: "center" }}>
            Arbitrage
            <ArbSortIcon active={sortField === "arbPct"} direction={sortAsc} />
          </span>
        </div>
      </div>

      {loading && sorted.length === 0 ? (
        <SkeletonRows />
      ) : !hasScanned && sorted.length === 0 ? (
        /* User hasn't scanned yet - show prompt */
        <div className="panel" style={{ padding: "60px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 42, marginBottom: 16, opacity: 0.4 }}>🔍</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "rgba(233,238,245,0.85)", marginBottom: 8 }}>
            Press "<span style={{ color: "rgba(255,180,50,1)" }}>Scan Now</span>" to find Arbitrage Opportunities
          </div>
          <div className="muted" style={{ fontSize: 12, maxWidth: 400, margin: "0 auto" }}>
            It may take up to 30 seconds to fully load.
          </div>
        </div>
      ) : searchFilteredRows.length === 0 && !loading ? (
        <div className="panel" style={{ padding: 14 }}>
          <div className="muted" style={{ fontSize: 13, fontWeight: 800 }}>
            {searchQuery.trim() 
              ? `No results found for "${searchQuery.trim()}"`
              : bonusOnly 
                ? `No bonus markets with arbitrage ≥ ${minArbPct.toFixed(2)}% found.`
                : `No arbitrage opportunities ≥ ${minArbPct.toFixed(2)}% found.`}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            {searchQuery.trim()
              ? "Try a different search term or clear the search."
              : bonusOnly 
                ? "Try disabling the bonus filter or adjusting other filters."
                : "Try checking back later, adjust filters, or switch between Bids/Asks mode."}
          </div>
        </div>
      ) : (
        <>
          {searchFilteredRows.map((r) => (
            <Row 
              key={r.id} 
              r={r} 
              priceMode={priceMode}
              isBonus={bonusSet.has(String(r.opinionMarketId || ""))}
              onCalculatorClick={() => setCalculatorRow(r)}
            />
          ))}
          {loading && (
            <div className="panel" style={{ padding: 14, textAlign: "center" }}>
              <div className="muted" style={{ fontSize: 12, fontWeight: 800 }}>
                Loading more opportunities...
              </div>
            </div>
          )}
        </>
      )}
      
      {/* Calculator Modal */}
      {calculatorRow && (
        <ArbCalculatorModal 
          row={calculatorRow} 
          onClose={() => setCalculatorRow(null)} 
        />
      )}
    </div>
  );
}

function Row({ r, priceMode, isBonus, onCalculatorClick }) {
  return (
    <div
      className="panel arb-row"
      style={{
        padding: 12,
        display: "grid",
        gridTemplateColumns: "1.25fr 0.65fr 0.35fr 0.35fr",
        gap: 14,
        alignItems: "stretch",
      }}
    >
      {/* Title col */}
      <div className="arb-row-title" style={{ display: "flex", gap: 12, minWidth: 0 }}>
        {/* Image (Opinion) */}
        <div className="arb-row-img" style={{ width: 120, flex: "0 0 auto" }}>
          <div
            className="arb-row-img-inner"
            style={{
              width: 120,
              height: 78,
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "rgba(255,255,255,0.03)",
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {r.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img 
                src={getOptimizedImageUrl(r.imageUrl, 240, 80)} 
                alt="" 
                loading="lazy"
                decoding="async"
                style={{ width: "100%", height: "100%", objectFit: "cover" }} 
              />
            ) : (
              <div className="muted" style={{ fontSize: 12, fontWeight: 800 }}>
                Image
              </div>
            )}
          </div>
        </div>

        {/* Text + Links */}
        <div className="arb-row-info" style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="arb-row-market-title" style={{ fontSize: 15, fontWeight: 900, lineHeight: 1.2 }} title={r.parentTitle ? `${r.parentTitle} - ${r.outcome || r.title}` : (r.title || r.opinionTitle || r.polyTitle)}>
            {r.parentTitle ? (
              <>
                <span style={{ color: "rgba(180,195,214,0.75)" }}>{r.parentTitle}</span>
                <span style={{ margin: "0 6px", color: "rgba(180,195,214,0.5)" }}>—</span>
                <span>{r.outcome || r.title}</span>
              </>
            ) : (
              r.title || r.opinionTitle || r.polyTitle || "Untitled Market"
            )}
          </div>

          <div className="arb-row-links" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <VenueLine logoSrc="/2polymarket_600.webp" label="Polymarket" url={r.poly?.url} />
            <VenueLine logoSrc="/2logo-opinion.webp" label="Opinion" url={r.opinion?.url} isBonus={isBonus} />
          </div>
          
          {/* Mobile-only strategy - shows first 2 lines below links */}
          <div className="arb-row-strategy-mobile" style={{ display: "none", flexDirection: "row", gap: 12, marginTop: 8 }}>
            {(r.strategy ?? []).slice(0, 2).map((line, idx) => (
              <div key={idx} style={{ fontSize: 12, fontWeight: 700, color: "rgb(255, 255, 255)", whiteSpace: "nowrap" }}>
                {line}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Strat col */}
      <div className="arb-row-strategy" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {(r.strategy ?? []).slice(0, 6).map((line, idx) => (
          <div key={idx} style={{ fontSize: 14, fontWeight: 900 }}>
            {line}
          </div>
        ))}
        {/* Price details */}
        {r.prices && (
          <div className="arb-row-prices" style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 3 }}>
            <div className="muted" style={{ fontSize: 11, fontWeight: 700 }}>
              Poly: YES {formatCents(r.prices.polyYes)} · NO {formatCents(r.prices.polyNo)}
            </div>
            <div className="muted" style={{ fontSize: 11, fontWeight: 700 }}>
              Opinion: YES {formatCents(r.prices.opYes)} · NO {formatCents(r.prices.opNo)}
            </div>
          </div>
        )}
        {(r.strategy ?? []).length > 6 ? (
          <div className="muted" style={{ fontSize: 12, fontWeight: 800 }}>
            +{(r.strategy ?? []).length - 6} more…
          </div>
        ) : null}
      </div>

      {/* Expires col */}
      <div className="arb-row-expires" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: 16, fontWeight: 900, color: "rgba(233,238,245,0.85)" }}>
          {formatExpires(r.endDate)}
        </div>
      </div>

      {/* Arb col */}
      <div className="arb-row-arb" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center" }}>
        <div className="arb-row-pct-wrapper" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <div className="arb-row-pct" style={{ fontSize: 24, fontWeight: 1000, color: (r.arbPct ?? 0) > 0 ? "rgba(80,200,120,1)" : "rgba(233,238,245,0.85)" }}>{formatPct(r.arbPct)}</div>
          <div className="muted" style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>
            Spread
          </div>
        </div>
        {/* Calculator button */}
        <button
          type="button"
          onClick={onCalculatorClick}
          className="arb-calc-btn"
          aria-label="Open arbitrage calculator"
          style={{
            marginTop: 8,
            padding: "8px 14px",
            fontSize: 12,
            fontWeight: 700,
            background: "rgba(255,180,50,0.15)",
            border: "1px solid rgba(255,180,50,0.3)",
            borderRadius: 6,
            color: "rgba(255,180,50,1)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
          title="Calculate PNL"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="2" width="18" height="20" rx="3" fill="#FF9500"/>
            <rect x="5" y="4" width="14" height="5" rx="1" fill="#fff"/>
            <circle cx="7" cy="12" r="1.2" fill="#fff"/>
            <circle cx="12" cy="12" r="1.2" fill="#fff"/>
            <circle cx="17" cy="12" r="1.2" fill="#fff"/>
            <circle cx="7" cy="16" r="1.2" fill="#fff"/>
            <circle cx="12" cy="16" r="1.2" fill="#fff"/>
            <circle cx="17" cy="16" r="1.2" fill="#fff"/>
            <circle cx="7" cy="20" r="1.2" fill="#fff"/>
            <rect x="10.5" y="19" width="8" height="2.4" rx="1" fill="#fff"/>
          </svg>
          Calculate
        </button>
      </div>
    </div>
  );
}

function VenueLine({ logoSrc, label, url, isBonus }) {
  return (
    <a
      href={url || "#"}
      target="_blank"
      rel="noopener noreferrer"
      className="arb-venue-link"
      aria-label={`Open ${label} market`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        minWidth: 0,
        textDecoration: "none",
        opacity: url ? 1 : 0.5,
        pointerEvents: url ? "auto" : "none",
        padding: "4px 0",
        borderRadius: 6,
        transition: "background 0.15s ease",
      }}
      title={url || ""}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img 
        src={logoSrc} 
        alt="" 
        width={18}
        height={18}
        loading="lazy"
        decoding="async"
        style={{ width: 18, height: 18, borderRadius: 4, opacity: 0.95, flexShrink: 0 }} 
      />
      <span className="arb-venue-label" style={{ fontSize: 13, fontWeight: 800, color: "rgba(150,180,255,0.9)" }}>{label}</span>
      
      {/* External link icon box */}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 16,
          height: 16,
          borderRadius: 4,
          border: "1px solid rgba(180,195,214,0.3)",
          marginLeft: 2,
        }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          stroke="rgba(180,195,214,0.7)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4.5 2H2.5C1.95 2 1.5 2.45 1.5 3V9.5C1.5 10.05 1.95 10.5 2.5 10.5H9C9.55 10.5 10 10.05 10 9.5V7.5" />
          <path d="M7 1.5H10.5V5" />
          <path d="M10.5 1.5L5.5 6.5" />
        </svg>
      </span>

      {/* Bonus icon - only for Opinion with bonus */}
      {isBonus && (
        // eslint-disable-next-line @next/next/no-img-element
        <img 
          src="/gift_icon_24.svg" 
          alt="Bonus" 
          width={30}
          height={30}
          title="This market has bonus rewards"
          style={{ 
            width: 30, 
            height: 30, 
            marginLeft: 4,
          }} 
        />
      )}
    </a>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="panel"
          style={{
            padding: 12,
            display: "grid",
            gridTemplateColumns: "1.25fr 0.75fr 0.35fr",
            gap: 14,
            alignItems: "stretch",
          }}
        >
          <div style={{ display: "flex", gap: 12 }}>
            <div className="skeleton" style={{ width: 120, height: 78, borderRadius: 12 }} />
            <div style={{ flex: 1 }}>
              <div className="skeleton skeleton-text" style={{ width: "70%", height: 14, marginTop: 4 }} />
              <div className="skeleton skeleton-text" style={{ width: "40%", height: 12, marginTop: 10 }} />
              <div className="skeleton skeleton-text" style={{ width: "35%", height: 12, marginTop: 8 }} />
            </div>
          </div>
          <div>
            <div className="skeleton skeleton-text" style={{ width: "55%", height: 12, marginTop: 6 }} />
            <div className="skeleton skeleton-text" style={{ width: "45%", height: 12, marginTop: 10 }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center" }}>
            <div className="skeleton skeleton-text" style={{ width: 70, height: 20 }} />
            <div className="skeleton skeleton-text" style={{ width: 50, height: 12, marginTop: 8 }} />
          </div>
        </div>
      ))}
    </>
  );
}

function formatPct(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "--";
  return `${Number(x).toFixed(2)}%`;
}

function formatCents(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "--";
  return `${Number(x).toFixed(1)}¢`;
}

function formatExpires(dateStr) {
  if (!dateStr) return "—";
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "—";
    // Format: Jan 31, 2026
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function formatShares(x) {
  if (x === null || x === undefined || Number.isNaN(x) || x === 0) return "--";
  const num = Number(x);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toFixed(0);
}
