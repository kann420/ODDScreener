"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import LineChart from "@/components/LineChart";
import { OptimizedThumbnail } from "@/components/OptimizedImage";
import PredictFunBoostBadge from "@/components/PredictFunBoostBadge";
import { clientGet, clientSet } from "@/lib/clientCache";

const SIDE_COLORS = {
  YES: "#4589ff",
  NO: "#f04438",
};

const RANGE_OPTIONS = [
  { key: "6H", label: "6h" },
  { key: "1D", label: "1d" },
  { key: "1W", label: "1w" },
  { key: "ALL", label: "All" },
];

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmtUsdFull(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDateShort(valueMs) {
  if (!valueMs) return "-";
  try {
    return new Date(valueMs).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "-";
  }
}

function fmtRelative(valueMs) {
  if (!valueMs) return "-";
  const diff = Date.now() - valueMs;
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}h ago`;
  return `${Math.floor(hour / 24)}d ago`;
}

function fmtQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "0";
  const isWhole = Math.abs(n - Math.round(n)) < 1e-9;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function fmtCents01(value, symbol = "c") {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "-";
  return `${(n * 100).toFixed(1).replace(/\.0$/, "")}${symbol}`;
}

function ExternalProfileIcon({ size = 13 }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function shortHash(value) {
  const s = String(value || "");
  if (!s) return "-";
  if (s.length <= 14) return s;
  return `${s.slice(0, 8)}...${s.slice(-6)}`;
}

function getAccountDisplayName(name, address) {
  const cleaned = String(name || "").trim();
  if (cleaned) return cleaned;
  return shortHash(address);
}

function PredictFunAccountAvatar({ imageUrl, name, address, accent }) {
  const [errored, setErrored] = useState(false);
  const label = getAccountDisplayName(name, address).replace(/^#\d+\s*/, "");
  const initials = label.slice(0, 2).toUpperCase() || "?";
  const showImage = Boolean(imageUrl) && !errored;

  return (
    <div
      style={{
        width: 34,
        height: 34,
        borderRadius: "999px",
        overflow: "hidden",
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: showImage
          ? "rgba(255,255,255,0.04)"
          : `linear-gradient(135deg, ${accent} 0%, rgba(255,255,255,0.16) 100%)`,
      }}
    >
      {showImage ? (
        <img
          src={imageUrl}
          alt=""
          width="34"
          height="34"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          onError={() => setErrored(true)}
        />
      ) : (
        <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", letterSpacing: "0.02em" }}>
          {initials}
        </span>
      )}
    </div>
  );
}

function rerankHolderRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((holder, index) => ({
    ...holder,
    rank: index + 1,
  }));
}

function appendHolderOutcomePage(existingOutcomes, nextOutcome) {
  if (!nextOutcome) return Array.isArray(existingOutcomes) ? existingOutcomes : [];

  const targetOutcomeId = String(nextOutcome?.outcomeId || "");
  const currentOutcomes = Array.isArray(existingOutcomes) ? existingOutcomes : [];

  return currentOutcomes.map((outcome) => {
    if (String(outcome?.outcomeId || "") !== targetOutcomeId) return outcome;

    const currentRows = Array.isArray(outcome?.holders) ? outcome.holders : [];
    const incomingRows = Array.isArray(nextOutcome?.holders) ? nextOutcome.holders : [];
    const seen = new Set(
      currentRows.map((holder) => String(holder?.id || holder?.accountAddress || ""))
    );
    const mergedRows = [...currentRows];

    for (const holder of incomingRows) {
      const key = String(holder?.id || holder?.accountAddress || "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      mergedRows.push(holder);
    }

    return {
      ...outcome,
      ...nextOutcome,
      holders: rerankHolderRows(mergedRows),
    };
  });
}

function getRangeMs(rangeKey) {
  if (rangeKey === "6H") return 6 * 60 * 60 * 1000;
  if (rangeKey === "1D") return 24 * 60 * 60 * 1000;
  if (rangeKey === "1W") return 7 * 24 * 60 * 60 * 1000;
  return null;
}

function getChartHistoryLimit(rangeKey) {
  if (rangeKey === "6H") return 240;
  if (rangeKey === "1D") return 600;
  if (rangeKey === "1W") return 2400;
  return 5000;
}

function buildChartPoints(historyRows, selectedSide, rangeKey) {
  const sorted = (Array.isArray(historyRows) ? historyRows : [])
    .map((point) => ({
      timestampMs: numberOrNull(point?.timestampMs ?? point?.t),
      yesPrice: numberOrNull(point?.yesPrice ?? point?.p),
    }))
    .filter((point) => Number.isFinite(point.timestampMs) && Number.isFinite(point.yesPrice))
    .sort((a, b) => a.timestampMs - b.timestampMs);

  const cutoffMs = getRangeMs(rangeKey);
  const filtered = cutoffMs
    ? sorted.filter((point) => point.timestampMs >= Date.now() - cutoffMs)
    : sorted;
  const picked = filtered.length >= 2 ? filtered : sorted;

  return picked
    .map((point) => ({
      t: point.timestampMs,
      p: selectedSide === "NO" ? 1 - point.yesPrice : point.yesPrice,
    }))
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p));
}

function getSelectedChance(detail, orderbook, trades, selectedSide) {
  const detailSide = Array.isArray(detail?.sides)
    ? detail.sides.find((side) => side.key === selectedSide)
    : null;
  if (Number.isFinite(detailSide?.chance)) return detailSide.chance;

  const orderbookMid = selectedSide === "NO"
    ? numberOrNull(orderbook?.midNo)
    : numberOrNull(orderbook?.midYes);
  if (Number.isFinite(orderbookMid)) return orderbookMid;

  const latestTrade = Array.isArray(trades) ? trades[0] : null;
  const tradePrice = selectedSide === "NO"
    ? numberOrNull(latestTrade?.noPrice)
    : numberOrNull(latestTrade?.yesPrice);
  if (Number.isFinite(tradePrice)) return tradePrice;

  return null;
}

function buildAsksDepth(rows) {
  const sorted = [...rows].sort((a, b) => b.price - a.price);
  const result = new Array(sorted.length);
  let cumShares = 0;
  let cumTotal = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    cumShares += num(sorted[i].shares);
    cumTotal += num(sorted[i].total);
    result[i] = { ...sorted[i], cumShares, cumTotal };
  }
  return result;
}

function buildBidsDepth(rows) {
  const sorted = [...rows].sort((a, b) => b.price - a.price);
  let cumShares = 0;
  let cumTotal = 0;
  return sorted.map((row) => {
    cumShares += num(row.shares);
    cumTotal += num(row.total);
    return { ...row, cumShares, cumTotal };
  });
}

function getTradeTypeMeta(trade) {
  const side = String(trade?.side || "").toUpperCase();
  if (side === "BUY") return { label: "BUY", color: "#22c55e" };
  if (side === "SELL") return { label: "SELL", color: "#ef4444" };

  const quoteType = String(trade?.quoteType || "").toUpperCase();
  if (quoteType === "BID") return { label: "BUY", color: "#22c55e" };
  if (quoteType === "ASK") return { label: "SELL", color: "#ef4444" };
  return { label: "-", color: "rgba(148,163,184,0.9)" };
}

function PredictFunChartPanel({
  outcome,
  onOutcomeChange,
  yesLabel,
  noLabel,
  chartPoints,
  loading,
  error,
  range,
  onRangeChange,
  volume24hUsd,
  lastPrice,
  chance,
}) {
  const chartColor = outcome === "YES" ? SIDE_COLORS.YES : SIDE_COLORS.NO;
  const displayChance = Number.isFinite(chance)
    ? chance * 100
    : (chartPoints.length ? num(chartPoints[chartPoints.length - 1]?.p) * 100 : 0);

  return (
    <div className="panel chart-panel" style={{ padding: 10, height: 530, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "inline-flex",
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.03)",
              borderRadius: 12,
              padding: 2,
              gap: 2,
            }}
          >
            <button
              className="btn"
              onClick={() => onOutcomeChange("YES")}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                opacity: outcome === "YES" ? 1 : 0.65,
                background: outcome === "YES" ? "rgba(69,137,255,0.18)" : "transparent",
                border: outcome === "YES" ? "1px solid rgba(69,137,255,0.34)" : "1px solid transparent",
              }}
            >
              {yesLabel}
            </button>
            <button
              className="btn"
              onClick={() => onOutcomeChange("NO")}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                opacity: outcome === "NO" ? 1 : 0.65,
                background: outcome === "NO" ? "rgba(240,68,56,0.14)" : "transparent",
                border: outcome === "NO" ? "1px solid rgba(240,68,56,0.30)" : "1px solid transparent",
              }}
            >
              {noLabel}
            </button>
          </div>

          <div
            className="chart-chance-label"
            style={{
              fontSize: 22,
              fontWeight: 900,
              color: chartColor,
            }}
          >
            {loading ? (
              <div className="skeleton" style={{ width: 120, height: 26, borderRadius: 6 }} />
            ) : (
              `${displayChance.toFixed(1).replace(/\.0$/, "")}% CHANCE`
            )}
          </div>
        </div>
      </div>

      <div className="chart-area" style={{ marginTop: 8, flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div className="chart-container" style={{ flex: 1, minHeight: 0 }}>
          {loading && chartPoints.length === 0 ? (
            <div className="skeleton" style={{ width: "100%", height: "100%", borderRadius: 12 }} />
          ) : (
            <LineChart pts={chartPoints} color={chartColor} range={range} />
          )}
        </div>
      </div>

      <div className="chart-controls" style={{ display: "flex", gap: 8, marginTop: 0, alignItems: "center" }}>
        {RANGE_OPTIONS.map((option) => (
          <button key={option.key} className="btn" onClick={() => onRangeChange(option.key)} style={{ opacity: range === option.key ? 1 : 0.65 }}>
            {option.label}
          </button>
        ))}
        <div className="spacer" />
        <div className="chart-volume-info" style={{ display: "flex", gap: 12, color: "rgba(148,163,184,0.95)", fontSize: 12 }}>
          <div>
            Volume: <span style={{ color: "rgba(34,197,94,0.95)", fontWeight: 900 }}>{fmtUsdFull(volume24hUsd)}</span>
          </div>
          <div>
            Last: <span style={{ color: chartColor, fontWeight: 900 }}>{Number.isFinite(lastPrice) ? lastPrice.toFixed(2) : "-"}</span>
          </div>
        </div>
      </div>

      {error ? (
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Error: {error}
        </div>
      ) : null}
    </div>
  );
}

function PredictFunOrderbookPanel({ outcome, onOutcomeChange, yesLabel, noLabel, sideData, loading }) {
  const asksScrollRef = useRef(null);
  const asks = Array.isArray(sideData?.asks) ? sideData.asks : [];
  const bids = Array.isArray(sideData?.bids) ? sideData.bids : [];
  const asksDepth = buildAsksDepth(asks);
  const bidsDepth = buildBidsDepth(bids);
  const outcomeLabel = outcome === "YES" ? yesLabel : noLabel;
  const spread = bids[0] && asks[0] ? num(asks[0].price) - num(bids[0].price) : null;

  useEffect(() => {
    if (!asksScrollRef.current || asksDepth.length === 0) return;
    asksScrollRef.current.scrollTop = asksScrollRef.current.scrollHeight;
  }, [asksDepth, outcome]);

  return (
    <div className="panel orderbook-panel">
      <div className="orderbook-header">
        <div className="orderbook-title">Order Book</div>
        <div className="outcome-toggle">
          <button
            onClick={() => onOutcomeChange("YES")}
            className={`outcome-btn outcome-btn-yes ${outcome === "YES" ? "active" : ""}`}
            style={outcome === "YES" ? { background: SIDE_COLORS.YES, color: "#fff" } : undefined}
          >
            {yesLabel}
          </button>
          <button
            onClick={() => onOutcomeChange("NO")}
            className={`outcome-btn outcome-btn-no ${outcome === "NO" ? "active" : ""}`}
            style={outcome === "NO" ? { background: SIDE_COLORS.NO, color: "#fff" } : undefined}
          >
            {noLabel}
          </button>
        </div>
      </div>

      <div className="orderbook-col-header">
        <div>PRICE</div>
        <div style={{ textAlign: "center" }}>SHARES</div>
        <div style={{ textAlign: "right" }}>TOTAL</div>
      </div>

      <div className="orderbook-side-section" style={{ marginTop: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span className="pill" style={{ color: "#fff", background: "rgba(239,68,68,0.18)" }}>Asks ({outcomeLabel})</span>
        </div>
        <div ref={asksScrollRef} className="orderbook-scroll" style={{ maxHeight: 5 * 56, overflowY: "auto" }}>
          {loading && asks.length === 0 ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={`ask-skel-${i}`} style={{ marginTop: 6 }}>
                <div className="skeleton" style={{ height: 44, borderRadius: 10 }} />
              </div>
            ))
          ) : asksDepth.length === 0 ? (
            <div className="orderbook-empty-state">
              <span>No asks available</span>
              <span className="orderbook-empty-hint">Waiting for sell orders</span>
            </div>
          ) : (
            asksDepth.map((row, i) => {
              const maxCum = Math.max(1, ...asksDepth.map((x) => x.cumTotal));
              const pct = Math.max(0, Math.min(100, (row.cumTotal / maxCum) * 100));
              return (
                <div key={`ask-${i}`} className="orderbook-row orderbook-row-ask">
                  <div className="orderbook-row-depth" style={{ width: `${pct}%` }} />
                  <div className="orderbook-row-content">
                    <div className="red orderbook-price">{fmtCents01(row.price)}</div>
                    <div className="muted orderbook-shares" style={{ fontFamily: "inherit", fontWeight: 500 }}>{fmtQty(row.shares)}</div>
                    <div className="orderbook-total" style={{ fontFamily: "inherit", fontWeight: 600 }}>{fmtUsdFull(row.cumTotal)}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="orderbook-spread-row">
        <span className="orderbook-spread-label">Spread</span>
        <span className="orderbook-spread-value" style={{ fontFamily: "inherit" }}>
          {Number.isFinite(spread) ? fmtCents01(spread) : "-"}
        </span>
      </div>

      <div className="orderbook-side-section" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span className="pill" style={{ color: "#fff", background: "rgba(69,137,255,0.18)" }}>Bids ({outcomeLabel})</span>
        </div>
        <div className="orderbook-scroll" style={{ maxHeight: 5 * 56, overflowY: "auto" }}>
          {loading && bids.length === 0 ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={`bid-skel-${i}`} style={{ marginTop: 6 }}>
                <div className="skeleton" style={{ height: 44, borderRadius: 10 }} />
              </div>
            ))
          ) : bidsDepth.length === 0 ? (
            <div className="orderbook-empty-state">
              <span>No bids available</span>
              <span className="orderbook-empty-hint">Waiting for buy orders</span>
            </div>
          ) : (
            bidsDepth.map((row, i) => {
              const maxCum = Math.max(1, ...bidsDepth.map((x) => x.cumTotal));
              const pct = Math.max(0, Math.min(100, (row.cumTotal / maxCum) * 100));
              return (
                <div key={`bid-${i}`} className="orderbook-row orderbook-row-bid">
                  <div className="orderbook-row-depth orderbook-row-depth-bid" style={{ width: `${pct}%` }} />
                  <div className="orderbook-row-content">
                    <div className="orderbook-price" style={{ color: SIDE_COLORS.YES }}>{fmtCents01(row.price)}</div>
                    <div className="muted orderbook-shares" style={{ fontFamily: "inherit", fontWeight: 500 }}>{fmtQty(row.shares)}</div>
                    <div className="orderbook-total" style={{ fontFamily: "inherit", fontWeight: 600 }}>{fmtUsdFull(row.cumTotal)}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function fmtCompactUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "-";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtCompactShares(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n >= 100) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 0.01) {
    return n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  }
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

function getTraderBalanceMeta(trader) {
  if (trader?.currentBalanceKnown !== true) return null;

  const currentShares = num(trader?.currentShares);
  const totalShares = num(trader?.currentTotalShares);
  const currentOutcome = String(trader?.currentSharesOutcome || "").trim().toUpperCase();
  const otherShares = num(trader?.currentOtherShares);
  const otherOutcome = String(trader?.currentOtherOutcome || "").trim().toUpperCase();

  return {
    currentShares,
    currentOutcome: currentOutcome || null,
    otherShares,
    otherOutcome: otherOutcome || null,
    totalShares,
    ratio: totalShares > 0 ? Math.min(currentShares / totalShares, 1) : 0,
  };
}

function PredictFunBottomPanel({
  activeTab,
  onTabChange,
  rules,
  rulesLoading,
  trades,
  tradesLoading,
  holders,
  holdersLoading,
  holdersError,
  yesLabel,
  noLabel,
  holdersCount,
  outcomeHolderCounts,
  holdersLoadMoreLoading,
  onLoadMoreHolders,
  expandAnimationKey,
  topTraders,
  topTradersLoading,
  topTradersError,
}) {
  const holderColumnRefs = useRef({});
  const holderOutcomeCounts = Array.isArray(outcomeHolderCounts) ? outcomeHolderCounts : [];
  const namedOutcomeHolders = Array.isArray(holders) ? holders : [];
  const normalizedOutcomeHolders = (namedOutcomeHolders.length > 0
    ? namedOutcomeHolders.map((outcome, index) => {
      const outcomeName = String(outcome?.outcomeName || "").trim();
      const fallbackByName = holderOutcomeCounts.find(
        (item) => String(item?.name || "").trim().toUpperCase() === outcomeName.toUpperCase()
      );
      const fallback = fallbackByName || holderOutcomeCounts[index] || null;
      return {
        outcomeId: outcome?.outcomeId ?? `outcome:${index}`,
        outcomeName: outcomeName || String(fallback?.name || "").trim() || (index === 0 ? yesLabel : noLabel),
        holdersCount: Number.isFinite(outcome?.holdersCount)
          ? outcome.holdersCount
          : numberOrNull(fallback?.holdersCount),
        hasNextPage: outcome?.hasNextPage === true,
        endCursor: outcome?.endCursor || null,
        holders: Array.isArray(outcome?.holders) ? outcome.holders : [],
        position: index,
      };
    })
    : holderOutcomeCounts.map((item, index) => ({
      outcomeId: `count:${index}`,
      outcomeName: String(item?.name || "").trim() || (index === 0 ? yesLabel : noLabel),
      holdersCount: numberOrNull(item?.holdersCount),
      hasNextPage: false,
      endCursor: null,
      holders: [],
      position: index,
    })));

  const hasHolderSurface = Number.isFinite(holdersCount)
    || holderOutcomeCounts.length > 0
    || holdersLoading
    || Boolean(holdersError)
    || normalizedOutcomeHolders.length > 0;
  const canLoadMoreAny = normalizedOutcomeHolders.some((outcome) => {
    const holderRows = Array.isArray(outcome?.holders) ? outcome.holders : [];
    const totalCount = Number.isFinite(outcome?.holdersCount) ? outcome.holdersCount : holderRows.length;
    return Boolean(outcome?.endCursor) && totalCount > holderRows.length;
  });

  useEffect(() => {
    if (!expandAnimationKey) return;
    const nodes = Object.values(holderColumnRefs.current).filter(Boolean);
    for (const node of nodes) {
      if (typeof node?.animate !== "function") continue;
      node.animate(
        [
          { transform: "translateY(0) scaleY(0.992)", opacity: 0.9, filter: "brightness(0.96)" },
          { transform: "translateY(0) scaleY(1)", opacity: 1, filter: "brightness(1)" },
        ],
        {
          duration: 260,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        }
      );
    }
  }, [expandAnimationKey]);

  return (
    <div className="panel trades-panel">
      <div className="tabs">
        <div className={`tab${activeTab === "rules" ? " active" : ""}`} onClick={() => onTabChange("rules")}>Rules</div>
        <div className={`tab${activeTab === "trades" ? " active" : ""}`} onClick={() => onTabChange("trades")}>Trades</div>
        <div className={`tab${activeTab === "toptraders" ? " active" : ""}`} onClick={() => onTabChange("toptraders")}>Top Traders</div>
        <div className={`tab${activeTab === "holders" ? " active" : ""}`} onClick={() => onTabChange("holders")}>
          {Number.isFinite(holdersCount) ? `Holders (${holdersCount})` : "Holders"}
        </div>
      </div>

      {activeTab === "rules" ? (
        <div style={{ padding: "12px 16px" }}>
          {rules ? (
            <div style={{ fontSize: 13, lineHeight: 1.7, color: "rgba(255,255,255,0.75)", whiteSpace: "pre-wrap", maxHeight: 400, overflowY: "auto" }}>
              {rules}
            </div>
          ) : (
            <div className="trades-empty-content" style={{ padding: "32px 0" }}>
              <span className="trades-empty-title">{rulesLoading ? "Loading rules..." : "No rules found"}</span>
              <span className="trades-empty-hint">{rulesLoading ? "Resolution rules are still loading" : "Predict.fun did not provide additional rules"}</span>
            </div>
          )}
        </div>
      ) : null}

      {activeTab === "trades" ? (
        <div style={{ padding: "12px 16px" }}>
          <div className="trades-table-wrap">
            <table className="trades-table trades-table--with-separators">
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
                {trades.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="trades-empty-state">
                      <div className="trades-empty-content">
                        <span className="trades-empty-title">{tradesLoading ? "Loading trades..." : "No recent trades yet"}</span>
                        <span className="trades-empty-hint">{tradesLoading ? "Pulling recent matches from Predict.fun" : "Matched trades will appear here"}</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  trades.map((trade) => {
                    const typeMeta = getTradeTypeMeta(trade);
                    const outcomeLabel = trade?.outcomeLabel || (String(trade?.sideKey || "").toUpperCase() === "NO" ? noLabel : yesLabel);
                    const outcomeColor = String(trade?.sideKey || "").toUpperCase() === "NO" ? SIDE_COLORS.NO : SIDE_COLORS.YES;
                    const traderName = getAccountDisplayName(trade?.accountName, trade?.signer || trade?.txHash);
                    const traderAddress = trade?.signer || null;
                    const showTraderAddress = Boolean(trade?.accountName) && Boolean(traderAddress);
                    const walletHref = traderAddress
                      ? `/wallet/predictfun/${encodeURIComponent(traderAddress)}`
                      : null;

                    return (
                      <tr key={trade.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", animation: "fadeIn 0.3s ease" }}>
                        <td className="muted" style={{ padding: "12px 12px 12px 0", fontSize: 13, whiteSpace: "nowrap" }}>
                          {fmtRelative(trade.timestampMs)}
                        </td>
                        <td style={{ padding: "12px" }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: outcomeColor }}>{outcomeLabel}</span>
                        </td>
                        <td style={{ padding: "12px" }}>
                          <span style={{ color: typeMeta.color, fontWeight: 700, fontSize: 13 }}>{typeMeta.label}</span>
                        </td>
                        <td style={{ padding: "12px", fontWeight: 500, fontSize: 13 }}>{fmtCents01(trade.outcomePrice, "¢")}</td>
                        <td style={{ padding: "12px", fontWeight: 500, fontSize: 13 }}>{fmtQty(trade.size)}</td>
                        <td style={{ padding: "12px", color: typeMeta.color, fontWeight: 600, fontSize: 13 }}>{fmtUsdFull(trade.notionalUsd)}</td>
                        <td style={{ padding: "12px", fontSize: 13 }}>
                          <div style={{ display: "grid", gap: 2 }}>
                            {walletHref ? (
                              <Link
                                href={walletHref}
                                className="pf-holder-link"
                                title={`Open ${traderName} in wallet tracker`}
                                aria-label={`Open ${traderName} in wallet tracker`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <span className="pf-holder-link-text">{traderName}</span>
                                <span className="pf-holder-link-icon">
                                  <ExternalProfileIcon />
                                </span>
                              </Link>
                            ) : (
                              <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{traderName}</span>
                            )}
                            {showTraderAddress ? (
                              <span className="muted" style={{ fontSize: 12 }}>
                                {shortHash(traderAddress)}
                              </span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {activeTab === "toptraders" ? (
        <div style={{ padding: "12px 16px" }}>
          {topTradersLoading && (!Array.isArray(topTraders) || topTraders.length === 0) ? (
            <div className="trades-empty-content" style={{ padding: "32px 0" }}>
              <span className="trades-empty-title">Loading top traders...</span>
              <span className="trades-empty-hint">Aggregating trade data from Predict.fun</span>
            </div>
          ) : topTradersError && (!Array.isArray(topTraders) || topTraders.length === 0) ? (
            <div className="trades-empty-content" style={{ padding: "32px 0" }}>
              <span className="trades-empty-title">Failed to load top traders</span>
              <span className="trades-empty-hint">{topTradersError}</span>
            </div>
          ) : Array.isArray(topTraders) && topTraders.length > 0 ? (
            <div className="trades-table-wrap pf-top-traders-table-wrap">
              <table className="trades-table trades-table--with-separators pf-top-traders-table">
                <colgroup>
                  <col style={{ width: "5%" }} />
                  <col style={{ width: "26%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "5%" }} />
                </colgroup>
                <thead className="trades-table-header">
                  <tr>
                    <th style={{ width: 50, textAlign: "center" }}>RANK</th>
                    <th>MAKER</th>
                    <th style={{ textAlign: "center" }}>OUTCOME</th>
                    <th style={{ textAlign: "right" }}>BOUGHT</th>
                    <th style={{ textAlign: "right" }}>SOLD</th>
                    <th style={{ textAlign: "right" }}>PNL</th>
                    <th style={{ textAlign: "center" }}>BALANCE</th>
                    <th style={{ textAlign: "center", width: 60 }}>TXNS</th>
                  </tr>
                </thead>
                <tbody>
                  {topTraders.map((trader) => {
                    const pnl = Number(trader.pnl) || 0;
                    const pnlColor = pnl > 0 ? "#22c55e" : pnl < 0 ? "#ef4444" : "rgba(148,163,184,0.9)";
                    const traderLabel = getAccountDisplayName(trader.accountName, trader.address);
                    const showAddress = Boolean(trader.accountName) && Boolean(trader.address);
                    const walletHref = trader?.address
                      ? `/wallet/predictfun/${encodeURIComponent(trader.address)}`
                      : null;
                    const outcomeRaw = String(trader.outcome || "").trim().toUpperCase();
                    const isNo = outcomeRaw === "NO" || outcomeRaw === String(noLabel || "").trim().toUpperCase();
                    const isYes = outcomeRaw === "YES" || outcomeRaw === String(yesLabel || "").trim().toUpperCase();
                    const outcomeColor = isNo ? SIDE_COLORS.NO : isYes ? SIDE_COLORS.YES : "rgba(148,163,184,0.9)";
                    const outcomeDisplay = trader.outcome || "-";
                    const balanceMeta = getTraderBalanceMeta(trader);
                    const balanceFillWidth = balanceMeta
                      ? `${Math.max(balanceMeta.ratio * 100, balanceMeta.currentShares > 0 ? 6 : 0)}%`
                      : "0%";

                    return (
                      <tr key={trader.address} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <td style={{ padding: "10px 8px", textAlign: "center", fontSize: 14, fontWeight: 700, color: "rgba(148,163,184,0.95)" }}>
                          {trader.rank}
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, maxWidth: 220, minWidth: 0 }}>
                            <PredictFunAccountAvatar
                              imageUrl={trader.accountImageUrl}
                              name={trader.accountName}
                              address={trader.address}
                              accent={outcomeColor}
                            />
                            <div style={{ display: "grid", gap: 2, minWidth: 0, maxWidth: 164 }}>
                              {walletHref ? (
                                <Link
                                  href={walletHref}
                                  className="pf-holder-link"
                                  title={`Open ${traderLabel} in wallet tracker`}
                                  aria-label={`Open ${traderLabel} in wallet tracker`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <span className="pf-holder-link-text">{traderLabel}</span>
                                  <span className="pf-holder-link-icon">
                                    <ExternalProfileIcon />
                                  </span>
                                </Link>
                              ) : (
                                <span style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {traderLabel}
                                </span>
                              )}
                              {showAddress ? (
                                <span className="muted" style={{ fontSize: 12 }}>{shortHash(trader.address)}</span>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "center" }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: outcomeColor }}>{outcomeDisplay}</span>
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          {trader.boughtTxns > 0 ? (
                            <div style={{ display: "grid", gap: 2 }}>
                              <span style={{ fontSize: 13, fontWeight: 600, color: "#22c55e" }}>{fmtCompactUsd(trader.boughtUsd)}</span>
                              <span className="muted" style={{ fontSize: 11 }}>{fmtCompactShares(trader.boughtShares)} / {trader.boughtTxns} txns</span>
                            </div>
                          ) : (
                            <span className="muted" style={{ fontSize: 13 }}>-</span>
                          )}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          {trader.soldTxns > 0 ? (
                            <div style={{ display: "grid", gap: 2 }}>
                              <span style={{ fontSize: 13, fontWeight: 600, color: "#ef4444" }}>{fmtCompactUsd(trader.soldUsd)}</span>
                              <span className="muted" style={{ fontSize: 11 }}>{fmtCompactShares(trader.soldShares)} / {trader.soldTxns} txns</span>
                            </div>
                          ) : (
                            <span className="muted" style={{ fontSize: 13 }}>-</span>
                          )}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: pnlColor }}>
                            {fmtCompactUsd(pnl)}
                          </span>
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "center" }}>
                          {balanceMeta ? (
                            <div className="pf-top-trader-balance">
                              <span className="pf-top-trader-balance-text">
                                <strong>{fmtCompactShares(balanceMeta.currentShares)}</strong>
                                {balanceMeta.currentOutcome ? ` ${balanceMeta.currentOutcome}` : ""}
                              </span>
                              {balanceMeta.otherShares > 0 ? (
                                <span className="muted" style={{ fontSize: 11 }}>
                                  {fmtCompactShares(balanceMeta.otherShares)} {balanceMeta.otherOutcome}
                                </span>
                              ) : null}
                              <span className="pf-top-trader-balance-bar">
                                <span
                                  className="pf-top-trader-balance-fill"
                                  style={{ width: balanceFillWidth }}
                                />
                              </span>
                            </div>
                          ) : (
                            <span className="muted" style={{ fontSize: 12 }}>Unavailable</span>
                          )}
                        </td>
                        <td style={{ padding: "10px 8px", textAlign: "center", fontSize: 13, color: "rgba(148,163,184,0.9)" }}>
                          {trader.txns}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="trades-empty-content" style={{ padding: "32px 0" }}>
              <span className="trades-empty-title">No top traders data</span>
              <span className="trades-empty-hint">No matched trades found for this market</span>
            </div>
          )}
        </div>
      ) : null}

      {activeTab === "holders" ? (
        <div style={{ padding: "12px 16px" }}>
          {hasHolderSurface ? (
            <div style={{ display: "grid", gap: 12 }}>
              {Number.isFinite(holdersCount) ? (
                <div
                  style={{
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 12,
                    padding: "14px 16px",
                    background: "rgba(255,255,255,0.02)",
                  }}
                >
                  <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Unique holders</div>
                  <div style={{ fontSize: 24, fontWeight: 900, color: "#fff" }}>{holdersCount}</div>
                </div>
              ) : null}

              {holdersLoading && (!Array.isArray(holders) || holders.length === 0) ? (
                <div className="trades-empty-content" style={{ padding: "24px 0" }}>
                  <span className="trades-empty-title">Loading holders...</span>
                  <span className="trades-empty-hint">Pulling named holder data from Predict.fun public GraphQL</span>
                </div>
              ) : null}

              {!holdersLoading && holdersError ? (
                <div className="trades-empty-content" style={{ padding: "24px 0" }}>
                  <span className="trades-empty-title">Failed to load holder names</span>
                  <span className="trades-empty-hint">{holdersError}</span>
                </div>
              ) : null}

              {normalizedOutcomeHolders.length > 0 ? (
                <div className="pf-holders-grid">
                  {normalizedOutcomeHolders.map((outcome, outcomePosition) => {
                    const isNo = outcomePosition === 1
                      || String(outcome?.outcomeName || "").trim().toUpperCase() === String(noLabel || "").trim().toUpperCase();
                    const accent = isNo ? SIDE_COLORS.NO : SIDE_COLORS.YES;
                    const holderRows = Array.isArray(outcome?.holders) ? outcome.holders : [];
                    const totalCount = Number.isFinite(outcome?.holdersCount) ? outcome.holdersCount : holderRows.length;
                    const outcomeTitle = String(outcome?.outcomeName || "-").trim() || "-";
                    const titleText = Number.isFinite(totalCount)
                      ? `${totalCount.toLocaleString("en-US")} ${outcomeTitle} Holders`
                      : `${outcomeTitle} Holders`;

                    return (
                      <div
                        key={`${outcome?.outcomeId || outcome?.outcomeName || "outcome"}:${totalCount}`}
                        className="pf-holders-col"
                        ref={(node) => {
                          holderColumnRefs.current[String(outcome?.outcomeId || outcomePosition)] = node;
                        }}
                      >
                        <div
                          className="pf-holders-col-header"
                        >
                          <span className="pf-holders-col-title" style={{ color: accent }}>
                            {titleText}
                          </span>
                          <span className="muted pf-holders-col-sub">
                            Showing {holderRows.length}/{totalCount}
                          </span>
                        </div>

                        {holderRows.length > 0 ? (
                          <>
                            <div className="pf-holders-list">
                              {holderRows.map((holder) => {
                              const displayName = getAccountDisplayName(holder?.accountName, holder?.accountAddress);
                              const showHolderAddress = Boolean(holder?.accountName) && Boolean(holder?.accountAddress);
                              const walletHref = holder?.accountAddress
                                ? `/wallet/predictfun/${encodeURIComponent(holder.accountAddress)}`
                                : null;
                              const rowRank = Number.isFinite(holder?.rank) ? holder.rank : 0;

                              return (
                                <div
                                  key={`${outcome?.outcomeId || outcomePosition}:${holder?.id || holder?.accountAddress || holder?.rank || "holder"}`}
                                  className="pf-holders-row"
                                >
                                  <div className="pf-holders-left">
                                    <span className="pf-holders-rank">{rowRank > 0 ? rowRank : "-"}</span>
                                    <PredictFunAccountAvatar
                                      imageUrl={holder?.accountImageUrl}
                                      name={holder?.accountName}
                                      address={holder?.accountAddress}
                                      accent={accent}
                                    />
                                    <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                                      {walletHref ? (
                                        <Link
                                          href={walletHref}
                                          className="pf-holder-link"
                                          title={`Open ${displayName} in wallet tracker`}
                                          aria-label={`Open ${displayName} in wallet tracker`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                        >
                                          <span className="pf-holder-link-text">{displayName}</span>
                                          <span className="pf-holder-link-icon">
                                            <ExternalProfileIcon />
                                          </span>
                                        </Link>
                                      ) : (
                                        <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 700 }}>
                                          {displayName}
                                        </span>
                                      )}
                                      {showHolderAddress ? (
                                        <span className="muted" style={{ fontSize: 12 }}>
                                          {shortHash(holder.accountAddress)}
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                  <div className="pf-holders-right">
                                    <span className="pf-holders-shares" style={{ color: accent }}>
                                      {fmtQty(holder?.shares)}
                                    </span>
                                    <span className="muted" style={{ fontSize: 12, textTransform: "lowercase" }}>
                                      shares
                                    </span>
                                  </div>
                                </div>
                              );
                              })}
                            </div>

                          </>
                        ) : (
                          <div className="trades-empty-content" style={{ padding: "24px 0" }}>
                            <span className="trades-empty-title">No holder rows returned</span>
                            <span className="trades-empty-hint">Predict.fun only exposed aggregate counts for this outcome</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {canLoadMoreAny && onLoadMoreHolders ? (
                <div className="pf-holders-load-more pf-holders-load-more-global">
                  <button
                    className="btn"
                    onClick={() => onLoadMoreHolders()}
                    disabled={holdersLoadMoreLoading}
                    style={{
                      minWidth: 156,
                      opacity: holdersLoadMoreLoading ? 0.7 : 1,
                    }}
                  >
                    {holdersLoadMoreLoading ? "Loading..." : "Load more"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="trades-empty-content" style={{ padding: "32px 0" }}>
              <span className="trades-empty-title">Holder counts unavailable</span>
              <span className="trades-empty-hint">Predict.fun did not expose holder counts for this market in the current response</span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function PredictFunDetailView({ initialDetail }) {
  const marketId = initialDetail?.marketId;
  const holdersKey = `pf-detail:holders:${marketId}`;
  const [detail, setDetail] = useState(initialDetail);
  const [orderbook, setOrderbook] = useState(null);
  const [trades, setTrades] = useState([]);
  const [chartHistory, setChartHistory] = useState([]);
  const [holders, setHolders] = useState([]);
  const [topTraders, setTopTraders] = useState([]);
  const [holdersLoadMoreLoading, setHoldersLoadMoreLoading] = useState(false);
  const [holdersExpandAnimationKey, setHoldersExpandAnimationKey] = useState(0);
  const [selectedSide, setSelectedSide] = useState(initialDetail?.chart?.defaultSide || "YES");
  const [range, setRange] = useState("1D");
  const [activeBottomTab, setActiveBottomTab] = useState("trades");
  const [loading, setLoading] = useState({ enrich: true, orderbook: true, trades: true, chart: true, holders: true, topTraders: false });
  const [errors, setErrors] = useState({ enrich: null, orderbook: null, trades: null, chart: null, holders: null, topTraders: null });
  const topTradersLoadedRef = useRef(false);
  const [siblings, setSiblings] = useState([]);
  const [showSiblingsDropdown, setShowSiblingsDropdown] = useState(false);
  const [siblingsPopupPos, setSiblingsPopupPos] = useState({ top: 0, left: 0 });
  const siblingsDropdownRef = useRef(null);
  const siblingsButtonRef = useRef(null);

  useEffect(() => {
    if (!marketId) return undefined;
    let alive = true;

    const enrichKey = `pf-detail:enrich:${marketId}`;
    const orderbookKey = `pf-detail:orderbook:${marketId}`;
    const tradesKey = `pf-detail:trades:${marketId}`;
    const cachedEnrich = clientGet(enrichKey);
    const cachedOrderbook = clientGet(orderbookKey);
    const cachedTrades = clientGet(tradesKey);
    const cachedHolders = clientGet(holdersKey);

    if (cachedEnrich) {
      setDetail((prev) => ({ ...prev, ...cachedEnrich }));
      setLoading((prev) => ({ ...prev, enrich: false }));
    }
    if (cachedOrderbook) {
      setOrderbook(cachedOrderbook);
      setLoading((prev) => ({ ...prev, orderbook: false }));
    }
    if (cachedTrades) {
      setTrades(cachedTrades);
      setLoading((prev) => ({ ...prev, trades: false }));
    }
    if (cachedHolders) {
      setHolders(cachedHolders);
      setLoading((prev) => ({ ...prev, holders: false }));
    }

    async function loadEnrich(force = false) {
      if (!force && cachedEnrich) return;
      setLoading((prev) => ({ ...prev, enrich: true }));
      try {
        const res = await fetch(`/api/predictfun/market/${marketId}/enrich`, { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(json?.error || "Failed to load market details");
        clientSet(enrichKey, json, 20_000);
        setDetail((prev) => ({ ...prev, ...json }));
        setErrors((prev) => ({ ...prev, enrich: null }));
      } catch (err) {
        if (alive) setErrors((prev) => ({ ...prev, enrich: err?.message || "Failed to load market details" }));
      } finally {
        if (alive) setLoading((prev) => ({ ...prev, enrich: false }));
      }
    }

    async function loadOrderbook(force = false) {
      if (!force && cachedOrderbook) return;
      setLoading((prev) => ({ ...prev, orderbook: true }));
      try {
        const res = await fetch(`/api/predictfun/market/${marketId}/orderbook`, { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(json?.error || "Failed to load orderbook");
        clientSet(orderbookKey, json, 10_000);
        setOrderbook(json);
        setErrors((prev) => ({ ...prev, orderbook: null }));
      } catch (err) {
        if (alive) setErrors((prev) => ({ ...prev, orderbook: err?.message || "Failed to load orderbook" }));
      } finally {
        if (alive) setLoading((prev) => ({ ...prev, orderbook: false }));
      }
    }

    async function loadTrades(force = false) {
      if (!force && cachedTrades) return;
      setLoading((prev) => ({ ...prev, trades: true }));
      try {
        const res = await fetch(`/api/predictfun/market/${marketId}/trades?limit=160`, { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(json?.error || "Failed to load recent trades");
        const nextTrades = Array.isArray(json?.trades) ? json.trades : [];
        clientSet(tradesKey, nextTrades, 15_000);
        setTrades(nextTrades);
        setErrors((prev) => ({ ...prev, trades: null }));
      } catch (err) {
        if (alive) setErrors((prev) => ({ ...prev, trades: err?.message || "Failed to load recent trades" }));
      } finally {
        if (alive) setLoading((prev) => ({ ...prev, trades: false }));
      }
    }

    async function loadHolders(force = false) {
      const isBackgroundRefresh = Boolean(cachedHolders) && !force;
      if (!isBackgroundRefresh) {
        setLoading((prev) => ({ ...prev, holders: true }));
      }
      try {
        const res = await fetch(`/api/predictfun/market/${marketId}/holders?limit=20`, { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(json?.error || "Failed to load holders");
        const nextHolders = Array.isArray(json?.outcomes) ? json.outcomes : [];
        clientSet(holdersKey, nextHolders, 30_000);
        setHolders(nextHolders);
        setErrors((prev) => ({ ...prev, holders: null }));
      } catch (err) {
        if (alive) setErrors((prev) => ({ ...prev, holders: err?.message || "Failed to load holders" }));
      } finally {
        if (alive) setLoading((prev) => ({ ...prev, holders: false }));
      }
    }

    loadEnrich();
    loadOrderbook();
    loadTrades();
    loadHolders();

    const orderbookTimer = setInterval(() => loadOrderbook(true), 15_000);
    const tradesTimer = setInterval(() => loadTrades(true), 30_000);
    const holdersTimer = setInterval(() => loadHolders(true), 60_000);

    return () => {
      alive = false;
      clearInterval(orderbookTimer);
      clearInterval(tradesTimer);
      clearInterval(holdersTimer);
    };
  }, [marketId]);

  // Lazy-load top traders when the tab is selected
  useEffect(() => {
    if (activeBottomTab !== "toptraders" || !marketId || topTradersLoadedRef.current) return;
    let alive = true;
    topTradersLoadedRef.current = true;

    const topTradersKey = `pf-detail:toptraders:${marketId}`;
    const cached = clientGet(topTradersKey);
    if (cached) {
      setTopTraders(cached);
      return;
    }

    setLoading((prev) => ({ ...prev, topTraders: true }));
    fetch(`/api/predictfun/market/${marketId}/top-traders`, { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (!alive) return;
        const traders = Array.isArray(json?.traders) ? json.traders : [];
        clientSet(topTradersKey, traders, 60_000);
        setTopTraders(traders);
        setErrors((prev) => ({ ...prev, topTraders: null }));
      })
      .catch((err) => {
        if (alive) setErrors((prev) => ({ ...prev, topTraders: err?.message || "Failed to load top traders" }));
      })
      .finally(() => {
        if (alive) setLoading((prev) => ({ ...prev, topTraders: false }));
      });

    return () => { alive = false; };
  }, [activeBottomTab, marketId]);

  useEffect(() => {
    if (!marketId) return undefined;
    let alive = true;

    const chartKey = `pf-detail:chart:${marketId}:${range}`;
    const cachedChart = clientGet(chartKey);
    if (cachedChart) {
      setChartHistory(Array.isArray(cachedChart) ? cachedChart : []);
      setLoading((prev) => ({ ...prev, chart: false }));
      return () => { alive = false; };
    }

    async function loadChart() {
      setLoading((prev) => ({ ...prev, chart: true }));
      try {
        const limit = getChartHistoryLimit(range);
        const res = await fetch(`/api/predictfun/market/${marketId}/price-history?limit=${limit}`, { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(json?.error || "Failed to load chart history");
        const nextHistory = Array.isArray(json?.points) ? json.points : [];
        clientSet(chartKey, nextHistory, 60_000);
        setChartHistory(nextHistory);
        setErrors((prev) => ({ ...prev, chart: null }));
      } catch (err) {
        if (alive) setErrors((prev) => ({ ...prev, chart: err?.message || "Failed to load chart history" }));
      } finally {
        if (alive) setLoading((prev) => ({ ...prev, chart: false }));
      }
    }

    loadChart();
    return () => { alive = false; };
  }, [marketId, range]);

  // Fetch siblings (related outcomes in same category)
  useEffect(() => {
    if (!marketId) return;
    let alive = true;
    const siblingsKey = `pf-detail:siblings:${marketId}`;
    const cached = clientGet(siblingsKey);
    if (cached) { setSiblings(cached); return; }

    fetch(`/api/predictfun/market/${marketId}/siblings`, { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (!alive) return;
        const list = Array.isArray(json?.siblings) ? json.siblings : [];
        if (list.length > 1) {
          clientSet(siblingsKey, list, 60_000);
          setSiblings(list);
        }
      })
      .catch(() => {}); // silent fail — siblings are optional
    return () => { alive = false; };
  }, [marketId]);

  // Close siblings dropdown on click outside or scroll
  useEffect(() => {
    if (!showSiblingsDropdown) return;
    function handleClick(e) {
      if (siblingsButtonRef.current && siblingsButtonRef.current.contains(e.target)) return;
      if (siblingsDropdownRef.current && !siblingsDropdownRef.current.contains(e.target)) {
        setShowSiblingsDropdown(false);
      }
    }
    function handleScroll(e) {
      if (siblingsDropdownRef.current && siblingsDropdownRef.current.contains(e.target)) return;
      setShowSiblingsDropdown(false);
    }
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("scroll", handleScroll, { passive: true, capture: true });
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("scroll", handleScroll, { capture: true });
    };
  }, [showSiblingsDropdown]);

  const selectedOrderbook = selectedSide === "NO" ? orderbook?.no : orderbook?.yes;
  const selectedChance = useMemo(
    () => getSelectedChance(detail, orderbook, trades, selectedSide),
    [detail, orderbook, trades, selectedSide]
  );
  const chartPoints = useMemo(
    () => buildChartPoints(chartHistory, selectedSide, range),
    [chartHistory, selectedSide, range]
  );

  const latestTrade = Array.isArray(trades) ? trades[0] : null;
  const expiresText = fmtDateShort(detail?.endsAtMs);
  const vol24hText = fmtUsdFull(detail?.volume24hUsd);
  const totalVolText = fmtUsdFull(detail?.volumeTotalUsd);
  const liquidityText = fmtUsdFull(detail?.liquidityUsd);
  const headerTitle = detail?.displayTitle || detail?.title || `Market ${marketId}`;
  const combinedError = [errors.enrich, errors.orderbook, errors.trades, errors.chart].filter(Boolean).join(" | ");
  const detailBoostVisible = useMemo(() => {
    if (!detail?.isBoosted) return false;
    const now = Date.now();
    const start = Number(detail?.boostStartsAtMs);
    const end = Number(detail?.boostEndsAtMs);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      return now < end;
    }
    return true;
  }, [detail?.isBoosted, detail?.boostStartsAtMs, detail?.boostEndsAtMs]);

  async function loadMoreHolders() {
    if (!marketId || holdersLoadMoreLoading) return;
    const pendingOutcomes = (Array.isArray(holders) ? holders : []).filter((outcome) => {
      const holderRows = Array.isArray(outcome?.holders) ? outcome.holders : [];
      const totalCount = Number.isFinite(outcome?.holdersCount) ? outcome.holdersCount : holderRows.length;
      return outcome?.outcomeId && outcome?.endCursor && totalCount > holderRows.length;
    });
    if (!pendingOutcomes.length) return;

    setHoldersLoadMoreLoading(true);

    try {
      const responses = await Promise.all(
        pendingOutcomes.map(async (outcome) => {
          const params = new URLSearchParams({
            limit: "20",
            outcomeId: String(outcome.outcomeId),
            cursor: String(outcome.endCursor),
          });
          const res = await fetch(`/api/predictfun/market/${marketId}/holders?${params.toString()}`, {
            cache: "no-store",
          });
          const json = await res.json();
          if (!res.ok) {
            throw new Error(json?.error || `Failed to load more holders for ${outcome.outcomeName || outcome.outcomeId}`);
          }
          return Array.isArray(json?.outcomes) ? json.outcomes[0] : null;
        })
      );

      setHolders((prev) => {
        const merged = responses.filter(Boolean).reduce(
          (acc, nextOutcome) => appendHolderOutcomePage(acc, nextOutcome),
          prev
        );
        clientSet(holdersKey, merged, 30_000);
        return merged;
      });
      setHoldersExpandAnimationKey((prev) => prev + 1);
      setErrors((prev) => ({ ...prev, holders: null }));
    } catch (err) {
      setErrors((prev) => ({ ...prev, holders: err?.message || "Failed to load more holders" }));
    } finally {
      setHoldersLoadMoreLoading(false);
    }
  }

  return (
    <div className="col" style={{ gap: 12, paddingBottom: 120 }}>
      <div className="detail-header-grid">
        <div className="panel detail-header-panel-left" style={{ padding: "4px 12px", display: "flex", alignItems: "center" }}>
          <div className="detail-header" style={{ width: "100%" }}>
            <div className="detail-header-left">
              <OptimizedThumbnail url={detail?.imageUrl} size={78} radius={8} sizes="78px" className="detail-thumbnail" priority />

              <div className="detail-info">
                <div className="detail-market-id-row">
                  <span className="muted detail-market-id-text" style={{ fontSize: 11 }}>Market #{marketId}</span>
	                  <div className="detail-buttons-inline">
	                    {detail?.marketUrl ? (
	                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
	                        <a href={detail.marketUrl} target="_blank" rel="noopener noreferrer" className="btn btn-small-mobile">
	                          <img src="/predictfun_logo.svg" alt="Predict.fun" width="14" height="14" />
	                          <span className="btn-text-mobile">View on Predict.fun</span>
	                        </a>
	                        {detailBoostVisible ? <PredictFunBoostBadge /> : null}
	                      </div>
	                    ) : null}
	                  </div>
                </div>

                <div className="detail-title" style={{ fontWeight: 900, fontSize: 15, lineHeight: 1.15 }}>
                  {headerTitle}
                </div>
                {siblings.length > 1 ? (
                  <div style={{ position: "relative" }}>
                    <button
                      ref={siblingsButtonRef}
                      type="button"
                      onClick={() => {
                        if (!showSiblingsDropdown && siblingsButtonRef.current) {
                          const rect = siblingsButtonRef.current.getBoundingClientRect();
                          const margin = 8;
                          const isMobile = window.innerWidth < 768;
                          const popupWidth = isMobile
                            ? Math.max(260, Math.floor((window.innerWidth - margin * 2) * 0.8))
                            : Math.min(380, window.innerWidth - margin * 2);
                          const centeredMobileLeft = rect.left + (rect.width / 2) - (popupWidth / 2);
                          const left = isMobile
                            ? Math.min(window.innerWidth - popupWidth - margin, Math.max(margin, centeredMobileLeft))
                            : Math.min(rect.left, window.innerWidth - popupWidth - margin);
                          setSiblingsPopupPos({ top: rect.bottom + 6, left: Math.max(margin, left), width: popupWidth });
                        }
                        setShowSiblingsDropdown((prev) => !prev);
                      }}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        marginTop: 4,
                        padding: "3px 10px",
                        fontSize: 11,
                        fontWeight: 700,
                        color: "rgba(34,211,238,0.85)",
                        background: "rgba(34,211,238,0.08)",
                        border: "1px solid rgba(34,211,238,0.18)",
                        borderRadius: 8,
                        cursor: "pointer",
                        letterSpacing: "0.03em",
                        transition: "background 0.15s, border-color 0.15s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(34,211,238,0.14)"; e.currentTarget.style.borderColor = "rgba(34,211,238,0.30)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(34,211,238,0.08)"; e.currentTarget.style.borderColor = "rgba(34,211,238,0.18)"; }}
                    >
                      RELATED MARKETS ({siblings.length})
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ transition: "transform 0.2s", transform: showSiblingsDropdown ? "rotate(180deg)" : "rotate(0deg)" }}>
                        <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    {showSiblingsDropdown ? (
                      <div ref={siblingsDropdownRef} style={{
                        position: "fixed",
                        top: siblingsPopupPos.top,
                        left: siblingsPopupPos.left,
                        zIndex: 9999,
                        width: siblingsPopupPos.width ?? Math.min(380, typeof window !== "undefined" ? Math.max(260, Math.floor((window.innerWidth - 16) * 0.8)) : 380),
                        background: "#1a1f2e",
                        border: "1px solid rgba(255,255,255,0.10)",
                        borderRadius: 10,
                        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                        overflow: "hidden",
                        animation: "fadeIn 0.15s ease",
                      }}>
                        <div style={{ padding: "8px 14px 6px", fontSize: 11, fontWeight: 600, color: "rgba(148,163,184,0.7)", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                          Related Markets ({siblings.length})
                        </div>
                        <div style={{ maxHeight: 265, overflowY: "auto" }}>
                          {siblings.map((sibling) => {
                            const isCurrent = sibling.isCurrent;
                            const yesDisplay = Number.isFinite(sibling.yesPrice)
                              ? `${(sibling.yesPrice * 100).toFixed(1).replace(/\.0$/, "")}c`
                              : null;
                            const noDisplay = Number.isFinite(sibling.yesPrice)
                              ? `${((1 - sibling.yesPrice) * 100).toFixed(1).replace(/\.0$/, "")}c`
                              : null;
                            return (
                              <a
                                key={sibling.marketId}
                                href={`/predictfun/market/${sibling.marketId}`}
                                onClick={(e) => {
                                  if (isCurrent) { e.preventDefault(); setShowSiblingsDropdown(false); return; }
                                }}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 10,
                                  padding: "8px 14px",
                                  textDecoration: "none",
                                  color: "#fff",
                                  fontSize: 13,
                                  fontWeight: isCurrent ? 800 : 500,
                                  background: isCurrent ? "rgba(34,211,238,0.08)" : "transparent",
                                  borderLeft: isCurrent ? "3px solid rgba(34,211,238,0.7)" : "3px solid transparent",
                                  transition: "background 0.15s",
                                  cursor: isCurrent ? "default" : "pointer",
                                }}
                                onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                                onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = isCurrent ? "rgba(34,211,238,0.08)" : "transparent"; }}
                              >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: isCurrent ? "rgba(34,211,238,0.95)" : "#e2e8f0" }}>
                                    {sibling.title}
                                  </div>
                                  {Number.isFinite(sibling.volumeTotalUsd) && sibling.volumeTotalUsd > 0 ? (
                                    <div style={{ fontSize: 11, color: "rgba(148,163,184,0.65)", marginTop: 1 }}>
                                      {fmtUsdFull(sibling.volumeTotalUsd)} Volume
                                    </div>
                                  ) : null}
                                </div>
                                {yesDisplay ? (
                                  <div style={{ display: "flex", gap: 8, flexShrink: 0, fontSize: 12, fontWeight: 700 }}>
                                    <span style={{ color: "rgba(34,211,238,0.95)" }}>YES {yesDisplay}</span>
                                    {noDisplay ? <span style={{ color: "rgba(148,163,184,0.65)" }}>NO {noDisplay}</span> : null}
                                  </div>
                                ) : null}
                              </a>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="detail-stats-mobile">
                  <div>
                    <span className="muted">Exp</span>
                    <span style={{ fontWeight: 700 }}>{expiresText}</span>
                  </div>
                  <div>
                    <span className="muted">24h Vol</span>
                    <span style={{ fontWeight: 700, color: "#fff" }}>{vol24hText}</span>
                  </div>
                  <div>
                    <span className="muted">Total Vol</span>
                    <span style={{ fontWeight: 700, color: "#fff" }}>{totalVolText}</span>
                  </div>
                  <div>
                    <span className="muted">Liq</span>
                    <span style={{ fontWeight: 700, color: "#fff" }}>{liquidityText}</span>
                  </div>
                </div>

	                <div className="detail-buttons">
	                  {detail?.marketUrl ? (
	                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
	                      <a href={detail.marketUrl} target="_blank" rel="noopener noreferrer" className="btn" style={{ fontSize: 11, padding: "6px 12px", display: "flex", alignItems: "center", gap: 6 }}>
	                      <img src="/predictfun_logo.svg" alt="Predict.fun" width="16" height="16" />
	                      View on Predict.fun
	                      </a>
	                      {detailBoostVisible ? <PredictFunBoostBadge /> : null}
	                    </div>
	                  ) : null}
	                </div>
              </div>
            </div>

            <div className="detail-stats-inline">
              <div className="detail-stat-item">
                <span className="detail-stat-label">Expires</span>
                <span className="detail-stat-value">{expiresText}</span>
              </div>
              <div className="detail-stat-item">
                <span className="detail-stat-label">24h Vol</span>
                <span className="detail-stat-value">{vol24hText}</span>
              </div>
              <div className="detail-stat-item">
                <span className="detail-stat-label">Total Vol</span>
                <span className="detail-stat-value">{totalVolText}</span>
              </div>
              <div className="detail-stat-item">
                <span className="detail-stat-label">Liquidity</span>
                <span className="detail-stat-value">{liquidityText}</span>
              </div>
            </div>
          </div>

          <div className="detail-stats detail-stats-desktop">
            <div>
              <div className="muted" style={{ fontSize: 10, marginBottom: 2 }}>Expires</div>
              <div style={{ fontWeight: 700 }}>{expiresText}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 10, marginBottom: 2 }}>24h Volume</div>
              <div style={{ fontWeight: 700, color: "#fff" }}>{vol24hText}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 10, marginBottom: 2 }}>Total Volume</div>
              <div style={{ fontWeight: 700, color: "#fff" }}>{totalVolText}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 10, marginBottom: 2 }}>Liquidity</div>
              <div style={{ fontWeight: 700, color: "#fff" }}>{liquidityText}</div>
            </div>
          </div>
        </div>
      </div>

      {combinedError ? (
        <div className="panel" style={{ padding: "10px 14px", color: "#fca5a5", fontSize: 13, fontWeight: 700 }}>
          {combinedError}
        </div>
      ) : null}

      <div className="detail-grid">
        <div className="chart-wrapper">
          <PredictFunChartPanel
            outcome={selectedSide}
            onOutcomeChange={setSelectedSide}
            yesLabel={detail?.yesLabel || "Yes"}
            noLabel={detail?.noLabel || "No"}
            chartPoints={chartPoints}
            loading={loading.chart}
            error={errors.chart}
            range={range}
            onRangeChange={setRange}
            volume24hUsd={detail?.volume24hUsd}
            lastPrice={latestTrade?.outcomePrice ?? latestTrade?.yesPrice ?? null}
            chance={selectedChance}
          />
        </div>

        <PredictFunOrderbookPanel
          outcome={selectedSide}
          onOutcomeChange={setSelectedSide}
          yesLabel={detail?.yesLabel || "Yes"}
          noLabel={detail?.noLabel || "No"}
          sideData={selectedOrderbook}
          loading={loading.orderbook}
        />

        <PredictFunBottomPanel
          activeTab={activeBottomTab}
          onTabChange={setActiveBottomTab}
          rules={detail?.rules}
          rulesLoading={loading.enrich}
          trades={trades.slice(0, 30)}
          tradesLoading={loading.trades}
          holders={holders}
          holdersLoading={loading.holders}
          holdersError={errors.holders}
          yesLabel={detail?.yesLabel || "Yes"}
          noLabel={detail?.noLabel || "No"}
          holdersCount={detail?.holdersCount}
          outcomeHolderCounts={detail?.outcomeHolderCounts}
          holdersLoadMoreLoading={holdersLoadMoreLoading}
          onLoadMoreHolders={loadMoreHolders}
          expandAnimationKey={holdersExpandAnimationKey}
          topTraders={topTraders}
          topTradersLoading={loading.topTraders}
          topTradersError={errors.topTraders}
        />
      </div>
    </div>
  );
}
