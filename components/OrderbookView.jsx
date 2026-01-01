"use client";

import ChartViewV2 from "./ChartViewV2";
import { useEffect, useMemo, useRef, useState } from "react";

// Skeleton components for loading states
function SkeletonOrderbookRow() {
  return (
    <tr>
      <td><div className="skeleton skeleton-text" style={{ width: 60 }} /></td>
      <td><div className="skeleton skeleton-text" style={{ width: 80 }} /></td>
      <td><div className="skeleton skeleton-text" style={{ width: 70 }} /></td>
    </tr>
  );
}

function SkeletonOrderbook() {
  return (
    <>
      {/* Skeleton asks */}
      {Array.from({ length: 5 }).map((_, i) => (
        <SkeletonOrderbookRow key={`ask-skel-${i}`} />
      ))}
      {/* Spread row skeleton */}
      <tr>
        <td colSpan={3} style={{ padding: "8px 0", borderTop: "1px solid rgba(255,255,255,0.1)", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="muted" style={{ fontSize: 12 }}>Spread: </span>
            <div className="skeleton skeleton-text" style={{ width: 40 }} />
          </div>
        </td>
      </tr>
      {/* Skeleton bids */}
      {Array.from({ length: 5 }).map((_, i) => (
        <SkeletonOrderbookRow key={`bid-skel-${i}`} />
      ))}
    </>
  );
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtQty(v) {
  const n = num(v);
  if (n === 0) return "0";
  const isWholeNumber = n === Math.floor(n);
  return n.toLocaleString('en-US', {
    minimumFractionDigits: isWholeNumber ? 0 : 2,
    maximumFractionDigits: 2
  });
}

function fmtCents(v) {
  const n = num(v);
  if (!Number.isFinite(n)) return "-";
  const cents = n * 100;
  const s = cents.toFixed(1).replace(/\.0$/, "");
  return `${s}¢`;
}

function shortToken(t) {
  if (!t) return "-";
  const s = String(t);
  if (s.length <= 18) return s;
  return `${s.slice(0, 10)}…${s.slice(-6)}`;
}

function buildDepth(rows) {
  let cumShares = 0;
  let cumTotal = 0;
  return rows.map((r) => {
    cumShares += r.shares;
    cumTotal += r.total;
    return { ...r, cumShares, cumTotal };
  });
}

function normalizeOrderbook(raw) {
  const root = raw?.result ?? raw ?? {};
  const rawBids = root?.bids ?? root?.buy ?? root?.bid ?? root?.b ?? [];
  const rawAsks = root?.asks ?? root?.sell ?? root?.ask ?? root?.a ?? [];

  const coerceLevel = (row) => {
    if (Array.isArray(row) && row.length >= 2) {
      const a = num(row[0]);
      const b = num(row[1]);

      const aLooksLikePrice = a >= 0 && a <= 1;
      const bLooksLikePrice = b >= 0 && b <= 1;

      let price = a;
      let shares = b;

      if (!aLooksLikePrice && bLooksLikePrice) {
        price = b;
        shares = a;
      }
      return { price: num(price), shares: num(shares) };
    }

    if (row && typeof row === "object") {
      const price =
        row?.price ?? row?.p ?? row?.rate ?? row?.value ?? row?.px ?? row?.y ?? row?.x ?? 0;
      const shares =
        row?.shares ?? row?.s ?? row?.size ?? row?.amount ?? row?.qty ?? row?.q ?? 0;
      return { price: num(price), shares: num(shares) };
    }

    return { price: 0, shares: 0 };
  };

  const mapSide = (arr) =>
    (Array.isArray(arr) ? arr : []).map((row) => {
      const { price, shares } = coerceLevel(row);
      const total = shares * price;
      return { price, shares, total };
    });

  let bids = mapSide(rawBids);
  let asks = mapSide(rawAsks);

  bids.sort((a, b) => b.price - a.price);
  asks.sort((a, b) => a.price - b.price);

  return { bids, asks };
}

function samePrice(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) < 1e-9;
}

/**
 * -------------------------------------------------------
 * Client cache (30s) + in-flight dedupe (global)
 * -------------------------------------------------------
 */
const __CACHE__ =
  globalThis.__ODD_CLIENT_CACHE__ ?? (globalThis.__ODD_CLIENT_CACHE__ = new Map());
const __INFLIGHT__ =
  globalThis.__ODD_CLIENT_INFLIGHT__ ?? (globalThis.__ODD_CLIENT_INFLIGHT__ = new Map());

function cacheGetEntry(key, ttlMs) {
  const hit = __CACHE__.get(key);
  if (!hit) return null;
  if (!ttlMs) return hit;
  if (Date.now() - hit.t > ttlMs) return null;
  return hit;
}
function cacheSet(key, v) {
  __CACHE__.set(key, { t: Date.now(), v });
}

/**
 * Prefetch helpers (A3.2)
 * - Warm cache for the OTHER outcome tokenId
 * - No setState here, only cache fill
 */
async function prefetchOrderbookToken(tokenId) {
  if (!tokenId) return;
  const key = `ob:${tokenId}`;

  // If cached fresh, skip
  const cached = cacheGetEntry(key, 30_000);
  if (cached) return;

  // In-flight dedupe
  if (__INFLIGHT__.has(key)) return;

  const p = (async () => {
    try {
      const res = await fetch(
        `/api/opinion/token/orderbook?token_id=${encodeURIComponent(tokenId)}`,
        { cache: "no-store" }
      );
      const j = await res.json();
      if (j?.errno !== 0) return;
      const ob = normalizeOrderbook(j?.result ?? j);
      cacheSet(key, ob);
    } catch {
      // ignore prefetch errors
    } finally {
      __INFLIGHT__.delete(key);
    }
  })();

  __INFLIGHT__.set(key, p);
}

async function prefetchHistoryToken(tokenId, interval = "1d") {
  if (!tokenId) return;
  const key = `ph:${tokenId}:${interval}`;

  const cached = cacheGetEntry(key, 30_000);
  if (cached) return;

  if (__INFLIGHT__.has(key)) return;

  const p = (async () => {
    try {
      const res = await fetch(
        `/api/opinion/token/price-history?token_id=${encodeURIComponent(tokenId)}&interval=${encodeURIComponent(interval)}`,
        { cache: "no-store" }
      );
      const j = await res.json();
      if (j?.errno !== 0) return;

      // Normalize to [{t,p}] same as ChartView expects
      const raw = j?.result ?? j;
      const rows = raw?.prices ?? raw?.history ?? raw?.data ?? raw ?? [];

      const out = (Array.isArray(rows) ? rows : [])
        .map((r) => {
          if (Array.isArray(r) && r.length >= 2) {
            const t = Number(r[0]);
            const p = Number(r[1]);
            return { t: t > 1e12 ? t : t * 1000, p };
          }
          if (r && typeof r === "object") {
            const tRaw = r.t ?? r.time ?? r.ts ?? r.timestamp ?? r.date ?? 0;
            const pRaw = r.p ?? r.price ?? r.value ?? r.y ?? 0;
            const tNum = Number(tRaw);
            const t = tNum > 1e12 ? tNum : tNum * 1000;
            const p = Number(pRaw);
            return { t, p };
          }
          return null;
        })
        .filter(Boolean)
        .sort((a, b) => a.t - b.t);

      cacheSet(key, out);
    } catch {
      // ignore prefetch errors
    } finally {
      __INFLIGHT__.delete(key);
    }
  })();

  __INFLIGHT__.set(key, p);
}

// Format helpers for market info
function fmtPercent(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  const pct = n * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function fmtUsdCompact(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  });
}

function fmtChance(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  const pct = Math.max(0, Math.min(100, n * 100));
  return `${pct.toFixed(1).replace(/\.0$/, "")}%`;
}

function fmtDate(v) {
  if (!v) return "-";
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "-";
  }
}

export default function OrderbookView({ marketId, title, yesTokenId, noTokenId, marketData = {} }) {
  const [outcome, setOutcome] = useState(yesTokenId ? "YES" : "NO");
  const tokenId = outcome === "YES" ? yesTokenId : noTokenId;

  const otherTokenId = outcome === "YES" ? noTokenId : yesTokenId;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bids, setBids] = useState([]);
  const [asks, setAsks] = useState([]);

  const [selectedPrice, setSelectedPrice] = useState(null);
  const [selectedSide, setSelectedSide] = useState(null);

  const abortRef = useRef(null);

  // Prevent re-applying same cached data every poll tick
  const appliedCacheAtRef = useRef(0);

  async function load({ silent = false } = {}) {
    if (!tokenId) return;

    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const key = `ob:${tokenId}`;

    const cachedEntry = cacheGetEntry(key, 30_000);
    if (cachedEntry) {
      if (cachedEntry.t > appliedCacheAtRef.current) {
        appliedCacheAtRef.current = cachedEntry.t;
        if (!silent) setLoading(false);
        setError("");
        setBids(cachedEntry.v?.bids || []);
        setAsks(cachedEntry.v?.asks || []);
      }
      return;
    }

    if (!silent) {
      setLoading(true);
      setError("");
    }

    if (__INFLIGHT__.has(key)) {
      try {
        const data = await __INFLIGHT__.get(key);
        setBids(data?.bids || []);
        setAsks(data?.asks || []);
        setError("");
        setLoading(false);
      } catch (e) {
        // Ignore abort errors - keep showing loading state
        if (e?.name === 'AbortError' || String(e?.message || '').toLowerCase().includes('abort')) return;
        setError(String(e?.message || e));
        setBids([]);
        setAsks([]);
        setLoading(false);
      }
      return;
    }

    const p = (async () => {
      const res = await fetch(
        `/api/opinion/token/orderbook?token_id=${encodeURIComponent(tokenId)}`,
        { cache: "no-store", signal: ac.signal }
      );
      const j = await res.json();
      if (j?.errno !== 0) throw new Error(j?.errormsg || "orderbook_failed");
      const ob = normalizeOrderbook(j?.result ?? j);
      cacheSet(key, ob);
      return ob;
    })();

    __INFLIGHT__.set(key, p);

    try {
      const ob = await p;
      setBids(ob?.bids || []);
      setAsks(ob?.asks || []);
      setError("");
      setLoading(false);
    } catch (e) {
      if (String(e?.name || "").toLowerCase().includes("abort")) return;
      setError(String(e?.message || e));
      setBids([]);
      setAsks([]);
      setLoading(false);
    } finally {
      __INFLIGHT__.delete(key);
    }
  }

  // Poll (pause when tab hidden)
  useEffect(() => {
    let t = null;

    const tick = () => {
      if (document.visibilityState !== "visible") return;
      load({ silent: true });
    };

    load();
    t = setInterval(tick, 5000);

    const onVis = () => {
      if (document.visibilityState === "visible") load({ silent: true });
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      if (t) clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      if (abortRef.current) abortRef.current.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenId]);

  // A3.2: Prefetch other outcome (orderbook + history) whenever token changes
  useEffect(() => {
    if (!otherTokenId) return;
    // Warm cache for instant outcome switch
    prefetchOrderbookToken(otherTokenId);
    prefetchHistoryToken(otherTokenId, "1d");
  }, [otherTokenId]);

  useEffect(() => {
    setSelectedPrice(null);
    setSelectedSide(null);
    appliedCacheAtRef.current = 0;
  }, [tokenId]);

  const mid = useMemo(() => {
    const bestBid = bids?.[0]?.price;
    const bestAsk = asks?.[0]?.price;
    if (bestBid && bestAsk) return (bestBid + bestAsk) / 2;
    if (bestBid) return bestBid;
    if (bestAsk) return bestAsk;
    return 0;
  }, [bids, asks]);

  const bidsD = useMemo(() => buildDepth(bids), [bids]);
  const asksD = useMemo(() => buildDepth(asks), [asks]);

  const maxBidDepth = useMemo(() => Math.max(1, ...bidsD.map((r) => r.cumTotal)), [bidsD]);
  const maxAskDepth = useMemo(() => Math.max(1, ...asksD.map((r) => r.cumTotal)), [asksD]);

  const copyToken = async () => {
    if (!tokenId) return;
    try {
      await navigator.clipboard.writeText(String(tokenId));
    } catch {}
  };

  const onPick = (side, price) => {
    if (!Number.isFinite(price) || price <= 0) return;
    setSelectedSide(side);
    setSelectedPrice(price);
  };

  const clearPick = () => {
    setSelectedSide(null);
    setSelectedPrice(null);
  };

  const selectedCents = Number.isFinite(selectedPrice) ? selectedPrice * 100 : null;

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="panel" style={{ padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Market #{marketId}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
              <div style={{ fontWeight: 900, fontSize: 16 }}>{title || "Market"}</div>
              <a
                href={`https://app.opinion.trade/detail?topicId=${marketId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn ghost"
                style={{ 
                  display: "inline-flex", 
                  alignItems: "center", 
                  gap: 6, 
                  padding: "4px 10px",
                  fontSize: 12,
                  textDecoration: "none"
                }}
              >
                <img src="/opinion-logo.svg" alt="Opinion" width="16" height="16" style={{ borderRadius: "50%" }} />
                View on Opinion
              </a>
            </div>

            {/* Market Info Bar */}
            <div style={{ 
              display: "flex", 
              gap: 24, 
              marginTop: 12, 
              flexWrap: "wrap",
              fontSize: 13
            }}>
              <div>
                <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>Chance</div>
                <div className="mono" style={{ fontWeight: 600 }}>
                  {loading && mid === 0 ? (
                    <div className="skeleton" style={{ width: 45, height: 16, borderRadius: 4 }} />
                  ) : (
                    fmtChance(mid)
                  )}
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>Expires</div>
                <div className="mono">{fmtDate(marketData?.endDate || marketData?.end_date || marketData?.expiresAt || marketData?.expires_at)}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>24h Change</div>
                <div className="mono" style={{ 
                  color: Number(marketData?.change24h || marketData?.priceChange24h || 0) >= 0 ? "#4ade80" : "#f87171" 
                }}>
                  {fmtPercent(marketData?.change24h || marketData?.priceChange24h || marketData?.price_change_24h)}
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>24h Volume</div>
                <div className="mono">{fmtUsdCompact(marketData?.volume24h || marketData?.vol24h || marketData?.volume_24h)}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>Total Volume</div>
                <div className="mono">{fmtUsdCompact(marketData?.volume || marketData?.volumeTotal || marketData?.volume_total)}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>Open Interest</div>
                <div className="mono">{fmtUsdCompact(marketData?.openInterest || marketData?.open_interest || marketData?.oi)}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>Volatility</div>
                <div className="mono">{fmtPercent(marketData?.volatility || marketData?.vol)}</div>
              </div>

              {/* Rules tooltip */}
              {(marketData?.rules || marketData?.rule || marketData?.description || marketData?.marketDescription || marketData?.market_description) && (
                <div style={{ position: "relative" }} className="rules-tooltip-container">
                  <div 
                    className="btn ghost rules-trigger"
                    style={{ 
                      padding: "4px 10px", 
                      fontSize: 12, 
                      display: "flex", 
                      alignItems: "center", 
                      gap: 4,
                      cursor: "pointer"
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <line x1="16" y1="13" x2="8" y2="13"/>
                      <line x1="16" y1="17" x2="8" y2="17"/>
                      <polyline points="10 9 9 9 8 9"/>
                    </svg>
                    Rules
                  </div>
                  <div 
                    className="rules-tooltip"
                    style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      right: 0,
                      width: 320,
                      maxHeight: 300,
                      overflowY: "auto",
                      background: "#1a1a2e",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 8,
                      padding: 14,
                      zIndex: 1000,
                      boxShadow: "0 4px 20px rgba(0,0,0,0.5)"
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                      </svg>
                      Market Rules
                    </div>
                    <div style={{ fontSize: 12, lineHeight: 1.6, color: "rgba(255,255,255,0.85)", whiteSpace: "pre-wrap" }}>
                      {marketData?.rules || marketData?.rule || marketData?.description || marketData?.marketDescription || marketData?.market_description}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <a className="btn" href="/">← Back</a>

            <button className="btn ghost" onClick={() => load()} disabled={!tokenId}>
              Refresh
            </button>
          </div>
        </div>
      </div>

      <ChartViewV2 
        key={yesTokenId} 
        tokenId={yesTokenId} 
        outcome={outcome}
        mid={mid} 
        selectedCents={selectedCents} 
        onOutcomeChange={setOutcome}
      />

      {error ? (
        <div className="panel" style={{ padding: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Orderbook</div>
          <div className="mono" style={{ fontSize: 12 }}>{error}</div>
        </div>
      ) : null}

      <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: 12, fontWeight: 900, display: "flex", alignItems: "center", gap: 8 }}>
          Order Book
          {loading && <div className="skeleton" style={{ width: 60, height: 14, borderRadius: 4 }} />}
        </div>
        <div style={{ padding: "0 12px 12px" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 120 }}>Price</th>
                <th style={{ width: 140 }}>Size</th>
                <th>Total (USDT)</th>
              </tr>
            </thead>
            <tbody>
              {/* Show skeleton when loading and no data yet */}
              {loading && bids.length === 0 && asks.length === 0 ? (
                <SkeletonOrderbook />
              ) : (
                <>
              {/* ASKS - reversed so highest price at top, lowest near spread */}
              {asksD.length === 0 ? (
                <tr>
                  <td className="muted" colSpan={3}>No asks</td>
                </tr>
              ) : (
                [...asksD].reverse().map((r, i) => {
                  const pct = Math.min(1, r.cumTotal / maxAskDepth);
                  const bg = `linear-gradient(to right, rgba(239, 68, 68, 0.18) ${pct * 100}%, rgba(0,0,0,0) ${pct * 100}%)`;
                  const isSel = selectedSide === "ASK" && samePrice(selectedPrice, r.price);

                  return (
                    <tr
                      key={`ask-${i}`}
                      style={{
                        background: bg,
                        cursor: "pointer",
                        outline: isSel ? "1px solid rgba(255,255,255,0.45)" : "none",
                        boxShadow: isSel ? "inset 0 0 0 999px rgba(255,255,255,0.06)" : "none",
                      }}
                      title="Click to select this price"
                      onClick={() => onPick("ASK", r.price)}
                    >
                      <td className="mono">{fmtCents(r.price)}</td>
                      <td className="mono">{fmtQty(r.shares)}</td>
                      <td className="mono">{fmtQty(r.cumShares)}</td>
                    </tr>
                  );
                })
              )}

              {/* Separator between Asks and Bids */}
              <tr>
                <td colSpan={3} style={{ padding: "8px 0", borderTop: "1px solid rgba(255,255,255,0.1)", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                  <div style={{ fontSize: 12 }}>
                    <span className="muted">Spread: </span>
                    <span className="mono">{bids[0] && asks[0] ? fmtCents(asks[0].price - bids[0].price) : "-"}</span>
                  </div>
                </td>
              </tr>

              {/* BIDS - highest price at top (near spread), decreasing down */}
              {bidsD.length === 0 ? (
                <tr>
                  <td className="muted" colSpan={3}>No bids</td>
                </tr>
              ) : (
                bidsD.map((r, i) => {
                  const pct = Math.min(1, r.cumTotal / maxBidDepth);
                  const bg = `linear-gradient(to right, rgba(16, 185, 129, 0.20) ${pct * 100}%, rgba(0,0,0,0) ${pct * 100}%)`;
                  const isSel = selectedSide === "BID" && samePrice(selectedPrice, r.price);

                  return (
                    <tr
                      key={`bid-${i}`}
                      style={{
                        background: bg,
                        cursor: "pointer",
                        outline: isSel ? "1px solid rgba(255,255,255,0.45)" : "none",
                        boxShadow: isSel ? "inset 0 0 0 999px rgba(255,255,255,0.06)" : "none",
                      }}
                      title="Click to select this price"
                      onClick={() => onPick("BID", r.price)}
                    >
                      <td className="mono">{fmtCents(r.price)}</td>
                      <td className="mono">{fmtQty(r.shares)}</td>
                      <td className="mono">{fmtQty(r.cumShares)}</td>
                    </tr>
                  );
                })
              )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="muted" style={{ fontSize: 12, paddingLeft: 2 }}>
      </div>
    </div>
  );
}
