"use client";

/**
 * Wallet Tracker Page
 * 
 * Route: /wallet/[wallet]
 * 
 * Displays wallet profile with:
 * - Header with stats and PnL chart
 * - Tabs: Positions (Active/Closed) and Activity
 * - Data fetched from Opinion OpenAPI via our proxy routes
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import WalletHeader from "@/components/wallet-tracker/WalletHeader";
import PositionsTable from "@/components/wallet-tracker/PositionsTable";
import ClosedPositionsTable from "@/components/wallet-tracker/ClosedPositionsTable";
import ActivityList from "@/components/wallet-tracker/ActivityList";
import RebateTab from "@/components/wallet-tracker/RebateTab";
import { 
  isValidWalletAddress,
  shortenAddress 
} from "@/lib/walletTracker/format";
import { 
  deriveClosedPositions, 
  calculateWalletStats,
  calculatePnLByPeriod
} from "@/lib/walletTracker/deriveClosed";

/**
 * Tab Button Component
 */
function TabButton({ active, onClick, children }) {
  const [hovered, setHovered] = useState(false);
  
  return (
    <button
      style={{
        background: "none",
        border: "none",
        padding: "14px 24px",
        fontSize: 15,
        fontWeight: 600,
        color: active ? "#fff" : hovered ? "#fff" : "rgba(255,255,255,0.5)",
        cursor: "pointer",
        position: "relative",
        transition: "color 0.15s",
        borderBottom: active ? "2px solid #22c55e" : "2px solid transparent",
        marginBottom: -1,
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
    </button>
  );
}

/**
 * Sub-tab button for Positions (Active/Closed)
 */
function SubTabButton({ active, onClick, children }) {
  const [hovered, setHovered] = useState(false);
  
  return (
    <button
      style={{
        background: active ? "rgba(255, 255, 255, 0.1)" : hovered ? "rgba(255, 255, 255, 0.06)" : "rgba(255, 255, 255, 0.03)",
        border: active ? "1px solid rgba(255,255,255,0.15)" : "1px solid transparent",
        padding: "8px 18px",
        fontSize: 13,
        fontWeight: 500,
        color: active ? "#fff" : "rgba(255,255,255,0.6)",
        cursor: "pointer",
        borderRadius: 8,
        transition: "all 0.15s",
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
    </button>
  );
}

function ValueSortButton({ sortOrder = "desc", onClick, disabled = false }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      style={{
        background: "rgba(255, 255, 255, 0.03)",
        border: "1px solid rgba(255,255,255,0.12)",
        padding: "8px 14px",
        fontSize: 13,
        fontWeight: 600,
        color: disabled ? "rgba(255,255,255,0.35)" : (hovered ? "#fff" : "rgba(255,255,255,0.8)"),
        cursor: disabled ? "not-allowed" : "pointer",
        borderRadius: 8,
        transition: "all 0.15s",
        minWidth: 96,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
      }}
      onClick={() => !disabled && onClick?.()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      disabled={disabled}
    >
      Value {sortOrder === "desc" ? "↓" : "↑"}
    </button>
  );
}

function ClosedSortDropdown({ sortBy = "date", sortOrder = "desc", onSortChange }) {
  const [hovered, setHovered] = useState(false);
  const [open, setOpen] = useState(false);
  const label = sortBy === "pnl" ? "Profit/Loss" : "Date";
  return (
    <div style={{ position: "relative" }}>
      <button
        style={{
          background: "rgba(255, 255, 255, 0.03)",
          border: "1px solid rgba(255,255,255,0.12)",
          padding: "8px 12px",
          fontSize: 13,
          fontWeight: 600,
          color: hovered ? "#fff" : "rgba(255,255,255,0.8)",
          cursor: "pointer",
          borderRadius: 8,
          transition: "all 0.15s",
          minWidth: 120,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
        onClick={() => setOpen(v => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {label} {sortOrder === "desc" ? "↓" : "↑"}
      </button>
      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 6px)",
          right: 0,
          zIndex: 20,
          minWidth: 148,
          background: "rgba(12,14,18,0.98)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 8,
          overflow: "hidden",
          boxShadow: "0 8px 20px rgba(0,0,0,0.3)",
        }}>
          {[
            { value: "date", text: "Date" },
            { value: "pnl", text: "Profit/Loss" },
          ].map((opt) => (
            <button
              key={opt.value}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "9px 10px",
                background: "transparent",
                border: "none",
                color: sortBy === opt.value ? "#fff" : "rgba(255,255,255,0.7)",
                fontSize: 12,
                fontWeight: sortBy === opt.value ? 600 : 500,
                cursor: "pointer",
              }}
              onClick={() => {
                const nextOrder = opt.value === sortBy ? (sortOrder === "desc" ? "asc" : "desc") : "desc";
                onSortChange?.(opt.value, nextOrder);
                setOpen(false);
              }}
            >
              {opt.text} {sortBy === opt.value ? (sortOrder === "desc" ? "↓" : "↑") : ""}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Search input component
 */
function SearchInput({ value, onChange, placeholder, fullWidth = false, stretch = false }) {
  const [focused, setFocused] = useState(false);
  
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      background: "rgba(255, 255, 255, 0.03)",
      border: focused ? "1px solid rgba(255,255,255,0.2)" : "1px solid rgba(255,255,255,0.08)",
      borderRadius: 8,
      padding: "10px 14px",
      flex: 1,
      width: (fullWidth || stretch) ? "100%" : "auto",
      maxWidth: (fullWidth || stretch) ? "100%" : 280,
      transition: "border-color 0.15s",
    }}>
      <svg 
        width="16" 
        height="16" 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke="rgba(255,255,255,0.4)" 
        strokeWidth="2"
        style={{ flexShrink: 0 }}
      >
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          background: "none",
          border: "none",
          outline: "none",
          color: "#fff",
          fontSize: 13,
          width: "100%",
        }}
      />
    </div>
  );
}

/**
 * Error state component
 */
function ErrorState({ message, onRetry }) {
  const [hovered, setHovered] = useState(false);
  
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "60px 20px",
      textAlign: "center",
    }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
      <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, maxWidth: 400, marginBottom: 20 }}>
        {message}
      </div>
      {onRetry && (
        <button 
          style={{
            background: hovered ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            padding: "10px 24px",
            color: "#fff",
            fontSize: 13,
            cursor: "pointer",
            transition: "all 0.15s",
          }}
          onClick={onRetry}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * Navigation Bar with Back and Refresh buttons
 */
function NavigationBar({ onBack, onRefresh, isRefreshing }) {
  return (
    <div className="wallet-nav-bar" style={{ 
      display: "flex", 
      justifyContent: "space-between", 
      alignItems: "center",
      marginBottom: 16,
    }}>
      {/* Back Button */}
      <button
        onClick={onBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 8,
          padding: "8px 14px",
          color: "rgba(255,255,255,0.7)",
          fontSize: 13,
          fontWeight: 500,
          cursor: "pointer",
          transition: "all 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.1)";
          e.currentTarget.style.color = "#fff";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.06)";
          e.currentTarget.style.color = "rgba(255,255,255,0.7)";
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M19 12H5"/>
          <polyline points="12,19 5,12 12,5"/>
        </svg>
        Back
      </button>
      
      {/* Refresh Button */}
      <button
        onClick={onRefresh}
        disabled={isRefreshing}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 8,
          padding: "8px 14px",
          color: isRefreshing ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.7)",
          fontSize: 13,
          fontWeight: 500,
          cursor: isRefreshing ? "not-allowed" : "pointer",
          transition: "all 0.15s",
        }}
        onMouseEnter={(e) => {
          if (!isRefreshing) {
            e.currentTarget.style.background = "rgba(255,255,255,0.1)";
            e.currentTarget.style.color = "#fff";
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.06)";
          e.currentTarget.style.color = isRefreshing ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.7)";
        }}
      >
        <svg 
          width="16" 
          height="16" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2"
          style={{
            animation: isRefreshing ? "spin 1s linear infinite" : "none",
          }}
        >
          <path d="M23 4v6h-6"/>
          <path d="M1 20v-6h6"/>
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
        </svg>
        {isRefreshing ? "Refreshing..." : "Refresh"}
      </button>
    </div>
  );
}

/**
 * Main Wallet Tracker Page
 */
export default function WalletPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  
  // Get wallet from URL params
  const wallet = params?.wallet || "";
  const chainId = Number(searchParams.get("chainId") || "56");
  
  // State
  const [activeTab, setActiveTab] = useState("positions"); // positions | activity
  const [positionsSubTab, setPositionsSubTab] = useState("active"); // active | closed
  const [positionsSortOrder, setPositionsSortOrder] = useState("desc");
  const [closedSortBy, setClosedSortBy] = useState("date");
  const [closedSortOrder, setClosedSortOrder] = useState("desc");
  const [searchQuery, setSearchQuery] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  
  // Data state
  const [positions, setPositions] = useState([]);
  const [positionsTotal, setPositionsTotal] = useState(0);
  const [positionsPage, setPositionsPage] = useState(1);
  const [positionsLoading, setPositionsLoading] = useState(true);
  const [positionsLoadingMore, setPositionsLoadingMore] = useState(false);
  const [positionsError, setPositionsError] = useState(null);
  
  const [trades, setTrades] = useState([]);
  const [tradesTotal, setTradesTotal] = useState(0);
  const [tradesPage, setTradesPage] = useState(1);
  const [tradesLoading, setTradesLoading] = useState(true);
  const [tradesLoadingMore, setTradesLoadingMore] = useState(false);
  const [tradesError, setTradesError] = useState(null);
  
  // Market info map for resolved markets (to determine winning outcome)
  // Map<marketId, { winningOutcomeSide, statusEnum, resolvedAt }>
  const [marketInfoMap, setMarketInfoMap] = useState(new Map());
  
  // Derived closed positions (pass active positions to detect "practically closed" ones)
  // Opinion doesn't allow selling 100% - typically 1-4 shares remain with value < $1.5
  // Also includes RESOLVED markets (user can claim winnings or has lost)
  const closedPositions = useMemo(() => {
    return deriveClosedPositions(trades, positions, marketInfoMap);
  }, [trades, positions, marketInfoMap]);
  
  // Filter out "practically closed" and "claimed" from active positions display
  // These are positions with:
  // - <= 3 shares and value < $1.5 (practically closed)
  // - claimStatus === 4 (Claimed) or claimStatusEnum === "Claimed"
  // Filter out only claimed positions from active positions display
  // claimStatus === 4 (Claimed) or claimStatusEnum === "Claimed"
  const activePositionsFiltered = useMemo(() => {
    if (!positions || positions.length === 0) return [];
    
    return positions.filter(pos => {
      // Check if position is claimed (claimStatus=4 or claimStatusEnum="Claimed")
      const claimStatus = Number(pos.claimStatus);
      const claimStatusEnum = String(pos.claimStatusEnum || "").toLowerCase();
      const isClaimed = claimStatus === 4 || claimStatusEnum === "claimed";
      
      // Only exclude claimed positions - show everything else
      return !isClaimed;
    });
  }, [positions]);
  
  // Wallet stats
  const walletStats = useMemo(() => {
    return calculateWalletStats(positions, trades, marketInfoMap);
  }, [positions, trades, marketInfoMap]);
  
  // PnL data for all periods (1D, 1W, 1M, ALL)
  const pnlByPeriod = useMemo(() => {
    return calculatePnLByPeriod(trades, positions, closedPositions);
  }, [trades, positions, closedPositions]);
  
  /**
   * Fetch positions from API
   */
  const fetchPositions = useCallback(async (page = 1, append = false) => {
    if (!isValidWalletAddress(wallet)) return;
    
    if (page === 1) {
      setPositionsLoading(true);
    } else {
      setPositionsLoadingMore(true);
    }
    setPositionsError(null);
    
    try {
      // When loading page 1 (initial load), fetch ALL pages for accurate PnL calculation
      if (page === 1 && !append) {
        let allPositions = [];
        let currentPage = 1;
        const limit = 20;
        const maxPages = 50;
        
        while (currentPage <= maxPages) {
          const url = `/api/opinion/wallet/${wallet}/positions?chainId=${chainId}&page=${currentPage}&limit=${limit}`;
          const res = await fetch(url);
          const data = await res.json();
          
          const hasError = (data.errno !== undefined && data.errno !== 0) || 
                           (data.errno === undefined && data.code !== 0);
          if (hasError) {
            throw new Error(data.errmsg || data.msg || "Failed to fetch positions");
          }
          
          const list = data.result?.list || [];
          const total = data.result?.total || 0;
          allPositions = [...allPositions, ...list];
          
          if (allPositions.length >= total || list.length < limit) break;
          currentPage++;
        }
        
        setPositions(allPositions);
        setPositionsTotal(allPositions.length);
        setPositionsPage(Math.ceil(allPositions.length / 20));
      } else {
        // Manual "load more" for paginated UI display
        const url = `/api/opinion/wallet/${wallet}/positions?chainId=${chainId}&page=${page}&limit=20`;
        const res = await fetch(url);
        const data = await res.json();
        
        const hasError = (data.errno !== undefined && data.errno !== 0) || 
                         (data.errno === undefined && data.code !== 0);
        if (hasError) {
          throw new Error(data.errmsg || data.msg || "Failed to fetch positions");
        }
        
        const list = data.result?.list || [];
        const total = data.result?.total || 0;
        
        if (append) {
          setPositions(prev => [...prev, ...list]);
        } else {
          setPositions(list);
        }
        setPositionsTotal(total);
        setPositionsPage(page);
      }
      
    } catch (err) {
      console.error("[WalletPage] Error fetching positions:", err);
      setPositionsError(err.message);
    } finally {
      setPositionsLoading(false);
      setPositionsLoadingMore(false);
    }
  }, [wallet, chainId]);
  
  /**
   * Fetch trades from API
   */
  const fetchTrades = useCallback(async (page = 1, append = false) => {
    if (!isValidWalletAddress(wallet)) return;
    
    if (page === 1) {
      setTradesLoading(true);
    } else {
      setTradesLoadingMore(true);
    }
    setTradesError(null);
    
    try {
      const url = `/api/opinion/wallet/${wallet}/trades?chainId=${chainId}&page=${page}&limit=20`;
      const res = await fetch(url);
      const data = await res.json();
      
      // Opinion API uses errno instead of code
      const hasError = (data.errno !== undefined && data.errno !== 0) || 
                       (data.errno === undefined && data.code !== 0);
      if (hasError) {
        throw new Error(data.errmsg || data.msg || "Failed to fetch trades");
      }
      
      const list = data.result?.list || [];
      const total = data.result?.total || 0;
      
      if (append) {
        setTrades(prev => [...prev, ...list]);
      } else {
        setTrades(list);
      }
      setTradesTotal(total);
      setTradesPage(page);
      
    } catch (err) {
      console.error("[WalletPage] Error fetching trades:", err);
      setTradesError(err.message);
    } finally {
      setTradesLoading(false);
      setTradesLoadingMore(false);
    }
  }, [wallet, chainId]);
  
  /**
   * Initial backfill of trades for closed positions
   * Fetches multiple pages to detect closed positions accurately
   * Also fetches market info for claimed positions to calculate correct PnL
   */
  const backfillTrades = useCallback(async () => {
    if (!isValidWalletAddress(wallet)) return;
    
    setTradesLoading(true);
    setTradesError(null);
    
    try {
      let allTrades = [];
      let page = 1;
      const maxPages = 50; // Fetch up to 50 pages (1000 trades) for better closed positions coverage
      const limit = 20;
      
      while (page <= maxPages) {
        const url = `/api/opinion/wallet/${wallet}/trades?chainId=${chainId}&page=${page}&limit=${limit}`;
        const res = await fetch(url);
        const data = await res.json();
        
        // Opinion API uses errno instead of code
        const hasError = (data.errno !== undefined && data.errno !== 0) || 
                         (data.errno === undefined && data.code !== 0);
        if (hasError) {
          throw new Error(data.errmsg || data.msg || "Failed to fetch trades");
        }
        
        const list = data.result?.list || [];
        const total = data.result?.total || 0;
        
        allTrades = [...allTrades, ...list];
        
        // Stop if we've fetched all trades or reached 1000
        if (allTrades.length >= total || allTrades.length >= 1000 || list.length < limit) {
          break;
        }
        
        page++;
      }
      
      // === FETCH MARKET INFO FOR CLAIMED POSITIONS ===
      // Group trades by marketId
      const tradesByMarket = new Map();
      for (const trade of allTrades) {
        const marketId = String(trade.marketId);
        if (!tradesByMarket.has(marketId)) {
          tradesByMarket.set(marketId, []);
        }
        tradesByMarket.get(marketId).push(trade);
      }
      
      // Find markets with net shares > 0 (potentially claimed)
      // Count SPLIT as BUY and MERGE as SELL to correctly track SPLIT-funded positions
      // SPLIT/MERGE trades have shares=0 in API — derive from usdAmount / price
      const claimedMarketIds = [];
      for (const [marketId, trades] of tradesByMarket) {
        let netShares = 0;
        for (const t of trades) {
          let shares = Number(t.shares) || 0;
          const side = (t.side || '').toUpperCase();
          if (shares === 0 && (side === 'SPLIT' || side === 'MERGE')) {
            const price = Number(t.price) || 0;
            if (price > 0) {
              let amt = Number(t.usdAmount) || Number(t.amount) || 0;
              if (Math.abs(amt) > 1e10) amt = amt / 1e18;
              shares = amt / price;
            }
          }
          if (side === 'BUY' || side === 'SPLIT') netShares += shares;
          else if (side === 'SELL' || side === 'MERGE') netShares -= shares;
        }
        if (Math.abs(netShares) > 0.001) {
          claimedMarketIds.push(marketId);
        }
      }
      
      // Fetch market info for claimed positions
      if (claimedMarketIds.length > 0) {
        const newMarketInfoMap = new Map();
        
        // Fetch in batches of 10 to avoid overwhelming the server
        const batchSize = 10;
        for (let i = 0; i < claimedMarketIds.length; i += batchSize) {
          const batch = claimedMarketIds.slice(i, i + batchSize);
          const results = await Promise.all(
            batch.map(async (marketId) => {
              try {
                const res = await fetch(`/api/opinion/market/${marketId}`);
                const data = await res.json();
                const market = data.result?.data;
                
                if (!market) return null;
                
                let winningOutcomeSide = null;
                if (market.resultTokenId && market.yesTokenId && market.resultTokenId === market.yesTokenId) {
                  winningOutcomeSide = 1;
                } else if (market.resultTokenId && market.noTokenId && market.resultTokenId === market.noTokenId) {
                  winningOutcomeSide = 2;
                }
                
                return {
                  marketId,
                  winningOutcomeSide,
                  statusEnum: market.statusEnum,
                  resolvedAt: market.resolvedAt,
                };
              } catch (err) {
                console.error(`Error fetching market ${marketId}:`, err);
                return null;
              }
            })
          );
          
          for (const info of results) {
            if (info && info.winningOutcomeSide !== null) {
              newMarketInfoMap.set(info.marketId, info);
            }
          }
        }
        
        setMarketInfoMap(newMarketInfoMap);
      }
      
      setTrades(allTrades);
      setTradesTotal(allTrades.length);
      setTradesPage(page);
      
    } catch (err) {
      console.error("[WalletPage] Error backfilling trades:", err);
      setTradesError(err.message);
    } finally {
      setTradesLoading(false);
    }
  }, [wallet, chainId]);
  
  /**
   * Load more positions
   */
  const handleLoadMorePositions = useCallback(() => {
    const nextPage = positionsPage + 1;
    fetchPositions(nextPage, true);
  }, [positionsPage, fetchPositions]);
  
  /**
   * Load more trades for activity
   */
  const handleLoadMoreTrades = useCallback(() => {
    const nextPage = tradesPage + 1;
    fetchTrades(nextPage, true);
  }, [tradesPage, fetchTrades]);
  
  /**
   * Load more trade history for closed positions
   */
  const handleLoadMoreHistory = useCallback(async () => {
    if (!isValidWalletAddress(wallet)) return;
    
    setTradesLoadingMore(true);
    
    try {
      const startPage = tradesPage + 1;
      const maxNewPages = 5;
      let newTrades = [...trades];
      let page = startPage;
      
      while (page < startPage + maxNewPages) {
        const url = `/api/opinion/wallet/${wallet}/trades?chainId=${chainId}&page=${page}&limit=20`;
        const res = await fetch(url);
        const data = await res.json();
        
        // Opinion API uses errno instead of code
        const hasError = (data.errno !== undefined && data.errno !== 0) || 
                         (data.errno === undefined && data.code !== 0);
        if (hasError) break;
        
        const list = data.result?.list || [];
        if (list.length === 0) break;
        
        newTrades = [...newTrades, ...list];
        page++;
      }
      
      setTrades(newTrades);
      setTradesPage(page - 1);
      
    } catch (err) {
      console.error("[WalletPage] Error loading more history:", err);
    } finally {
      setTradesLoadingMore(false);
    }
  }, [wallet, chainId, tradesPage, trades]);
  
  /**
   * Handle back navigation - go to wallet tracker search
   */
  const handleBack = useCallback(() => {
    // Use replace to prevent adding to history stack
    router.replace("/wallet");
  }, [router]);
  
  /**
   * Handle refresh - refetch all data
   */
  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    
    setIsRefreshing(true);
    try {
      // Reset and refetch everything
      await Promise.all([
        fetchPositions(1, false),
        backfillTrades(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, fetchPositions, backfillTrades]);
  
  // Initial data fetch
  useEffect(() => {
    if (isValidWalletAddress(wallet)) {
      fetchPositions(1, false);
      backfillTrades();
    }
  }, [wallet, chainId, fetchPositions, backfillTrades]);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 900);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);
  
  // Validate wallet address
  if (!isValidWalletAddress(wallet)) {
    return (
      <div className="container">
        <div className="wallet-page">
          <ErrorState 
            message={`Invalid wallet address: "${wallet}". Please provide a valid Ethereum/BSC address (0x followed by 40 hex characters).`}
          />
        </div>
      </div>
    );
  }
  
  const hasMorePositions = positions.length < positionsTotal;
  const hasMoreTrades = trades.length < tradesTotal;
  const isDataLoading = positionsLoading || tradesLoading;
  
  return (
    <div className="container wallet-container">
      <div className="wallet-page-wrapper">
        {/* Navigation Bar - Back & Refresh */}
        <NavigationBar 
          onBack={handleBack}
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
        />
        
        {/* Wallet Header */}
        <WalletHeader 
          wallet={wallet}
          stats={walletStats}
          pnlByPeriod={pnlByPeriod}
          chainId={chainId}
          isLoading={isDataLoading}
        />
        
        {/* Main Tabs */}
        <div style={{ marginBottom: 20, marginTop: 20 }}>
          <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <TabButton
              active={activeTab === "positions"}
              onClick={() => setActiveTab("positions")}
            >
              Positions
            </TabButton>
            <TabButton
              active={activeTab === "activity"}
              onClick={() => setActiveTab("activity")}
            >
              Activity
            </TabButton>
            <TabButton
              active={activeTab === "rebate"}
              onClick={() => setActiveTab("rebate")}
            >
              Rebate
            </TabButton>
          </div>
        </div>
        
        {/* Positions Tab Content */}
        {activeTab === "positions" && (
          <div style={{ marginTop: 16 }}>
            {/* Sub-tabs and Search */}
            <div style={{ 
              display: "flex", 
              alignItems: "stretch", 
              gap: 16, 
              marginBottom: 16,
              flexWrap: "wrap",
              flexDirection: isMobile ? "column" : "row",
            }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", width: isMobile ? "100%" : "auto" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flex: isMobile ? 1 : "initial" }}>
                  <SubTabButton
                    active={positionsSubTab === "active"}
                    onClick={() => setPositionsSubTab("active")}
                  >
                    Active
                  </SubTabButton>
                  <SubTabButton
                    active={positionsSubTab === "closed"}
                    onClick={() => setPositionsSubTab("closed")}
                  >
                    Closed
                  </SubTabButton>
                </div>
                {isMobile && (
                  positionsSubTab === "active" ? (
                    <ValueSortButton
                      sortOrder={positionsSortOrder}
                      onClick={() => setPositionsSortOrder(prev => prev === "desc" ? "asc" : "desc")}
                    />
                  ) : (
                    <ClosedSortDropdown
                      sortBy={closedSortBy}
                      sortOrder={closedSortOrder}
                      onSortChange={(nextBy, nextOrder) => {
                        setClosedSortBy(nextBy);
                        setClosedSortOrder(nextOrder);
                      }}
                    />
                  )
                )}
              </div>
              
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search positions"
                fullWidth={isMobile}
                stretch={!isMobile && positionsSubTab === "closed"}
              />
              {!isMobile && positionsSubTab === "closed" && (
                <ClosedSortDropdown
                  sortBy={closedSortBy}
                  sortOrder={closedSortOrder}
                  onSortChange={(nextBy, nextOrder) => {
                    setClosedSortBy(nextBy);
                    setClosedSortOrder(nextOrder);
                  }}
                />
              )}
            </div>
            
            {/* Active Positions (filtered to exclude "practically closed" ones) */}
            {positionsSubTab === "active" && (
              positionsError ? (
                <ErrorState 
                  message={positionsError}
                  onRetry={() => fetchPositions(1, false)}
                />
              ) : (
                <PositionsTable
                  positions={activePositionsFiltered}
                  isLoading={positionsLoading}
                  searchQuery={searchQuery}
                  onLoadMore={handleLoadMorePositions}
                  hasMore={hasMorePositions}
                  loadingMore={positionsLoadingMore}
                  sortOrder={positionsSortOrder}
                  onToggleSort={() => setPositionsSortOrder(prev => prev === "desc" ? "asc" : "desc")}
                />
              )
            )}
            
            {/* Closed Positions */}
            {positionsSubTab === "closed" && (
              tradesError ? (
                <ErrorState 
                  message={tradesError}
                  onRetry={backfillTrades}
                />
              ) : (
                <ClosedPositionsTable
                  closedPositions={closedPositions}
                  isLoading={tradesLoading}
                  searchQuery={searchQuery}
                  onLoadMoreHistory={handleLoadMoreHistory}
                  loadingMore={tradesLoadingMore}
                  sortBy={closedSortBy}
                  sortOrder={closedSortOrder}
                  onSortChange={(nextBy, nextOrder) => {
                    setClosedSortBy(nextBy);
                    setClosedSortOrder(nextOrder);
                  }}
                  hideDesktopControls={!isMobile}
                  hideMobileControls={isMobile}
                />
              )
            )}
          </div>
        )}
        
        {/* Activity Tab Content */}
        {activeTab === "activity" && (
          <div style={{ marginTop: 16 }}>
            {tradesError ? (
              <ErrorState 
                message={tradesError}
                onRetry={() => fetchTrades(1, false)}
              />
            ) : (
              <ActivityList
                trades={trades}
                isLoading={tradesLoading}
                onLoadMore={handleLoadMoreTrades}
                hasMore={hasMoreTrades}
                loadingMore={tradesLoadingMore}
                chainId={chainId}
              />
            )}
          </div>
        )}
        
        {/* Rebate Tab Content */}
        {activeTab === "rebate" && (
          <div style={{ marginTop: 16 }}>
            <RebateTab
              trades={trades}
              isLoading={tradesLoading}
            />
          </div>
        )}
      </div>
    </div>
  );
}
