"use client";

/**
 * WalletHeader Component - Polymarket Style
 * 
 * Displays wallet profile header with:
 * - Left: Avatar + Address + Stats (Positions Value, Biggest Win, Predictions, Unrealized, Win Rate, Volumes)
 * - Right: PnL Chart with period selector (1D, 1W, 1M, ALL)
 */

import { useState, useMemo } from "react";
import { 
  shortenAddress, 
  formatUSD, 
  formatUSDSigned,
  getWhaleName,
  getWhaleInfo,
  getDisplayName,
} from "@/lib/walletTracker/format";

/**
 * Skeleton loader component
 */
function Skeleton({ width, height, borderRadius = 4 }) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius,
        background: "linear-gradient(90deg, rgba(255,255,255,0.06) 25%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.06) 75%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.5s infinite",
      }}
    />
  );
}

/**
 * Info tooltip with hover
 */
function InfoTooltip({ text }) {
  const [show, setShow] = useState(false);
  
  return (
    <div 
      style={{ position: "relative", display: "inline-flex", cursor: "help" }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {/* Info icon (filled circle with "i") */}
      <svg 
        width="14" 
        height="14" 
        viewBox="0 0 24 24" 
        fill="currentColor"
        style={{ color: "rgba(255,255,255,0.5)", transition: "color 0.2s", cursor: "pointer" }}
        onMouseEnter={(e) => e.currentTarget.style.color = "rgba(255,255,255,0.9)"}
        onMouseLeave={(e) => e.currentTarget.style.color = "rgba(255,255,255,0.5)"}
      >
        {/* Filled circle background */}
        <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.15"/>
        {/* Circle outline */}
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.5"/>
        {/* Info text: dot */}
        <circle cx="12" cy="8" r="1.2" fill="currentColor"/>
        {/* Info text: line */}
        <line x1="12" y1="11" x2="12" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
      
      {/* Tooltip */}
      {show && (
        <div style={{
          position: "absolute",
          bottom: "calc(100% + 8px)",
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(20,22,28,0.98)",
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 8,
          padding: "10px 12px",
          fontSize: 12,
          color: "rgba(255,255,255,0.85)",
          lineHeight: 1.5,
          width: 260,
          whiteSpace: "pre-wrap",
          zIndex: 100,
          boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
        }}>
          {text}
          {/* Arrow */}
          <div style={{
            position: "absolute",
            bottom: -6,
            left: "50%",
            transform: "translateX(-50%) rotate(45deg)",
            width: 10,
            height: 10,
            background: "rgba(20,22,28,0.98)",
            borderRight: "1px solid rgba(255,255,255,0.15)",
            borderBottom: "1px solid rgba(255,255,255,0.15)",
          }} />
        </div>
      )}
    </div>
  );
}

/**
 * Sparkline with gradient fill
 */
function PnLSparkline({ data, width = 220, height = 60, isLoading = false }) {
  const gradientId = "pnl-gradient-" + Math.random().toString(36).slice(2);
  
  const { pathD, areaD, isPositive } = useMemo(() => {
    if (!data || data.length === 0) {
      return { pathD: "", areaD: "", isPositive: true };
    }
    
    const values = data.map(d => d.pnl);
    
    // If only 1 point, duplicate it to draw a flat line
    if (values.length === 1) {
      values.push(values[0]);
    }
    
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    
    // Handle case where all values are the same (flat line)
    const range = maxVal - minVal;
    const effectiveRange = range === 0 ? 1 : range;
    
    const points = values.map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      // If flat line, center it vertically
      const y = range === 0 
        ? height / 2 
        : height - 8 - ((v - minVal) / effectiveRange) * (height - 16);
      return { x, y };
    });
    
    const linePath = points.map((p, i) => 
      `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`
    ).join(" ");
    
    // Area path (for gradient fill)
    const areaPath = linePath + 
      ` L ${width},${height} L 0,${height} Z`;
    
    // Determine positive/negative based on final value
    const finalValue = values[values.length - 1];
    
    return {
      pathD: linePath,
      areaD: areaPath,
      isPositive: finalValue >= 0
    };
  }, [data, width, height]);
  
  // Show skeleton when loading
  if (isLoading) {
    return <Skeleton width={width} height={height} borderRadius={8} />;
  }
  
  const color = isPositive ? "#22c55e" : "#ef4444";
  
  return (
    <svg 
      width={width} 
      height={height} 
      viewBox={`0 0 ${width} ${height}`}
      style={{ overflow: "visible" }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      
      {areaD && (
        <path
          d={areaD}
          fill={`url(#${gradientId})`}
        />
      )}
      
      {pathD && (
        <path
          d={pathD}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

/**
 * Period selector button
 */
function PeriodButton({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? "rgba(255,255,255,0.12)" : "transparent",
        border: "none",
        color: active ? "#fff" : "rgba(255,255,255,0.5)",
        fontSize: 12,
        fontWeight: 600,
        padding: "4px 10px",
        borderRadius: 6,
        cursor: "pointer",
        transition: "all 0.15s",
      }}
    >
      {label}
    </button>
  );
}

export default function WalletHeader({ 
  wallet, 
  stats,
  pnlByPeriod,
  chainId = 56,
  isLoading = false,
}) {
  const [selectedPeriod, setSelectedPeriod] = useState("1W");
  
  // Get whale info (name + topPnl flag + avatar)
  const whaleInfo = getWhaleInfo(wallet);
  const displayName = whaleInfo?.name || shortenAddress(wallet);
  const isWhale = !!whaleInfo;
  const isTopPnl = whaleInfo?.topPnl || false;
  const whaleAvatar = whaleInfo?.avatar || null;
  
  // Opinion profile URL instead of bscscan
  const opinionProfileUrl = `https://app.opinion.trade/profile?address=${wallet}`;
  
  // Get first 2 chars after 0x for avatar fallback
  const avatarText = wallet ? wallet.slice(2, 4).toUpperCase() : "??";
  
  // Get PnL from stats
  const totalUnrealizedPnl = stats?.totalUnrealizedPnl || 0;
  
  // Get PnL data for selected period
  const currentPnLData = useMemo(() => {
    return pnlByPeriod?.[selectedPeriod] || [];
  }, [pnlByPeriod, selectedPeriod]);
  
  // Calculate chart PnL (final cumulative value)
  const chartPnL = useMemo(() => {
    if (!currentPnLData || currentPnLData.length === 0) return 0;
    return currentPnLData[currentPnLData.length - 1]?.pnl || 0;
  }, [currentPnLData]);
  
  const isPositive = chartPnL >= 0;
  
  // Period labels
  const periods = ["1D", "1W", "1M", "ALL"];
  const periodLabels = {
    "1D": "Past Day",
    "1W": "Past Week", 
    "1M": "Past Month",
    "ALL": "All Time"
  };
  
  return (
    <div className="wallet-header-container" style={{
      background: "linear-gradient(135deg, rgba(30,32,40,0.95) 0%, rgba(20,22,28,0.98) 100%)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 16,
      padding: "24px 28px",
      display: "flex",
      gap: 24,
      alignItems: "stretch",
      flexWrap: "wrap",
    }}>
      {/* Left Section: Profile + Stats */}
        <div style={{ flex: 1, minWidth: 300 }}>
          {/* Profile Row */}
          <div className="wallet-profile-row" style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
          {/* Avatar */}
          {whaleAvatar ? (
            <img 
              src={whaleAvatar}
              alt={displayName}
              style={{
                width: 52,
                height: 52,
                borderRadius: "50%",
                objectFit: "cover",
                flexShrink: 0,
                boxShadow: "0 4px 12px rgba(99, 102, 241, 0.3)",
                border: "2px solid rgba(255,183,77,0.5)",
              }}
            />
          ) : (
            <div style={{
              width: 52,
              height: 52,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #8b5cf6 0%, #6366f1 50%, #3b82f6 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              fontWeight: 700,
              color: "#fff",
              flexShrink: 0,
              boxShadow: "0 4px 12px rgba(99, 102, 241, 0.3)",
            }}>
              {avatarText}
            </div>
          )}
          
          {/* Name & Chain */}
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{
                fontSize: 18,
                fontWeight: 700,
                color: isWhale ? "#ffb74d" : "#fff",
                letterSpacing: "0.5px",
              }}>
                {displayName}
              </span>
              
              {/* Whale badge */}
              {isWhale && (
                <span style={{
                  background: "linear-gradient(135deg, rgba(255,183,77,0.2) 0%, rgba(255,152,0,0.15) 100%)",
                  color: "#ffb74d",
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 4,
                  letterSpacing: "0.5px",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}>
                  🐋 WHALE
                </span>
              )}
              
              {/* TOP PNL badge */}
              {isTopPnl && (
                <span style={{
                  background: "linear-gradient(135deg, rgba(34,197,94,0.2) 0%, rgba(16,185,129,0.15) 100%)",
                  color: "#22c55e",
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 4,
                  letterSpacing: "0.5px",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}>
                  💰 TOP PNL
                </span>
              )}
              
              {/* External link to Opinion profile */}
              <a
                href={opinionProfileUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="View on Opinion"
                style={{
                  color: "rgba(255,255,255,0.4)",
                  transition: "color 0.15s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = "#8b5cf6"}
                onMouseLeave={(e) => e.currentTarget.style.color = "rgba(255,255,255,0.4)"}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15,3 21,3 21,9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
              </a>
            </div>
            

          </div>
        </div>
        
        {/* Stats Row */}
        <div className="wallet-stats-row" style={{
          display: "flex",
          gap: 32,
          paddingTop: 16,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          flexWrap: "wrap",
        }}>
          {/* Positions Value */}
          <div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>
              Positions Value
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>
              {isLoading ? <Skeleton width={90} height={26} /> : formatUSD(stats?.positionsValue || 0)}
            </div>
          </div>
          
          {/* Biggest Win */}
          <div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>
              Biggest Win
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#22c55e" }}>
              {isLoading ? <Skeleton width={70} height={26} /> : formatUSD(stats?.biggestWin || 0)}
            </div>
          </div>
          
          {/* Predictions - hidden on mobile via CSS */}
          <div className="wallet-stat-predictions">
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>
              Predictions
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>
              {isLoading ? <Skeleton width={50} height={26} /> : String(stats?.predictionsCount || 0)}
            </div>
          </div>
          
          {/* Unrealized PnL */}
          <div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>
              Unrealized
            </div>
            <div style={{ 
              fontSize: 22, 
              fontWeight: 700, 
              color: totalUnrealizedPnl >= 0 ? "#22c55e" : "#ef4444" 
            }}>
              {isLoading ? <Skeleton width={80} height={26} /> : formatUSDSigned(totalUnrealizedPnl)}
            </div>
          </div>
          
          {/* Win Rate */}
          <div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>
              Win Rate
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>
              {isLoading ? <Skeleton width={50} height={26} /> : `${(stats?.winRate || 0).toFixed(0)}%`}
            </div>
          </div>
          
          {/* Total Volume */}
          <div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>
              Total Volume
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>
              {isLoading ? <Skeleton width={70} height={26} /> : formatUSD(stats?.totalVolume || 0)}
            </div>
          </div>
          
          {/* Weekly Volume with tooltip */}
          <div style={{ position: "relative" }}>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
              <span>Weekly Volume</span>
              <InfoTooltip text="Weekly Volume is calculated from 00:00 UTC last Sunday → 00:00 UTC this Sunday. You need $200 in Weekly Volume to be eligible to earn Opinion points for the week." />
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>
              {isLoading ? <Skeleton width={70} height={26} /> : formatUSD(stats?.weeklyVolume || 0)}
            </div>
          </div>
          
          {/* Est. Rebate (daily UTC) */}
          <div style={{ position: "relative" }}>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
              <span>Est. Rebate</span>
              <InfoTooltip text="Estimated maker rebate for today (UTC). Rebates are calculated and distributed daily. Only limit orders (maker fills) earn rebates. Formula: amount × p × (1−p) × 4% × 50%." />
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: (stats?.dailyEstRebate || 0) > 0 ? "#22c55e" : "#fff" }}>
              {isLoading ? <Skeleton width={70} height={26} /> : formatUSD(stats?.dailyEstRebate || 0)}
            </div>
          </div>
        </div>
      </div>
      
      {/* Divider */}
      <div className="wallet-divider" style={{
        width: 1,
        background: "rgba(255,255,255,0.08)",
        alignSelf: "stretch",
      }} />
      
      {/* Right Section: PnL Chart */}
      <div className="wallet-chart-section" style={{ 
        minWidth: 280,
        display: "flex",
        flexDirection: "column",
      }}>
        {/* Header with period selector */}
        <div style={{ 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "space-between",
          marginBottom: 8,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ 
              color: isPositive ? "#22c55e" : "#ef4444", 
              fontSize: 12,
            }}>
              {isPositive ? "▲" : "▼"}
            </span>
            <span style={{ 
              color: "rgba(255,255,255,0.6)", 
              fontSize: 13,
              fontWeight: 500,
            }}>
              Profit/Loss
            </span>
          </div>
          
          <div style={{ 
            display: "flex", 
            gap: 2,
            background: "rgba(255,255,255,0.05)",
            padding: 2,
            borderRadius: 8,
          }}>
            {periods.map(p => (
              <PeriodButton
                key={p}
                label={p}
                active={selectedPeriod === p}
                onClick={() => setSelectedPeriod(p)}
              />
            ))}
          </div>
        </div>
        
        {/* PnL Value */}
        <div style={{
          fontSize: 36,
          fontWeight: 700,
          color: isPositive ? "#22c55e" : "#ef4444",
          lineHeight: 1.1,
          marginBottom: 4,
        }}>
          {isLoading ? <Skeleton width={120} height={40} /> : formatUSDSigned(chartPnL)}
        </div>
        
        {/* Period label */}
        <div style={{
          fontSize: 12,
          color: "rgba(255,255,255,0.4)",
          marginBottom: 12,
        }}>
          {periodLabels[selectedPeriod]}
        </div>
        
        {/* Sparkline */}
        <div style={{ marginTop: "auto" }}>
          <PnLSparkline 
            data={currentPnLData} 
            width={260} 
            height={55}
            isLoading={isLoading}
          />
        </div>
      </div>
    </div>
  );
}
