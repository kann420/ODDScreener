"use client";

/**
 * PositionsTable Component
 * 
 * Displays active positions with columns: MARKET, AVG, CURRENT, VALUE
 * Polymarket-style clean layout with market icons.
 * Mobile: Card-based layout like reference app
 */

import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import {
  formatCents,
  formatUSD,
  formatUSDSigned,
  formatPercentSigned,
  formatShares,
  num,
} from "@/lib/walletTracker/format";

/**
 * Skeleton loader for position row
 */
function PositionRowSkeleton({ isMobile }) {
  if (isMobile) {
    return (
      <div className="position-card-mobile">
        <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
          <div style={{ width: 44, height: 44, borderRadius: 8, background: "rgba(255,255,255,0.06)" }} />
          <div style={{ flex: 1 }}>
            <div style={{ width: "80%", height: 14, borderRadius: 4, background: "rgba(255,255,255,0.06)", marginBottom: 8 }} />
            <div style={{ width: "60%", height: 12, borderRadius: 4, background: "rgba(255,255,255,0.06)" }} />
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ width: 60, height: 16, borderRadius: 4, background: "rgba(255,255,255,0.06)", marginBottom: 4, marginLeft: "auto" }} />
            <div style={{ width: 80, height: 12, borderRadius: 4, background: "rgba(255,255,255,0.06)", marginLeft: "auto" }} />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="position-row-desktop">
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: "rgba(255,255,255,0.06)" }} />
        <div style={{ flex: 1 }}>
          <div style={{ width: "70%", height: 14, borderRadius: 4, background: "rgba(255,255,255,0.06)", marginBottom: 6 }} />
          <div style={{ width: "50%", height: 12, borderRadius: 4, background: "rgba(255,255,255,0.06)" }} />
        </div>
      </div>
      <div style={{ width: 40, height: 16, borderRadius: 4, background: "rgba(255,255,255,0.06)", margin: "0 auto" }} />
      <div style={{ width: 40, height: 16, borderRadius: 4, background: "rgba(255,255,255,0.06)", margin: "0 auto" }} />
      <div style={{ marginLeft: "auto" }}>
        <div style={{ width: 70, height: 16, borderRadius: 4, background: "rgba(255,255,255,0.06)", marginBottom: 4 }} />
        <div style={{ width: 60, height: 12, borderRadius: 4, background: "rgba(255,255,255,0.06)" }} />
      </div>
    </div>
  );
}

/**
 * Desktop position row
 */
function PositionRowDesktop({ position }) {
  const avgPrice = num(position.avgEntryPrice);
  const currentPrice = num(position.currentPrice || position.avgEntryPrice);
  const value = num(position.currentValueInQuoteToken);
  const pnl = num(position.unrealizedPnl);
  const pnlPercent = num(position.unrealizedPnlPercent);
  const isPositive = pnl >= 0;
  
  const rawOutcomeSide = position.outcomeSideEnum || position.outcomeSide || position.outcome || "";
  const outcomeSideStr = typeof rawOutcomeSide === "number" 
    ? (rawOutcomeSide === 1 ? "Yes" : "No")
    : String(rawOutcomeSide);
  const isYes = outcomeSideStr.toLowerCase() === "yes" || rawOutcomeSide === 1;
  
  const marketImage = position.thumbnailUrl || position.marketIcon || position.coverUrl || null;
  const displayTitle = position.displayTitle || position.marketTitle || position.outcomeName || "Unknown";
  
  const [hovered, setHovered] = useState(false);
  
  return (
    <div 
      className="position-row-desktop"
      style={{ background: hovered ? "rgba(255,180,50,0.04)" : "transparent" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="position-market-cell">
        <div className="position-icon" style={{ 
          background: marketImage ? "transparent" : "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)"
        }}>
          {marketImage ? (
            <img src={marketImage} alt="" className="position-icon-img" onError={(e) => {
              e.target.style.display = 'none';
              e.target.parentElement.style.background = "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)";
              e.target.parentElement.innerHTML = displayTitle?.charAt(0) || "?";
            }} />
          ) : displayTitle?.charAt(0) || "?"}
        </div>
        <div className="position-info">
          <div className="position-title" title={displayTitle}>{displayTitle}</div>
          <div className="position-meta">
            <span className={`badge-${isYes ? 'yes' : 'no'}`}>{outcomeSideStr}</span>
            <span className="shares-text">{formatShares(position.sharesOwned)} at {formatCents(avgPrice)}</span>
          </div>
        </div>
      </div>
      <div className="position-price">{formatCents(avgPrice)}</div>
      <div className="position-price">{formatCents(currentPrice)}</div>
      <div className="position-value">
        <div className="value-amount">{formatUSD(value)}</div>
        <div className={`pnl-text ${isPositive ? 'positive' : 'negative'}`}>
          {formatUSDSigned(pnl)} ({formatPercentSigned(pnlPercent)})
        </div>
      </div>
    </div>
  );
}

/**
 * Mobile position card - similar to reference app (image 5)
 */
function PositionCardMobile({ position }) {
  const avgPrice = num(position.avgEntryPrice);
  const value = num(position.currentValueInQuoteToken);
  const pnl = num(position.unrealizedPnl);
  const pnlPercent = num(position.unrealizedPnlPercent);
  const isPositive = pnl >= 0;
  
  const rawOutcomeSide = position.outcomeSideEnum || position.outcomeSide || position.outcome || "";
  const outcomeSideStr = typeof rawOutcomeSide === "number" 
    ? (rawOutcomeSide === 1 ? "Yes" : "No")
    : String(rawOutcomeSide);
  const isYes = outcomeSideStr.toLowerCase() === "yes" || rawOutcomeSide === 1;
  
  const marketImage = position.thumbnailUrl || position.marketIcon || position.coverUrl || null;
  const displayTitle = position.displayTitle || position.marketTitle || position.outcomeName || "Unknown";
  
  return (
    <div className="position-card-mobile">
      <div className="position-card-row">
        {/* Left: Icon + Title */}
        <div className="position-icon" style={{ 
          width: 44, height: 44,
          background: marketImage ? "transparent" : "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)"
        }}>
          {marketImage ? (
            <img src={marketImage} alt="" className="position-icon-img" onError={(e) => {
              e.target.style.display = 'none';
              e.target.parentElement.style.background = "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)";
              e.target.parentElement.innerHTML = displayTitle?.charAt(0) || "?";
            }} />
          ) : displayTitle?.charAt(0) || "?"}
        </div>
        
        <div className="position-card-info">
          <div className="position-card-title">{displayTitle}</div>
          <div className="position-card-meta">
            <span className={`badge-${isYes ? 'yes' : 'no'}`}>{outcomeSideStr}</span>
            <span className="shares-text-mobile">{formatShares(position.sharesOwned)} at {formatCents(avgPrice)}</span>
          </div>
        </div>
        
        {/* Right: Value + PnL */}
        <div className="position-card-value">
          <div className="value-amount">{formatUSD(value)}</div>
          <div className={`pnl-text ${isPositive ? 'positive' : 'negative'}`}>
            {formatUSDSigned(pnl)} ({formatPercentSigned(pnlPercent)})
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PositionsTable({ 
  positions, 
  isLoading,
  searchQuery,
  onSearchChange,
  onLoadMore,
  hasMore,
  loadingMore,
  sortOrder: externalSortOrder,
  onToggleSort: externalToggleSort,
}) {
  const [internalSortOrder, setInternalSortOrder] = useState("desc");
  const sortOrder = externalSortOrder || internalSortOrder;
  const scrollContainerRef = useRef(null);
  
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current || !hasMore || loadingMore || isLoading) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    if (scrollHeight - scrollTop - clientHeight < 50) {
      onLoadMore?.();
    }
  }, [hasMore, loadingMore, isLoading, onLoadMore]);
  
  const displayPositions = useMemo(() => {
    if (!positions) return [];
    let filtered = positions;
    if (searchQuery && searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = positions.filter(p => 
        (p.displayTitle || p.marketTitle || "").toLowerCase().includes(query)
      );
    }
    return [...filtered].sort((a, b) => {
      const aVal = num(a.currentValueInQuoteToken);
      const bVal = num(b.currentValueInQuoteToken);
      return sortOrder === "desc" ? bVal - aVal : aVal - bVal;
    });
  }, [positions, searchQuery, sortOrder]);
  
  const toggleSort = externalToggleSort || (() => setInternalSortOrder(prev => prev === "desc" ? "asc" : "desc"));
  const [sortHovered, setSortHovered] = useState(false);
  
  return (
    <>
      <div className="positions-container">
        {/* Desktop Header */}
        <div className="positions-header-desktop">
          <div>MARKET</div>
          <div style={{ textAlign: "center" }}>AVG</div>
          <div style={{ textAlign: "center" }}>CURRENT</div>
          <div 
            style={{ textAlign: "right", cursor: "pointer", color: sortHovered ? "#fff" : "rgba(255,255,255,0.5)" }}
            onClick={toggleSort}
            onMouseEnter={() => setSortHovered(true)}
            onMouseLeave={() => setSortHovered(false)}
          >
            VALUE {sortOrder === "desc" ? "↓" : "↑"}
          </div>
        </div>
        
        {/* Desktop Rows */}
        <div ref={scrollContainerRef} onScroll={handleScroll} className="positions-body-desktop">
          {isLoading ? (
            <>{[1,2,3,4,5].map(i => <PositionRowSkeleton key={i} isMobile={false} />)}</>
          ) : displayPositions.length > 0 ? (
            <>
              {displayPositions.map((position, idx) => (
                <PositionRowDesktop key={`${position.marketId}-${position.outcomeSide}-${idx}`} position={position} />
              ))}
              {loadingMore && <div className="loading-more">Loading more...</div>}
              {!hasMore && !loadingMore && <div className="end-list">— End of positions —</div>}
            </>
          ) : (
            <div className="empty-state">{searchQuery ? "No positions match your search" : "No active positions found"}</div>
          )}
        </div>
      </div>
      
      {/* Mobile Cards */}
      <div className="positions-mobile">
        {isLoading ? (
          <>{[1,2,3,4,5].map(i => <PositionRowSkeleton key={i} isMobile={true} />)}</>
        ) : displayPositions.length > 0 ? (
          <>
            {displayPositions.map((position, idx) => (
              <PositionCardMobile key={`m-${position.marketId}-${position.outcomeSide}-${idx}`} position={position} />
            ))}
            {loadingMore && <div className="loading-more">Loading more...</div>}
            {!hasMore && !loadingMore && <div className="end-list">— End of positions —</div>}
          </>
        ) : (
          <div className="empty-state">{searchQuery ? "No positions match your search" : "No active positions found"}</div>
        )}
      </div>
      
      <style jsx>{`
        .positions-container {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          overflow: hidden;
        }
        .positions-header-desktop {
          display: grid;
          grid-template-columns: 1fr 70px 80px 120px;
          gap: 16px;
          padding: 12px 20px;
          background: rgba(0, 0, 0, 0.3);
          border-bottom: 1px solid rgba(255,255,255,0.08);
          font-size: 11px;
          font-weight: 600;
          color: rgba(255,255,255,0.5);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .positions-body-desktop {
          max-height: 550px;
          overflow-y: auto;
        }
        .positions-container :global(.position-row-desktop) {
          display: grid;
          grid-template-columns: 1fr 70px 80px 120px;
          gap: 16px;
          padding: 14px 20px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          align-items: center;
          transition: background 0.15s;
          cursor: pointer;
        }
        .positions-container :global(.position-market-cell) {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }
        .positions-container :global(.position-icon) {
          width: 36px;
          height: 36px;
          border-radius: 8px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 14px;
          color: white;
          overflow: hidden;
        }
        .positions-container :global(.position-icon-img) {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 8px;
        }
        .positions-container :global(.position-info) {
          min-width: 0;
          flex: 1;
        }
        .positions-container :global(.position-title) {
          font-size: 14px;
          font-weight: 500;
          color: #fff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.4;
        }
        .positions-container :global(.position-meta) {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 3px;
        }
        .positions-container :global(.badge-yes) {
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
          background: rgba(34, 197, 94, 0.15);
          color: #22c55e;
        }
        .positions-container :global(.badge-no) {
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
          background: rgba(239, 68, 68, 0.15);
          color: #ef4444;
        }
        .positions-container :global(.shares-text) {
          font-size: 13px;
          color: rgba(255,255,255,0.5);
        }
        .positions-container :global(.position-price) {
          font-size: 14px;
          color: #fff;
          text-align: center;
        }
        .positions-container :global(.position-value) {
          text-align: right;
        }
        .positions-container :global(.value-amount) {
          font-size: 14px;
          font-weight: 600;
          color: #fff;
        }
        .positions-container :global(.pnl-text) {
          font-size: 12px;
          margin-top: 2px;
        }
        .positions-container :global(.pnl-text.positive) { color: #22c55e; }
        .positions-container :global(.pnl-text.negative) { color: #ef4444; }
        
        .empty-state {
          padding: 60px 20px;
          text-align: center;
          color: rgba(255,255,255,0.4);
          font-size: 14px;
        }
        .loading-more {
          padding: 16px;
          text-align: center;
          color: rgba(255,255,255,0.5);
          font-size: 13px;
        }
        .end-list {
          padding: 16px;
          text-align: center;
          color: rgba(255,255,255,0.3);
          font-size: 12px;
        }

        @media (min-width: 1800px) {
          .positions-header-desktop {
            font-size: 12px;
          }

          .positions-container :global(.position-title) {
            font-size: 16px;
          }

          .positions-container :global(.badge-yes),
          .positions-container :global(.badge-no) {
            font-size: 13px;
          }

          .positions-container :global(.shares-text) {
            font-size: 14px;
          }

          .positions-container :global(.position-price) {
            font-size: 15px;
          }

          .positions-container :global(.value-amount) {
            font-size: 16px;
          }

          .positions-container :global(.pnl-text) {
            font-size: 13px;
          }
        }
        
        /* Mobile Cards - hidden on desktop */
        .positions-mobile {
          display: none;
        }
        .positions-mobile :global(.position-card-mobile) {
          background: linear-gradient(180deg, rgba(20,24,30,0.92) 0%, rgba(13,17,23,0.94) 100%);
          border: 1px solid rgba(255,255,255,0.14);
          border-radius: 12px;
          padding: 14px;
          margin-bottom: 10px;
          box-shadow: 0 4px 14px rgba(0,0,0,0.18);
        }
        .positions-mobile :global(.position-card-row) {
          display: flex;
          gap: 12px;
          align-items: flex-start;
        }
        .positions-mobile :global(.position-icon) {
          flex-shrink: 0;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          color: white;
          overflow: hidden;
        }
        .positions-mobile :global(.position-icon-img) {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 8px;
        }
        .positions-mobile :global(.position-card-info) {
          flex: 1;
          min-width: 0;
        }
        .positions-mobile :global(.position-card-title) {
          font-size: 15px;
          font-weight: 700;
          color: rgba(255,255,255,0.98);
          line-height: 1.35;
          margin-bottom: 6px;
        }
        .positions-mobile :global(.position-card-meta) {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        .positions-mobile :global(.badge-yes),
        .positions-mobile :global(.badge-no) {
          padding: 3px 8px;
          border-radius: 5px;
          font-size: 11px;
          font-weight: 700;
        }
        .positions-mobile :global(.badge-yes) {
          background: rgba(34, 197, 94, 0.22);
          border: 1px solid rgba(34, 197, 94, 0.32);
          color: #22c55e;
        }
        .positions-mobile :global(.badge-no) {
          background: rgba(239, 68, 68, 0.22);
          border: 1px solid rgba(239, 68, 68, 0.34);
          color: #ef4444;
        }
        .positions-mobile :global(.shares-text-mobile) {
          font-size: 12px;
          color: rgba(255,255,255,0.74);
        }
        .positions-mobile :global(.position-card-value) {
          text-align: right;
          flex-shrink: 0;
        }
        .positions-mobile :global(.value-amount) {
          font-size: 15px;
          font-weight: 700;
          color: rgba(255,255,255,0.98);
        }
        .positions-mobile :global(.pnl-text) {
          font-size: 12px;
          margin-top: 2px;
        }
        .positions-mobile :global(.pnl-text.positive) { color: #22c55e; }
        .positions-mobile :global(.pnl-text.negative) { color: #ef4444; }
        
        @media (max-width: 640px) {
          .positions-container {
            display: none;
          }
          .positions-mobile {
            display: block;
          }
        }
      `}</style>
    </>
  );
}
