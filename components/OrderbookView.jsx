"use client";

import ChartViewV2 from "./ChartViewV2";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMarketTrades } from "@/components/hooks/useMarketTrades";
import { getOptimizedImageUrl } from "@/components/OptimizedImage";

/* =========================
   NEW: Thumbnail (Detail)
   - Fixed size box so it never misaligns
   - Uses marketData.thumbnailUrl / coverUrl
   - Optimized via wsrv.nl (WebP, resize)
========================= */
function MarketThumbnailDetail({ url, size = 100, radius = 14 }) {
  const [errored, setErrored] = useState(false);
  const showImg = Boolean(url) && !errored;

  // Optimize external images via wsrv.nl (2x for retina)
  const optimizedUrl = useMemo(() => {
    if (!url || errored) return null;
    return getOptimizedImageUrl(url, size * 2, 85);
  }, [url, size, errored]);

  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        overflow: "hidden",
        background: "rgba(255,255,255,0.08)",
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {showImg && optimizedUrl ? (
        <img
          src={optimizedUrl}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
          onError={() => setErrored(true)}
        />
      ) : null}
    </div>
  );
}

/* =========================
   Esport Stream Link Helper
   - Extracts tournament name from market title
   - Maps to Twitch stream URL
========================= */
const TOURNAMENT_TWITCH_MAP = {
  pgl:         "https://www.twitch.tv/pgl",
  lec:         "https://www.twitch.tv/lec",
  lck:         "https://www.twitch.tv/lck",
  lcs:         "https://www.twitch.tv/lcs",
  lpl:         "https://www.twitch.tv/lpl",
  esl:         "https://www.twitch.tv/esl_csgo",
  blast:       "https://www.twitch.tv/blastpremier",
  cblol:       "https://www.twitch.tv/cblol",
  lcp:         "https://www.twitch.tv/lcp",
  kpl:         "https://www.twitch.tv/kpl",
  "vct masters": "https://www.twitch.tv/valorant",
  vct:         "https://www.twitch.tv/valorant",
};

function getStreamUrl(title) {
  if (!title) return null;
  // Match "Valorant - VCT Masters: ..." pattern first
  const vct = title.match(/^Valorant\s*-\s*(VCT\s*Masters)\s*:/i);
  if (vct) return TOURNAMENT_TWITCH_MAP[vct[1].toLowerCase()] || null;
  // Match patterns like "CS2 - PGL: ..." or "LEC: ..." or "LCK: ..."
  const m = title.match(/^(?:CS2\s*-\s*)?(\w+)\s*:/i);
  if (!m) return null;
  const tournament = m[1].toLowerCase();
  return TOURNAMENT_TWITCH_MAP[tournament] || null;
}

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

function timeAgo(timestampMs) {
  if (!timestampMs) return "--:--:--";
  const now = Date.now();
  const diffMs = now - timestampMs;
  if (diffMs < 0) return "just now";
  
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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

export default function OrderbookView({ marketId, title, yesTokenId, noTokenId, marketData = {}, hasBonus = false, yesLabel = "YES", noLabel = "NO" }) {
  const [outcome, setOutcome] = useState(yesTokenId ? "YES" : "NO");
  const tokenId = outcome === "YES" ? yesTokenId : noTokenId;

  const otherTokenId = outcome === "YES" ? noTokenId : yesTokenId;

  // Display labels for the two outcomes (e.g. "NAVI" / "FNC")
  const outcomeDisplayLabel = outcome === "YES" ? yesLabel : noLabel;

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

  // NEW: image url for thumbnail (prefers thumbnailUrl, fallback coverUrl)
  const thumbnailUrl =
    marketData.thumbnailUrl ||
    marketData.thumbnail_url ||
    marketData.coverUrl ||
    marketData.cover_url ||
    null;

  // Get expiresAt - try cutoffAt first, then fallback to extracting from title
  let expiresAt = marketData.cutoffAt || marketData.resolvedAt || marketData.expiresAt || marketData.expires_at || marketData.endDate || marketData.end_date || null;
  if (!expiresAt || expiresAt === 0) {
    expiresAt = extractExpiresFromTitle(title);
  }

  const [showRules, setShowRules] = useState(false);

  // ✅ FIX: categorical markets need rootMarketId for market.last.trade
  const rootMarketId =
    marketData.rootMarketId ||
    marketData.root_market_id ||
    marketData.rootId ||
    marketData.root_id ||
    null;

  const tradeSubId = rootMarketId ? `root:${rootMarketId}` : marketId;

  // Recent trades via WebSocket
  const { trades: recentTrades, connected: wsConnected, error: wsError } = useMarketTrades(tradeSubId);

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

  // Compute total liquidity: sum of all bid sizes + all ask sizes
  const totalLiquidity = useMemo(() => {
    const bidLiq = (bids || []).reduce((s, b) => s + (b.shares || 0), 0);
    const askLiq = (asks || []).reduce((s, a) => s + (a.shares || 0), 0);
    return bidLiq + askLiq;
  }, [bids, asks]);

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
    <div className="col" style={{ gap: 12, paddingBottom: 120 }}>
      <div className="panel" style={{ padding: "14px 16px" }}>
        <div className="detail-header">
          {/* LEFT BLOCK (unchanged content, just insert thumbnail) */}
          <div className="detail-header-left">
            {/* NEW: thumbnail at the exact left spot you marked */}
            <MarketThumbnailDetail url={thumbnailUrl} size={100} radius={14} />

            <div className="detail-info">
              {/* Market ID row with buttons on mobile */}
              <div className="detail-market-id-row">
                <span className="muted" style={{ fontSize: 11 }}>Market #{marketId}</span>
                {/* Buttons - shown inline on mobile */}
                <div className="detail-buttons-inline">
                  <a
                    href={`https://app.opinion.trade/detail?topicId=${marketId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-small-mobile"
                  >
                    <img src="/opinion-logo.svg" alt="Opinion" width="14" height="14" />
                    <span className="btn-text-mobile">View on Opinion</span>
                  </a>
                  {(() => {
                    const streamUrl = getStreamUrl(title);
                    if (!streamUrl) return null;
                    return (
                      <a
                        href={streamUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-small-mobile btn-stream"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M11.64 5.93h1.43v4.28h-1.43m3.93-4.28H17v4.28h-1.43M7 2L3.43 5.57v12.86h4.28V22l3.58-3.57h2.85L20.57 12V2m-1.43 9.29l-2.85 2.85h-2.86l-2.5 2.5v-2.5H7.71V3.43h11.43Z" />
                        </svg>
                        <span className="btn-text-mobile">Stream</span>
                      </a>
                    );
                  })()}
                  {hasBonus && (
                    <img 
                      src="/gift_icon_24.svg" 
                      alt="Bonus" 
                      title="Bonus market"
                      className="bonus-icon-mobile"
                    />
                  )}
                </div>
              </div>
              <div className="detail-title" style={{ fontWeight: 900, fontSize: 16 }}>
                {title || "Market"}
              </div>
              
              {/* Stats - shown here on mobile, hidden on desktop */}
              <div className="detail-stats-mobile">
                <div>
                  <span className="muted">Chance</span>
                  <span style={{ fontWeight: 700, color: "#fff" }}>{mid ? (mid * 100).toFixed(1) + "%" : "-"}</span>
                </div>
                <div>
                  <span className="muted">Expires</span>
                  <span style={{ fontWeight: 700 }}>{expiresAt ? (() => {
                    const ts = Number(expiresAt);
                    const ms = ts > 1e12 ? ts : ts * 1000;
                    const d = new Date(ms);
                    if (isNaN(d.getTime())) return "-";
                    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                  })() : "-"}</span>
                </div>
                <div>
                  <span className="muted">24h Vol</span>
                  <span style={{ fontWeight: 700, color: "#fff" }}>{volume24h ? `$${fmtQty(volume24h)}` : "-"}</span>
                </div>
                <div>
                  <span className="muted">Total Vol</span>
                  <span style={{ fontWeight: 700, color: "#fff" }}>{totalVolume ? `$${fmtQty(totalVolume)}` : "-"}</span>
                </div>
                <div>
                  <span className="muted">Liquidity</span>
                  <span style={{ fontWeight: 700, color: "#fff" }}>{totalLiquidity > 0 ? fmtUsdCompact(totalLiquidity) : "-"}</span>
                </div>
              </div>
              
              {/* Buttons section - shown on desktop, hidden on mobile */}
              <div className="detail-buttons">
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
                {/* Watch Stream button - shown for esport markets with known Twitch channels */}
                {(() => {
                  const streamUrl = getStreamUrl(title);
                  if (!streamUrl) return null;
                  return (
                    <a
                      href={streamUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-stream"
                      style={{ fontSize: 11, padding: "6px 12px", display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M11.64 5.93h1.43v4.28h-1.43m3.93-4.28H17v4.28h-1.43M7 2L3.43 5.57v12.86h4.28V22l3.58-3.57h2.85L20.57 12V2m-1.43 9.29l-2.85 2.85h-2.86l-2.5 2.5v-2.5H7.71V3.43h11.43Z" />
                      </svg>
                      Watch Stream
                    </a>
                  );
                })()}
                {/* ✅ Bonus Icon - positioned after View on Opinion button */}
                {hasBonus && (
                  <img 
                    src="/gift_icon_24.svg" 
                    alt="Bonus" 
                    title="Bonus market"
                    style={{ width: 40, height: 40, flexShrink: 0 }} 
                  />
                )}
              </div>
            </div>
          </div>

          {/* RIGHT BLOCK (unchanged) */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          </div>
        </div>

        {/* Stats for desktop - hidden on mobile */}
        <div className="detail-stats detail-stats-desktop">
          <div>
            <div className="muted" style={{ fontSize: 10, marginBottom: 2 }}>Chance</div>
            <div style={{ fontWeight: 700, color: "#fff" }}>{mid ? (mid * 100).toFixed(1) + "%" : "-"}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 10, marginBottom: 2 }}>Expires</div>
            <div style={{ fontWeight: 700 }}>{expiresAt ? (() => {
              const ts = Number(expiresAt);
              const ms = ts > 1e12 ? ts : ts * 1000;
              const d = new Date(ms);
              if (isNaN(d.getTime())) return "-";
              return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
            })() : "-"}</div>
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
            <div className="muted" style={{ fontSize: 10, marginBottom: 2 }}>Liquidity</div>
            <div style={{ fontWeight: 700, color: "#fff" }}>{totalLiquidity > 0 ? fmtUsdCompact(totalLiquidity) : "-"}</div>
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

      <div className="detail-grid">
        <div className="detail-left-col">
          <div className="chart-wrapper">
            <ChartViewV2
              key={yesTokenId}
              tokenId={yesTokenId}
              outcome={outcome}
              mid={mid}
              selectedCents={selectedCents}
              onOutcomeChange={setOutcome}
              yesLabel={yesLabel}
              noLabel={noLabel}
            />
          </div>

          <div className="panel trades-panel" style={{ marginTop: 12 }}>
            <div className="tabs">
              <div className="tab active">Trades</div>
              <div className="tab">Top Traders</div>
              <div className="tab">Holders</div>
            </div>

            <div style={{ padding: "12px 16px" }}>
              <div className="trades-table-wrap">
                <table className="trades-table">
                  <thead className="trades-table-header">
                    <tr>
                      <th>Time</th>
                      <th>Outcome</th>
                      <th>Type</th>
                      <th>Price</th>
                      <th>Amount</th>
                      <th>Total USD</th>
                      <th>Trader</th>
                    </tr>
                  </thead>

                  <tbody>
                    {recentTrades.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="trades-empty-state">
                          <div className="trades-empty-content">
                            {wsConnected ? (
                              <>
                                <span className="trades-empty-title">Waiting for trades</span>
                                <span className="trades-empty-hint">Live trades will appear here</span>
                              </>
                            ) : wsError ? (
                              <>
                                <span className="trades-empty-title trades-empty-error">Connection error</span>
                                <span className="trades-empty-hint">Unable to connect to live feed</span>
                              </>
                            ) : (
                              <>
                                <span className="trades-empty-title">Connecting...</span>
                                <span className="trades-empty-hint">Establishing live feed connection</span>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ) : (
                      recentTrades.map((trade) => {
                        // ---- SAFE NORMALIZATION (only for render; does not change logic elsewhere)
                        const sideRaw = String(trade?.side ?? trade?.type ?? "").toLowerCase();
                        const isBuy = sideRaw === "buy" || sideRaw === "b" || sideRaw === "long";

                        const outcomeSideRaw = trade?.outcomeSide ?? trade?.outcome_side ?? trade?.outcome;
                        const outcomeLabel = Number(outcomeSideRaw) === 1 || String(outcomeSideRaw).toUpperCase() === "YES"
                          ? yesLabel
                          : noLabel;

                        const price = Number(trade?.price ?? 0);
                        const shares = Number(trade?.shares ?? trade?.size ?? 0);

                        const tRaw =
                          trade?.timestamp ??
                          trade?.ts ??
                          trade?.time ??
                          trade?.createdAt ??
                          trade?.created_at ??
                          trade?.receivedAt ??
                          0;

                        const tNum = Number(tRaw);
                        const tMs =
                          !tNum ? 0 :
                          tNum > 1e12 ? tNum :
                          tNum > 1e10 ? tNum :
                          tNum * 1000;

                        const timeStr = timeAgo(tMs);
                        const priceCents = (price * 100).toFixed(1).replace(/\.0$/, "");

                        const amount = Math.round(shares).toLocaleString();

                        const totalUsd = price * shares;
                        const totalStr = "$" + Math.round(totalUsd).toLocaleString();

                        const rowKey =
                          trade?.id ??
                          trade?.txHash ??
                          trade?.hash ??
                          `${tMs}-${trade?.tokenId ?? ""}-${trade?.price ?? ""}-${trade?.shares ?? ""}`;

                        return (
                          <tr
                            key={rowKey}
                            style={{
                              borderBottom: "1px solid rgba(255,255,255,0.04)",
                              animation: "fadeIn 0.3s ease"
                            }}
                          >
                            <td className="muted" style={{
                              padding: "12px 12px 12px 0",
                              fontSize: 13,
                              whiteSpace: "nowrap"
                            }}>
                              {timeStr}
                            </td>

                            <td style={{ padding: "12px" }}>
                              <span style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: outcomeLabel === yesLabel ? "#22d3ee" : "#a855f7"
                              }}>
                                {outcomeLabel}
                              </span>
                            </td>

                            <td style={{ padding: "12px" }}>
                              <span style={{
                                color: isBuy ? "#22c55e" : "#ef4444",
                                fontWeight: 700,
                                fontSize: 13
                              }}>
                                {isBuy ? "BUY" : "SELL"}
                              </span>
                            </td>

                            <td style={{
                              padding: "12px",
                              fontWeight: 500,
                              fontSize: 13
                            }}>
                              {priceCents}¢
                            </td>

                            <td style={{
                              padding: "12px",
                              fontWeight: 500,
                              fontSize: 13
                            }}>
                              {amount}
                            </td>

                            <td style={{
                              padding: "12px",
                              color: isBuy ? "#22c55e" : "#ef4444",
                              fontWeight: 600,
                              fontSize: 13
                            }}>
                              {totalStr}
                            </td>

                            <td className="muted" style={{
                              padding: "12px",
                              fontSize: 13
                            }}>
                              -
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <div className="panel orderbook-panel">
          <div className="orderbook-header">
            <div className="orderbook-title">Order Book</div>
            <div className="outcome-toggle">
              <button
                onClick={() => setOutcome("YES")}
                className={`outcome-btn outcome-btn-yes ${outcome === "YES" ? "active" : ""}`}
              >
                {yesLabel}
              </button>
              <button
                onClick={() => setOutcome("NO")}
                className={`outcome-btn outcome-btn-no ${outcome === "NO" ? "active" : ""}`}
              >
                {noLabel}
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
              <span className="pill" style={{ color: "#fff", background: "rgba(239,68,68,0.18)" }}>Asks ({outcomeDisplayLabel})</span>
            </div>
            <div ref={asksScrollRef} style={{ maxHeight: 5 * 56, overflowY: "auto", paddingRight: 6 }}>
              {loading && asks.length === 0 ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} style={{ marginTop: 6 }}>
                    <div className="skeleton" style={{ height: 44, borderRadius: 10 }} />
                  </div>
                ))
              ) : asksD.length === 0 ? (
                <div className="orderbook-empty-state">
                  <span>No asks available</span>
                  <span className="orderbook-empty-hint">Waiting for sell orders</span>
                </div>
              ) : (
                asksD.map((r, i) => {
                  const maxCum = Math.max(1, ...asksD.map(x => x.cumTotal));
                  const pct = Math.max(0, Math.min(100, (r.cumTotal / maxCum) * 100));
                  return (
                    <div key={`ask-${i}`} className="orderbook-row orderbook-row-ask">
                      <div className="orderbook-row-depth" style={{ width: `${pct}%` }} />
                      <div className="orderbook-row-content">
                        <div className="red orderbook-price">{(r.price * 100).toFixed(1)}¢</div>
                        <div className="muted orderbook-shares" style={{ fontFamily: "inherit", fontWeight: 500 }}>{fmtQty(r.shares)}</div>
                        <div className="orderbook-total" style={{ fontFamily: "inherit", fontWeight: 600 }}>${fmtQty(r.total)}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="orderbook-spread-row">
            <div className="orderbook-spread-item">
              <span className="orderbook-spread-label">Last</span>
              <span className="orderbook-spread-value" style={{ fontFamily: "inherit" }}>{bids[0] ? (bids[0].price * 100).toFixed(1).replace(/\.0$/, "") + "¢" : "-"}</span>
            </div>
            <div className="orderbook-spread-item">
              <span className="orderbook-spread-label">Spread</span>
              <span className="orderbook-spread-value" style={{ fontFamily: "inherit" }}>{bids[0] && asks[0] ? ((asks[0].price - bids[0].price) * 100).toFixed(1).replace(/\.0$/, "") + "¢" : "-"}</span>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span className="pill" style={{ color: "#fff", background: "rgba(34,197,94,0.18)" }}>Bids ({outcomeDisplayLabel})</span>
            </div>
            <div style={{ maxHeight: 5 * 56, overflowY: "auto", paddingRight: 6 }}>
              {loading && bids.length === 0 ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} style={{ marginTop: 6 }}>
                    <div className="skeleton" style={{ height: 44, borderRadius: 10 }} />
                  </div>
                ))
              ) : bidsD.length === 0 ? (
                <div className="orderbook-empty-state">
                  <span>No bids available</span>
                  <span className="orderbook-empty-hint">Waiting for buy orders</span>
                </div>
              ) : (
                bidsD.map((r, i) => {
                  const maxCum = Math.max(1, ...bidsD.map(x => x.cumTotal));
                  const pct = Math.max(0, Math.min(100, (r.cumTotal / maxCum) * 100));
                  return (
                    <div key={`bid-${i}`} className="orderbook-row orderbook-row-bid">
                      <div className="orderbook-row-depth orderbook-row-depth-bid" style={{ width: `${pct}%` }} />
                      <div className="orderbook-row-content">
                        <div className="green orderbook-price">{(r.price * 100).toFixed(1)}¢</div>
                        <div className="muted orderbook-shares" style={{ fontFamily: "inherit", fontWeight: 500 }}>{fmtQty(r.shares)}</div>
                        <div className="orderbook-total" style={{ fontFamily: "inherit", fontWeight: 600 }}>${fmtQty(r.total)}</div>
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
