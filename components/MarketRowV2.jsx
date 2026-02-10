"use client";

import { useEffect, useMemo, useRef, useState, useCallback, memo } from "react";
import MiniSparkline from "@/components/MiniSparkline";
import { getOptimizedImageUrl } from "@/components/OptimizedImage";

import useInView from "@/components/hooks/useInView";
import { withConcurrency } from "@/lib/concurrency";
import { clientGet, clientSet } from "@/lib/clientCache";
import Link from "next/link";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtUsdCompact(v) {
  const n = num(v);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  });
}

function fmtChanceFromPrice01(p01) {
  const pct = Math.max(0, Math.min(100, num(p01) * 100));
  const s = pct.toFixed(1).replace(/\.0$/, "");
  return `${s}%`;
}

/**
 * ✅ FIXED Thumbnail: always renders a fixed box (prevents vertical misalignment)
 * size = 45 (your chosen size)
 * Uses wsrv.nl for optimized external images (WebP, resize)
 */
function MarketThumbnail({ url, size = 45, radius = 10 }) {
  const [errored, setErrored] = useState(false);
  const showImg = Boolean(url) && !errored;

  // Optimize external images via wsrv.nl (2x for retina)
  const optimizedUrl = useMemo(() => {
    if (!url || errored) return null;
    return getOptimizedImageUrl(url, size * 2, 80);
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

/**
 * Extract expiration date from market title
 * Returns Unix timestamp in SECONDS if found, null otherwise
 */
function extractExpiresFromTitle(title) {
  if (!title) return null;

  const str = String(title).trim();

  const months = {
    january: 0,
    jan: 0,
    february: 1,
    feb: 1,
    march: 2,
    mar: 2,
    april: 3,
    apr: 3,
    may: 4,
    june: 5,
    jun: 5,
    july: 6,
    jul: 6,
    august: 7,
    aug: 7,
    september: 8,
    sep: 8,
    sept: 8,
    october: 9,
    oct: 9,
    november: 10,
    nov: 10,
    december: 11,
    dec: 11,
  };

  const pattern1 =
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?\b/i;

  const match1 = str.match(pattern1);
  if (match1) {
    const month = months[match1[1].toLowerCase()];
    const day = parseInt(match1[2], 10);
    let year = match1[3] ? parseInt(match1[3], 10) : new Date().getFullYear();

    const now = new Date();
    const testDate = new Date(year, month, day);
    if (testDate < now && !match1[3]) year = now.getFullYear() + 1;

    if (month !== undefined && day >= 1 && day <= 31 && year >= 2020 && year <= 2035) {
      return Math.floor(new Date(year, month, day, 23, 59, 59).getTime() / 1000);
    }
  }

  const pattern2 =
    /\bin\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?:\s+(\d{4}))?\b/i;

  const match2 = str.match(pattern2);
  if (match2) {
    const month = months[match2[1].toLowerCase()];
    let year = match2[2] ? parseInt(match2[2], 10) : new Date().getFullYear();

    const now = new Date();
    if (month < now.getMonth() && !match2[2]) year = now.getFullYear() + 1;

    if (month !== undefined && year >= 2020 && year <= 2035) {
      const lastDay = new Date(year, month + 1, 0).getDate();
      return Math.floor(new Date(year, month, lastDay, 23, 59, 59).getTime() / 1000);
    }
  }

  const pattern3 =
    /\bby\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?\b/i;

  const match3 = str.match(pattern3);
  if (match3) {
    const month = months[match3[1].toLowerCase()];
    const day = parseInt(match3[2], 10);
    let year = match3[3] ? parseInt(match3[3], 10) : new Date().getFullYear();

    const now = new Date();
    const testDate = new Date(year, month, day);
    if (testDate < now && !match3[3]) year = now.getFullYear() + 1;

    if (month !== undefined && day >= 1 && day <= 31 && year >= 2020 && year <= 2035) {
      return Math.floor(new Date(year, month, day, 23, 59, 59).getTime() / 1000);
    }
  }

  const pattern4 =
    /\bon\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i;

  const match4 = str.match(pattern4);
  if (match4) {
    const month = months[match4[1].toLowerCase()];
    const day = parseInt(match4[2], 10);
    let year = new Date().getFullYear();

    const now = new Date();
    const testDate = new Date(year, month, day);
    if (testDate < now) year = now.getFullYear() + 1;

    if (month !== undefined && day >= 1 && day <= 31) {
      return Math.floor(new Date(year, month, day, 23, 59, 59).getTime() / 1000);
    }
  }

  return null;
}

function fmtExpires(timestampSec) {
  if (!timestampSec || timestampSec <= 0) return "—";
  const ms = Number(timestampSec) * 1000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return "—";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function pickYesTokenId(m) {
  if (!m) return null;

  const direct =
    m.yesTokenId ??
    m.yes_token_id ??
    m.yesTokenID ??
    m.yes_tokenID ??
    m.outcomeYesTokenId ??
    m.outcome_yes_token_id ??
    m.tokenId ??
    m.token_id;

  if (direct) return String(direct);

  const nested =
    m?.yes?.token_id ??
    m?.yes?.tokenId ??
    m?.outcomes?.YES?.token_id ??
    m?.outcomes?.YES?.tokenId ??
    m?.outcomes?.yes?.token_id ??
    m?.outcomes?.yes?.tokenId;

  if (nested) return String(nested);

  const tokens = m?.tokens ?? m?.token_list ?? m?.tokenList ?? m?.outcomeTokens ?? m?.outcome_tokens ?? null;

  if (Array.isArray(tokens) && tokens.length) {
    const yesLike =
      tokens.find((t) => String(t?.outcome ?? t?.name ?? t?.label ?? "").toLowerCase().includes("yes")) ?? null;

    const candidate = yesLike ?? tokens[0];
    const tid = candidate?.token_id ?? candidate?.tokenId ?? candidate?.id ?? null;
    if (tid) return String(tid);
  }

  return null;
}

function normalizeOrderbook(raw) {
  const root = raw?.result ?? raw ?? {};
  const rawBids = root?.bids ?? root?.buy ?? root?.bid ?? [];
  const rawAsks = root?.asks ?? root?.sell ?? root?.ask ?? [];

  const toRow = (r) => {
    if (Array.isArray(r) && r.length >= 2) {
      const a = num(r[0]);
      const b = num(r[1]);
      const aLooks = a >= 0 && a <= 1;
      const bLooks = b >= 0 && b <= 1;
      const price = aLooks ? a : bLooks ? b : a;
      return { price, shares: aLooks ? b : a };
    }
    if (r && typeof r === "object") {
      return { price: num(r.price ?? r.p ?? r.px), shares: num(r.shares ?? r.size ?? r.qty) };
    }
    return { price: 0, shares: 0 };
  };

  const bids = (Array.isArray(rawBids) ? rawBids : []).map(toRow).sort((a, b) => b.price - a.price);
  const asks = (Array.isArray(rawAsks) ? rawAsks : []).map(toRow).sort((a, b) => a.price - b.price);
  return { bids, asks };
}

function parseHistory(result) {
  const hist = result?.history || [];
  return hist
    .map((x) => ({ t: Number(x.t) * 1000, p: num(x.p) }))
    .filter((x) => x.t > 0)
    .sort((a, b) => a.t - b.t);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJsonWithRetry(url, opts) {
  const r1 = await fetch(url, opts);
  const j1 = await r1.json();
  if (j1?.errno === 0) return j1;

  await sleep(900);
  const r2 = await fetch(url, opts);
  const j2 = await r2.json();
  return j2;
}

function getInflightMap() {
  const g = globalThis;
  if (!g.__ODD_INFLIGHT__) g.__ODD_INFLIGHT__ = new Map();
  return g.__ODD_INFLIGHT__;
}

async function fetchOnce(key, fn) {
  const inflight = getInflightMap();
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      return await fn();
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

async function fetchOrderbookCached(tokenId) {
  const obKey = `ob:${tokenId}`;
  const cached = clientGet(obKey);
  if (cached) return cached;

  return fetchOnce(`inflight:${obKey}`, async () => {
    const obJson = await withConcurrency(
      () =>
        fetchJsonWithRetry(`/api/opinion/token/orderbook?token_id=${encodeURIComponent(tokenId)}`, {
          cache: "no-store",
        }),
      4
    );
    if (obJson?.errno !== 0) throw new Error("orderbook_failed");
    clientSet(obKey, obJson, 30_000);
    return obJson;
  });
}

async function fetchHistoryCached(tokenId, interval = "1d") {
  const phKey = `hist:${tokenId}:${interval}`;
  const cached = clientGet(phKey);
  if (cached) return cached;

  return fetchOnce(`inflight:${phKey}`, async () => {
    const phJson = await withConcurrency(
      () =>
        fetchJsonWithRetry(
          `/api/opinion/token/price-history?token_id=${encodeURIComponent(tokenId)}&interval=${interval}`,
          { cache: "no-store" }
        ),
      4
    );
    if (phJson?.errno !== 0) throw new Error("price_history_failed");
    clientSet(phKey, phJson, 30_000);
    return phJson;
  });
}

async function fetchMarketDetailCached(marketId) {
  const key = `mkt:${marketId}`;
  const cached = clientGet(key);
  if (cached) return cached;

  return fetchOnce(`inflight:${key}`, async () => {
    const j = await withConcurrency(
      () =>
        fetchJsonWithRetry(`/api/opinion/market/${encodeURIComponent(marketId)}`, {
          cache: "no-store",
        }),
      4
    );
    clientSet(key, j, 30_000);
    return j;
  });
}

function MarketRowV2({
  market,
  volMode,
  onOpen,
  isBonus = false,
  priority = false,
  onChanceLoaded,
  onVolumeLoaded,
  onBonusDetected,
  volumeOverride,
}) {
  const tokenId = useMemo(() => pickYesTokenId(market), [market]);

  // IMPORTANT: list API might return marketTitle, not title
  const title = market?.title ?? market?.marketTitle ?? "Market";

  // ✅ Thumbnail: hydrate from detail API (because list may not include thumbnailUrl yet)
  const [thumbUrl, setThumbUrl] = useState(
    market?.thumbnailUrl ??
      market?.thumbnail_url ??
      market?.coverUrl ??
      market?.cover_url ??
      market?.imageUrl ??
      market?.image_url ??
      market?.image ??
      null
  );

  const rowRef = useRef(null);
  const inView = useInView(rowRef, { root: null, rootMargin: "220px", threshold: 0.01 });

  const [loading, setLoading] = useState(false);
  const [rowErr, setRowErr] = useState("");

  const [mid, setMid] = useState(0);
  const [sparkPts, setSparkPts] = useState([]);

  // Bonus state - check from detail API if not provided via prop
  const [detectedBonus, setDetectedBonus] = useState(false);

  const interval = "1d";

  const computeMidFromOrderbook = (obJson) => {
    const ob = normalizeOrderbook(obJson?.result ?? obJson);
    const bestBid = ob.bids?.[0]?.price ?? 0;
    const bestAsk = ob.asks?.[0]?.price ?? 0;
    return bestBid > 0 && bestAsk > 0
      ? (bestBid + bestAsk) / 2
      : bestBid > 0
        ? bestBid
        : bestAsk > 0
          ? bestAsk
          : 0;
  };

  const prefetch = useCallback(async () => {
    if (!tokenId) return;
    try {
      await Promise.all([fetchOrderbookCached(tokenId), fetchHistoryCached(tokenId, interval)]);
    } catch {}
  }, [tokenId]);

  useEffect(() => {
    let alive = true;

    async function load() {
      if (!inView && !priority) return;

      setLoading(true);
      setRowErr("");

      if (!tokenId) {
        setRowErr("missing_token");
        setLoading(false);
        return;
      }

      try {
        const [obJson, phJson] = await Promise.all([
          fetchOrderbookCached(tokenId),
          fetchHistoryCached(tokenId, interval),
        ]);
        if (!alive) return;

        const m = computeMidFromOrderbook(obJson);
        const pts = parseHistory(phJson?.result);

        setMid(m);
        setSparkPts((pts || []).slice(-90));
        setLoading(false);

        if (m > 0 && onChanceLoaded) onChanceLoaded(market?.marketId, m);
      } catch {
        if (!alive) return;
        setRowErr("fetch_failed");
        setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [tokenId, inView, priority]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true;

    async function loadVolumeAndBonus() {
      const marketId = market?.marketId;
      if (!marketId) return;
      if (!inView && !priority) return;

      try {
        const j = await fetchMarketDetailCached(marketId);
        if (!alive) return;

        const data = j?.result?.data ?? j?.result ?? j?.data ?? j ?? {};

        // ✅ Hydrate thumbnail from detail API
        const detailThumb =
          data?.thumbnailUrl ??
          data?.thumbnail_url ??
          data?.coverUrl ??
          data?.cover_url ??
          data?.imageUrl ??
          data?.image_url ??
          data?.image ??
          null;

        if (detailThumb) setThumbUrl(detailThumb);

        // Load volume if volume24h not already available
        // NOTE: Categorical children only have total volume from list API, need to fetch volume24h
        const current24h = Number(volumeOverride?.volume24h ?? market?.volume24h ?? 0);
        if (current24h <= 0) {
          const vAll = Number(data?.volume ?? 0) || 0;
          const v24h = Number(data?.volume24h ?? 0) || 0;
          if ((vAll > 0 || v24h > 0) && onVolumeLoaded) onVolumeLoaded(marketId, { volume: vAll, volume24h: v24h });
        }

        // Check for bonus (incentiveFactor field exists in detail)
        if ("incentiveFactor" in data) {
          setDetectedBonus(true);
          if (onBonusDetected) onBonusDetected(marketId);
        }
      } catch {}
    }

    loadVolumeAndBonus();
    return () => {
      alive = false;
    };
  }, [market?.marketId, market?.volume, market?.volume24h, volumeOverride, inView, priority, onVolumeLoaded]);

  const chanceText = mid > 0 ? fmtChanceFromPrice01(mid) : "-";

  // Get volume based on mode
  const volNumber = (() => {
    if (volMode === "24h") {
      return volumeOverride?.volume24h ?? market?.volume24h ?? market?.vol24h ?? market?.volume_24h ?? 0;
    } else {
      // "all" mode - use total volume
      return volumeOverride?.volume ?? market?.volume ?? market?.volTotal ?? market?.volume_total ?? market?.volumeAll ?? 0;
    }
  })();

  const volText = fmtUsdCompact(volNumber);

  const marketTitle = title ?? "";
  let expiresTimestamp = market?.cutoffAt || market?.resolvedAt || 0;
  if (!expiresTimestamp || expiresTimestamp === 0) expiresTimestamp = extractExpiresFromTitle(marketTitle) || 0;
  const expiresText = fmtExpires(expiresTimestamp);

  // Build detail URL with parentEventTitle in query params for categorical children
  const parentEventTitle = market?.parentEventTitle || "";
  const detailUrl = parentEventTitle 
    ? `/market/${market?.marketId}?parentTitle=${encodeURIComponent(parentEventTitle)}`
    : `/market/${market?.marketId}`;

  return (
    <Link
      href={detailUrl}
      prefetch={false}
      className="panel market-row"
      style={{
        padding: "8px 12px",
        cursor: "pointer",
        display: "block",
        color: "inherit",
        textDecoration: "none",
      }}
      onMouseEnter={() => {
        prefetch();
      }}
      onClick={() => {
        prefetch();
        onOpen?.(market);
      }}
      title="Open market"
    >
      {/* Desktop Layout */}
      <div
        ref={rowRef}
        className="market-row-desktop"
        style={{
          display: "grid",
          gridTemplateColumns:
            "var(--market-desktop-grid-columns, minmax(320px, 1.6fr) 140px 110px 140px 130px)",
          gap: "var(--market-desktop-grid-gap, 12px)",
          alignItems: "center",
        }}
      >
        <div style={{ minWidth: 0 }}>
          {/* Title row: [Thumbnail] [Title] [Gift icon] */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <MarketThumbnail url={thumbUrl} size={50} radius={10} />

            <span
              style={{
                fontWeight: 900,
                lineHeight: 1.05,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
            >
              {title}
            </span>

            {(isBonus || detectedBonus) ? (
              <img
                src="/gift_icon_24.svg"
                alt="Bonus"
                title="Bonus market"
                style={{
                  width: 32,
                  height: 32,
                  flex: "0 0 auto",
                  display: "block",
                }}
              />
            ) : null}
          </div>

          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {rowErr ? "" : ""}
          </div>
        </div>

        <div>
          {loading ? (
            <div className="skeleton skeleton-chart" style={{ width: 120, height: 32 }} />
          ) : (
            <MiniSparkline points={sparkPts} />
          )}
        </div>

        <div className="mono" style={{ fontWeight: 900 }}>
          {loading ? <div className="skeleton skeleton-text" style={{ width: 50, height: 14 }} /> : chanceText}
        </div>

        <div className="mono">{volText}</div>

        <div className="mono muted">{expiresText}</div>
      </div>

      {/* Mobile Layout - Chance Style Card */}
      <div
        className="market-row-mobile"
        style={{
          display: "none",
        }}
      >
        {/* Header: Thumbnail + Title */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <MarketThumbnail url={thumbUrl} size={56} radius={12} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Bonus badge */}
            {(isBonus || detectedBonus) && (
              <div style={{ 
                display: "inline-flex", 
                alignItems: "center", 
                gap: 4,
                marginBottom: 4,
                padding: "2px 8px",
                background: "rgba(245, 200, 75, 0.15)",
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                color: "#F5C84B"
              }}>
                <img src="/gift_icon_24.svg" alt="" style={{ width: 12, height: 12 }} />
                BONUS
              </div>
            )}
            <div
              style={{
                fontWeight: 700,
                fontSize: 15,
                lineHeight: 1.3,
                color: "#fff",
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
            >
              {title}
            </div>
          </div>
        </div>

        {/* Outcome Row - Chance display */}
        <div style={{ 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "space-between",
          marginTop: 14,
          padding: "10px 12px",
          background: "rgba(255,255,255,0.03)",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.06)"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Mini Chart */}
            <div style={{ width: 50, height: 24 }}>
              {loading ? (
                <div className="skeleton" style={{ width: 50, height: 24, borderRadius: 4 }} />
              ) : (
                <MiniSparkline points={sparkPts} width={50} height={24} />
              )}
            </div>
            {/* Chance Label */}
            <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(148,163,184,0.8)" }}>Chance</span>
          </div>
          
          {/* Chance Value - prominent */}
          <span className="mono" style={{ fontWeight: 900, fontSize: 18, color: "#22d3ee" }}>
            {loading ? <span style={{ color: "rgba(255,255,255,0.3)" }}>--</span> : chanceText}
          </span>
        </div>

        {/* Footer: Volume + Date */}
        <div style={{ 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "space-between",
          marginTop: 10,
          paddingTop: 10,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          fontSize: 12,
          color: "rgba(148,163,184,0.8)"
        }}>
          <span className="mono" style={{ fontWeight: 600 }}>{volText} Vol.</span>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12,6 12,12 16,14"/>
              </svg>
              {expiresText}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

// Memoize MarketRowV2 to prevent unnecessary re-renders
export default memo(MarketRowV2, (prevProps, nextProps) => {
  // Only re-render if these props change
  return (
    prevProps.market?.marketId === nextProps.market?.marketId &&
    prevProps.volMode === nextProps.volMode &&
    prevProps.isBonus === nextProps.isBonus &&
    prevProps.priority === nextProps.priority &&
    prevProps.volumeOverride?.volume === nextProps.volumeOverride?.volume &&
    prevProps.volumeOverride?.volume24h === nextProps.volumeOverride?.volume24h
  );
});
