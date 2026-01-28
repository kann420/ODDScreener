"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import ArbCalculatorModal from "./ArbCalculatorModal";
import { getOptimizedImageUrl } from "@/components/OptimizedImage";

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
  
  // Track if user has ever scanned
  const [hasScanned, setHasScanned] = useState(false);
  
  // Calculator modal
  const [calculatorRow, setCalculatorRow] = useState(null); // Row to show in calculator
  
  // SSE streaming state
  const [progress, setProgress] = useState(null); // { phase, current, total, message }
  const [streamingRows, setStreamingRows] = useState([]); // Rows received while streaming
  const eventSourceRef = useRef(null);

  // Update "X ago" display every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => forceUpdate((n) => n + 1), 30000);
    return () => clearInterval(interval);
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
    } else {
      // No cache, wait for user to scan
      setRows([]);
      setLastScanTime(null);
      setInitialized(true);
      setHasScanned(false); // Reset hasScanned when switching to mode without cache
    }
  }, [priceMode]);

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

    const url = `/api/arbitage/stream?priceMode=${encodeURIComponent(priceMode)}&minArbPct=${encodeURIComponent(minArbPct)}&limit=100`;
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
  }, [priceMode, minArbPct]);

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
    
    // Sort based on sortField
    if (sortField === "endDate") {
      arr.sort((a, b) => {
        const dateA = a.endDate ? new Date(a.endDate).getTime() : Infinity;
        const dateB = b.endDate ? new Date(b.endDate).getTime() : Infinity;
        return sortAsc ? dateA - dateB : dateB - dateA;
      });
    } else {
      arr.sort((a, b) => sortAsc 
        ? (a.arbPct ?? 0) - (b.arbPct ?? 0) 
        : (b.arbPct ?? 0) - (a.arbPct ?? 0)
      );
    }
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

  // Progress bar percentage
  const progressPct = progress?.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header */}
      <div className="panel" style={{ padding: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 900 }}>Arbitrage</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
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

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {/* Filter toggle */}
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className="btn ghost"
              style={{
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 800,
                background: showFilters ? "rgba(255,180,50,0.15)" : "transparent",
                border: showFilters ? "1px solid rgba(255,180,50,0.4)" : "1px solid rgba(255,255,255,0.1)",
              }}
            >
              ⚙️ Filters
            </button>
            {/* Price Mode Toggle */}
            <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: 3 }}>
              <button
                type="button"
                onClick={() => setPriceMode("bids")}
                style={{
                  padding: "6px 12px",
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
                style={{
                  padding: "6px 12px",
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
            <div className="pill">
              Min Arb: <b>{minArbPct.toFixed(2)}%</b>
              {minShares > 0 && <> • Min: <b>{minShares}</b> shares</>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
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
            marginTop: 14, 
            padding: 14, 
            background: "rgba(255,255,255,0.03)", 
            borderRadius: 10, 
            border: "1px solid rgba(255,255,255,0.08)" 
          }}>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
              {/* Min Arb % */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 11, fontWeight: 800, color: "rgba(233,238,245,0.6)" }}>
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
                    height: 36,
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
                <label style={{ fontSize: 11, fontWeight: 800, color: "rgba(233,238,245,0.6)" }}>
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
                    height: 36,
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

      {/* Table Header */}
      <div
        className="panel"
        style={{
          padding: "10px 12px",
          display: "grid",
          gridTemplateColumns: "1.25fr 0.65fr 0.35fr 0.35fr",
          gap: 14,
          alignItems: "center",
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
          Expires {sortField === "endDate" ? (sortAsc ? "↑" : "↓") : "↕"}
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
          Arbitrage {sortField === "arbPct" ? (sortAsc ? "↑" : "↓") : "↕"}
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
      ) : sorted.length === 0 && !loading ? (
        <div className="panel" style={{ padding: 14 }}>
          <div className="muted" style={{ fontSize: 13, fontWeight: 800 }}>
            No arbitrage opportunities ≥ {minArbPct.toFixed(2)}% found.
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Try checking back later, adjust filters, or switch between Bids/Asks mode.
          </div>
        </div>
      ) : (
        <>
          {sorted.map((r) => (
            <Row 
              key={r.id} 
              r={r} 
              priceMode={priceMode}
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

function Row({ r, priceMode, onCalculatorClick }) {
  return (
    <div
      className="panel"
      style={{
        padding: 12,
        display: "grid",
        gridTemplateColumns: "1.25fr 0.65fr 0.35fr 0.35fr",
        gap: 14,
        alignItems: "stretch",
      }}
    >
      {/* Title col */}
      <div style={{ display: "flex", gap: 12, minWidth: 0 }}>
        {/* Image (Opinion) */}
        <div style={{ width: 120, flex: "0 0 auto" }}>
          <div
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
        <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 900, lineHeight: 1.2 }} title={r.parentTitle ? `${r.parentTitle} - ${r.outcome || r.title}` : (r.title || r.opinionTitle || r.polyTitle)}>
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

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <VenueLine logoSrc="/polymarket_600.svg" label="Polymarket" url={r.poly?.url} />
            <VenueLine logoSrc="/logo-opinion.svg" label="Opinion" url={r.opinion?.url} />
          </div>
        </div>
      </div>

      {/* Strat col */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {(r.strategy ?? []).slice(0, 6).map((line, idx) => (
          <div key={idx} style={{ fontSize: 14, fontWeight: 900 }}>
            {line}
          </div>
        ))}
        {/* Price details */}
        {r.prices && (
          <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 3 }}>
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
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: 16, fontWeight: 900, color: "rgba(233,238,245,0.85)" }}>
          {formatExpires(r.endDate)}
        </div>
      </div>

      {/* Arb col */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center" }}>
        <div style={{ fontSize: 24, fontWeight: 1000 }}>{formatPct(r.arbPct)}</div>
        <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginTop: 4 }}>
          Spread
        </div>
        {/* Calculator button */}
        <button
          type="button"
          onClick={onCalculatorClick}
          style={{
            marginTop: 8,
            padding: "6px 12px",
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

function VenueLine({ logoSrc, label, url }) {
  return (
    <a
      href={url || "#"}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        minWidth: 0,
        textDecoration: "none",
        opacity: url ? 1 : 0.5,
        pointerEvents: url ? "auto" : "none",
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
        style={{ width: 18, height: 18, borderRadius: 4, opacity: 0.95 }} 
      />
      <span style={{ fontSize: 13, fontWeight: 900, color: "rgba(233,238,245,0.92)" }}>{label}</span>
      
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
