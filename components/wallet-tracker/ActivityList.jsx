"use client";

/**
 * ActivityList Component
 * 
 * Displays chronological list of trades (Buy/Sell).
 * Desktop: Clean table layout. Mobile: Card-based layout.
 */

import { useState, useRef, useCallback } from "react";
import {
  formatCents,
  formatUSD,
  formatShares,
  timeAgo,
  getExplorerTxUrl,
  num,
  normalizeUsdAmount,
} from "@/lib/walletTracker/format";

/**
 * Skeleton loader for activity row
 */
function ActivityRowSkeleton({ isMobile }) {
  if (isMobile) {
    return (
      <div className="activity-card-mobile">
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ width: 44, height: 44, borderRadius: 8, background: "rgba(255,255,255,0.06)" }} />
          <div style={{ flex: 1 }}>
            <div style={{ width: "80%", height: 14, borderRadius: 4, background: "rgba(255,255,255,0.06)", marginBottom: 8 }} />
            <div style={{ width: "60%", height: 12, borderRadius: 4, background: "rgba(255,255,255,0.06)" }} />
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ width: 60, height: 16, borderRadius: 4, background: "rgba(255,255,255,0.06)", marginBottom: 4, marginLeft: "auto" }} />
            <div style={{ width: 50, height: 12, borderRadius: 4, background: "rgba(255,255,255,0.06)", marginLeft: "auto" }} />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="activity-row-desktop">
      <div style={{ width: 40, height: 24, borderRadius: 6, background: "rgba(255,255,255,0.06)" }} />
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: "rgba(255,255,255,0.06)" }} />
        <div style={{ flex: 1 }}>
          <div style={{ width: "60%", height: 14, borderRadius: 4, background: "rgba(255,255,255,0.06)", marginBottom: 6 }} />
          <div style={{ width: "40%", height: 12, borderRadius: 4, background: "rgba(255,255,255,0.06)" }} />
        </div>
      </div>
      <div style={{ marginLeft: "auto" }}>
        <div style={{ width: 70, height: 14, borderRadius: 4, background: "rgba(255,255,255,0.06)", marginBottom: 4 }} />
        <div style={{ width: 50, height: 12, borderRadius: 4, background: "rgba(255,255,255,0.06)" }} />
      </div>
      <div style={{ width: 32, height: 32, borderRadius: 6, background: "rgba(255,255,255,0.06)" }} />
    </div>
  );
}

/**
 * Desktop activity row
 */
function ActivityRowDesktop({ trade, chainId }) {
  const price = num(trade.price);
  const shares = num(trade.shares);
  // Use normalizeUsdAmount to handle wei format from Opinion API
  const amount = normalizeUsdAmount(trade.usdAmount, trade.amount);
  
  const rawOutcomeSide = trade.outcomeSideEnum || trade.outcomeSide || trade.outcome || "";
  const outcomeSideStr = typeof rawOutcomeSide === "number" 
    ? (rawOutcomeSide === 1 ? "Yes" : "No")
    : String(rawOutcomeSide);
  const isYes = outcomeSideStr.toLowerCase() === "yes" || rawOutcomeSide === 1;
  
  const explorerUrl = getExplorerTxUrl(trade.txHash, chainId);
  const createdAtDate = typeof trade.createdAt === "number" 
    ? new Date(trade.createdAt * 1000) 
    : new Date(trade.createdAt);
  
  const isBuy = (trade.side || "").toUpperCase() === "BUY";
  const marketImage = trade.thumbnailUrl || trade.marketIcon || trade.coverUrl || null;
  const displayTitle = trade.displayTitle || trade.marketTitle || trade.outcomeName || "Unknown";
  
  const [hovered, setHovered] = useState(false);
  
  return (
    <div 
      className="activity-row-desktop"
      style={{ background: hovered ? "rgba(255,180,50,0.04)" : "transparent" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div>
        <span className={`badge-${isBuy ? 'buy' : 'sell'}`}>{isBuy ? "Buy" : "Sell"}</span>
      </div>
      
      <div className="activity-market-cell">
        <div className="activity-icon" style={{ 
          background: marketImage ? "transparent" : "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)"
        }}>
          {marketImage ? (
            <img src={marketImage} alt="" className="activity-icon-img" onError={(e) => {
              e.target.style.display = 'none';
              e.target.parentElement.style.background = "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)";
              e.target.parentElement.innerHTML = displayTitle?.charAt(0) || "?";
            }} />
          ) : displayTitle?.charAt(0) || "?"}
        </div>
        <div className="activity-info">
          <div className="activity-title" title={displayTitle}>{displayTitle}</div>
          <div className="activity-meta">
            <span className={`badge-${isYes ? 'yes' : 'no'}`}>{outcomeSideStr}</span>
            <span className="meta-text">{formatCents(price)} · {shares.toFixed(1)} shares</span>
          </div>
        </div>
      </div>
      
      <div className="activity-amount">
        <div className="amount-value">{formatUSD(amount)}</div>
        <div className="amount-time">{timeAgo(createdAtDate)}</div>
      </div>
      
      <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="activity-link" title="View on BSCScan">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15,3 21,3 21,9"/>
          <line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
      </a>
    </div>
  );
}

/**
 * Mobile activity card
 */
function ActivityCardMobile({ trade, chainId }) {
  const price = num(trade.price);
  const shares = num(trade.shares);
  // Use normalizeUsdAmount to handle wei format from Opinion API
  const amount = normalizeUsdAmount(trade.usdAmount, trade.amount);
  
  const rawOutcomeSide = trade.outcomeSideEnum || trade.outcomeSide || trade.outcome || "";
  const outcomeSideStr = typeof rawOutcomeSide === "number" 
    ? (rawOutcomeSide === 1 ? "Yes" : "No")
    : String(rawOutcomeSide);
  const isYes = outcomeSideStr.toLowerCase() === "yes" || rawOutcomeSide === 1;
  
  const explorerUrl = getExplorerTxUrl(trade.txHash, chainId);
  const createdAtDate = typeof trade.createdAt === "number" 
    ? new Date(trade.createdAt * 1000) 
    : new Date(trade.createdAt);
  
  const isBuy = (trade.side || "").toUpperCase() === "BUY";
  const marketImage = trade.thumbnailUrl || trade.marketIcon || trade.coverUrl || null;
  const displayTitle = trade.displayTitle || trade.marketTitle || trade.outcomeName || "Unknown";
  
  return (
    <div className="activity-card-mobile">
      <div className="activity-card-row">
        <div className="activity-icon" style={{ 
          width: 44, height: 44,
          background: marketImage ? "transparent" : "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)"
        }}>
          {marketImage ? (
            <img src={marketImage} alt="" className="activity-icon-img" onError={(e) => {
              e.target.style.display = 'none';
              e.target.parentElement.style.background = "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)";
              e.target.parentElement.innerHTML = displayTitle?.charAt(0) || "?";
            }} />
          ) : displayTitle?.charAt(0) || "?"}
        </div>
        
        <div className="activity-card-info">
          <div className="activity-card-title">{displayTitle}</div>
          <div className="activity-card-meta">
            <span className={`badge-${isBuy ? 'buy' : 'sell'}`}>{isBuy ? "Buy" : "Sell"}</span>
            <span className={`badge-${isYes ? 'yes' : 'no'}`}>{outcomeSideStr}</span>
            <span className="meta-text-mobile">{shares.toFixed(1)} at {formatCents(price)}</span>
          </div>
        </div>
        
        <div className="activity-card-right">
          <div className="amount-value">{formatUSD(amount)}</div>
          <div className="amount-time">{timeAgo(createdAtDate)}</div>
        </div>
      </div>
    </div>
  );
}

export default function ActivityList({ 
  trades, 
  isLoading,
  onLoadMore,
  hasMore,
  loadingMore,
  chainId = 56
}) {
  const scrollContainerRef = useRef(null);
  
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current || !hasMore || loadingMore || isLoading) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    if (scrollHeight - scrollTop - clientHeight < 50) {
      onLoadMore?.();
    }
  }, [hasMore, loadingMore, isLoading, onLoadMore]);
  
  return (
    <>
      <div className="activity-container">
        <div className="activity-header-desktop">
          <div>TYPE</div>
          <div>MARKET</div>
          <div style={{ textAlign: "right" }}>AMOUNT</div>
          <div></div>
        </div>
        
        <div ref={scrollContainerRef} onScroll={handleScroll} className="activity-body-desktop">
          {isLoading ? (
            <>{[1,2,3,4,5].map(i => <ActivityRowSkeleton key={i} isMobile={false} />)}</>
          ) : trades && trades.length > 0 ? (
            <>
              {trades.map((trade, idx) => (
                <ActivityRowDesktop key={`${trade.txHash}-${idx}`} trade={trade} chainId={chainId} />
              ))}
              {loadingMore && <div className="loading-more">Loading more...</div>}
              {!hasMore && !loadingMore && <div className="end-list">— End of activity —</div>}
            </>
          ) : (
            <div className="empty-state">No trade activity found</div>
          )}
        </div>
      </div>
      
      <div className="activity-mobile">
        {isLoading ? (
          <>{[1,2,3,4,5].map(i => <ActivityRowSkeleton key={i} isMobile={true} />)}</>
        ) : trades && trades.length > 0 ? (
          <>
            {trades.map((trade, idx) => (
              <ActivityCardMobile key={`m-${trade.txHash}-${idx}`} trade={trade} chainId={chainId} />
            ))}
            {loadingMore && <div className="loading-more">Loading more...</div>}
            {!hasMore && !loadingMore && <div className="end-list">— End of activity —</div>}
          </>
        ) : (
          <div className="empty-state">No trade activity found</div>
        )}
      </div>
      
      <style jsx>{`
        .activity-container {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          overflow: hidden;
        }
        .activity-header-desktop {
          display: grid;
          grid-template-columns: 60px 1fr 110px 40px;
          gap: 12px;
          padding: 12px 20px;
          background: rgba(0, 0, 0, 0.3);
          border-bottom: 1px solid rgba(255,255,255,0.08);
          font-size: 11px;
          font-weight: 600;
          color: rgba(255,255,255,0.5);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .activity-body-desktop {
          max-height: 550px;
          overflow-y: auto;
        }
        .activity-container :global(.activity-row-desktop) {
          display: grid;
          grid-template-columns: 60px 1fr 110px 40px;
          gap: 12px;
          padding: 14px 20px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          align-items: center;
          transition: background 0.15s;
        }
        .activity-container :global(.activity-market-cell) {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }
        .activity-container :global(.activity-icon) {
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
        .activity-container :global(.activity-icon-img) {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 8px;
        }
        .activity-container :global(.activity-info) {
          min-width: 0;
          flex: 1;
        }
        .activity-container :global(.activity-title) {
          font-size: 14px;
          font-weight: 500;
          color: #fff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.4;
        }
        .activity-container :global(.activity-meta) {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 3px;
        }
        .activity-container :global(.badge-buy) {
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          background: rgba(34, 197, 94, 0.15);
          color: #22c55e;
        }
        .activity-container :global(.badge-sell) {
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          background: rgba(239, 68, 68, 0.15);
          color: #ef4444;
        }
        .activity-container :global(.badge-yes) {
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
          background: rgba(34, 197, 94, 0.15);
          color: #22c55e;
        }
        .activity-container :global(.badge-no) {
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
          background: rgba(239, 68, 68, 0.15);
          color: #ef4444;
        }
        .activity-container :global(.meta-text) {
          font-size: 12px;
          color: rgba(255,255,255,0.5);
        }
        .activity-container :global(.activity-amount) {
          text-align: right;
        }
        .activity-container :global(.amount-value) {
          font-size: 14px;
          font-weight: 600;
          color: #fff;
        }
        .activity-container :global(.amount-time) {
          font-size: 12px;
          color: rgba(255,255,255,0.5);
          margin-top: 2px;
        }
        .activity-container :global(.activity-link) {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 6px;
          color: rgba(255,255,255,0.5);
          transition: all 0.15s;
          text-decoration: none;
        }
        .activity-container :global(.activity-link:hover) {
          background: rgba(255,255,255,0.05);
          color: #fff;
        }
        
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
          .activity-header-desktop {
            font-size: 12px;
          }

          .activity-container :global(.activity-title) {
            font-size: 16px;
          }

          .activity-container :global(.badge-buy),
          .activity-container :global(.badge-sell) {
            font-size: 13px;
          }

          .activity-container :global(.badge-yes),
          .activity-container :global(.badge-no),
          .activity-container :global(.meta-text) {
            font-size: 13px;
          }

          .activity-container :global(.amount-value) {
            font-size: 16px;
          }

          .activity-container :global(.amount-time) {
            font-size: 13px;
          }
        }
        
        /* Mobile Cards */
        .activity-mobile {
          display: none;
        }
        .activity-mobile :global(.activity-card-mobile) {
          background: linear-gradient(180deg, rgba(20,24,30,0.92) 0%, rgba(13,17,23,0.94) 100%);
          border: 1px solid rgba(255,255,255,0.14);
          border-radius: 12px;
          padding: 14px;
          margin-bottom: 10px;
          box-shadow: 0 4px 14px rgba(0,0,0,0.18);
        }
        .activity-mobile :global(.activity-card-row) {
          display: flex;
          gap: 12px;
          align-items: flex-start;
        }
        .activity-mobile :global(.activity-icon) {
          flex-shrink: 0;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          color: white;
          overflow: hidden;
        }
        .activity-mobile :global(.activity-icon-img) {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 8px;
        }
        .activity-mobile :global(.activity-card-info) {
          flex: 1;
          min-width: 0;
        }
        .activity-mobile :global(.activity-card-title) {
          font-size: 15px;
          font-weight: 700;
          color: rgba(255,255,255,0.98);
          line-height: 1.35;
          margin-bottom: 6px;
        }
        .activity-mobile :global(.activity-card-meta) {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        .activity-mobile :global(.badge-buy),
        .activity-mobile :global(.badge-sell) {
          padding: 3px 8px;
          border-radius: 5px;
          font-size: 11px;
          font-weight: 700;
        }
        .activity-mobile :global(.badge-buy) {
          background: rgba(34, 197, 94, 0.22);
          border: 1px solid rgba(34, 197, 94, 0.32);
          color: #22c55e;
        }
        .activity-mobile :global(.badge-sell) {
          background: rgba(239, 68, 68, 0.22);
          border: 1px solid rgba(239, 68, 68, 0.34);
          color: #ef4444;
        }
        .activity-mobile :global(.badge-yes),
        .activity-mobile :global(.badge-no) {
          padding: 3px 8px;
          border-radius: 5px;
          font-size: 11px;
          font-weight: 700;
        }
        .activity-mobile :global(.badge-yes) {
          background: rgba(34, 197, 94, 0.22);
          border: 1px solid rgba(34, 197, 94, 0.32);
          color: #22c55e;
        }
        .activity-mobile :global(.badge-no) {
          background: rgba(239, 68, 68, 0.22);
          border: 1px solid rgba(239, 68, 68, 0.34);
          color: #ef4444;
        }
        .activity-mobile :global(.meta-text-mobile) {
          font-size: 12px;
          color: rgba(255,255,255,0.74);
        }
        .activity-mobile :global(.activity-card-right) {
          text-align: right;
          flex-shrink: 0;
        }
        .activity-mobile :global(.amount-value) {
          font-size: 15px;
          font-weight: 700;
          color: rgba(255,255,255,0.98);
        }
        .activity-mobile :global(.amount-time) {
          font-size: 12px;
          color: rgba(255,255,255,0.74);
          margin-top: 2px;
        }
        
        @media (max-width: 640px) {
          .activity-container {
            display: none;
          }
          .activity-mobile {
            display: block;
          }
        }
      `}</style>
    </>
  );
}
