"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, memo } from "react";
import { OptimizedThumbnail } from "@/components/OptimizedImage";
import PredictFunBoostBadge from "@/components/PredictFunBoostBadge";
import MiniSparkline from "@/components/MiniSparkline";
import useInView from "@/components/hooks/useInView";
import { clientGet, clientSet } from "@/lib/clientCache";
import { getPredictFunDisplayTitleParts } from "@/lib/predictfunDisplay";

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

function fmtExpires(isoOrMs) {
  if (!isoOrMs) return "—";
  const ms = typeof isoOrMs === "string" ? Date.parse(isoOrMs) : Number(isoOrMs);
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const d = new Date(ms);
  if (isNaN(d.getTime())) return "—";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function fmtBoostStartsAtUtc(isoOrMs) {
  if (!isoOrMs) return "";
  const ms = typeof isoOrMs === "string" ? Date.parse(isoOrMs) : Number(isoOrMs);
  if (!Number.isFinite(ms) || ms <= 0) return "";

  const d = new Date(ms);
  if (isNaN(d.getTime())) return "";

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");

  return `at ${hours}:${minutes} (UTC) on ${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function BoostMeta({ text }) {
  if (!text) return null;
  return (
    <span
      className="mono"
      style={{
        fontSize: 11,
        lineHeight: "16px",
        fontWeight: 700,
        color: "rgba(226,188,99,0.88)",
        whiteSpace: "nowrap",
        flex: "0 0 auto",
      }}
    >
      {text}
    </span>
  );
}

function PredictFunMarketRow({
  market,
  initialData = null,
  volMode = "24h",
  isBoost = false,
  showBoostTime = false,
  priority = false,
  relatedCount = 0,
  onChanceLoaded,
  onLiquidityLoaded,
}) {
  const imageUrl = market?.imageUrl ?? null;
  const titleParts = useMemo(() => getPredictFunDisplayTitleParts(market), [market]);
  const displayTitle = titleParts.plainText;

  const rowRef = useRef(null);
  const inView = useInView(rowRef, { root: null, rootMargin: "220px", threshold: 0.01 });

  const [mid, setMid] = useState(initialData?.mid ?? 0);
  const [loading, setLoading] = useState(false);
  const [obLiquidity, setObLiquidity] = useState(initialData?.totalLiquidity ?? null);
  const [sparkPts, setSparkPts] = useState(
    Array.isArray(initialData?.sparkPts) ? initialData.sparkPts : []
  );

  useEffect(() => {
    if (initialData?.mid > 0) setMid(initialData.mid);
    if (initialData?.totalLiquidity != null) setObLiquidity(initialData.totalLiquidity);
    if (Array.isArray(initialData?.sparkPts) && initialData.sparkPts.length > 0) {
      setSparkPts(initialData.sparkPts);
    }
  }, [initialData]);

  // Fetch chance (mid price) + price history lazily when in view
  useEffect(() => {
    if (!inView && !priority) return;
    if (!market?.id) return;

    let alive = true;
    const cacheKey = `pf-mid:${market.id}`;
    const chartCacheKey = `pf-chart:${market.id}`;
    const cached = clientGet(cacheKey);
    const cachedChart = clientGet(chartCacheKey);
    const hasInitialMetric = initialData?.mid > 0 || initialData?.totalLiquidity != null;
    const hasInitialChart = Array.isArray(initialData?.sparkPts) && initialData.sparkPts.length > 0;
    if (cached) {
      setMid(cached.mid || 0);
      if (cached.totalLiquidity != null) setObLiquidity(cached.totalLiquidity);
    } else if (hasInitialMetric) {
      if (initialData?.mid > 0) setMid(initialData.mid);
      if (initialData?.totalLiquidity != null) setObLiquidity(initialData.totalLiquidity);
    }

    if (cachedChart) {
      setSparkPts(cachedChart);
    } else if (hasInitialChart) {
      setSparkPts(initialData.sparkPts);
    }

    const needsMetricFetch = !cached && !hasInitialMetric;
    const needsChartFetch = !cachedChart && !hasInitialChart;
    if (!needsMetricFetch && !needsChartFetch) return;

    setLoading(true);

    function fetchChart() {
      fetch(`/api/predictfun/market/${market.id}/price-history`, { cache: "no-store" })
        .then((r) => r.ok ? r.json() : null)
        .then((json) => {
          if (!alive || !json?.points) return;
          const pts = (json.points || []).slice(-50);
          setSparkPts(pts);
          clientSet(chartCacheKey, pts, 60_000);
        })
        .catch(() => {});
    }

    const tasks = [];

    if (needsMetricFetch) {
      tasks.push(
        (async () => {
          try {
            const res = await fetch(`/api/predictfun/market/${market.id}/last-sale`, { cache: "no-store" });
            if (!alive || !res.ok) return;
            const json = await res.json();
            if (!alive) return;

            const m = json.mid || 0;
            setMid(m);
            if (json.totalLiquidity != null) setObLiquidity(json.totalLiquidity);

            clientSet(cacheKey, json, 30_000);
            if (m > 0 && onChanceLoaded) onChanceLoaded(market.id, m);
            if (json.totalLiquidity > 0 && onLiquidityLoaded) onLiquidityLoaded(market.id, json.totalLiquidity);
          } catch {
            // ignore
          }
        })()
      );
    }

    if (needsChartFetch) {
      tasks.push(fetchChart());
    }

    Promise.allSettled(tasks).finally(() => {
      if (alive) setLoading(false);
    });

    return () => { alive = false; };
  }, [inView, priority, market?.id, initialData, onChanceLoaded, onLiquidityLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const chanceText = mid > 0 ? fmtChanceFromPrice01(mid) : "—";

  // Volume
  const vol24h = num(market?.stats?.volume24hUsd ?? 0);
  const volTotal = num(market?.stats?.volumeTotalUsd ?? 0);
  const volNumber = volMode === "24h" ? vol24h : volTotal;
  const volText = fmtUsdCompact(volNumber);

  // Liquidity - prefer inline stats, fallback to orderbook
  const liqFromStats = num(market?.stats?.totalLiquidityUsd ?? 0);
  const liqDisplay = liqFromStats > 0 ? liqFromStats : (obLiquidity ?? 0);
  const liqText = liqDisplay > 0 ? fmtUsdCompact(liqDisplay) : "—";

  // Expires
  const expiresText = fmtExpires(market?._categoryEndsAt);

  // Boost badge
  const boostActive = (() => {
    if (!market?.isBoosted) return false;
    const now = Date.now();
    const start = market.boostStartsAt ? Date.parse(market.boostStartsAt) : null;
    const end = market.boostEndsAt ? Date.parse(market.boostEndsAt) : null;
    if (Number.isFinite(start) && Number.isFinite(end)) {
      return now >= start && now < end;
    }
    return market.isBoosted === true;
  })();
  const boostStartsAtText =
    showBoostTime && market?.isBoosted ? fmtBoostStartsAtUtc(market?.boostStartsAt) : "";
  const showBoostBadge = isBoost || market?.isBoosted || boostActive;

  const detailUrl = market?.id ? `/predictfun/market/${market.id}` : "/predictfun";

  return (
    <Link
      href={detailUrl}
      prefetch={false}
      className="panel market-row pf-market-row"
      style={{
        padding: "8px 12px",
        cursor: "pointer",
        display: "block",
        color: "inherit",
        textDecoration: "none",
      }}
    >
      {/* Desktop Layout */}
      <div
        ref={rowRef}
        className="market-row-desktop"
        style={{
          display: "grid",
          gridTemplateColumns:
            "var(--market-desktop-grid-columns, minmax(280px, 1.8fr) 140px 100px 120px 100px 120px)",
          gap: "var(--market-desktop-grid-gap, 12px)",
          alignItems: "center",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <OptimizedThumbnail url={imageUrl} size={50} radius={10} sizes="50px" />

            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span
                  style={{
                    fontWeight: 900,
                    lineHeight: 1.05,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {titleParts.highlight ? (
                    <>
                      {titleParts.prefix}
                      <span style={{ color: "#A78BFA" }}>{titleParts.highlight}</span>
                      {titleParts.suffix}
                    </>
                  ) : (
                    displayTitle
                  )}
                </span>
                {relatedCount > 0 && (
                  <span style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "2px 7px",
                    background: "rgba(34,211,238,0.08)",
                    border: "1px solid rgba(34,211,238,0.2)",
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 600,
                    color: "rgba(34,211,238,0.8)",
                    whiteSpace: "nowrap",
                    flex: "0 0 auto",
                  }}>
                    {relatedCount} related market{relatedCount !== 1 ? "s" : ""}
                  </span>
                )}
                {showBoostBadge ? <PredictFunBoostBadge /> : null}
                {boostStartsAtText ? <BoostMeta text={boostStartsAtText} /> : null}
              </div>
            </div>
          </div>
        </div>

        {/* Chart */}
        <div>
          {loading ? (
            <div className="skeleton skeleton-chart" style={{ width: 120, height: 32 }} />
          ) : (
            <MiniSparkline points={sparkPts} width={120} height={32} />
          )}
        </div>

        <div className="mono" style={{ fontWeight: 900 }}>
          {loading ? <div className="skeleton skeleton-text" style={{ width: 50, height: 14 }} /> : chanceText}
        </div>

        <div className="mono">{volText}</div>

        <div className="mono">{liqText}</div>

        <div className="mono muted">{expiresText}</div>
      </div>

      {/* Mobile Layout */}
      <div className="market-row-mobile" style={{ display: "none" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <OptimizedThumbnail url={imageUrl} size={56} radius={12} sizes="56px" />
          <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <div style={{
                  fontWeight: 700,
                  fontSize: 15,
                  lineHeight: 1.3,
                  color: "#fff",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}>
                  {titleParts.highlight ? (
                    <>
                      {titleParts.prefix}
                      <span style={{ color: "#A78BFA" }}>{titleParts.highlight}</span>
                      {titleParts.suffix}
                    </>
                  ) : (
                    displayTitle
                  )}
                </div>
                {relatedCount > 0 && (
                  <span style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "2px 7px",
                    background: "rgba(34,211,238,0.08)",
                    border: "1px solid rgba(34,211,238,0.2)",
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 600,
                    color: "rgba(34,211,238,0.8)",
                    whiteSpace: "nowrap",
                    flex: "0 0 auto",
                  }}>
                    {relatedCount} related market{relatedCount !== 1 ? "s" : ""}
                  </span>
                )}
                {showBoostBadge ? <PredictFunBoostBadge /> : null}
                {boostStartsAtText ? <BoostMeta text={boostStartsAtText} /> : null}
              </div>
            </div>
          </div>

        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 10,
          paddingTop: 10,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          fontSize: 12,
          color: "rgba(148,163,184,0.8)",
        }}>
          <span className="mono" style={{ fontWeight: 600 }}>{volText} Vol.</span>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="mono" style={{ fontWeight: 600 }}>{liqText} Liq.</span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12,6 12,12 16,14" />
              </svg>
              {expiresText}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default memo(PredictFunMarketRow, (prevProps, nextProps) => {
  return (
    prevProps.market?.id === nextProps.market?.id &&
    prevProps.initialData === nextProps.initialData &&
    prevProps.volMode === nextProps.volMode &&
    prevProps.isBoost === nextProps.isBoost &&
    prevProps.showBoostTime === nextProps.showBoostTime &&
    prevProps.priority === nextProps.priority &&
    prevProps.relatedCount === nextProps.relatedCount
  );
});
