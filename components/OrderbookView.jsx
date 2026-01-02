"use client";

import ChartViewV2 from "./ChartViewV2";
import { useEffect, useMemo, useRef, useState } from "react";

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
      {Array.from({ length: 5 }).map((_, i) => (
        <SkeletonOrderbookRow key={`ask-skel-${i}`} />
      ))}
      <tr>
        <td colSpan={3} style={{ padding: "8px 0", borderTop: "1px solid rgba(255,255,255,0.1)", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="muted" style={{ fontSize: 12 }}>Spread: </span>
            <div className="skeleton skeleton-text" style={{ width: 40 }} />
          </div>
        </td>
      </tr>
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

function buildAsksDepth(rows) {
  if (!rows?.length) return [];
  const sorted = [...rows].sort((a, b) => b.price - a.price);
  const result = new Array(sorted.length);
  let cumShares = 0, cumTotal = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    cumShares += sorted[i].shares;
    cumTotal += sorted[i].total;
    result[i] = { ...sorted[i], cumShares, cumTotal };
  }
  return result;
}

function buildBidsDepth(rows) {
  if (!rows?.length) return [];
  const sorted = [...rows].sort((a, b) => b.price - a.price);
  let cumShares = 0, cumTotal = 0;
  return sorted.map((r) => {
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

async function prefetchOrderbookToken(tokenId) {
  if (!tokenId) return;
  const key = `ob:${tokenId}`;

  const cached = cacheGetEntry(key, 30_000);
  if (cached) return;

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

  const volume24h = marketData.volume24h || marketData.volume_24h || marketData.dayVolume || null;
  const totalVolume = marketData.totalVolume || marketData.total_volume || marketData.volume || null;
  const openInterest = marketData.openInterest || marketData.open_interest || null;
  const rules = marketData.rules || marketData.description || marketData.marketRules || null;
  const expiresAt = marketData.expiresAt || marketData.expires_at || marketData.endDate || marketData.end_date || null;

  const [showRules, setShowRules] = useState(false);

  const abortRef = useRef(null);
  const asksScrollRef = useRef(null);
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
  }, [tokenId]);

  useEffect(() => {
    if (!otherTokenId) return;
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

  const bidsD = useMemo(() => buildBidsDepth(bids), [bids]);
  const asksD = useMemo(() => buildAsksDepth(asks), [asks]);

  useEffect(() => {
    if (asksScrollRef.current && asksD.length > 0) {
      asksScrollRef.current.scrollTop = asksScrollRef.current.scrollHeight;
    }
  }, [asksD, outcome]);

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
      <div className="panel" style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Market #{marketId}</div>
            <div style={{ fontWeight: 900, fontSize: 16, display: "flex", alignItems: "center", gap: 12 }}>
              {title || "Market"}
              <a 
                href={`https://app.opinion.trade/detail?topicId=${marketId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn"
                style={{ fontSize: 11, padding: "6px 12px", display: "flex", alignItems: "center", gap: 6 }}
              >
                <img src="/opinion-logo.svg" alt="Opinion" width="16" height="16" />
                View on Opinion
              </a>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="tag"><span className="dot"></span>LIVE</span>
          </div>
        </div>

        <div style={{ 
          display: "flex", 
          alignItems: "center", 
          gap: 24, 
          marginTop: 14, 
          flexWrap: "wrap",
          fontSize: 12 
        }}>
          <div>
            <div className="muted" style={{ fontSize: 10, marginBottom: 2 }}>Chance</div>
            <div style={{ fontWeight: 700, color: "#fff" }}>{mid ? (mid * 100).toFixed(1) + "%" : "-"}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 10, marginBottom: 2 }}>Expires</div>
            <div style={{ fontWeight: 700 }}>{expiresAt ? new Date(expiresAt).toLocaleDateString() : "-"}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 10, marginBottom: 2 }}>24h Change</div>
            <div style={{ fontWeight: 700 }}>-</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 10, marginBottom: 2 }}>24h Volume</div>
            <div style={{ fontWeight: 700, color: "#fff" }}>{volume24h ? `$${fmtQty(volume24h)}` : "-"}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 10, marginBottom: 2 }}>Total Volume</div>
            <div style={{ fontWeight: 700, color: "#fff" }}>{totalVolume ? `$${fmtQty(totalVolume)}` : "-"}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 10, marginBottom: 2 }}>Open Interest</div>
            <div style={{ fontWeight: 700 }}>{openInterest ? `$${fmtQty(openInterest)}` : "-"}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 10, marginBottom: 2 }}>Volatility</div>
            <div style={{ fontWeight: 700 }}>-</div>
          </div>
          <div style={{ marginLeft: "auto" }}>
            <button 
              className="btn" 
              style={{ fontSize: 11, padding: "6px 12px", display: "flex", alignItems: "center", gap: 6 }}
              onClick={() => setShowRules(!showRules)}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14,2 14,8 20,8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10,9 9,9 8,9" />
              </svg>
              Rules
            </button>
          </div>
        </div>

        {showRules && rules && (
          <div style={{ 
            marginTop: 12, 
            padding: 12, 
            background: "rgba(255,255,255,0.03)", 
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.08)",
            fontSize: 12,
            lineHeight: 1.6,
            color: "rgba(255,255,255,0.8)"
          }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Market Rules</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{rules}</div>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 12 }}>
        <div className="col" style={{ gap: 12 }}>
          <ChartViewV2 
            key={yesTokenId} 
            tokenId={yesTokenId} 
            outcome={outcome}
            mid={mid} 
            selectedCents={selectedCents} 
            onOutcomeChange={setOutcome}
          />

          <div className="panel" style={{ marginTop: 0 }}>
            <div className="tabs">
              <div className="tab active">Trades</div>
              <div className="tab">Top Traders</div>
              <div className="tab">Holders</div>
            </div>
            <div style={{ padding: 20, textAlign: "center" }}>
              <div className="muted" style={{ fontSize: 12 }}>-</div>
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Coming soon</div>
            </div>
          </div>
        </div>

        <div className="panel" style={{ padding: 10, height: "fit-content" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontWeight: 900, fontSize: 13 }}>Order Book</div>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                onClick={() => setOutcome("YES")}
                style={{
                  padding: "6px 14px",
                  fontSize: 12,
                  fontWeight: 700,
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  background: outcome === "YES" ? "#22d3ee" : "rgba(255,255,255,0.08)",
                  color: outcome === "YES" ? "#0a0a0a" : "rgba(255,255,255,0.6)",
                  transition: "all 0.15s ease"
                }}
              >
                YES
              </button>
              <button
                onClick={() => setOutcome("NO")}
                style={{
                  padding: "6px 14px",
                  fontSize: 12,
                  fontWeight: 700,
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  background: outcome === "NO" ? "#a855f7" : "rgba(255,255,255,0.08)",
                  color: outcome === "NO" ? "#fff" : "rgba(255,255,255,0.6)",
                  transition: "all 0.15s ease"
                }}
              >
                NO
              </button>
            </div>
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: "74px 1fr 1fr",
            gap: 10,
            marginTop: 10,
            fontSize: 11,
            color: "rgba(148,163,184,0.95)",
            fontWeight: 800
          }}>
            <div>PRICE</div>
            <div>SHARES</div>
            <div style={{ textAlign: "right" }}>TOTAL</div>
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span className="pill" style={{ color: "#fff", background: "rgba(239,68,68,0.18)" }}>Asks ({outcome})</span>
            </div>
            <div ref={asksScrollRef} style={{ maxHeight: 5 * 56, overflowY: "auto", paddingRight: 6 }}>
              {loading && asks.length === 0 ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} style={{ marginTop: 6 }}>
                    <div className="skeleton" style={{ height: 44, borderRadius: 10 }} />
                  </div>
                ))
              ) : asksD.length === 0 ? (
                <div className="muted" style={{ padding: 10, fontSize: 12 }}>No asks</div>
              ) : (
                asksD.map((r, i) => {
                  const maxCum = Math.max(1, ...asksD.map(x => x.cumTotal));
                  const pct = Math.max(0, Math.min(100, (r.cumTotal / maxCum) * 100));
                  return (
                    <div key={`ask-${i}`} style={{ position: "relative", overflow: "hidden", marginTop: 6 }}>
                      <div style={{
                        position: "absolute",
                        left: 0, top: 0, bottom: 0,
                        width: `${pct}%`,
                        background: "rgba(239,68,68,0.26)"
                      }} />
                      <div style={{
                        position: "relative",
                        display: "grid",
                        gridTemplateColumns: "74px 1fr 1fr",
                        gap: 10,
                        alignItems: "center",
                        padding: "10px 10px",
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.06)",
                        background: "rgba(255,255,255,0.02)"
                      }}>
                        <div className="red" style={{ fontWeight: 900 }}>{(r.price * 100).toFixed(1)}¢</div>
                        <div className="mono muted">{fmtQty(r.shares)}</div>
                        <div className="mono" style={{ textAlign: "right" }}>${fmtQty(r.total)}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div style={{
            marginTop: 12,
            padding: "10px 10px",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            justifyContent: "space-between",
            color: "rgba(148,163,184,0.95)",
            fontSize: 12,
            fontWeight: 800
          }}>
            <div>Last: <span className="mono" style={{ color: "#e9eef5" }}>{bids[0] ? (bids[0].price * 100).toFixed(1).replace(/\.0$/, "") + "¢" : "-"}</span></div>
            <div>Spread: <span className="mono" style={{ color: "#e9eef5" }}>{bids[0] && asks[0] ? ((asks[0].price - bids[0].price) * 100).toFixed(1).replace(/\.0$/, "") + "¢" : "-"}</span></div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span className="pill" style={{ color: "#fff", background: "rgba(34,197,94,0.18)" }}>Bids ({outcome})</span>
            </div>
            <div style={{ maxHeight: 5 * 56, overflowY: "auto", paddingRight: 6 }}>
              {loading && bids.length === 0 ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} style={{ marginTop: 6 }}>
                    <div className="skeleton" style={{ height: 44, borderRadius: 10 }} />
                  </div>
                ))
              ) : bidsD.length === 0 ? (
                <div className="muted" style={{ padding: 10, fontSize: 12 }}>No bids</div>
              ) : (
                bidsD.map((r, i) => {
                  const maxCum = Math.max(1, ...bidsD.map(x => x.cumTotal));
                  const pct = Math.max(0, Math.min(100, (r.cumTotal / maxCum) * 100));
                  return (
                    <div key={`bid-${i}`} style={{ position: "relative", overflow: "hidden", marginTop: 6 }}>
                      <div style={{
                        position: "absolute",
                        left: 0, top: 0, bottom: 0,
                        width: `${pct}%`,
                        background: "rgba(34,197,94,0.22)"
                      }} />
                      <div style={{
                        position: "relative",
                        display: "grid",
                        gridTemplateColumns: "74px 1fr 1fr",
                        gap: 10,
                        alignItems: "center",
                        padding: "10px 10px",
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.06)",
                        background: "rgba(255,255,255,0.02)"
                      }}>
                        <div className="green" style={{ fontWeight: 900 }}>{(r.price * 100).toFixed(1)}¢</div>
                        <div className="mono muted">{fmtQty(r.shares)}</div>
                        <div className="mono" style={{ textAlign: "right" }}>${fmtQty(r.total)}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
