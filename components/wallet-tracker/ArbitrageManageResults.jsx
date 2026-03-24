"use client";

/**
 * ArbitrageManageResults Component
 * 
 * Displays arbitrage positions across Opinion and Polymarket in a table-like layout.
 * 
 * Features:
 * - Active/Closed tabs like Opinion wallet tracker
 * - Fetches real positions from API
 * - Search by market title (case-insensitive)
 * - Sortable columns: Value, Arbitrage, Current PnL
 * - Exit Plan logic: "Needs +X% to close" vs "Sell Now"
 * - Closed positions history with P&L results
 */

import { useState, useMemo, useEffect, useCallback, useRef } from "react";

// ============================================================================
// Icon Components
// ============================================================================

/** Result badge for closed positions (Won/Lost) */
function ResultBadge({ result, small }) {
  const isWon = result === "won";
  const isLost = result === "lost";
  
  return (
    <span className={`arb-result-badge ${isWon ? 'won' : isLost ? 'lost' : 'unknown'} ${small ? 'small' : ''}`}>
      {isWon && <span className="badge-icon">✓</span>}
      {isLost && <span className="badge-icon">✗</span>}
      <span>{isWon ? "Won" : isLost ? "Lost" : "—"}</span>
    </span>
  );
}

/** Search icon for the search input */
function SearchIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ color: "rgba(255,255,255,0.4)", flexShrink: 0 }}
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

/** Info icon for column tooltip */
function InfoIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ display: "block" }}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

/** External link icon for market links */
function ExternalLinkIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ color: "rgba(255,255,255,0.4)", cursor: "pointer" }}
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

/** Sort icon for sortable columns - matches Arbitrage board style */
function SortIcon({ direction }) {
  const isActive = direction !== null;
  const color = isActive ? "#f59e0b" : "rgba(255,255,255,0.4)";
  
  return (
    <span style={{ 
      marginLeft: 4, 
      fontSize: 14,
      color,
      display: "inline-flex",
      alignItems: "center",
    }}>
      {direction === "asc" ? "↑" : direction === "desc" ? "↓" : "↕"}
    </span>
  );
}

/** Warning triangle icon */
function WarningIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#ef4444"
      strokeWidth="2"
      style={{ flexShrink: 0 }}
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

/** Check circle icon */
function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#22c55e"
      strokeWidth="2"
      style={{ flexShrink: 0 }}
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

/** Polymarket icon - uses actual logo image */
function PolymarketIcon() {
  return (
    <img 
      src="/2polymarket_600.webp" 
      alt="Polymarket" 
      style={{
        width: 18,
        height: 18,
        borderRadius: 4,
        objectFit: "cover",
        flexShrink: 0,
      }}
    />
  );
}

/** Opinion icon - uses actual logo image */
function OpinionIcon() {
  return (
    <img
      src="/2logo-opinion.webp"
      alt="Opinion"
      style={{
        width: 18,
        height: 18,
        borderRadius: 4,
        objectFit: "cover",
        flexShrink: 0,
      }}
    />
  );
}

/** Predict.fun icon - uses actual logo image */
function PredictFunIcon() {
  return (
    <img
      src="/predictfun_logo.svg"
      alt="Predict.fun"
      style={{
        width: 18,
        height: 18,
        borderRadius: 4,
        objectFit: "cover",
        flexShrink: 0,
      }}
    />
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatUSD(value) {
  if (Number.isInteger(value)) {
    return `$${value}`;
  }
  return `$${value.toFixed(2)}`;
}

function formatUSDCompact(value) {
  const num = Number(value) || 0;
  return `$${num.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}`;
}

function formatUSDSigned(value, { showPlus = false } = {}) {
  const num = Number(value) || 0;
  const sign = num < 0 ? "-" : (showPlus && num > 0 ? "+" : "");
  return `${sign}${formatUSD(Math.abs(num))}`;
}

function formatUSDDelta(value) {
  const num = Number(value) || 0;
  const sign = num < 0 ? "-" : "+";
  return `${sign}${formatUSD(Math.abs(num))}`;
}

function formatCents(cents) {
  const num = Number(cents);
  if (!Number.isFinite(num)) return "0¢";
  return `${num.toFixed(1).replace(/\.0$/, "")}¢`;
}

function calcNeededPct(totalCents) {
  if (totalCents >= 100) return 0;
  return ((100 - totalCents) / totalCents) * 100;
}

function getPlatformIcon(platform) {
  if (platform === "polymarket") return <PolymarketIcon />;
  if (platform === "predictfun") return <PredictFunIcon />;
  return <OpinionIcon />;
}

function getLeg(row, platform) {
  return row.legs.find((l) => l.platform === platform);
}

// ============================================================================
// Sub-Components
// ============================================================================

function ColumnHeader({ label, sortKey, sortConfig, onSort, align = "center", infoTooltip = null, labelOffsetX = 0 }) {
  const isSortable = sortKey !== null;
  const isActive = sortConfig.key === sortKey;
  const direction = isActive ? sortConfig.direction : null;
  const [showInfo, setShowInfo] = useState(false);

  const handleClick = () => {
    if (!isSortable) return;
    onSort(sortKey);
  };

  return (
    <div
      onClick={handleClick}
      style={{
        cursor: isSortable ? "pointer" : "default",
        display: "flex",
        alignItems: "center",
        justifyContent: align === "left" ? "flex-start" : "center",
        gap: 4,
        userSelect: "none",
        color: "rgba(255,255,255,0.7)",
        fontSize: 13,
        fontWeight: 600,
        padding: "12px 8px",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, position: "relative", transform: `translateX(${labelOffsetX}px)` }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, position: "relative" }}>
          {label}
          {infoTooltip && (
            <span
              style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
              onMouseEnter={() => setShowInfo(true)}
              onMouseLeave={() => setShowInfo(false)}
            >
              <button
                type="button"
                aria-label="Column info"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowInfo((prev) => !prev);
                }}
                onFocus={() => setShowInfo(true)}
                onBlur={() => setShowInfo(false)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "rgba(255,255,255,0.5)",
                  padding: 0,
                  cursor: "pointer",
                  lineHeight: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <InfoIcon />
              </button>
              {showInfo && (
                <span
                  role="tooltip"
                  style={{
                    position: "absolute",
                    top: "calc(100% + 8px)",
                    right: -8,
                    minWidth: 240,
                    maxWidth: 280,
                    background: "rgba(15, 23, 42, 0.98)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: 8,
                    padding: "8px 10px",
                    color: "rgba(255,255,255,0.88)",
                    fontSize: 12,
                    fontWeight: 500,
                    lineHeight: 1.35,
                    textTransform: "none",
                    letterSpacing: 0,
                    whiteSpace: "normal",
                    zIndex: 50,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
                  }}
                >
                  {infoTooltip}
                </span>
              )}
            </span>
          )}
        </span>
        {isSortable && <SortIcon direction={direction} />}
      </span>
    </div>
  );
}

function MarketThumbnail({ url, title, size = 56 }) {
  const [hasError, setHasError] = useState(false);
  
  const containerStyle = {
    width: size,
    height: size,
    borderRadius: 8,
    overflow: "hidden",
    flexShrink: 0,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.03)",
  };

  const fallbackStyle = {
    ...containerStyle,
    background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 28,
  };

  if (!url || hasError) {
    return (
      <div style={fallbackStyle}>
        🏆
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={title || "Market"}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
        loading="lazy"
        onError={() => setHasError(true)}
      />
    </div>
  );
}

function SideBadge({ side, sideLabel }) {
  const display = sideLabel || side;
  // For non-YES/NO sides (e.g. categorical team names), use neutral white
  const isStandard = side === "YES" || side === "NO";
  const color = isStandard
    ? (side === "YES" ? "#22c55e" : "#ef4444")
    : "#e2e8f0"; // neutral for categorical team names (e.g. "Natus Vincere")
  return (
    <span
      style={{
        color,
        fontWeight: 700,
        fontSize: 13,
      }}
    >
      {display}
    </span>
  );
}

function ValueCell({ row }) {
  const renderLegValue = (leg) => {
    const shares = Number(leg?.shares) || 0;
    const entryPriceCents = Number(leg?.entryPriceCents) || 0;
    const currentValue = Number(leg?.valueUsd) || 0;
    const investedValue = (shares * entryPriceCents) / 100;
    const deltaValue = currentValue - investedValue;
    const positive = deltaValue >= 0;

    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", justifyContent: "center", whiteSpace: "nowrap" }}>
        {getPlatformIcon(leg.platform)}
        <span style={{ color: "#fff", fontSize: 14, fontWeight: 700, lineHeight: 1.25 }}>
          {formatUSDCompact(currentValue)}
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: positive ? "#22c55e" : "#ef4444", lineHeight: 1.25 }}>
          ({formatUSDDelta(deltaValue)})
        </span>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      {row.legs.map((leg, i) => <div key={i}>{renderLegValue(leg)}</div>)}
    </div>
  );
}

function CurrentPriceCell({ row }) {
  const rowStyle = {
    display: "grid",
    gridTemplateColumns: "18px 1fr",
    alignItems: "center",
    justifyItems: "start",
    columnGap: 6,
    width: "fit-content",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4, width: "fit-content", margin: "0 auto" }}>
      {row.legs.map((leg, i) => (
        <div key={i} style={rowStyle}>
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18 }}>
            {getPlatformIcon(leg.platform)}
          </span>
          <span style={{ color: "#fff", fontSize: 14, fontWeight: 700, lineHeight: 1.25, whiteSpace: "nowrap" }}>
            {formatCents(leg?.entryPriceCents || 0)} {"->"} {formatCents(leg?.currentPriceCents || 0)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ExitPlanCell({ row }) {
  const totalCents = row.currentTotalCents;
  const neededPct = calcNeededPct(totalCents);

  // Can sell now if total >= 100
  if (totalCents >= 100) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        <CheckIcon />
        <span style={{ color: "#22c55e", fontSize: 13, fontWeight: 500 }}>
          Sell Now
        </span>
      </div>
    );
  }

  // Show "Needs +X% to close" with warning (NO "or Sell Now")
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
      <WarningIcon />
      <span style={{ color: "#ef4444", fontSize: 13 }}>
        Needs +{neededPct.toFixed(1)}% to close
      </span>
    </div>
  );
}

function ArbitrageCell({ row }) {
  return (
    <div style={{ textAlign: "center", color: "#22c55e", fontSize: 14, fontWeight: 600 }}>
      {row.arbitragePct}%
    </div>
  );
}

function PnlCell({ value, label }) {
  const isPositive = value >= 0;
  const color = isPositive ? "#22c55e" : "#ef4444";
  
  // Format: -$0.95 instead of $-0.95
  const formatted = isPositive 
    ? formatUSD(value) 
    : `-${formatUSD(Math.abs(value))}`;

  return (
    <div style={{ textAlign: "center", color, fontSize: 13, fontWeight: 600 }}>
      {formatted}
    </div>
  );
}

function ArbRow({ row }) {
  return (
    <div className="arb-row">
      {/* Title Cell */}
      <div className="arb-cell-title">
        <MarketThumbnail url={row.thumbnailUrl} title={row.marketTitle} size={48} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="arb-market-title">
            <span style={{ color: "rgba(255,255,255,0.5)" }}>{row.marketTitleBase}</span>
            {row.outcomeDisplay && (
              <>
                <span style={{ color: "rgba(255,255,255,0.5)" }}> — </span>
                <span style={{ color: "rgba(255,255,255,0.9)" }}>{row.outcomeDisplay}</span>
              </>
            )}
          </div>
          <div className="arb-legs-info">
            {row.legs.map((leg, i) => (
              <span key={i} className="arb-leg">
                {getPlatformIcon(leg.platform)}
                <span>{leg.shares.toFixed(0)} shares <SideBadge side={leg.side} sideLabel={leg.sideLabel} /> at {formatCents(leg.entryPriceCents)}</span>
                {leg.link && (
                  <a
                    href={leg.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="arb-leg-link"
                    title={`Open on ${leg.platform}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLinkIcon />
                  </a>
                )}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Value Cell */}
      <div className="arb-cell arb-cell-value">
        <ValueCell row={row} />
      </div>

      {/* Current Price Cell */}
      <div className="arb-cell arb-cell-price">
        <CurrentPriceCell row={row} />
      </div>

      {/* Arbitrage Cell */}
      <div className="arb-cell arb-cell-arb">
        <ArbitrageCell row={row} />
      </div>

      {/* Current PnL Cell */}
      <div className="arb-cell arb-cell-pnl">
        <PnlCell value={row.currentPnlUsd} label="Current" />
      </div>

      {/* Potential PnL Cell */}
      <div className="arb-cell arb-cell-potential">
        <PnlCell value={row.potentialPnlUsd} label="Potential" />
      </div>

      {/* Exit Plan Cell */}
      <div className="arb-cell arb-cell-exit">
        <ExitPlanCell row={row} />
      </div>
    </div>
  );
}

/** Mobile card version of ArbRow */
function ArbRowMobile({ row }) {
  const totalCents = row.currentTotalCents;
  const canSellNow = totalCents >= 100;
  const neededPct = calcNeededPct(totalCents);

  const getLegDeltaUsd = (leg) => {
    const shares = Number(leg?.shares) || 0;
    const entryPriceCents = Number(leg?.entryPriceCents) || 0;
    const currentValue = Number(leg?.valueUsd) || 0;
    const investedValue = (shares * entryPriceCents) / 100;
    return currentValue - investedValue;
  };

  return (
    <div className="arb-card-mobile">
      {/* Header: Thumbnail + Title + Arb% */}
      <div className="arb-card-header">
        <MarketThumbnail url={row.thumbnailUrl} title={row.marketTitle} size={44} />
        <div className="arb-card-title-wrap">
          <div className="arb-card-title">
            <span style={{ color: "rgba(255,255,255,0.5)" }}>{row.marketTitleBase}</span>
            {row.outcomeDisplay && (
              <>
                <span style={{ color: "rgba(255,255,255,0.5)" }}> — </span>
                <span style={{ color: "rgba(255,255,255,0.9)" }}>{row.outcomeDisplay}</span>
              </>
            )}
          </div>
          <div className="arb-card-arb">
            <span className="arb-card-arb-value">{row.arbitragePct}%</span>
            <span className="arb-card-arb-label">Arb</span>
          </div>
        </div>
      </div>

      {/* Legs info */}
      <div className="arb-card-legs">
        {row.legs.map((leg, i) => (
          <div key={i} className="arb-card-leg">
            {getPlatformIcon(leg.platform)}
            <span>{leg.shares.toFixed(0)} shares <SideBadge side={leg.side} sideLabel={leg.sideLabel} /> at {formatCents(leg.entryPriceCents)}</span>
            <div className="arb-card-leg-value-wrap">
              <span className="arb-card-leg-value">{formatUSD(leg.valueUsd || 0)}</span>
              <span className={`arb-card-leg-delta ${getLegDeltaUsd(leg) >= 0 ? "positive" : "negative"}`}>
                ({formatUSDDelta(getLegDeltaUsd(leg))})
              </span>
            </div>
            {leg.link && (
              <a
                href={leg.link}
                target="_blank"
                rel="noopener noreferrer"
                className="arb-leg-link"
                title={`Open on ${leg.platform}`}
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLinkIcon />
              </a>
            )}
          </div>
        ))}
      </div>

      {/* Stats row */}
      <div className="arb-card-stats">
        <div className="arb-card-stat">
          <span className="arb-card-stat-label">Current PnL</span>
          <span className={`arb-card-stat-value ${row.currentPnlUsd >= 0 ? 'positive' : 'negative'}`}>
            {row.currentPnlUsd >= 0 ? formatUSD(row.currentPnlUsd) : `-${formatUSD(Math.abs(row.currentPnlUsd))}`}
          </span>
        </div>
        <div className="arb-card-stat">
          <span className="arb-card-stat-label">Potential</span>
          <span className={`arb-card-stat-value ${row.potentialPnlUsd >= 0 ? 'positive' : 'negative'}`}>
            {row.potentialPnlUsd >= 0 ? formatUSD(row.potentialPnlUsd) : `-${formatUSD(Math.abs(row.potentialPnlUsd))}`}
          </span>
        </div>
        <div className="arb-card-stat arb-card-stat-exit">
          {canSellNow ? (
            <span className="arb-card-exit-ok"><CheckIcon /> Sell Now</span>
          ) : (
            <span className="arb-card-exit-wait"><WarningIcon /> +{neededPct.toFixed(1)}%</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Closed Position Components
// ============================================================================

/** Desktop row for closed arbitrage position */
function ClosedArbRow({ row }) {
  const [isHovered, setIsHovered] = useState(false);
  const pnl = row.closedPnl || row.realizedPnl || 0;
  const pnlPercent = row.closedPnlPercent || row.realizedPnlPercent || 0;
  const totalBet = row.totalBet || row.totalCost || 0;
  const isPositive = pnl >= 0;

  return (
    <div
      className="closed-arb-row"
      style={{ background: isHovered ? "rgba(255,180,50,0.04)" : "transparent" }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Result badge */}
      <div className="closed-arb-cell closed-arb-result">
        <ResultBadge result={row.result} />
      </div>

      {/* Market info */}
      <div className="closed-arb-cell closed-arb-market">
        <MarketThumbnail url={row.thumbnailUrl} title={row.marketTitle} size={44} />
        <div className="closed-arb-info">
          <div className="closed-arb-title" title={row.marketTitle}>
            <span style={{ color: "rgba(255,255,255,0.5)" }}>{row.marketTitleBase}</span>
            {row.outcomeDisplay && (
              <>
                <span style={{ color: "rgba(255,255,255,0.5)" }}> — </span>
                <span style={{ color: "rgba(255,255,255,0.9)" }}>{row.outcomeDisplay}</span>
              </>
            )}
          </div>
          <div className="closed-arb-legs">
            {row.legs?.map((leg, i) => (
              <span key={i} className="closed-leg-mini">
                {getPlatformIcon(leg.platform)}
                <span>{leg.shares?.toFixed(0) || 0} <SideBadge side={leg.side} sideLabel={leg.sideLabel} /> @{formatCents(leg.entryPriceCents ?? 0)}{leg.exitPriceCents != null ? ` → ${formatCents(leg.exitPriceCents)}` : ""}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Entry Arb % */}
      <div className="closed-arb-cell closed-arb-entry-arb">
        <span className="arb-entry-pct">{row.arbitragePct || row.entryArbPct || 0}%</span>
      </div>

      {/* Total Bet */}
      <div className="closed-arb-cell closed-arb-bet">
        {formatUSD(totalBet)}
      </div>

      {/* Realized P&L */}
      <div className="closed-arb-cell closed-arb-pnl">
        <div className={`pnl-value ${isPositive ? 'positive' : 'negative'}`}>
          {formatUSDSigned(pnl, { showPlus: true })}
        </div>
        <div className={`pnl-percent ${isPositive ? 'positive' : 'negative'}`}>
          {isPositive ? '+' : ''}{pnlPercent.toFixed(1)}%
        </div>
      </div>

      {/* Date */}
      <div className="closed-arb-cell closed-arb-date">
        {formatDate(row.closedAt)}
      </div>
    </div>
  );
}

/** Mobile card for closed arbitrage position */
function ClosedArbCardMobile({ row }) {
  const pnl = row.closedPnl || row.realizedPnl || 0;
  const pnlPercent = row.closedPnlPercent || row.realizedPnlPercent || 0;
  const totalBet = row.totalBet || row.totalCost || 0;
  const isPositive = pnl >= 0;

  return (
    <div className="closed-arb-card-mobile">
      <div className="closed-arb-card-header">
        <MarketThumbnail url={row.thumbnailUrl} title={row.marketTitle} size={44} />
        <div className="closed-arb-card-info">
          <div className="closed-arb-card-title">
            <span style={{ color: "rgba(255,255,255,0.5)" }}>{row.marketTitleBase}</span>
            {row.outcomeDisplay && (
              <>
                <span style={{ color: "rgba(255,255,255,0.5)" }}> — </span>
                <span style={{ color: "rgba(255,255,255,0.9)" }}>{row.outcomeDisplay}</span>
              </>
            )}
          </div>
          <div className="closed-arb-card-meta">
            <ResultBadge result={row.result} small />
            <span className="arb-entry-pct">{row.arbitragePct || 0}% arb</span>
          </div>
        </div>
        <div className="closed-arb-card-pnl">
          <div className={`pnl-value ${isPositive ? 'positive' : 'negative'}`}>
            {formatUSDSigned(pnl, { showPlus: true })}
          </div>
          <div className={`pnl-percent ${isPositive ? 'positive' : 'negative'}`}>
            {isPositive ? '+' : ''}{pnlPercent.toFixed(1)}%
          </div>
        </div>
      </div>

      <div className="closed-arb-card-legs">
        {row.legs?.map((leg, i) => (
          <div key={i} className="closed-leg-mini">
            {getPlatformIcon(leg.platform)}
            <span>{leg.shares?.toFixed(0) || 0} shares <SideBadge side={leg.side} sideLabel={leg.sideLabel} /> @{formatCents(leg.entryPriceCents ?? 0)}{leg.exitPriceCents != null ? ` → ${formatCents(leg.exitPriceCents)}` : ""}</span>
          </div>
        ))}
      </div>

      <div className="closed-arb-card-footer">
        <span>Bet: {formatUSD(totalBet)}</span>
        <span>{formatDate(row.closedAt)}</span>
      </div>
    </div>
  );
}

/** Format date for closed positions */
function formatDate(timestamp) {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ============================================================================
// Main Component
// ============================================================================

// Tab constants
const TAB_ACTIVE = "active";
const TAB_CLOSED = "closed";

export default function ArbitrageManageResults({ polyWallet, opinionWallet, exchangeB = "opinion" }) {
  const exchangeBLabel = exchangeB === "predictfun" ? "Predict.fun" : "Opinion";
  const exchangeBPlatform = exchangeB === "predictfun" ? "predictfun" : "opinion";
  const activeRequestRef = useRef(0);
  const closedRequestRef = useRef(0);
  // Tab state
  const [activeTab, setActiveTab] = useState(TAB_ACTIVE);
  
  // Active positions state
  const [arbRows, setArbRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortConfig, setSortConfig] = useState({
    key: "arbitragePct",
    direction: "desc",
  });
  
  // Closed positions state
  const [closedRows, setClosedRows] = useState([]);
  const [closedLoading, setClosedLoading] = useState(false);
  const [closedError, setClosedError] = useState(null);
  const [closedSortBy, setClosedSortBy] = useState("date");
  const [closedSortOrder, setClosedSortOrder] = useState("desc");

  // Fetch active positions from API
  useEffect(() => {
    const controller = new AbortController();
    const requestId = activeRequestRef.current + 1;
    activeRequestRef.current = requestId;

    async function fetchPositions() {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (polyWallet) params.set("polyWallet", polyWallet);
        if (opinionWallet) params.set("opinionWallet", opinionWallet);
        if (exchangeB !== "opinion") params.set("exchangeB", exchangeB);
        params.set("_ts", String(Date.now()));

        const response = await fetch(`/api/arbitage/wallet-positions?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to fetch positions");
        }

        if (controller.signal.aborted || activeRequestRef.current !== requestId) {
          return;
        }

        setArbRows(data.matched || []);
      } catch (err) {
        if (err?.name === "AbortError") return;
        console.error("Error fetching arb positions:", err);
        if (activeRequestRef.current !== requestId) return;
        setError(err.message);
        setArbRows([]);
      } finally {
        if (activeRequestRef.current !== requestId) return;
        setLoading(false);
      }
    }

    if (polyWallet || opinionWallet) {
      fetchPositions();
    } else {
      setLoading(false);
      setArbRows([]);
    }

    return () => controller.abort();
  }, [polyWallet, opinionWallet, exchangeB]);

  // Fetch closed positions when tab changes to closed
  const fetchClosedPositions = useCallback(async () => {
    if (!polyWallet && !opinionWallet) {
      setClosedRows([]);
      return;
    }

    const controller = new AbortController();
    const requestId = closedRequestRef.current + 1;
    closedRequestRef.current = requestId;
    
    setClosedLoading(true);
    setClosedError(null);
    
    try {
      const params = new URLSearchParams();
      if (polyWallet) params.set("polyWallet", polyWallet);
      if (opinionWallet) params.set("opinionWallet", opinionWallet);
      if (exchangeB !== "opinion") params.set("exchangeB", exchangeB);
      params.set("type", "closed");
      params.set("_ts", String(Date.now()));

      const response = await fetch(`/api/arbitage/wallet-positions?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch closed positions");
      }

      if (controller.signal.aborted || closedRequestRef.current !== requestId) {
        return;
      }
      
      setClosedRows(data.closedArb || []);
    } catch (err) {
      if (err?.name === "AbortError") return;
      console.error("Error fetching closed arb positions:", err);
      if (closedRequestRef.current !== requestId) return;
      setClosedError(err.message);
      setClosedRows([]);
    } finally {
      if (closedRequestRef.current !== requestId) return;
      setClosedLoading(false);
    }
  }, [polyWallet, opinionWallet, exchangeB]);

  // Fetch closed positions when tab changes
  useEffect(() => {
    if (activeTab === TAB_CLOSED && closedRows.length === 0 && !closedLoading) {
      fetchClosedPositions();
    }
  }, [activeTab, closedRows.length, closedLoading, fetchClosedPositions]);

  // Filtered and sorted active rows
  const filteredAndSortedRows = useMemo(() => {
    let rows = [...arbRows];

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      rows = rows.filter((row) =>
        row.marketTitle.toLowerCase().includes(query)
      );
    }

    if (sortConfig.key) {
      rows.sort((a, b) => {
        let aVal, bVal;

        switch (sortConfig.key) {
          case "value":
            aVal = (a.legs || []).reduce((s, l) => s + (l.valueUsd || 0), 0);
            bVal = (b.legs || []).reduce((s, l) => s + (l.valueUsd || 0), 0);
            break;
          case "arbitragePct":
            aVal = a.arbitragePct;
            bVal = b.arbitragePct;
            break;
          case "currentPnl":
            aVal = a.currentPnlUsd;
            bVal = b.currentPnlUsd;
            break;
          default:
            return 0;
        }

        if (sortConfig.direction === "asc") {
          return aVal - bVal;
        } else {
          return bVal - aVal;
        }
      });
    }

    return rows;
  }, [arbRows, searchQuery, sortConfig]);

  // Filtered and sorted closed rows
  const filteredAndSortedClosedRows = useMemo(() => {
    let rows = [...closedRows];
    
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      rows = rows.filter((row) =>
        row.marketTitle?.toLowerCase().includes(query)
      );
    }
    
    // Sort closed rows by selected column
    rows.sort((a, b) => {
      let aVal, bVal;
      
      if (closedSortBy === "date") {
        aVal = a.closedAt || 0;
        bVal = b.closedAt || 0;
      } else if (closedSortBy === "pnl") {
        aVal = a.closedPnl || a.realizedPnl || 0;
        bVal = b.closedPnl || b.realizedPnl || 0;
      } else {
        return 0;
      }
      
      return closedSortOrder === "desc" ? bVal - aVal : aVal - bVal;
    });
    
    return rows;
  }, [closedRows, searchQuery, closedSortBy, closedSortOrder]);

  // Calculate summary stats for closed positions
  const closedSummary = useMemo(() => {
    const totalPnl = closedRows.reduce((sum, row) => sum + (row.closedPnl || row.realizedPnl || 0), 0);
    const wonCount = closedRows.filter(r => r.result === "won").length;
    const lostCount = closedRows.filter(r => r.result === "lost").length;
    return { totalPnl, wonCount, lostCount };
  }, [closedRows]);

  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        return {
          key,
          direction: prev.direction === "asc" ? "desc" : "asc",
        };
      }
      return { key, direction: "desc" };
    });
  };
  
  const handleClosedSortChange = (newSortBy) => {
    if (newSortBy === closedSortBy) {
      // Toggle sort order if clicking same column
      setClosedSortOrder(prev => prev === "desc" ? "asc" : "desc");
    } else {
      // New column: default to desc
      setClosedSortBy(newSortBy);
      setClosedSortOrder("desc");
    }
  };

  return (
    <div className="arb-results-container">
      {/* Active/Closed Tab Toggle */}
      <div className="arb-tabs">
        <button
          className={`arb-tab ${activeTab === TAB_ACTIVE ? "active" : ""}`}
          onClick={() => setActiveTab(TAB_ACTIVE)}
        >
          Active
        </button>
        <button
          className={`arb-tab ${activeTab === TAB_CLOSED ? "active" : ""}`}
          onClick={() => setActiveTab(TAB_CLOSED)}
        >
          Closed
        </button>
      </div>

      {/* Search Input */}
      <div className="arb-search-wrapper">
        <SearchIcon />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by Market Title..."
          className="arb-search-input"
          spellCheck="false"
        />
      </div>

      {/* ACTIVE TAB CONTENT */}
      {activeTab === TAB_ACTIVE && (
        <>
      {/* Table Container */}
      <div className="arb-table-wrapper">
        {/* Table Header */}
        <div className="arb-table-header">
          <ColumnHeader
            label="Title"
            sortKey={null}
            sortConfig={sortConfig}
            onSort={handleSort}
            align="left"
          />
          <ColumnHeader
            label="Value"
            sortKey="value"
            sortConfig={sortConfig}
            onSort={handleSort}
            align="left"
            labelOffsetX={24}
          />
          <ColumnHeader
            label="Avg -> Now"
            sortKey={null}
            sortConfig={sortConfig}
            onSort={handleSort}
            infoTooltip="Your average buy price per share vs current price"
          />
          <ColumnHeader
            label="Arbitrage"
            sortKey="arbitragePct"
            sortConfig={sortConfig}
            onSort={handleSort}
          />
          <ColumnHeader
            label="Current PnL"
            sortKey="currentPnl"
            sortConfig={sortConfig}
            onSort={handleSort}
          />
          <ColumnHeader
            label="Potential PnL"
            sortKey={null}
            sortConfig={sortConfig}
            onSort={handleSort}
          />
          <ColumnHeader
            label="Exit Plan"
            sortKey={null}
            sortConfig={sortConfig}
            onSort={handleSort}
          />
        </div>

        {/* Table Rows - Desktop */}
        <div className="arb-table-body arb-desktop-only">
          {loading ? (
            <div className="arb-loading">
              <div className="arb-spinner"></div>
              <span>Fetching positions...</span>
            </div>
          ) : error ? (
            <div className="arb-error">
              ⚠️ {error}
            </div>
          ) : filteredAndSortedRows.length > 0 ? (
            filteredAndSortedRows.map((row) => <ArbRow key={row.id} row={row} />)
          ) : searchQuery.trim() ? (
            <div className="arb-no-results">
              No positions found matching "{searchQuery}"
            </div>
          ) : (
            <div className="arb-no-results">
              No matched arbitrage positions found
            </div>
          )}
        </div>
      </div>

      {/* Mobile Cards */}
      <div className="arb-mobile-cards arb-mobile-only">
        {loading ? (
          <div className="arb-loading">
            <div className="arb-spinner"></div>
            <span>Fetching positions...</span>
          </div>
        ) : error ? (
          <div className="arb-error">
            ⚠️ {error}
          </div>
        ) : filteredAndSortedRows.length > 0 ? (
          filteredAndSortedRows.map((row) => <ArbRowMobile key={row.id} row={row} />)
        ) : searchQuery.trim() ? (
          <div className="arb-no-results">
            No positions found matching "{searchQuery}"
          </div>
        ) : (
          <div className="arb-no-results">
            No matched arbitrage positions found
          </div>
        )}
      </div>

      {/* Summary note */}
      <div className="arb-scanning-note">
        💡 Showing {filteredAndSortedRows.length} matched position{filteredAndSortedRows.length !== 1 ? 's' : ''} across Polymarket and {exchangeBLabel}
      </div>
        </>
      )}

      {/* CLOSED TAB CONTENT */}
      {activeTab === TAB_CLOSED && (
        <>
          {/* Closed Summary Bar */}
          {closedRows.length > 0 && (
            <div className="closed-summary-bar">
              <div className="summary-stat">
                <span className="summary-label">Total P&L</span>
                <span className={`summary-value ${closedSummary.totalPnl >= 0 ? 'positive' : 'negative'}`}>
                  {formatUSDSigned(closedSummary.totalPnl, { showPlus: true })}
                </span>
              </div>
              <div className="summary-stat">
                <span className="summary-label">Won</span>
                <span className="summary-value won">{closedSummary.wonCount}</span>
              </div>
              <div className="summary-stat">
                <span className="summary-label">Lost</span>
                <span className="summary-value lost">{closedSummary.lostCount}</span>
              </div>
              <div className="summary-spacer" />
              {/* Sort Buttons */}
              <div className="closed-sort-dropdown">
                <button 
                  className={`sort-btn ${closedSortBy === 'date' ? 'active' : ''}`}
                  onClick={() => handleClosedSortChange('date')}
                >
                  Date {closedSortBy === 'date' && (closedSortOrder === 'desc' ? '↓' : '↑')}
                </button>
                <button 
                  className={`sort-btn ${closedSortBy === 'pnl' ? 'active' : ''}`}
                  onClick={() => handleClosedSortChange('pnl')}
                >
                  P&L {closedSortBy === 'pnl' && (closedSortOrder === 'desc' ? '↓' : '↑')}
                </button>
              </div>
            </div>
          )}

          {/* Closed Table - Desktop */}
          <div className="closed-arb-table arb-desktop-only">
            {/* Closed Table Header */}
            <div className="closed-arb-header">
              <div>RESULT</div>
              <div>MARKET</div>
              <div style={{ textAlign: "center" }}>ENTRY ARB</div>
              <div style={{ textAlign: "right" }}>TOTAL BET</div>
              <div style={{ textAlign: "right" }}>REALIZED P&L</div>
              <div 
                style={{ textAlign: "right", cursor: "pointer", userSelect: "none" }}
                onClick={() => handleClosedSortChange('date')}
                title="Click to sort by date"
              >
                DATE {closedSortBy === 'date' && (closedSortOrder === 'desc' ? '↓' : '↑')}
              </div>
            </div>

            {/* Closed Rows */}
            <div className="closed-arb-body">
              {closedLoading ? (
                <div className="arb-loading">
                  <div className="arb-spinner"></div>
                  <span>Fetching closed positions...</span>
                </div>
              ) : closedError ? (
                <div className="arb-error">⚠️ {closedError}</div>
              ) : filteredAndSortedClosedRows.length > 0 ? (
                filteredAndSortedClosedRows.map((row, idx) => (
                  <ClosedArbRow key={row.id || idx} row={row} />
                ))
              ) : searchQuery.trim() ? (
                <div className="arb-no-results">
                  No closed positions found matching "{searchQuery}"
                </div>
              ) : (
                <div className="arb-no-results">
                  <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>📊</div>
                  <div style={{ marginBottom: 8 }}>No closed arbitrage history yet</div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
                    Closed positions will appear here once you exit your arbitrage trades
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Closed Cards - Mobile */}
          <div className="closed-arb-mobile arb-mobile-only">
            {closedLoading ? (
              <div className="arb-loading">
                <div className="arb-spinner"></div>
                <span>Fetching closed positions...</span>
              </div>
            ) : closedError ? (
              <div className="arb-error">⚠️ {closedError}</div>
            ) : filteredAndSortedClosedRows.length > 0 ? (
              filteredAndSortedClosedRows.map((row, idx) => (
                <ClosedArbCardMobile key={row.id || idx} row={row} />
              ))
            ) : (
              <div className="arb-no-results">
                <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>📊</div>
                <div>No closed arbitrage history yet</div>
              </div>
            )}
          </div>

          {/* Closed Summary note */}
          <div className="arb-scanning-note">
            📊 Showing {filteredAndSortedClosedRows.length} closed arbitrage position{filteredAndSortedClosedRows.length !== 1 ? 's' : ''}
          </div>
        </>
      )}

      {/* Inline Styles */}
      <style jsx>{`
        .arb-results-container {
          width: 100%;
          padding: 20px;
        }

        .arb-search-wrapper {
          display: flex;
          align-items: center;
          gap: 12px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 12px 16px;
          margin-bottom: 20px;
          width: 100%;
        }

        .arb-search-input {
          flex: 1;
          background: transparent;
          border: none;
          outline: none;
          color: #fff;
          font-size: 14px;
        }

        .arb-search-input::placeholder {
          color: rgba(255, 255, 255, 0.4);
        }

        .arb-table-wrapper {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          overflow: hidden;
        }

        .arb-table-header {
          display: grid;
          grid-template-columns: minmax(280px, 2fr) 130px 130px 80px 90px 90px 140px;
          gap: 8px;
          background: rgba(255, 255, 255, 0.03);
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          padding: 0 16px;
        }

        .arb-table-body {
        }

        /* Desktop row grid */
        .arb-results-container :global(.arb-row) {
          display: grid;
          grid-template-columns: minmax(280px, 2fr) 130px 130px 80px 90px 90px 140px;
          gap: 8px;
          align-items: center;
          padding: 14px 16px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          transition: background 0.15s, border-left 0.15s;
          border-left: 2px solid transparent;
        }

        .arb-results-container :global(.arb-row:hover) {
          background: rgba(255,180,50,0.04);
          border-left: 2px solid rgba(255,180,50,0.15);
        }

        .arb-results-container :global(.arb-cell-title) {
          display: flex;
          gap: 12px;
          align-items: center;
          min-width: 0;
        }

        .arb-results-container :global(.arb-market-title) {
          font-size: 14px;
          font-weight: 600;
          color: #fff;
          line-height: 1.3;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .arb-results-container :global(.arb-legs-info) {
          display: flex;
          flex-direction: column;
          gap: 2px;
          margin-top: 4px;
        }

        .arb-results-container :global(.arb-leg) {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: rgba(255,255,255,0.6);
        }

        .arb-results-container :global(.arb-leg-link) {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: rgba(255,255,255,0.4);
          transition: color 0.15s;
          text-decoration: none;
          margin-left: 4px;
        }

        .arb-results-container :global(.arb-leg-link:hover) {
          color: #f59e0b;
        }

        .arb-results-container :global(.arb-cell) {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .arb-results-container :global(.arb-cell-value),
        .arb-results-container :global(.arb-cell-price) {
          justify-content: center;
        }

        .arb-results-container :global(.arb-cell-value) {
          justify-content: flex-start;
          padding-left: 6px;
        }

        .arb-no-results {
          padding: 40px 20px;
          text-align: center;
          color: rgba(255, 255, 255, 0.5);
          font-size: 14px;
        }

        .arb-loading {
          padding: 60px 20px;
          text-align: center;
          color: rgba(255, 255, 255, 0.6);
          font-size: 14px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }

        .arb-spinner {
          width: 32px;
          height: 32px;
          border: 3px solid rgba(255, 255, 255, 0.1);
          border-top-color: rgba(255, 255, 255, 0.6);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .arb-error {
          padding: 40px 20px;
          text-align: center;
          color: #ff6b6b;
          font-size: 14px;
          background: rgba(255, 107, 107, 0.1);
          border-radius: 8px;
          margin: 20px;
        }

        .arb-scanning-note {
          margin-top: 16px;
          padding: 12px 16px;
          background: rgba(255, 193, 7, 0.1);
          border: 1px solid rgba(255, 193, 7, 0.2);
          border-radius: 8px;
          color: rgba(255, 255, 255, 0.7);
          font-size: 13px;
          text-align: center;
        }

        /* Mobile visibility - hide mobile cards on desktop */
        .arb-mobile-only {
          display: none !important;
        }
        .arb-desktop-only {
          display: block;
        }

        /* Mobile card styles - only used when visible */
        .arb-mobile-cards.arb-mobile-only {
          flex-direction: column;
          gap: 12px;
        }

        .arb-results-container :global(.arb-card-mobile) {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          padding: 14px;
        }

        .arb-results-container :global(.arb-card-header) {
          display: flex;
          gap: 12px;
          align-items: flex-start;
          margin-bottom: 12px;
        }

        .arb-results-container :global(.arb-card-title-wrap) {
          flex: 1;
          min-width: 0;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 8px;
        }

        .arb-results-container :global(.arb-card-title) {
          font-size: 14px;
          font-weight: 600;
          color: #fff;
          line-height: 1.3;
          flex: 1;
        }

        .arb-results-container :global(.arb-card-arb) {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          flex-shrink: 0;
        }

        .arb-results-container :global(.arb-card-arb-value) {
          font-size: 16px;
          font-weight: 700;
          color: #22c55e;
        }

        .arb-results-container :global(.arb-card-arb-label) {
          font-size: 10px;
          color: rgba(255,255,255,0.5);
          text-transform: uppercase;
        }

        .arb-results-container :global(.arb-card-legs) {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 12px;
          padding-bottom: 12px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }

        .arb-results-container :global(.arb-card-leg) {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: rgba(255,255,255,0.7);
        }

        .arb-results-container :global(.arb-card-leg .arb-leg-link) {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: rgba(255,255,255,0.4);
          transition: color 0.15s;
          text-decoration: none;
          margin-left: 2px;
        }

        .arb-results-container :global(.arb-card-leg .arb-leg-link:hover) {
          color: #f59e0b;
        }

        .arb-results-container :global(.arb-card-leg-value) {
          margin-left: 0;
          color: #fff;
          font-weight: 500;
        }

        .arb-results-container :global(.arb-card-leg-value-wrap) {
          margin-left: auto;
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: 4px;
          white-space: nowrap;
        }

        .arb-results-container :global(.arb-card-leg-delta) {
          font-size: 12px;
          font-weight: 600;
          line-height: 1;
        }

        .arb-results-container :global(.arb-card-leg-delta.positive) {
          color: #22c55e;
        }

        .arb-results-container :global(.arb-card-leg-delta.negative) {
          color: #ef4444;
        }

        .arb-results-container :global(.arb-card-stats) {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 8px;
        }

        .arb-results-container :global(.arb-card-stat) {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .arb-results-container :global(.arb-card-stat-label) {
          font-size: 10px;
          color: rgba(255,255,255,0.5);
          text-transform: uppercase;
        }

        .arb-results-container :global(.arb-card-stat-value) {
          font-size: 13px;
          font-weight: 600;
        }

        .arb-results-container :global(.arb-card-stat-value.positive) {
          color: #22c55e;
        }

        .arb-results-container :global(.arb-card-stat-value.negative) {
          color: #ef4444;
        }

        .arb-results-container :global(.arb-card-stat-exit) {
          align-items: flex-end;
        }

        .arb-results-container :global(.arb-card-exit-ok) {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          font-weight: 600;
          color: #22c55e;
        }

        .arb-results-container :global(.arb-card-exit-wait) {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          font-weight: 500;
          color: #ef4444;
        }

        /* ============ TAB STYLES ============ */
        .arb-tabs {
          display: flex;
          gap: 4px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 10px;
          padding: 4px;
          margin-bottom: 20px;
          width: fit-content;
        }

        .arb-tab {
          padding: 10px 20px;
          border: none;
          background: transparent;
          color: rgba(255, 255, 255, 0.6);
          font-size: 14px;
          font-weight: 600;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.15s;
        }

        .arb-tab:hover {
          color: rgba(255, 255, 255, 0.9);
          background: rgba(255, 255, 255, 0.05);
        }

        .arb-tab.active {
          background: rgba(255, 255, 255, 0.1);
          color: #fff;
        }

        /* ============ CLOSED SUMMARY BAR ============ */
        .closed-summary-bar {
          display: flex;
          align-items: center;
          gap: 24px;
          padding: 14px 20px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          margin-bottom: 16px;
          flex-wrap: wrap;
        }

        .summary-stat {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .summary-label {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.5);
          text-transform: uppercase;
          font-weight: 600;
        }

        .summary-value {
          font-size: 18px;
          font-weight: 700;
        }

        .summary-value.positive { color: #22c55e; }
        .summary-value.negative { color: #ef4444; }
        .summary-value.won { color: #22c55e; }
        .summary-value.lost { color: #ef4444; }

        .summary-spacer {
          flex: 1;
        }

        .closed-sort-dropdown {
          display: flex;
          gap: 6px;
        }

        .sort-btn {
          padding: 8px 14px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          color: rgba(255, 255, 255, 0.6);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
        }

        .sort-btn:hover {
          background: rgba(255, 255, 255, 0.08);
          color: #fff;
        }

        .sort-btn.active {
          background: rgba(255, 180, 50, 0.15);
          border-color: rgba(255, 180, 50, 0.3);
          color: #f59e0b;
        }

        /* ============ CLOSED TABLE ============ */
        .closed-arb-table {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          overflow: hidden;
        }

        .closed-arb-header {
          display: grid;
          grid-template-columns: 80px 1fr 90px 100px 120px 90px;
          gap: 12px;
          padding: 12px 16px;
          background: rgba(0, 0, 0, 0.2);
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          font-size: 11px;
          font-weight: 600;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .closed-arb-body {
          max-height: 500px;
          overflow-y: auto;
        }

        .arb-results-container :global(.closed-arb-row) {
          display: grid;
          grid-template-columns: 80px 1fr 90px 100px 120px 90px;
          gap: 12px;
          padding: 14px 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          align-items: center;
          transition: background 0.15s;
        }

        .arb-results-container :global(.closed-arb-cell) {
          display: flex;
          align-items: center;
        }

        .arb-results-container :global(.closed-arb-market) {
          display: flex;
          gap: 12px;
          align-items: center;
          min-width: 0;
        }

        .arb-results-container :global(.closed-arb-info) {
          flex: 1;
          min-width: 0;
        }

        .arb-results-container :global(.closed-arb-title) {
          font-size: 14px;
          font-weight: 500;
          color: #e2e8f0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .arb-results-container :global(.closed-arb-legs) {
          display: flex;
          flex-direction: column;
          gap: 2px;
          margin-top: 4px;
        }

        .arb-results-container :global(.closed-leg-mini) {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: rgba(255, 255, 255, 0.5);
        }

        .arb-results-container :global(.closed-arb-entry-arb) {
          justify-content: center;
        }

        .arb-results-container :global(.arb-entry-pct) {
          color: #22c55e;
          font-weight: 600;
          font-size: 13px;
        }

        .arb-results-container :global(.closed-arb-bet) {
          justify-content: flex-end;
          color: #e2e8f0;
          font-size: 14px;
        }

        .arb-results-container :global(.closed-arb-pnl) {
          flex-direction: column;
          align-items: flex-end;
          gap: 2px;
        }

        .arb-results-container :global(.pnl-value) {
          font-size: 14px;
          font-weight: 600;
        }

        .arb-results-container :global(.pnl-percent) {
          font-size: 11px;
        }

        .arb-results-container :global(.pnl-value.positive),
        .arb-results-container :global(.pnl-percent.positive) {
          color: #22c55e;
        }

        .arb-results-container :global(.pnl-value.negative),
        .arb-results-container :global(.pnl-percent.negative) {
          color: #ef4444;
        }

        .arb-results-container :global(.closed-arb-date) {
          justify-content: flex-end;
          color: #64748b;
          font-size: 13px;
        }

        /* Result Badge */
        .arb-results-container :global(.arb-result-badge) {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
        }

        .arb-results-container :global(.arb-result-badge.small) {
          padding: 2px 6px;
          font-size: 11px;
        }

        .arb-results-container :global(.arb-result-badge.won) {
          background: rgba(34, 197, 94, 0.15);
          color: #22c55e;
        }

        .arb-results-container :global(.arb-result-badge.lost) {
          background: rgba(239, 68, 68, 0.15);
          color: #ef4444;
        }

        .arb-results-container :global(.arb-result-badge.unknown) {
          background: rgba(148, 163, 184, 0.15);
          color: #64748b;
        }

        .arb-results-container :global(.arb-result-badge .badge-icon) {
          font-size: 10px;
        }

        /* ============ CLOSED MOBILE ============ */
        .closed-arb-mobile {
          display: none;
          flex-direction: column;
          gap: 12px;
        }

        .arb-results-container :global(.closed-arb-card-mobile) {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 12px;
          padding: 14px;
        }

        .arb-results-container :global(.closed-arb-card-header) {
          display: flex;
          gap: 12px;
          align-items: flex-start;
          margin-bottom: 12px;
        }

        .arb-results-container :global(.closed-arb-card-info) {
          flex: 1;
          min-width: 0;
        }

        .arb-results-container :global(.closed-arb-card-title) {
          font-size: 14px;
          font-weight: 600;
          color: #fff;
          line-height: 1.3;
          margin-bottom: 4px;
        }

        .arb-results-container :global(.closed-arb-card-meta) {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .arb-results-container :global(.closed-arb-card-pnl) {
          text-align: right;
          flex-shrink: 0;
        }

        .arb-results-container :global(.closed-arb-card-legs) {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 10px 0;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          margin-bottom: 10px;
        }

        .arb-results-container :global(.closed-arb-card-footer) {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          color: rgba(255, 255, 255, 0.5);
        }

        @media (min-width: 1800px) {
          .arb-tab {
            font-size: 16px;
            padding: 11px 22px;
          }

          .arb-search-input {
            font-size: 16px;
          }

          .arb-table-header {
            grid-template-columns: minmax(380px, 2.25fr) 170px 180px 112px 126px 126px 210px;
            gap: 14px;
            padding: 0 18px;
          }

          .arb-results-container :global(.arb-row) {
            grid-template-columns: minmax(380px, 2.25fr) 170px 180px 112px 126px 126px 210px;
            gap: 14px;
            padding: 16px 18px;
          }

          .arb-results-container :global(.arb-market-title) {
            font-size: 16px;
          }

          .arb-results-container :global(.arb-leg) {
            font-size: 13px;
          }

          .arb-results-container :global(.arb-cell-value span),
          .arb-results-container :global(.arb-cell-price span) {
            font-size: 14px !important;
          }

          .arb-results-container :global(.arb-cell-arb > div) {
            font-size: 16px !important;
          }

          .arb-results-container :global(.arb-cell-pnl > div),
          .arb-results-container :global(.arb-cell-potential > div) {
            font-size: 14px !important;
          }

          .arb-results-container :global(.closed-arb-title) {
            font-size: 15px;
          }

          .arb-results-container :global(.closed-leg-mini) {
            font-size: 12px;
          }
        }

        @media (max-width: 900px) {
          .arb-results-container {
            padding: 16px;
          }

          .arb-search-wrapper {
            max-width: none;
          }

          .arb-table-wrapper,
          .closed-arb-table {
            display: none !important;
          }

          .arb-mobile-only,
          .closed-arb-mobile.arb-mobile-only {
            display: flex !important;
          }

          .arb-desktop-only {
            display: none !important;
          }

          .closed-summary-bar {
            gap: 16px;
          }

          .summary-value {
            font-size: 16px;
          }
        }
      `}</style>
    </div>
  );
}
