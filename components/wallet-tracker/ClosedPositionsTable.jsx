"use client";

/**
 * ClosedPositionsTable Component
 * 
 * Displays closed positions derived from trade history.
 * Desktop: Table layout. Mobile: Card-based layout.
 */

import { useMemo, useState, useRef, useCallback } from "react";
import {
  formatCents,
  formatUSD,
  formatUSDSigned,
  formatPercentSigned,
  formatShares,
  num,
} from "@/lib/walletTracker/format";
import { sortClosedPositions } from "@/lib/walletTracker/deriveClosed";

/**
 * Result badge component
 */
function ResultBadge({ result, small }) {
  const isWon = result === "won";
  const isLost = result === "lost";
  
  return (
    <div className={`result-badge ${isWon ? 'won' : isLost ? 'lost' : 'unknown'} ${small ? 'small' : ''}`}>
      {isWon && <span className="badge-icon">✓</span>}
      {isLost && <span className="badge-icon">✗</span>}
      <span>{isWon ? "Won" : isLost ? "Lost" : "—"}</span>
    </div>
  );
}

/**
 * Sort dropdown component
 */
function SortDropdown({ sortBy, sortOrder, onSortChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [hovered, setHovered] = useState(null);
  
  const options = [
    { value: "pnl", label: "Profit/Loss" },
    { value: "date", label: "Date" },
  ];
  
  const currentOption = options.find(o => o.value === sortBy);
  
  const handleSelect = (value) => {
    if (value === sortBy) {
      onSortChange(value, sortOrder === "desc" ? "asc" : "desc");
    } else {
      onSortChange(value, "desc");
    }
    setIsOpen(false);
  };
  
  return (
    <div className="sort-dropdown">
      <button className="dropdown-btn" onClick={() => setIsOpen(!isOpen)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="4" y1="6" x2="16" y2="6"/>
          <line x1="4" y1="12" x2="12" y2="12"/>
          <line x1="4" y1="18" x2="8" y2="18"/>
          <polyline points="15,15 18,18 21,15"/>
        </svg>
        {currentOption?.label || "Sort"}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <polyline points="6,9 12,15 18,9"/>
        </svg>
      </button>
      
      {isOpen && (
        <div className="dropdown-menu">
          {options.map(option => (
            <button key={option.value} className={`dropdown-item ${sortBy === option.value ? 'active' : ''}`}
              style={{ background: hovered === option.value ? "rgba(255, 255, 255, 0.05)" : "transparent" }}
              onMouseEnter={() => setHovered(option.value)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => handleSelect(option.value)}>
              {option.label}
              {sortBy === option.value && <span className="sort-arrow">{sortOrder === "desc" ? "↓" : "↑"}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Skeleton loader row
 */
function ClosedRowSkeleton({ isMobile }) {
  if (isMobile) {
    return (
      <div className="closed-card-mobile">
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
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
    <div className="closed-row-desktop">
      <div style={{ width: 50, height: 20, borderRadius: 4, background: "rgba(255,255,255,0.06)" }} />
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ width: 40, height: 40, borderRadius: 8, background: "rgba(255,255,255,0.06)" }} />
        <div style={{ flex: 1 }}>
          <div style={{ width: "70%", height: 14, borderRadius: 4, background: "rgba(255,255,255,0.06)" }} />
          <div style={{ width: "40%", height: 12, borderRadius: 4, marginTop: 4, background: "rgba(255,255,255,0.06)" }} />
        </div>
      </div>
      <div style={{ width: 70, height: 16, borderRadius: 4, background: "rgba(255,255,255,0.06)", marginLeft: "auto" }} />
      <div style={{ width: 80, height: 20, borderRadius: 4, background: "rgba(255,255,255,0.06)", marginLeft: "auto" }} />
      <div style={{ width: 32, height: 32, borderRadius: 6, background: "rgba(255,255,255,0.06)" }} />
    </div>
  );
}

/**
 * Desktop closed position row
 */
function ClosedRowDesktop({ position }) {
  const [isHovered, setIsHovered] = useState(false);
  
  const totalBet = num(position.totalBet);
  const pnl = num(position.closedPnl);
  const pnlPercent = num(position.closedPnlPercent);
  const avgPrice = num(position.avgPrice);
  const isPositive = pnl >= 0;
  
  // Use outcome for display (e.g. "SEN", "C9", "UP"), outcomeSide for badge color
  const outcomeDisplay = position.outcome || position.outcomeSideEnum || 
    (position.outcomeSide === 1 ? "Yes" : position.outcomeSide === 2 ? "No" : "");
  const isYes = position.outcomeSide === 1 || 
    (position.outcomeSideEnum || "").toLowerCase() === "yes";
  
  const imageUrl = position.thumbnailUrl || position.marketIcon || position.coverUrl;
  const displayTitle = position.displayTitle || position.rootMarketTitle || position.marketTitle || "Unknown";
  const outcomeBadgeText = position.outcome || outcomeDisplay;
  
  return (
    <div className="closed-row-desktop"
      style={{ background: isHovered ? "rgba(255,180,50,0.04)" : "transparent" }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}>
      <div><ResultBadge result={position.result} /></div>
      
      <div className="closed-market-cell">
        <div className="closed-icon" style={{ 
          background: imageUrl 
            ? `url(${imageUrl}) center/cover no-repeat`
            : "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
        }}>
          {!imageUrl && displayTitle?.charAt(0)}
        </div>
        <div className="closed-info">
          <div className="closed-title" title={displayTitle}>{displayTitle}</div>
          <div className="closed-meta">
            <span className={`badge-${isYes ? 'yes' : 'no'}`}>{outcomeBadgeText}</span>
            <span className="shares-text">{formatShares(position.totalShares)} at {formatCents(avgPrice)}</span>
          </div>
        </div>
      </div>
      
      <div className="closed-bet">{formatUSD(totalBet)}</div>
      
      <div className="closed-amount">
        <div className={`amount-value ${isPositive ? 'positive' : 'negative'}`}>{formatUSDSigned(pnl)}</div>
        <div className={`pnl-text ${isPositive ? 'positive' : 'negative'}`}>
          ({formatPercentSigned(pnlPercent)})
        </div>
      </div>
      
      <button className="action-btn" title="View trades">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7,10 12,15 17,10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </button>
    </div>
  );
}

/**
 * Mobile closed position card
 */
function ClosedCardMobile({ position }) {
  const totalBet = num(position.totalBet);
  const pnl = num(position.closedPnl);
  const pnlPercent = num(position.closedPnlPercent);
  const avgPrice = num(position.avgPrice);
  const isPositive = pnl >= 0;
  
  // Use outcome for display (e.g. "SEN", "C9", "UP"), outcomeSide for badge color
  const outcomeDisplay = position.outcome || position.outcomeSideEnum || 
    (position.outcomeSide === 1 ? "Yes" : position.outcomeSide === 2 ? "No" : "");
  const isYes = position.outcomeSide === 1 || 
    (position.outcomeSideEnum || "").toLowerCase() === "yes";
  
  const imageUrl = position.thumbnailUrl || position.marketIcon || position.coverUrl;
  const displayTitle = position.displayTitle || position.rootMarketTitle || position.marketTitle || "Unknown";
  const outcomeBadgeText = position.outcome || outcomeDisplay;
  
  return (
    <div className="closed-card-mobile">
      <div className="closed-card-row">
        <div className="closed-icon" style={{ 
          width: 44, height: 44,
          background: imageUrl 
            ? `url(${imageUrl}) center/cover no-repeat`
            : "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
        }}>
          {!imageUrl && displayTitle?.charAt(0)}
        </div>
        
        <div className="closed-card-info">
          <div className="closed-card-title">{displayTitle}</div>
          <div className="closed-card-meta">
            <ResultBadge result={position.result} small />
            <span className={`badge-${isYes ? 'yes' : 'no'}`}>{outcomeBadgeText}</span>
          </div>
          <div className="closed-card-shares">{formatShares(position.totalShares)} · Bet {formatUSD(totalBet)}</div>
        </div>
        
        <div className="closed-card-right">
          <div className={`amount-value ${isPositive ? 'positive' : 'negative'}`}>{formatUSDSigned(pnl)}</div>
          <div className={`pnl-text ${isPositive ? 'positive' : 'negative'}`}>({formatPercentSigned(pnlPercent)})</div>
        </div>
      </div>
    </div>
  );
}

export default function ClosedPositionsTable({ 
  closedPositions,
  isLoading,
  searchQuery,
  onLoadMoreHistory,
  loadingMore,
  hasMore,
  sortBy: externalSortBy,
  sortOrder: externalSortOrder,
  onSortChange: externalOnSortChange,
  hideDesktopControls = false,
  hideMobileControls = false,
}) {
  const [internalSortBy, setInternalSortBy] = useState("date");
  const [internalSortOrder, setInternalSortOrder] = useState("desc");
  const sortBy = externalSortBy || internalSortBy;
  const sortOrder = externalSortOrder || internalSortOrder;
  const scrollContainerRef = useRef(null);
  
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current || !hasMore || loadingMore || isLoading) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    if (scrollHeight - scrollTop - clientHeight < 50) {
      onLoadMoreHistory?.();
    }
  }, [hasMore, loadingMore, isLoading, onLoadMoreHistory]);
  
  const displayPositions = useMemo(() => {
    if (!closedPositions) return [];
    let filtered = closedPositions;
    if (searchQuery && searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = closedPositions.filter(p => 
        (p.displayTitle || p.marketTitle || "").toLowerCase().includes(query)
      );
    }
    return sortClosedPositions(filtered, sortBy, sortOrder);
  }, [closedPositions, searchQuery, sortBy, sortOrder]);
  
  const handleSortChange = (newSortBy, newOrder) => {
    if (externalOnSortChange) {
      externalOnSortChange(newSortBy, newOrder);
    } else {
      setInternalSortBy(newSortBy);
      setInternalSortOrder(newOrder);
    }
  };
  
  return (
    <>
      <div className="closed-container">
        {!hideDesktopControls && (
          <div className="closed-controls">
            <SortDropdown sortBy={sortBy} sortOrder={sortOrder} onSortChange={handleSortChange} />
          </div>
        )}
        
        <div className="closed-header-desktop">
          <div>RESULT</div>
          <div>MARKET</div>
          <div style={{ textAlign: "right" }}>TOTAL BET</div>
          <div style={{ textAlign: "right" }}>AMOUNT</div>
          <div></div>
        </div>
        
        <div ref={scrollContainerRef} onScroll={handleScroll} className="closed-body-desktop">
          {isLoading ? (
            <>{[1,2,3].map(i => <ClosedRowSkeleton key={i} isMobile={false} />)}</>
          ) : displayPositions.length > 0 ? (
            <>
              {displayPositions.map((position, idx) => (
                <ClosedRowDesktop key={`${position.marketId}-${position.outcomeSide}-${idx}`} position={position} />
              ))}
              {loadingMore && <div className="loading-more">Loading more...</div>}
              {!hasMore && !loadingMore && <div className="end-list">— End of closed positions —</div>}
            </>
          ) : (
            <div className="empty-state">{searchQuery ? "No closed positions match your search" : "No closed positions found"}</div>
          )}
        </div>
      </div>
      
      <div className="closed-mobile">
        {!hideMobileControls && (
          <div className="closed-mobile-controls">
            <SortDropdown sortBy={sortBy} sortOrder={sortOrder} onSortChange={handleSortChange} />
          </div>
        )}
        {isLoading ? (
          <>{[1,2,3].map(i => <ClosedRowSkeleton key={i} isMobile={true} />)}</>
        ) : displayPositions.length > 0 ? (
          <>
            {displayPositions.map((position, idx) => (
              <ClosedCardMobile key={`m-${position.marketId}-${position.outcomeSide}-${idx}`} position={position} />
            ))}
            {loadingMore && <div className="loading-more">Loading more...</div>}
            {!hasMore && !loadingMore && <div className="end-list">— End of closed positions —</div>}
          </>
        ) : (
          <div className="empty-state">{searchQuery ? "No closed positions match your search" : "No closed positions found"}</div>
        )}
      </div>
      
      <style jsx>{`
        .closed-container {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 12px;
          overflow: hidden;
        }
        .closed-controls {
          display: flex;
          justify-content: flex-end;
          padding: 12px 16px;
          border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .closed-header-desktop {
          display: grid;
          grid-template-columns: 80px 1fr 100px 120px 48px;
          gap: 12px;
          padding: 12px 16px;
          background: rgba(0, 0, 0, 0.2);
          border-bottom: 1px solid rgba(255,255,255,0.1);
          font-size: 11px;
          font-weight: 600;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .closed-body-desktop {
          max-height: 500px;
          overflow-y: auto;
        }
        .closed-container :global(.closed-row-desktop) {
          display: grid;
          grid-template-columns: 80px 1fr 100px 120px 48px;
          gap: 12px;
          padding: 12px 16px;
          border-bottom: 1px solid rgba(255,255,255,0.1);
          align-items: center;
          transition: background 0.15s;
        }
        .closed-container :global(.closed-market-cell) {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }
        .closed-container :global(.closed-icon) {
          width: 40px;
          height: 40px;
          border-radius: 8px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          color: white;
          font-size: 16px;
          background-size: cover;
          background-position: center;
        }
        .closed-container :global(.closed-info) {
          min-width: 0;
          flex: 1;
        }
        .closed-container :global(.closed-title) {
          font-size: 14px;
          font-weight: 500;
          color: #e2e8f0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .closed-container :global(.closed-meta) {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 4px;
        }
        .closed-container :global(.badge-yes) {
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
          background: rgba(34, 197, 94, 0.15);
          color: #22c55e;
        }
        .closed-container :global(.badge-no) {
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
          background: rgba(239, 68, 68, 0.15);
          color: #ef4444;
        }
        .closed-container :global(.shares-text) {
          font-size: 12px;
          color: #64748b;
        }
        .closed-container :global(.closed-bet) {
          text-align: right;
          font-size: 14px;
          color: #e2e8f0;
        }
        .closed-container :global(.closed-amount) {
          text-align: right;
        }
        .closed-container :global(.amount-value) {
          font-size: 14px;
          font-weight: 600;
        }
        .closed-container :global(.pnl-text) {
          font-size: 11px;
          margin-top: 2px;
        }
        .closed-container :global(.positive) { color: #22c55e; }
        .closed-container :global(.negative) { color: #ef4444; }
        .closed-container :global(.action-btn) {
          background: none;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 6px;
          padding: 8px;
          color: #64748b;
          cursor: pointer;
          transition: all 0.15s;
        }
        .closed-container :global(.action-btn:hover) {
          background: rgba(255,255,255,0.05);
          color: #fff;
        }
        .closed-container :global(.result-badge) {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
        }
        .closed-container :global(.result-badge.small) {
          padding: 2px 6px;
          font-size: 11px;
        }
        .closed-container :global(.result-badge.won) {
          background: rgba(34, 197, 94, 0.15);
          color: #22c55e;
        }
        .closed-container :global(.result-badge.lost) {
          background: rgba(239, 68, 68, 0.15);
          color: #ef4444;
        }
        .closed-container :global(.result-badge.unknown) {
          background: rgba(148, 163, 184, 0.15);
          color: #64748b;
        }
        .closed-container :global(.badge-icon) { font-size: 10px; }
        
        /* Sort Dropdown */
        .closed-container :global(.sort-dropdown) { position: relative; }
        .closed-container :global(.dropdown-btn) {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          padding: 8px 12px;
          color: #e2e8f0;
          font-size: 13px;
          cursor: pointer;
        }
        .closed-container :global(.dropdown-menu) {
          position: absolute;
          top: 100%;
          right: 0;
          margin-top: 4px;
          background: #1e293b;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          overflow: hidden;
          min-width: 150px;
          z-index: 100;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        }
        .closed-container :global(.dropdown-item) {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: 10px 14px;
          background: none;
          border: none;
          color: #e2e8f0;
          font-size: 13px;
          cursor: pointer;
          text-align: left;
        }
        .closed-container :global(.dropdown-item.active) { color: #22c55e; }
        .closed-container :global(.sort-arrow) { font-size: 12px; }
        
        .empty-state {
          padding: 40px 20px;
          text-align: center;
          color: #64748b;
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
          .closed-header-desktop {
            font-size: 12px;
          }

          .closed-container :global(.closed-title) {
            font-size: 16px;
          }

          .closed-container :global(.badge-yes),
          .closed-container :global(.badge-no),
          .closed-container :global(.shares-text) {
            font-size: 13px;
          }

          .closed-container :global(.closed-bet),
          .closed-container :global(.amount-value) {
            font-size: 16px;
          }

          .closed-container :global(.pnl-text) {
            font-size: 13px;
          }

          .closed-container :global(.result-badge) {
            font-size: 13px;
          }
        }
        
        /* Mobile Cards */
        .closed-mobile {
          display: none;
        }
        .closed-mobile-controls {
          display: flex;
          justify-content: flex-end;
          margin-bottom: 12px;
        }
        .closed-mobile :global(.sort-dropdown) { position: relative; }
        .closed-mobile :global(.dropdown-btn) {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          padding: 8px 12px;
          color: #e2e8f0;
          font-size: 13px;
          cursor: pointer;
        }
        .closed-mobile :global(.dropdown-menu) {
          position: absolute;
          top: 100%;
          right: 0;
          margin-top: 4px;
          background: #1e293b;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          overflow: hidden;
          min-width: 150px;
          z-index: 100;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        }
        .closed-mobile :global(.dropdown-item) {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: 10px 14px;
          background: none;
          border: none;
          color: #e2e8f0;
          font-size: 13px;
          cursor: pointer;
          text-align: left;
        }
        .closed-mobile :global(.dropdown-item.active) { color: #22c55e; }
        .closed-mobile :global(.sort-arrow) { font-size: 12px; }
        .closed-mobile :global(.closed-card-mobile) {
          background: linear-gradient(180deg, rgba(20,24,30,0.92) 0%, rgba(13,17,23,0.94) 100%);
          border: 1px solid rgba(255,255,255,0.14);
          border-radius: 12px;
          padding: 14px;
          margin-bottom: 10px;
          box-shadow: 0 4px 14px rgba(0,0,0,0.18);
        }
        .closed-mobile :global(.closed-card-row) {
          display: flex;
          gap: 12px;
          align-items: flex-start;
        }
        .closed-mobile :global(.closed-icon) {
          flex-shrink: 0;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          color: white;
          background-size: cover;
          background-position: center;
        }
        .closed-mobile :global(.closed-card-info) {
          flex: 1;
          min-width: 0;
        }
        .closed-mobile :global(.closed-card-title) {
          font-size: 15px;
          font-weight: 700;
          color: rgba(255,255,255,0.98);
          line-height: 1.35;
          margin-bottom: 6px;
        }
        .closed-mobile :global(.closed-card-meta) {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
          margin-bottom: 4px;
        }
        .closed-mobile :global(.result-badge) {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 7px;
          border-radius: 5px;
          font-size: 11px;
          font-weight: 700;
        }
        .closed-mobile :global(.result-badge.won) {
          background: rgba(34, 197, 94, 0.22);
          border: 1px solid rgba(34, 197, 94, 0.32);
          color: #22c55e;
        }
        .closed-mobile :global(.result-badge.lost) {
          background: rgba(239, 68, 68, 0.22);
          border: 1px solid rgba(239, 68, 68, 0.34);
          color: #ef4444;
        }
        .closed-mobile :global(.result-badge.unknown) {
          background: rgba(148, 163, 184, 0.2);
          border: 1px solid rgba(148, 163, 184, 0.3);
          color: #94a3b8;
        }
        .closed-mobile :global(.badge-icon) { font-size: 10px; }
        .closed-mobile :global(.badge-yes),
        .closed-mobile :global(.badge-no) {
          padding: 3px 7px;
          border-radius: 5px;
          font-size: 11px;
          font-weight: 700;
        }
        .closed-mobile :global(.badge-yes) {
          background: rgba(34, 197, 94, 0.22);
          border: 1px solid rgba(34, 197, 94, 0.32);
          color: #22c55e;
        }
        .closed-mobile :global(.badge-no) {
          background: rgba(239, 68, 68, 0.22);
          border: 1px solid rgba(239, 68, 68, 0.34);
          color: #ef4444;
        }
        .closed-mobile :global(.closed-card-shares) {
          font-size: 12px;
          color: rgba(255,255,255,0.74);
        }
        .closed-mobile :global(.closed-card-right) {
          text-align: right;
          flex-shrink: 0;
        }
        .closed-mobile :global(.amount-value) {
          font-size: 15px;
          font-weight: 700;
          color: rgba(255,255,255,0.98);
        }
        .closed-mobile :global(.pnl-text) {
          font-size: 12px;
          margin-top: 2px;
        }
        .closed-mobile :global(.positive) { color: #22c55e; }
        .closed-mobile :global(.negative) { color: #ef4444; }
        
        @media (max-width: 640px) {
          .closed-container {
            display: none;
          }
          .closed-mobile {
            display: block;
          }
        }
      `}</style>
    </>
  );
}

