/**
 * Derive Closed Positions from Trade History
 * 
 * Opinion API provides open positions directly, but closed positions must be
 * derived by analyzing trade history. A position is "closed" when:
 * - Net shares (buys - sells) equals 0
 * - There was at least one trade
 * 
 * This module provides functions to compute closed positions and their PnL.
 */

import { num, normalizeUsdAmount, normalizeWeiValue } from './format.js';

/**
 * Group trades by market and outcome side
 * @param {Array} trades - Array of trade objects
 * @returns {Map} - Map keyed by "marketId:outcomeSide" with trade arrays
 */
export function groupTradesByPosition(trades) {
  const groups = new Map();
  
  for (const trade of trades) {
    const key = `${trade.marketId}:${trade.outcomeSide || trade.outcome}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(trade);
  }
  
  return groups;
}

/**
 * Calculate net shares for a position from trades
 * @param {Array} trades - Array of trades for one position
 * @returns {number} - Net shares (positive = long, 0 = closed)
 */
export function calculateNetShares(trades) {
  let netShares = 0;
  
  for (const trade of trades) {
    const shares = num(trade.shares);
    const side = (trade.side || '').toUpperCase();
    
    if (side === 'BUY') {
      netShares += shares;
    } else if (side === 'SELL') {
      netShares -= shares;
    }
  }
  
  return netShares;
}

/**
 * Calculate PnL for a closed position
 * 
 * Method 1: Sum of trade.profit if available
 * Method 2: Cash flow analysis (sells - buys)
 * Method 3: For resolved/claimed positions, calculate based on winning outcome
 * 
 * @param {Array} trades - Trades for closed position
 * @param {Object} options - { isResolved, didWin, netShares }
 * @returns {Object} - { pnl, pnlPercent, totalBet, totalBought, totalSold }
 */
export function calculateClosedPnL(trades, options = {}) {
  const { isResolved = false, didWin = null, netShares = 0 } = options;
  
  let totalBought = 0;  // Total spent on buys
  let totalSold = 0;    // Total received from sells
  let profitSum = 0;    // Sum of profit fields if available
  let hasProfit = false;
  
  for (const trade of trades) {
    // Use normalizeUsdAmount to handle wei format from Opinion API
    const amount = normalizeUsdAmount(trade.usdAmount, trade.amount);
    // Also normalize profit as it may be in wei format
    const profit = normalizeWeiValue(trade.profit);
    const side = (trade.side || '').toUpperCase();
    
    if (profit !== 0) {
      hasProfit = true;
      profitSum += profit;
    }
    
    if (side === 'BUY') {
      totalBought += amount;
    } else if (side === 'SELL') {
      totalSold += amount;
    }
  }
  
  let pnl;
  const totalBet = totalBought;
  
  // For resolved positions with known outcome, calculate properly
  if (isResolved && didWin !== null && Math.abs(netShares) > 0.001) {
    if (didWin) {
      // User won: each share pays out $1
      // PnL = payout - cost + any sell profit
      // payout = netShares * $1
      pnl = netShares - totalBought + totalSold;
    } else {
      // User lost: payout is $0
      // PnL = 0 - cost + any sell profit
      pnl = 0 - totalBought + totalSold;
    }
  } else if (hasProfit) {
    // Use profit sum if available
    pnl = profitSum;
  } else {
    // Otherwise calculate from cash flow
    pnl = totalSold - totalBought;
  }
  
  const pnlPercent = totalBet > 0 ? (pnl / totalBet) * 100 : 0;
  
  return { pnl, pnlPercent, totalBet, totalBought, totalSold };
}

/**
 * Check if a position has been claimed (user has claimed winnings/losses)
 * claimStatus: 0=CanNotClaim, 1=WaitClaim, 2=Claiming, 3=ClaimFailed, 4=Claimed
 * @param {Object} pos - Position object
 * @returns {boolean}
 */
function isPositionClaimed(pos) {
  if (!pos) return false;
  
  // Check claimStatus === 4 (Claimed)
  const claimStatus = Number(pos.claimStatus);
  if (claimStatus === 4) return true;
  
  // Check claimStatusEnum === "Claimed"
  const claimStatusEnum = String(pos.claimStatusEnum || "").toLowerCase();
  if (claimStatusEnum === "claimed") return true;
  
  return false;
}

/**
 * Check if a market/position is resolved (market ended, waiting for claim or already claimed)
 * @param {Object} pos - Position or trade object
 * @returns {boolean}
 */
function isMarketResolved(pos) {
  if (!pos) return false;
  
  // Check if already claimed
  if (isPositionClaimed(pos)) return true;
  
  // Check statusEnum for resolved market
  const status = String(pos.statusEnum || pos.status || "").toLowerCase();
  if (status === "resolved" || status === "settled") return true;
  
  // Check resolvedAt timestamp
  const resolvedAt = Number(pos.resolvedAt || pos.resolved_at || 0);
  if (resolvedAt > 0) return true;
  
  // Check winningOutcome (if present, market is resolved)
  if (pos.winningOutcome !== undefined && pos.winningOutcome !== null) return true;
  
  return false;
}

/**
 * Derive closed positions from trade history and active positions
 * 
 * Opinion doesn't allow selling 100% of shares - typically 1-4 shares remain.
 * A position is considered "closed" when:
 * - Net shares is 0 (fully closed), OR
 * - Net shares <= 3 AND remaining value < $1.5 (practically closed), OR
 * - Market is RESOLVED (user can claim winnings or has lost)
 * 
 * @param {Array} trades - All trades for the wallet
 * @param {Array} activePositions - Optional: active positions to check for "practically closed" or resolved
 * @param {Map} marketInfoMap - Optional: Map<marketId, { winningOutcomeSide, statusEnum }> for resolved markets
 * @returns {Array} - Array of ClosedPosition objects
 */
export function deriveClosedPositions(trades, activePositions = [], marketInfoMap = new Map()) {
  const closedPositions = [];
  const processedKeys = new Set(); // Track which positions we've already processed
  
  // Build a map of active positions for quick lookup
  const activeMap = new Map();
  for (const pos of (activePositions || [])) {
    const key = `${pos.marketId}:${pos.outcomeSide || pos.outcome}`;
    activeMap.set(key, pos);
  }
  
  // ===== PART 1: Process trades to find closed/practically closed positions =====
  if (Array.isArray(trades) && trades.length > 0) {
    const groups = groupTradesByPosition(trades);
    
    for (const [key, positionTrades] of groups) {
      const netShares = calculateNetShares(positionTrades);
      
      // Check if position is in active list
      const activePos = activeMap.get(key);
      
      // Calculate remaining value (shares * current price, estimate ~$1 per share if no data)
      let remainingValue = Math.abs(netShares) * 1; // Default estimate
      if (activePos) {
        remainingValue = num(activePos.currentValueInQuoteToken) || num(activePos.value) || (Math.abs(netShares) * num(activePos.price || 1));
      }
      
      // Check if position is claimed (claimStatus=4 or claimStatusEnum="Claimed")
      const positionClaimed = isPositionClaimed(activePos);
      
      // **KEY LOGIC**: If we have trades for a position but it's NOT in activePositions,
      // and netShares > 0, it means the position was CLAIMED (resolved and removed from API)
      // Opinion removes positions from API after claim
      const hasTradesButNoPosition = !activePos && Math.abs(netShares) > 0.001;
      
      // Position is "closed" when:
      // 1. netShares is approximately 0 (fully closed by selling), OR
      // 2. netShares <= 3 AND remaining value < $1.5 (practically closed - Opinion's limitation), OR
      // 3. Position is CLAIMED (claimStatus=4), OR
      // 4. Has trades but position disappeared from API (was claimed after resolution)
      const isFullyClosed = Math.abs(netShares) < 0.001;
      const isPracticallyClosed = Math.abs(netShares) <= 3 && Math.abs(netShares) > 0.001 && remainingValue < 1.5;
      const isClaimed = positionClaimed && Math.abs(netShares) > 0;
      const wasClaimedAndRemoved = hasTradesButNoPosition;
      
      if (isFullyClosed || isPracticallyClosed || isClaimed || wasClaimedAndRemoved) {
        processedKeys.add(key);
        
        // Sort trades by date to find first/last
        const sortedTrades = [...positionTrades].sort(
          (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
        );
        
        const firstTrade = sortedTrades[0];
        const lastTrade = sortedTrades[sortedTrades.length - 1]; // Most recent trade
        
        // Find last SELL trade (this is when position was "closed")
        const sellTrades = sortedTrades.filter(t => (t.side || '').toUpperCase() === 'SELL');
        const lastSellTrade = sellTrades.length > 0 ? sellTrades[sellTrades.length - 1] : null;
        
        const marketId = String(firstTrade.marketId);
        const userOutcomeSide = Number(firstTrade.outcomeSide); // 1 = YES, 2 = NO
        
        // Get market info from map (for resolved markets)
        const marketInfo = marketInfoMap.get(marketId);
        
        // DEBUG for ALL claimed positions
        if (wasClaimedAndRemoved) {
          console.log(`[DEBUG] Claimed position ${marketId}:`, firstTrade.marketTitle);
          console.log('  - marketInfo:', marketInfo);
          console.log('  - userOutcomeSide:', userOutcomeSide);
        }
        
        // Determine if user won (for resolved/claimed positions)
        let isResolved = false;
        let didWin = null;
        
        if (wasClaimedAndRemoved || isClaimed) {
          // Check if we have market info with winning outcome
          if (marketInfo) {
            isResolved = true;
            const winningOutcomeSide = marketInfo.winningOutcomeSide;
            if (winningOutcomeSide !== undefined && winningOutcomeSide !== null) {
              // Compare user's outcome side with winning outcome side
              didWin = (userOutcomeSide === winningOutcomeSide);
            }
          } else if (activePos) {
            // Fallback: check activePos for winningOutcome
            const winningOutcome = activePos.winningOutcome;
            const userOutcome = activePos.outcomeSide || activePos.outcome;
            if (winningOutcome !== undefined && winningOutcome !== null) {
              isResolved = true;
              didWin = (String(winningOutcome) === String(userOutcome));
            }
          }
        }
        
        // Calculate PnL with proper resolution info
        const { pnl, pnlPercent, totalBet } = calculateClosedPnL(positionTrades, {
          isResolved,
          didWin,
          netShares: Math.abs(netShares),
        });
        
        // Determine result based on didWin or PnL
        let result = 'unknown';
        if (isResolved && didWin !== null) {
          result = didWin ? 'won' : 'lost';
        } else if (pnl > 0.01) {
          result = 'won';
        } else if (pnl < -0.01) {
          result = 'lost';
        }
        
        // Calculate average price from buy trades
        const buyTrades = positionTrades.filter(t => 
          (t.side || '').toUpperCase() === 'BUY'
        );
        const totalBuyShares = buyTrades.reduce((sum, t) => sum + num(t.shares), 0);
        const avgPrice = totalBuyShares > 0 
          ? buyTrades.reduce((sum, t) => sum + num(t.price) * num(t.shares), 0) / totalBuyShares
          : 0;
        
        // Get resolved/claimed timestamp if available
        const resolvedAt = activePos?.resolvedAt || activePos?.resolved_at || 
                          marketInfo?.resolvedAt ||
                          firstTrade?.resolvedAt || firstTrade?.resolved_at || null;
        
        closedPositions.push({
          marketId: firstTrade.marketId,
          marketTitle: firstTrade.marketTitle,
          // Enriched fields from trades API
          displayTitle: firstTrade.displayTitle,
          thumbnailUrl: firstTrade.thumbnailUrl,
          rootMarketTitle: firstTrade.rootMarketTitle,
          rootMarketId: firstTrade.rootMarketId,
          outcomeName: firstTrade.outcomeName || firstTrade.marketTitle,
          outcomeSide: firstTrade.outcomeSide || firstTrade.outcome,
          outcomeSideEnum: firstTrade.outcomeSideEnum,
          outcome: firstTrade.outcome,
          result,
          totalBet,
          totalShares: buyTrades.reduce((sum, t) => sum + num(t.shares), 0),
          avgPrice,
          closedPnl: pnl,
          closedPnlPercent: pnlPercent,
          // Use last SELL trade time as "closed at" (most recent activity)
          // Fallback to last trade if no SELL trades exist
          closedAt: lastSellTrade?.createdAt || lastTrade.createdAt,
          trades: sortedTrades,
          marketIcon: firstTrade.marketIcon,
          chainId: firstTrade.chainId,
          // Flags
          isPracticallyClosed: isPracticallyClosed,
          isClaimed: isClaimed || wasClaimedAndRemoved,
          wasClaimedAndRemoved: wasClaimedAndRemoved,
          remainingShares: (isPracticallyClosed || isClaimed || wasClaimedAndRemoved) ? Math.abs(netShares) : 0,
        });
      }
    }
  }
  
  // ===== PART 2: Check active positions for claimed positions not in trades =====
  // These are positions where user held through resolution and claimed, but may not have recent trades
  for (const pos of (activePositions || [])) {
    const key = `${pos.marketId}:${pos.outcomeSide || pos.outcome}`;
    
    // Skip if already processed from trades
    if (processedKeys.has(key)) continue;
    
    // Only add if position is claimed (claimStatus=4)
    if (!isPositionClaimed(pos)) continue;
    
    const shares = num(pos.shares);
    const value = num(pos.currentValueInQuoteToken) || num(pos.value) || 0;
    const avgPrice = num(pos.avgPrice) || num(pos.price) || 0;
    const totalBet = shares * avgPrice;
    
    // Determine result
    let result = 'unknown';
    const winningOutcome = pos.winningOutcome;
    const userOutcome = pos.outcomeSide || pos.outcome;
    if (winningOutcome !== undefined && winningOutcome !== null) {
      result = (String(winningOutcome) === String(userOutcome)) ? 'won' : 'lost';
    }
    
    // Calculate PnL for claimed position
    // If won: pnl = (shares * 1) - totalBet (each share pays out $1 if won)
    // If lost: pnl = -totalBet (lose entire bet)
    let pnl = 0;
    if (result === 'won') {
      pnl = shares - totalBet; // $1 per share payout minus cost
    } else if (result === 'lost') {
      pnl = -totalBet;
    }
    const pnlPercent = totalBet > 0 ? (pnl / totalBet) * 100 : 0;
    
    const resolvedAt = pos.resolvedAt || pos.resolved_at;
    
    closedPositions.push({
      marketId: pos.marketId,
      marketTitle: pos.marketTitle,
      displayTitle: pos.displayTitle || `${pos.rootMarketTitle || ""} - ${pos.marketTitle || ""}`.trim(),
      thumbnailUrl: pos.thumbnailUrl,
      rootMarketTitle: pos.rootMarketTitle,
      rootMarketId: pos.rootMarketId,
      outcomeName: pos.outcomeName || pos.marketTitle,
      outcomeSide: pos.outcomeSide || pos.outcome,
      outcomeSideEnum: pos.outcomeSideEnum,
      outcome: pos.outcome,
      result,
      totalBet,
      totalShares: shares,
      avgPrice,
      closedPnl: pnl,
      closedPnlPercent: pnlPercent,
      closedAt: resolvedAt ? new Date(resolvedAt * 1000).toISOString() : new Date().toISOString(),
      trades: [], // No trades for this position
      marketIcon: pos.marketIcon || pos.thumbnailUrl,
      chainId: pos.chainId,
      isClaimed: true,
      isPracticallyClosed: false,
      remainingShares: shares,
    });
  }
  
  // Sort by closed date descending (most recent first)
  closedPositions.sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt));
  
  return closedPositions;
}

/**
 * Calculate wallet statistics from positions and trades
 * 
 * @param {Array} positions - Active positions
 * @param {Array} trades - Trade history
 * @returns {Object} - WalletStats object
 */
export function calculateWalletStats(positions, trades) {
  // Positions value & unrealized PnL (exclude "practically closed" positions with <= 3 shares and value < $1.5)
  let positionsValue = 0;
  let totalUnrealizedPnl = 0;
  
  for (const p of (positions || [])) {
    const shares = num(p.shares);
    const value = num(p.currentValueInQuoteToken);
    const unrealizedPnl = num(p.unrealizedPnl);
    
    // Skip practically closed positions
    if (shares <= 3 && value < 1.5) continue;
    
    positionsValue += value;
    totalUnrealizedPnl += unrealizedPnl;
  }
  
  // Unique markets (predictions count)
  const uniqueMarkets = new Set();
  for (const trade of (trades || [])) {
    if (trade.marketId) uniqueMarkets.add(trade.marketId);
  }
  const predictionsCount = uniqueMarkets.size;
  
  // Biggest win - find max profit from trades
  let biggestWin = 0;
  for (const trade of (trades || [])) {
    // Normalize profit as it may be in wei format
    const profit = normalizeWeiValue(trade.profit);
    if (profit > biggestWin) biggestWin = profit;
  }
  
  // If no individual trade has profit field, calculate from closed positions
  if (biggestWin === 0) {
    const closed = deriveClosedPositions(trades || [], positions || []);
    for (const cp of closed) {
      if (cp.closedPnl > biggestWin) biggestWin = cp.closedPnl;
    }
  }
  
  // Total Realized PnL from closed positions
  const closed = deriveClosedPositions(trades || [], positions || []);
  const realizedPnl = closed.reduce((sum, cp) => sum + cp.closedPnl, 0);
  
  // Win rate
  const wins = closed.filter(cp => cp.result === 'won').length;
  const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;
  
  // === Volume calculations ===
  // Opinion uses usdAmount (in wei, divide by 1e18) for Trading Volume
  // This gives the exact match with Opinion's "Your Progress Hub" stats
  
  // Total Volume (all time)
  let totalVolume = 0;
  for (const trade of (trades || [])) {
    // usdAmount is in wei format (18 decimals), need to divide by 1e18
    const usdAmount = num(trade.usdAmount);
    totalVolume += usdAmount > 1e10 ? usdAmount / 1e18 : num(trade.amount);
  }
  
  // Weekly Volume (00:00 UTC last Sunday → 00:00 UTC this Sunday)
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0 = Sunday
  
  // Calculate this Sunday 00:00 UTC (end of week)
  const thisSunday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysUntilSunday = (7 - dayOfWeek) % 7;
  thisSunday.setUTCDate(thisSunday.getUTCDate() + daysUntilSunday);
  
  // Last Sunday 00:00 UTC (start of week)
  const lastSunday = new Date(thisSunday);
  lastSunday.setUTCDate(lastSunday.getUTCDate() - 7);
  
  let weeklyVolume = 0;
  for (const trade of (trades || [])) {
    const createdAt = trade.createdAt;
    let tradeDate;
    if (typeof createdAt === 'number' || /^\d+$/.test(createdAt)) {
      tradeDate = new Date(Number(createdAt) * 1000);
    } else {
      tradeDate = new Date(createdAt);
    }
    
    if (tradeDate >= lastSunday && tradeDate < thisSunday) {
      // Same logic: use usdAmount/1e18 for accurate volume
      const usdAmount = num(trade.usdAmount);
      weeklyVolume += usdAmount > 1e10 ? usdAmount / 1e18 : num(trade.amount);
    }
  }
  
  return {
    positionsValue,
    biggestWin,
    predictionsCount,
    // PnL fields
    totalUnrealizedPnl,  // From open positions (API provides this per position)
    realizedPnl,         // From closed positions
    totalPnl: totalUnrealizedPnl + realizedPnl,  // Combined
    winRate,
    // Volume fields
    totalVolume,
    weeklyVolume,
  };
}

/**
 * Calculate weekly PnL for sparkline chart
 * Groups trades by day and computes cumulative PnL
 * 
 * @param {Array} trades - Trade history
 * @param {number} days - Number of days to analyze (default 7)
 * @returns {Array} - Array of { date, pnl } for each day
 */
export function calculateWeeklyPnL(trades, days = 7) {
  if (!Array.isArray(trades) || trades.length === 0) {
    // Return placeholder data
    return Array.from({ length: days }, (_, i) => ({
      date: new Date(Date.now() - (days - 1 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      pnl: 0,
    }));
  }
  
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - days + 1);
  startDate.setHours(0, 0, 0, 0);
  
  // Initialize daily buckets
  const dailyPnL = new Map();
  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const key = date.toISOString().split('T')[0];
    dailyPnL.set(key, 0);
  }
  
  // Sum profits by day
  for (const trade of trades) {
    // Handle both Unix timestamp (number/string of digits) and ISO date string
    let tradeDate;
    const createdAt = trade.createdAt;
    
    if (typeof createdAt === 'number' || /^\d+$/.test(createdAt)) {
      // Unix timestamp (seconds)
      tradeDate = new Date(Number(createdAt) * 1000);
    } else {
      // ISO string
      tradeDate = new Date(createdAt);
    }
    
    if (isNaN(tradeDate.getTime())) continue;
    
    const key = tradeDate.toISOString().split('T')[0];
    if (dailyPnL.has(key)) {
      // Normalize profit as it may be in wei format
      const profit = normalizeWeiValue(trade.profit);
      dailyPnL.set(key, dailyPnL.get(key) + profit);
    }
  }
  
  // Convert to cumulative
  const result = [];
  let cumulative = 0;
  for (const [date, pnl] of dailyPnL) {
    cumulative += pnl;
    result.push({ date, pnl: cumulative });
  }
  
  return result;
}

/**
 * Calculate PnL data for multiple periods
 * Returns { "1D": [...], "1W": [...], "1M": [...], "ALL": [...] }
 * 
 * @param {Array} trades - Trade history
 * @returns {Object} - PnL data for each period
 */
export function calculatePnLByPeriod(trades) {
  const result = {};
  
  // Fixed periods
  result["1D"] = calculateWeeklyPnL(trades, 1);
  result["1W"] = calculateWeeklyPnL(trades, 7);
  result["1M"] = calculateWeeklyPnL(trades, 30);
  
  // ALL time: calculate from earliest trade
  if (!Array.isArray(trades) || trades.length === 0) {
    result["ALL"] = calculateWeeklyPnL(trades, 30);
  } else {
    // Find earliest trade date
    let earliestTimestamp = Infinity;
    for (const trade of trades) {
      const createdAt = trade.createdAt;
      let ts;
      if (typeof createdAt === 'number' || /^\d+$/.test(createdAt)) {
        ts = Number(createdAt) * 1000;
      } else {
        ts = new Date(createdAt).getTime();
      }
      if (ts < earliestTimestamp && !isNaN(ts)) {
        earliestTimestamp = ts;
      }
    }
    
    // Calculate days from earliest trade to now
    const now = Date.now();
    const daysFromEarliest = Math.ceil((now - earliestTimestamp) / (24 * 60 * 60 * 1000));
    const allDays = Math.max(daysFromEarliest, 1);
    
    result["ALL"] = calculateWeeklyPnL(trades, allDays);
  }
  
  return result;
}

/**
 * Sort closed positions by specified criteria
 * 
 * @param {Array} closedPositions - Closed positions array
 * @param {'pnl'|'date'} sortBy - Sort criteria
 * @param {'asc'|'desc'} order - Sort order
 * @returns {Array} - Sorted array (new array, doesn't mutate)
 */
export function sortClosedPositions(closedPositions, sortBy = 'date', order = 'desc') {
  const sorted = [...closedPositions];
  
  sorted.sort((a, b) => {
    let comparison = 0;
    
    if (sortBy === 'pnl') {
      comparison = a.closedPnl - b.closedPnl;
    } else if (sortBy === 'date') {
      const dateA = new Date(a.closedAt);
      const dateB = new Date(b.closedAt);
      
      // If invalid date, push to end
      if (isNaN(dateA.getTime())) return 1;
      if (isNaN(dateB.getTime())) return -1;
      
      comparison = dateA - dateB;
    }
    
    return order === 'desc' ? -comparison : comparison;
  });
  
  return sorted;
}
