/**
 * API Route: GET /api/arbitage/wallet-positions
 * 
 * Fetches wallet positions from both Polymarket and Opinion,
 * then matches them to find arbitrage pairs.
 * 
 * Query Params:
 * - polyWallet: Polymarket wallet address (required)
 * - opinionWallet: Opinion wallet address (optional, defaults to polyWallet)
 * - type: "active" (default) or "closed" - filter position type
 * 
 * Returns:
 * - arbPositions: Matched arbitrage pairs with computed values
 * - polyPositions: Raw Polymarket positions
 * - opinionPositions: Raw Opinion positions
 * - closedArb: Closed arbitrage positions (when type=closed)
 */

import { NextResponse } from "next/server";

// ============================================================================
// Configuration
// ============================================================================

const POLYMARKET_DATA_API = "https://data-api.polymarket.com";
const OPINION_OPENAPI_BASE = process.env.OPINION_OPENAPI_BASE || "https://openapi.opinion.trade/openapi";
const OPINION_API_KEY = process.env.OPINION_API_KEY || "";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Validate wallet address format
 */
function isValidWallet(address) {
  if (!address || typeof address !== "string") return false;
  return /^0x[a-fA-F0-9]{40}$/i.test(address);
}

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      cache: "no-store",
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================================
// Polymarket API Functions
// ============================================================================

/**
 * Fetch positions from Polymarket Data API
 * Docs: https://docs.polymarket.com/api-reference/core/get-current-positions-for-a-user
 * 
 * @param {string} wallet - User wallet address (proxy wallet)
 * @returns {Array} - Array of positions
 */
async function fetchPolymarketPositions(wallet) {
  try {
    const url = new URL(`${POLYMARKET_DATA_API}/positions`);
    url.searchParams.set("user", wallet.toLowerCase());
    url.searchParams.set("sizeThreshold", "0.1"); // Minimum 0.1 shares
    url.searchParams.set("limit", "100");
    url.searchParams.set("sortBy", "CURRENT_VALUE");
    url.searchParams.set("sortDirection", "DESC");
    
    console.log("[Polymarket] Fetching positions:", url.toString());
    
    const response = await fetchWithTimeout(url.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    });
    
    if (!response.ok) {
      const text = await response.text();
      console.error("[Polymarket] Error:", response.status, text);
      return [];
    }
    
    const data = await response.json();
    console.log("[Polymarket] Found", data?.length || 0, "positions");
    
    // Log raw data for debugging
    for (const pos of (data || [])) {
      console.log(`[Polymarket] Position: "${pos.title}" outcome="${pos.outcome}" size=${pos.size}`);
    }
    
    // Normalize Polymarket positions
    return (data || []).map(pos => {
      // For categorical markets, outcome might be the actual outcome name (e.g., "No change")
      // For binary markets, outcome is "Yes" or "No"
      const outcomeRaw = pos.outcome || "";
      const outcomeUpper = outcomeRaw.toUpperCase();
      
      // Determine side: YES, NO, or the actual outcome name for categorical
      let side;
      if (outcomeUpper === "YES") {
        side = "YES";
      } else if (outcomeUpper === "NO") {
        side = "NO";
      } else {
        // Categorical market - use the outcome as-is
        // For matching, we'll need to handle this specially
        side = outcomeRaw; // e.g., "No change"
      }
      
      return {
        platform: "polymarket",
        
        // IDs
        assetId: pos.asset,
        marketId: pos.market,
        conditionId: pos.conditionId,
        
        // Market info
        marketTitle: pos.title || pos.question || "",
        marketSlug: pos.slug || "",
        eventSlug: pos.eventSlug || "",
        outcome: outcomeRaw,
        
        // Position data
        side: side,
        shares: Number(pos.size) || 0,
        
        // Flag for categorical market detection
        isCategorical: outcomeUpper !== "YES" && outcomeUpper !== "NO",
        
        // Prices (Polymarket returns decimal 0-1)
        avgPriceCents: Math.round((Number(pos.avgPrice) || 0) * 1000) / 10,
        currentPriceCents: Math.round((Number(pos.curPrice) || 0) * 1000) / 10,
      
        // Values
        initialValueUsd: Number(pos.initialValue) || 0,
        currentValueUsd: Number(pos.currentValue) || 0,
        pnlUsd: Number(pos.cashPnl) || 0,  // cashPnl not pnl
        pnlPercent: Number(pos.percentPnl) || 0,  // percentPnl
        
        // URLs - use eventSlug for event page link
        thumbnailUrl: pos.icon || null,
        marketUrl: pos.eventSlug 
          ? `https://polymarket.com/event/${pos.eventSlug}` 
          : (pos.slug ? `https://polymarket.com/market/${pos.slug}` : null),
        
        // Raw data for debugging
        _raw: pos,
      };
    });
    
  } catch (error) {
    console.error("[Polymarket] Fetch error:", error.message);
    return [];
  }
}

// ============================================================================
// Opinion API Functions
// ============================================================================

/**
 * Fetch positions from Opinion OpenAPI
 * 
 * @param {string} wallet - User wallet address
 * @returns {Array} - Array of positions
 */
async function fetchOpinionPositions(wallet) {
  if (!OPINION_API_KEY) {
    console.error("[Opinion] API key not configured");
    return [];
  }
  
  try {
    const url = new URL(`${OPINION_OPENAPI_BASE}/positions/user/${wallet}`);
    url.searchParams.set("chainId", "56"); // BSC
    url.searchParams.set("limit", "100");
    url.searchParams.set("page", "1");
    
    console.log("[Opinion] Fetching positions:", url.toString());
    
    const response = await fetchWithTimeout(url.toString(), {
      method: "GET",
      headers: {
        "apikey": OPINION_API_KEY,
        "Accept": "application/json",
      },
    });
    
    if (!response.ok) {
      const text = await response.text();
      console.error("[Opinion] Error:", response.status, text);
      return [];
    }
    
    const data = await response.json();
    
    if (data.errno !== 0) {
      console.error("[Opinion] API error:", data.errmsg);
      return [];
    }
    
    const positions = data.result?.list || [];
    console.log("[Opinion] Found", positions.length, "positions");
    
    // Normalize Opinion positions
    return positions.map(pos => {
      // Get values from correct field names
      const shares = Number(pos.sharesOwned) || 0;
      // Opinion avgEntryPrice is decimal (0.143 means 14.3¢)
      const avgPriceCents = Math.round((Number(pos.avgEntryPrice) || 0) * 1000) / 10;
      // Current price needs to be calculated from currentValueInQuoteToken / shares
      const currentValueUsd = Number(pos.currentValueInQuoteToken) || 0;
      const currentPriceCents = shares > 0 ? Math.round((currentValueUsd / shares) * 1000) / 10 : 0;
      
      const initialValueUsd = (shares * avgPriceCents) / 100;
      const pnlUsd = Number(pos.unrealizedPnl) || 0;
      const pnlPercent = Number(pos.unrealizedPnlPercent) || 0;
      
      return {
        platform: "opinion",
        
        // IDs
        marketId: String(pos.marketId),
        rootMarketId: String(pos.rootMarketId || pos.marketId),
        
        // Market info (use rootMarketTitle for matching with Polymarket)
        marketTitle: pos.rootMarketTitle || pos.marketTitle || "",
        outcomeName: pos.marketTitle || pos.outcome || "",
        
        // Position data (outcomeSide: 1 = YES, 2 = NO)
        side: pos.outcomeSide === 1 ? "YES" : "NO",
        shares: shares,
        
        // Prices
        avgPriceCents: avgPriceCents,
        currentPriceCents: currentPriceCents,
        
        // Values
        initialValueUsd: initialValueUsd,
        currentValueUsd: currentValueUsd,
        pnlUsd: pnlUsd,
        pnlPercent: pnlPercent,
        
        // URLs - use app.opinion.trade with topicId
        // If rootMarketId differs from marketId, it's a categorical market (add type=multi)
        thumbnailUrl: pos.thumbnailUrl || null,
        marketUrl: pos.rootMarketId && pos.rootMarketId !== pos.marketId
          ? `https://app.opinion.trade/detail?topicId=${pos.rootMarketId}&type=multi`
          : `https://app.opinion.trade/detail?topicId=${pos.marketId}`,
        
        // Raw data for debugging
        _raw: pos,
      };
    });
    
  } catch (error) {
    console.error("[Opinion] Fetch error:", error.message);
    return [];
  }
}

// ============================================================================
// Closed Positions Fetching - Based on TRADES
// ============================================================================

/**
 * Fetch trades from Polymarket Data API + Activity endpoint
 * The trades endpoint sometimes misses recent trades, so we also fetch
 * from activity endpoint and merge the data.
 * 
 * @param {string} wallet - User wallet address (proxy wallet)
 * @returns {Array} - Array of raw trades
 */
async function fetchPolymarketTrades(wallet) {
  let trades = [];
  
  try {
    // Step 1: Fetch from trades endpoint first
    const tradesUrl = new URL(`${POLYMARKET_DATA_API}/trades`);
    tradesUrl.searchParams.set("user", wallet.toLowerCase());
    tradesUrl.searchParams.set("limit", "500");
    
    console.log("[Polymarket-Trades] Fetching trades:", tradesUrl.toString());
    
    const tradesResponse = await fetchWithTimeout(tradesUrl.toString(), {
      method: "GET",
      headers: { "Accept": "application/json" },
    });
    
    if (tradesResponse.ok) {
      trades = await tradesResponse.json() || [];
      console.log("[Polymarket-Trades] Found", trades.length, "trades from /trades endpoint");
    } else {
      console.error("[Polymarket-Trades] Error:", tradesResponse.status);
    }
  } catch (error) {
    console.error("[Polymarket-Trades] Trades fetch error:", error.message);
  }
  
  // Step 2: Fetch from activity endpoint to find missing trades
  try {
    const activityUrl = `${POLYMARKET_DATA_API}/activity?user=${wallet.toLowerCase()}&limit=1000`;
    console.log("[Polymarket-Activity] Fetching activity:", activityUrl);
    
    const activityResponse = await fetchWithTimeout(activityUrl, {
      method: "GET", 
      headers: { "Accept": "application/json" },
    });
    
    if (activityResponse.ok) {
      const activities = await activityResponse.json() || [];
      console.log("[Polymarket-Activity] Found", activities.length, "activities");
      
      // Create a Set of trade hashes for deduplication
      const tradeHashes = new Set(trades.map(t => t.transactionHash));
      
      // Filter for TRADE activities that are not in trades
      const tradeActivities = activities.filter(a => 
        a.type === 'TRADE' && 
        a.transactionHash && 
        !tradeHashes.has(a.transactionHash)
      );
      
      if (tradeActivities.length > 0) {
        console.log("[Polymarket-Activity] Found", tradeActivities.length, "trades missing from /trades endpoint");
        
        // Convert activity to trade format and add to trades
        for (const activity of tradeActivities) {
          // Activity API has direct side field (BUY/SELL) - use it directly
          // Also use activity.size (not activity.shares)
          const convertedTrade = {
            transactionHash: activity.transactionHash,
            timestamp: activity.timestamp ? Math.floor(activity.timestamp / 1000) : null,
            conditionId: activity.conditionId,
            title: activity.title,
            slug: activity.slug,
            eventSlug: activity.eventSlug,
            outcome: activity.outcome,
            side: activity.side, // Activity API already provides BUY/SELL
            size: Math.abs(Number(activity.size) || 0), // Field is 'size' not 'shares'
            price: Number(activity.price) || 0,
            usdcSize: Number(activity.usdcSize) || 0,
            icon: activity.icon,
            _fromActivity: true, // Flag for debugging
          };
          
          console.log(`[Polymarket-Activity] Adding trade: ${activity.side} ${activity.size} @ ${activity.price} for "${activity.title?.substring(0, 30)}..."`);
          
          // Only add if we have essential data
          if (convertedTrade.conditionId && convertedTrade.size > 0) {
            trades.push(convertedTrade);
            tradeHashes.add(activity.transactionHash);
          }
        }
        
        console.log("[Polymarket-Trades] Total trades after merge:", trades.length);
      }
    } else {
      console.log("[Polymarket-Activity] Error:", activityResponse.status);
    }
  } catch (error) {
    console.log("[Polymarket-Activity] Fetch error:", error.message);
  }
  
  return trades;
}

/**
 * Fetch trades from Opinion OpenAPI with pagination
 * Docs: https://docs.opinion.trade/developer-guide/opinion-open-api/trade
 * 
 * @param {string} wallet - User wallet address
 * @returns {Array} - Array of raw trades
 */
async function fetchOpinionTrades(wallet) {
  if (!OPINION_API_KEY) {
    console.error("[Opinion-Trades] API key not configured");
    return [];
  }
  
  const allTrades = [];
  const pageSize = 20; // Opinion API max is 20 per page
  let page = 1;
  let hasMore = true;
  
  try {
    while (hasMore && page <= 50) { // Max 50 pages (1000 trades)
      const url = new URL(`${OPINION_OPENAPI_BASE}/trade/user/${wallet}`);
      url.searchParams.set("chainId", "56");
      url.searchParams.set("limit", String(pageSize));
      url.searchParams.set("page", String(page));
      
      if (page === 1) {
        console.log("[Opinion-Trades] Fetching trades:", url.toString());
      }
      
      const response = await fetchWithTimeout(url.toString(), {
        method: "GET",
        headers: {
          "apikey": OPINION_API_KEY,
          "Accept": "application/json",
        },
      });
      
      if (!response.ok) {
        console.error("[Opinion-Trades] Error:", response.status);
        break;
      }
      
      const data = await response.json();
      
      if (data.errno !== 0) {
        console.error("[Opinion-Trades] API error:", data.errmsg);
        break;
      }
      
      const trades = data.result?.list || [];
      allTrades.push(...trades);
      
      // Check if more pages
      const total = data.result?.total || 0;
      hasMore = allTrades.length < total && trades.length > 0;
      page++;
      
      if (page % 10 === 0) {
        console.log(`[Opinion-Trades] Fetched ${allTrades.length}/${total} trades (page ${page})`);
      }
    }
    
    console.log("[Opinion-Trades] Found", allTrades.length, "trades total");
    
    return allTrades;
  } catch (error) {
    console.error("[Opinion-Trades] Fetch error:", error.message);
    return allTrades; // Return what we have so far
  }
}

/**
 * Aggregate Polymarket trades into closed positions
 * Groups by conditionId + outcome, calculates P&L
 */
function aggregatePolymarketTrades(trades, activeConditionIds = new Set()) {
  const closedPositions = [];
  
  // Group trades by conditionId + outcome
  const tradeGroups = new Map();
  for (const trade of trades) {
    const key = `${trade.conditionId}:${trade.outcome?.toLowerCase()}`;
    if (!tradeGroups.has(key)) {
      tradeGroups.set(key, []);
    }
    tradeGroups.get(key).push(trade);
  }
  
  console.log("[Poly-Aggregate] Found", tradeGroups.size, "trade groups");
  
  for (const [key, groupTrades] of tradeGroups) {
    // Calculate net position
    let netShares = 0;
    let totalBought = 0; // Amount spent buying
    let totalSold = 0;   // Amount received selling
    let avgBuyPrice = 0;
    let buyCount = 0;
    let totalSharesBought = 0;
    
    // Sort trades by timestamp (oldest first)
    groupTrades.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    
    for (const trade of groupTrades) {
      const shares = Number(trade.size) || 0;
      const price = Number(trade.price) || 0;
      const amount = shares * price;
      const side = (trade.side || '').toUpperCase();
      
      if (side === 'BUY') {
        netShares += shares;
        totalBought += amount;
        avgBuyPrice += price;
        buyCount++;
        totalSharesBought += shares;
      } else if (side === 'SELL') {
        netShares -= shares;
        totalSold += amount;
      }
    }
    
    // Only include if position is closed (net shares ~ 0) or has sells
    const isClosed = Math.abs(netShares) < 1;
    const hasSells = totalSold > 0;
    
    // Skip if still active
    const conditionId = groupTrades[0]?.conditionId;
    if (activeConditionIds.has(conditionId) && !isClosed) continue;
    
    // Only include closed positions with P&L
    if (!isClosed && !hasSells) continue;
    
    const firstTrade = groupTrades[0];
    const lastTrade = groupTrades[groupTrades.length - 1];
    
    // Calculate realized P&L: amount received - amount spent
    const realizedPnl = totalSold - totalBought;
    const realizedPnlPercent = totalBought > 0 ? (realizedPnl / totalBought) * 100 : 0;
    
    // Average entry price
    const entryPriceCents = buyCount > 0 ? Math.round((avgBuyPrice / buyCount) * 1000) / 10 : 0;
    
    closedPositions.push({
      platform: "polymarket",
      conditionId: firstTrade.conditionId,
      marketTitle: firstTrade.title || "",
      marketSlug: firstTrade.slug || "",
      eventSlug: firstTrade.eventSlug || "",
      outcome: firstTrade.outcome || "",
      side: firstTrade.outcome?.toUpperCase() === "YES" ? "YES" : 
            firstTrade.outcome?.toLowerCase() === "no" ? "NO" : firstTrade.outcome?.toUpperCase(),
      thumbnailUrl: firstTrade.icon || null,
      marketUrl: firstTrade.eventSlug 
        ? `https://polymarket.com/event/${firstTrade.eventSlug}` 
        : (firstTrade.slug ? `https://polymarket.com/market/${firstTrade.slug}` : null),
      
      // Position metrics
      shares: Math.round(totalSharesBought * 100) / 100, // Total shares bought
      entryPriceCents,
      avgPriceCents: entryPriceCents,
      
      // P&L
      initialValueUsd: totalBought,
      pnlUsd: realizedPnl,
      pnlPercent: realizedPnlPercent,
      
      // Closed info
      isClosed: true,
      closedAt: lastTrade.timestamp ? lastTrade.timestamp * 1000 : Date.now(),
      totalTrades: groupTrades.length,
      
      // Debug
      _debug: { netShares, totalBought, totalSold }
    });
  }
  
  console.log("[Poly-Aggregate] Created", closedPositions.length, "closed positions");
  return closedPositions;
}

/**
 * Aggregate Opinion trades into closed positions
 * Groups by marketId + outcomeSide, calculates P&L
 */
function aggregateOpinionTrades(trades, activeMarketIds = new Set()) {
  const closedPositions = [];
  
  // Group trades by marketId + outcome side
  const tradeGroups = new Map();
  for (const trade of trades) {
    const key = `${trade.marketId}:${trade.outcomeSide}`;
    if (!tradeGroups.has(key)) {
      tradeGroups.set(key, []);
    }
    tradeGroups.get(key).push(trade);
  }
  
  console.log("[Opinion-Aggregate] Found", tradeGroups.size, "trade groups");
  
  for (const [key, groupTrades] of tradeGroups) {
    // Calculate net position
    let netShares = 0;
    let totalBought = 0;
    let totalSold = 0;
    let avgBuyPrice = 0;
    let buyCount = 0;
    let totalProfit = 0; // Opinion already provides profit per trade
    
    // Sort trades by timestamp (oldest first)
    groupTrades.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    
    for (const trade of groupTrades) {
      const shares = Number(trade.shares) || 0;
      const price = Number(trade.price) || 0;
      const amount = Number(trade.amount) || 0;
      const profit = Number(trade.profit) || 0;
      const side = (trade.side || '').toUpperCase();
      
      totalProfit += profit;
      
      if (side === 'BUY') {
        netShares += shares;
        totalBought += amount;
        avgBuyPrice += price;
        buyCount++;
      } else if (side === 'SELL') {
        netShares -= shares;
        totalSold += amount;
      }
    }
    
    // Only include if position has been sold (partial or full)
    const isClosed = Math.abs(netShares) < 1;
    const hasSells = totalSold > 0;
    
    // Skip if still fully active
    const marketId = groupTrades[0]?.marketId;
    if (activeMarketIds.has(String(marketId)) && !hasSells) continue;
    
    // Only include positions with sells (realized P&L)
    if (!hasSells) continue;
    
    const firstTrade = groupTrades[0];
    const lastTrade = groupTrades[groupTrades.length - 1];
    
    // Use Opinion's profit calculation or derive from trades
    const realizedPnl = totalProfit !== 0 ? totalProfit : (totalSold - totalBought);
    const realizedPnlPercent = totalBought > 0 ? (realizedPnl / totalBought) * 100 : 0;
    
    // Average entry price
    const entryPriceCents = buyCount > 0 ? Math.round((avgBuyPrice / buyCount) * 1000) / 10 : 0;
    
    // Calculate total shares bought (for display)
    let totalSharesBought = 0;
    for (const trade of groupTrades) {
      if ((trade.side || '').toUpperCase() === 'BUY') {
        totalSharesBought += Number(trade.shares) || 0;
      }
    }
    
    closedPositions.push({
      platform: "opinion",
      marketId: String(firstTrade.marketId),
      rootMarketId: String(firstTrade.rootMarketId || firstTrade.marketId),
      marketTitle: firstTrade.rootMarketTitle || "",
      outcomeName: firstTrade.marketTitle || firstTrade.outcome || "",
      outcome: firstTrade.outcome || "",
      side: firstTrade.outcomeSide === 1 ? "YES" : "NO",
      thumbnailUrl: null,
      marketUrl: firstTrade.rootMarketId && firstTrade.rootMarketId !== firstTrade.marketId
        ? `https://app.opinion.trade/detail?topicId=${firstTrade.rootMarketId}&type=multi`
        : `https://app.opinion.trade/detail?topicId=${firstTrade.marketId}`,
      
      // Position metrics
      shares: Math.round(totalSharesBought * 100) / 100, // Total shares bought
      entryPriceCents,
      avgPriceCents: entryPriceCents,
      
      // P&L
      initialValueUsd: totalBought,
      pnlUsd: realizedPnl,
      pnlPercent: realizedPnlPercent,
      
      // Closed info
      isClosed: true,
      closedAt: lastTrade.createdAt ? lastTrade.createdAt * 1000 : Date.now(),
      totalTrades: groupTrades.length,
      
      // Debug
      _debug: { netShares, totalBought, totalSold, totalProfit }
    });
  }
  
  console.log("[Opinion-Aggregate] Created", closedPositions.length, "closed positions");
  return closedPositions;
}

/**
 * Match closed positions between platforms to find completed arbitrage trades
 * Arbitrage = YES on one platform, NO on the other for the same market
 */
function matchClosedArbPositions(polyClosedPositions, opinionClosedPositions) {
  const closedArbPairs = [];
  const usedPolyIds = new Set();
  const usedOpinionIds = new Set();
  
  // DEBUG: Log all positions for debugging
  console.log("\n=== DEBUG: matchClosedArbPositions ===");
  console.log("Poly closed positions:", polyClosedPositions.length);
  polyClosedPositions.forEach(p => {
    console.log(`  [POLY] "${p.marketTitle}" side=${p.side} shares=${p.shares} pnl=${p.pnlUsd} _debug=`, p._debug);
  });
  console.log("Opinion closed positions:", opinionClosedPositions.length);
  opinionClosedPositions.forEach(p => {
    console.log(`  [OPINION] "${p.marketTitle}" side=${p.side} shares=${p.shares} pnl=${p.pnlUsd} _debug=`, p._debug);
  });
  const SIMILARITY_THRESHOLD = 0.3;
  
  console.log("[Matching-Closed] Matching", polyClosedPositions.length, "poly closed with", opinionClosedPositions.length, "opinion closed");
  
  // Match each Poly position with best Opinion match
  for (const polyPos of polyClosedPositions) {
    let bestMatch = null;
    let bestScore = 0;
    
    for (const opinionPos of opinionClosedPositions) {
      if (usedOpinionIds.has(opinionPos.marketId)) continue;
      
      // Arbitrage requires opposite sides (YES on one, NO on other)
      const isOppositeSide = polyPos.side !== opinionPos.side;
      if (!isOppositeSide) continue;
      
      // Compare titles
      const score = titleSimilarity(polyPos.marketTitle, opinionPos.marketTitle);
      
      if (score > bestScore && score >= SIMILARITY_THRESHOLD) {
        bestScore = score;
        bestMatch = opinionPos;
      }
    }
    
    if (bestMatch) {
      usedPolyIds.add(polyPos.conditionId);
      usedOpinionIds.add(bestMatch.marketId);
      
      // Create closed arb pair
      const pair = createClosedArbPair(polyPos, bestMatch, bestScore);
      closedArbPairs.push(pair);
      
      console.log(`[Matching-Closed] ✓ Matched: "${polyPos.marketTitle.slice(0,50)}" (score: ${bestScore.toFixed(2)})`);
    }
  }
  
  console.log("[Matching-Closed] Found", closedArbPairs.length, "closed arb pairs");
  return closedArbPairs;
}

/**
 * Create a closed arbitrage pair object with realized P&L
 * 
 * For RESOLVED/CLAIMED arbitrage positions, we need to calculate P&L correctly:
 * - Arbitrage = YES on one platform + NO on the other for the same binary market
 * - When market resolves, ONE side always wins ($1 per share), ONE side always loses ($0)
 * - P&L = payout (matched shares × $1) - total cost
 * 
 * Individual platform P&L values may be incorrect for claimed positions because:
 * - Claims are NOT recorded as SELL trades
 * - aggregateXxxTrades() calculates pnlUsd = totalSold - totalBought
 * - For claimed positions: totalSold = 0, so pnlUsd = -totalBought (always negative, WRONG!)
 */
function createClosedArbPair(polyPos, opinionPos, matchScore) {
  // Determine which was YES and which was NO
  const yesPos = polyPos.side === "YES" ? polyPos : opinionPos;
  const noPos = polyPos.side === "NO" ? polyPos : opinionPos;
  
  // Entry prices (historical) - use avgPriceCents from each position
  const entryYesCents = yesPos.avgPriceCents || 0;
  const entryNoCents = noPos.avgPriceCents || 0;
  const entryTotalCents = entryYesCents + entryNoCents;
  
  // Calculate entry arbitrage percentage
  // Simple formula: if total = 98¢, arb = 2%
  // If total >= 100 or invalid, arb = 0
  const entryArbPct = (entryTotalCents > 0 && entryTotalCents < 100)
    ? (100 - entryTotalCents)
    : 0;
  
  // Total bet = sum of money spent buying on both exchanges
  // Use initialValueUsd which represents the cost basis
  const polyBet = polyPos.initialValueUsd || 0;
  const opinionBet = opinionPos.initialValueUsd || 0;
  const totalBet = polyBet + opinionBet;
  
  // Get individual platform P&L (may be incorrect for claimed/resolved positions)
  const polyPnl = polyPos.pnlUsd || 0;
  const opinionPnl = opinionPos.pnlUsd || 0;
  const summedPnl = polyPnl + opinionPnl;
  
  // Get raw cash flow data from _debug for more accurate calculation
  const polyDebug = polyPos._debug || {};
  const opinionDebug = opinionPos._debug || {};
  
  // Calculate P&L from ACTUAL CASH FLOW (most accurate method)
  // This works for both "sold early" and "claimed at resolution" cases
  const polyTotalBought = polyDebug.totalBought || polyPos.initialValueUsd || 0;
  const polyTotalSold = polyDebug.totalSold || 0;
  const opinionTotalBought = opinionDebug.totalBought || opinionPos.initialValueUsd || 0;
  const opinionTotalSold = opinionDebug.totalSold || 0;
  
  const totalBoughtAll = polyTotalBought + opinionTotalBought;
  const totalSoldAll = polyTotalSold + opinionTotalSold;
  const cashFlowPnl = totalSoldAll - totalBoughtAll;
  
  // For valid arbitrage positions (entry < 100¢), P&L should not be significantly negative
  const isValidArbitrage = entryTotalCents > 0 && entryTotalCents < 100;
  
  // Detect suspicious P&L: summedPnl is very different from cashFlowPnl, or both are very negative for valid arb
  const hasSells = polyTotalSold > 0 || opinionTotalSold > 0;
  const pnlDifference = Math.abs(summedPnl - cashFlowPnl);
  const pnlLooksSuspicious = isValidArbitrage && (
    summedPnl < -totalBet * 0.05 ||  // summed P&L is way too negative for arb
    (pnlDifference > totalBet * 0.1 && hasSells)  // big mismatch between methods when there are sells
  );
  
  let closedPnl;
  let usedArbCalculation = false;
  let calculationMethod = "summed";
  
  if (pnlLooksSuspicious) {
    // Try to use the most accurate method available
    
    if (hasSells && Math.abs(cashFlowPnl) < totalBet) {
      // Use cash flow calculation if we have sell data and result is reasonable
      closedPnl = cashFlowPnl;
      calculationMethod = "cashflow";
      
      console.log(`[createClosedArbPair] Using CASH FLOW P&L for "${opinionPos.marketTitle}":`);
      console.log(`  - Poly: bought=$${polyTotalBought.toFixed(2)}, sold=$${polyTotalSold.toFixed(2)}`);
      console.log(`  - Opinion: bought=$${opinionTotalBought.toFixed(2)}, sold=$${opinionTotalSold.toFixed(2)}`);
      console.log(`  - Total: bought=$${totalBoughtAll.toFixed(2)}, sold=$${totalSoldAll.toFixed(2)}`);
      console.log(`  - Cash Flow P&L=$${cashFlowPnl.toFixed(2)} (vs summed=$${summedPnl.toFixed(2)})`);
    } else if (!hasSells && isValidArbitrage) {
      // No sells = claimed at resolution, use arb formula
      const yesShares = yesPos.shares || 0;
      const noShares = noPos.shares || 0;
      const matchedShares = Math.min(yesShares, noShares);
      const payout = matchedShares; // $1 per share at resolution
      closedPnl = payout - totalBet;
      usedArbCalculation = true;
      calculationMethod = "arb-resolution";
      
      console.log(`[createClosedArbPair] Using ARB RESOLUTION P&L (no sells detected):`);
      console.log(`  - matchedShares=${matchedShares}, payout=$${payout.toFixed(2)}`);
      console.log(`  - P&L=$${closedPnl.toFixed(2)}`);
    } else {
      // Fallback to summed (best we can do)
      closedPnl = summedPnl;
      calculationMethod = "summed-fallback";
      
      console.log(`[createClosedArbPair] Falling back to summed P&L (suspicious but no better option):`);
      console.log(`  - summedPnl=$${summedPnl.toFixed(2)}`);
    }
  } else {
    // Use summed P&L from individual platforms (seems reasonable)
    closedPnl = summedPnl;
  }
  
  const closedPnlPercent = totalBet > 0 ? (closedPnl / totalBet) * 100 : 0;
  
  // Determine result
  const result = closedPnl > 0.01 ? "won" : closedPnl < -0.01 ? "lost" : "even";
  
  // Closed timestamp (most recent)
  const closedAt = Math.max(polyPos.closedAt || 0, opinionPos.closedAt || 0);
  
  return {
    id: `closed_${polyPos.marketId}_${opinionPos.marketId}`,
    
    // Market info (use Opinion title - shorter format)
    marketTitle: opinionPos.outcomeName 
      ? `${opinionPos.marketTitle} - ${opinionPos.outcomeName}`
      : opinionPos.marketTitle,
    marketTitleBase: opinionPos.marketTitle,
    outcomeDisplay: opinionPos.outcomeName || "",
    thumbnailUrl: polyPos.thumbnailUrl || opinionPos.thumbnailUrl,
    matchScore: matchScore,
    
    // Legs
    legs: [
      {
        platform: "polymarket",
        side: polyPos.side,
        shares: polyPos.shares,
        entryPriceCents: polyPos.avgPriceCents,
        currentPriceCents: polyPos.currentPriceCents,
        valueUsd: polyPos.initialValueUsd,
        pnlUsd: polyPos.pnlUsd,
        link: polyPos.marketUrl,
      },
      {
        platform: "opinion",
        side: opinionPos.side,
        shares: opinionPos.shares,
        entryPriceCents: opinionPos.avgPriceCents,
        currentPriceCents: opinionPos.currentPriceCents,
        valueUsd: opinionPos.initialValueUsd,
        pnlUsd: opinionPos.pnlUsd,
        link: opinionPos.marketUrl,
      },
    ],
    
    // Entry metrics
    entryTotalCents,
    entryYesCents,
    entryNoCents,
    arbitragePct: Math.round(entryArbPct * 100) / 100, // e.g., 2.5 for 2.5%
    entryArbPct: Math.round(entryArbPct * 100) / 100,
    
    // Bet amounts
    polyBet: Math.round(polyBet * 100) / 100,
    opinionBet: Math.round(opinionBet * 100) / 100,
    totalBet: Math.round(totalBet * 100) / 100,
    totalCost: Math.round(totalBet * 100) / 100,
    
    // Realized P&L
    polyPnl: Math.round(polyPnl * 100) / 100,
    opinionPnl: Math.round(opinionPnl * 100) / 100,
    closedPnl: Math.round(closedPnl * 100) / 100,
    realizedPnl: Math.round(closedPnl * 100) / 100,
    closedPnlPercent: Math.round(closedPnlPercent * 100) / 100,
    realizedPnlPercent: Math.round(closedPnlPercent * 100) / 100,
    
    // Cash flow debug info
    _cashFlow: {
      polyBought: Math.round(polyTotalBought * 100) / 100,
      polySold: Math.round(polyTotalSold * 100) / 100,
      opinionBought: Math.round(opinionTotalBought * 100) / 100,
      opinionSold: Math.round(opinionTotalSold * 100) / 100,
      totalBought: Math.round(totalBoughtAll * 100) / 100,
      totalSold: Math.round(totalSoldAll * 100) / 100,
      cashFlowPnl: Math.round(cashFlowPnl * 100) / 100,
      calculationMethod,
    },
    
    // Timestamp
    closedAt: closedAt || Date.now(),
    
    // Result
    result,
    
    // Debug flag for arb-based P&L calculation
    usedArbCalculation,
  };
}

// ============================================================================
// Position Matching Logic
// ============================================================================

/**
 * Manual whitelist for markets with different titles between platforms
 * 
 * Type 1: Direct title mapping (poly title ↔ opinion title)
 * Type 2: Poly binary market ↔ Opinion categorical outcome
 *   - polyPattern: keyword in Poly binary market title
 *   - opinionMarket: Opinion categorical market title
 *   - outcome: The outcome name that links them
 */
const MARKET_TITLE_WHITELIST = [
  // Fed Decision markets - Direct mapping
  { poly: "fed decision in june", opinion: "us fed decision in june" },
  { poly: "fed decision in march", opinion: "us fed rate decision in march" },
  
  // ECB markets
  { poly: "ecb interest rates: march 2026", opinion: "ecb rates decision (dfr): march 2026" },
  { poly: "ecb interest rates march 2026", opinion: "ecb rates decision dfr march 2026" },
];

/**
 * Special mapping for Polymarket binary markets → Opinion categorical outcomes
 * Polymarket often creates separate binary markets for each outcome of an event,
 * while Opinion uses a single categorical market with multiple outcomes.
 * 
 * Format: { polyKeywords: [...], opinionMarket: "...", outcome: "..." }
 */
const POLY_BINARY_TO_OPINION_CATEGORICAL = [
  // Fed June 2026 - "No change" outcome
  {
    polyKeywords: ["no change", "fed", "june 2026"],
    opinionMarket: "us fed decision in june",
    outcome: "no change",
  },
  // Fed March 2026 - "No change" outcome  
  {
    polyKeywords: ["no change", "fed", "january 2026"],
    opinionMarket: "us fed rate decision in march",
    outcome: "no change",
  },
  // Add more mappings as needed
];

/**
 * Normalize title for whitelist comparison
 * Remove punctuation, extra spaces, convert to lowercase
 */
function normalizeForWhitelist(title) {
  if (!title) return "";
  return title
    .toLowerCase()
    .replace(/[?!.,;:'"()[\]{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check if Poly binary market matches Opinion categorical outcome
 * Returns { matched: true, outcome: "..." } or { matched: false }
 */
function matchPolyBinaryToOpinionCategorical(polyTitle, opinionTitle, opinionOutcome) {
  const polyNorm = normalizeForWhitelist(polyTitle);
  const opinionMarketNorm = normalizeForWhitelist(opinionTitle);
  const opinionOutcomeNorm = normalizeForWhitelist(opinionOutcome);
  
  for (const mapping of POLY_BINARY_TO_OPINION_CATEGORICAL) {
    const mappingMarketNorm = normalizeForWhitelist(mapping.opinionMarket);
    const mappingOutcomeNorm = normalizeForWhitelist(mapping.outcome);
    
    // Check if Opinion market matches
    const opinionMarketMatch = opinionMarketNorm.includes(mappingMarketNorm) || 
                               mappingMarketNorm.includes(opinionMarketNorm);
    
    // Check if Opinion outcome matches
    const outcomeMatch = opinionOutcomeNorm === mappingOutcomeNorm ||
                        opinionOutcomeNorm.includes(mappingOutcomeNorm) ||
                        mappingOutcomeNorm.includes(opinionOutcomeNorm);
    
    // Check if Poly title contains all keywords
    const polyKeywordsMatch = mapping.polyKeywords.every(kw => 
      polyNorm.includes(kw.toLowerCase())
    );
    
    if (opinionMarketMatch && outcomeMatch && polyKeywordsMatch) {
      console.log(`[Whitelist-Binary] ✓ Matched Poly binary to Opinion categorical:`);
      console.log(`  Poly: "${polyTitle}"`);
      console.log(`  Opinion: "${opinionTitle}" outcome="${opinionOutcome}"`);
      return { matched: true, outcome: mapping.outcome };
    }
  }
  
  return { matched: false };
}

/**
 * Check if two titles match via whitelist
 * Returns true if they are known equivalent titles
 * Uses contains-based matching for flexibility
 */
function isWhitelistedMatch(title1, title2) {
  const t1 = normalizeForWhitelist(title1);
  const t2 = normalizeForWhitelist(title2);
  
  if (!t1 || !t2) return false;
  
  for (const mapping of MARKET_TITLE_WHITELIST) {
    const polyNorm = normalizeForWhitelist(mapping.poly);
    const opinionNorm = normalizeForWhitelist(mapping.opinion);
    
    // Check if t1 contains poly pattern and t2 contains opinion pattern (or vice versa)
    const t1IsPoly = t1.includes(polyNorm) || polyNorm.includes(t1);
    const t2IsOpinion = t2.includes(opinionNorm) || opinionNorm.includes(t2);
    const t1IsOpinion = t1.includes(opinionNorm) || opinionNorm.includes(t1);
    const t2IsPoly = t2.includes(polyNorm) || polyNorm.includes(t2);
    
    if ((t1IsPoly && t2IsOpinion) || (t1IsOpinion && t2IsPoly)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Normalize title for matching
 * Remove punctuation, extra spaces, convert to lowercase
 */
function normalizeTitle(title) {
  if (!title) return "";
  return title
    .toLowerCase()
    .replace(/[?!.,;:'"()[\]{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Calculate similarity between two titles
 * Uses whitelist first, then falls back to word overlap scoring
 */
function titleSimilarity(title1, title2) {
  // Check whitelist first - if matched, return perfect score
  if (isWhitelistedMatch(title1, title2)) {
    console.log(`[Whitelist] ✓ Matched: "${title1}" ↔ "${title2}"`);
    return 1.0;
  }
  
  const norm1 = normalizeTitle(title1);
  const norm2 = normalizeTitle(title2);
  
  if (!norm1 || !norm2) return 0;
  if (norm1 === norm2) return 1;
  
  const words1 = new Set(norm1.split(" ").filter(w => w.length > 2));
  const words2 = new Set(norm2.split(" ").filter(w => w.length > 2));
  
  if (words1.size === 0 || words2.size === 0) return 0;
  
  let matches = 0;
  for (const word of words1) {
    if (words2.has(word)) matches++;
  }
  
  // Jaccard-like similarity
  const union = new Set([...words1, ...words2]).size;
  return matches / union;
}

/**
 * Match positions between Polymarket and Opinion to find arbitrage pairs
 * 
 * Arbitrage logic:
 * - User holds YES on one platform and NO on the other (for same market/outcome)
 * - Combined price at entry < 100¢ = profit locked in
 * - Combined price now determines exit strategy
 * 
 * For categorical markets:
 * - Polymarket: outcome field contains the outcome name (e.g., "No change")
 *   The position itself is essentially a "YES" bet on that outcome
 * - Opinion: outcomeName contains the outcome name, side is YES/NO
 */
function matchArbPositions(polyPositions, opinionPositions) {
  const arbPairs = [];
  const usedOpinionIds = new Set();
  const SIMILARITY_THRESHOLD = 0.3;
  
  console.log("[Matching] Starting to match", polyPositions.length, "poly positions with", opinionPositions.length, "opinion positions");
  
  // Log all positions for debugging
  console.log("[Matching] Poly positions:");
  for (const p of polyPositions) {
    console.log(`  - "${p.marketTitle}" outcome="${p.outcome}" side="${p.side}" isCategorical=${p.isCategorical}`);
  }
  console.log("[Matching] Opinion positions:");
  for (const o of opinionPositions) {
    console.log(`  - "${o.marketTitle}" outcomeName="${o.outcomeName}" side="${o.side}"`);
  }
  
  for (const polyPos of polyPositions) {
    let bestMatch = null;
    let bestScore = 0;
    let matchType = "standard"; // "standard", "categorical", "binary-to-categorical"
    
    console.log(`\n[Matching] Looking for match for Poly: "${polyPos.marketTitle}" outcome="${polyPos.outcome}" side="${polyPos.side}" isCategorical=${polyPos.isCategorical}`);
    
    for (const opinionPos of opinionPositions) {
      if (usedOpinionIds.has(opinionPos.marketId)) continue;
      
      console.log(`  [Check] Opinion: "${opinionPos.marketTitle}" outcomeName="${opinionPos.outcomeName}" side="${opinionPos.side}"`);
      
      // ============================================================
      // CASE 1: Poly binary market → Opinion categorical outcome
      // Example: Poly "Will there be no change in Fed..." + Opinion "US Fed Decision in June?" outcome="No change"
      // ============================================================
      const binaryMatch = matchPolyBinaryToOpinionCategorical(
        polyPos.marketTitle, 
        opinionPos.marketTitle, 
        opinionPos.outcomeName
      );
      
      if (binaryMatch.matched) {
        // For this case:
        // - Poly YES = bet the outcome happens (e.g., "no change" happens)
        // - Opinion NO = bet the outcome does NOT happen
        // - Poly YES + Opinion NO = ARBITRAGE (one always wins)
        // - Poly NO + Opinion YES = ARBITRAGE (one always wins)
        
        const isArbPair = (polyPos.side === "YES" && opinionPos.side === "NO") ||
                         (polyPos.side === "NO" && opinionPos.side === "YES");
        
        if (!isArbPair) {
          console.log(`    -> Skipped: not an arb pair (Poly ${polyPos.side} + Opinion ${opinionPos.side})`);
          continue;
        }
        
        console.log(`    -> BINARY-TO-CATEGORICAL MATCH! Poly ${polyPos.side} + Opinion ${opinionPos.side}`);
        bestMatch = opinionPos;
        bestScore = 1.0; // Perfect match via whitelist
        matchType = "binary-to-categorical";
        break; // Found a whitelist match, no need to continue
      }
      
      // ============================================================
      // CASE 2: Poly categorical (outcome in outcome field)
      // ============================================================
      if (polyPos.isCategorical) {
        // Check if outcome names match
        const polyOutcome = normalizeForWhitelist(polyPos.outcome);
        const opinionOutcome = normalizeForWhitelist(opinionPos.outcomeName);
        
        const outcomeMatch = polyOutcome === opinionOutcome || 
                            polyOutcome.includes(opinionOutcome) || 
                            opinionOutcome.includes(polyOutcome);
        
        if (!outcomeMatch) {
          console.log(`    -> Skipped: outcome mismatch ("${polyPos.outcome}" vs "${opinionPos.outcomeName}")`);
          continue;
        }
        
        // For categorical: Poly buying an outcome = YES on that outcome
        // So we need Opinion to have NO on the same outcome for arb
        if (opinionPos.side !== "NO") {
          console.log(`    -> Skipped: need Opinion NO for categorical arb (got ${opinionPos.side})`);
          continue;
        }
        
        console.log(`    -> Categorical match! Poly "${polyPos.outcome}" + Opinion NO`);
        matchType = "categorical";
      } else {
        // ============================================================
        // CASE 3: Standard binary market matching
        // ============================================================
        const isOppositeSide = polyPos.side !== opinionPos.side;
        if (!isOppositeSide) {
          console.log(`    -> Skipped: same side (${polyPos.side} == ${opinionPos.side})`);
          continue;
        }
      }
      
      // Check whitelist (for direct title mappings)
      const isWhitelisted = isWhitelistedMatch(polyPos.marketTitle, opinionPos.marketTitle);
      if (isWhitelisted) {
        console.log(`    -> WHITELIST MATCH!`);
      }
      
      // Calculate title similarity
      const score = titleSimilarity(polyPos.marketTitle, opinionPos.marketTitle);
      
      if (score > 0.1 || isWhitelisted) {
        console.log(`    -> Score: ${score.toFixed(3)} (threshold: ${SIMILARITY_THRESHOLD})`);
      }
      
      if (score > bestScore && score >= SIMILARITY_THRESHOLD) {
        bestScore = score;
        bestMatch = opinionPos;
      }
    }
    
    if (bestMatch) {
      console.log(`[Matching] ✓ Matched: "${polyPos.marketTitle}" <-> "${bestMatch.marketTitle}" (score: ${bestScore.toFixed(3)}, type: ${matchType})`);
      usedOpinionIds.add(bestMatch.marketId);
      
      const pair = createArbPair(polyPos, bestMatch, bestScore, matchType);
      arbPairs.push(pair);
    } else {
      console.log(`[Matching] ✗ No match found for: "${polyPos.marketTitle}"`);
    }
  }
  
  return arbPairs;
}

/**
 * Create an arbitrage pair object with computed values
 */
function createArbPair(polyPos, opinionPos, matchScore, matchType = "standard") {
  // Determine YES and NO positions based on match type
  let yesPos, noPos;
  
  if (matchType === "binary-to-categorical") {
    // Poly binary market ↔ Opinion categorical outcome
    // Poly YES "Will there be no change" = bet outcome happens
    // Opinion NO on "No change" = bet outcome does NOT happen
    // These are OPPOSITE bets = ARBITRAGE
    if (polyPos.side === "YES") {
      yesPos = polyPos;
      noPos = opinionPos;
    } else {
      yesPos = opinionPos;
      noPos = polyPos;
    }
  } else if (polyPos.isCategorical || matchType === "categorical") {
    // Poly categorical: Poly = YES on outcome, Opinion has explicit side
    yesPos = polyPos;  // Poly buying categorical outcome = YES
    noPos = opinionPos; // Opinion should be NO (validated in matching)
  } else {
    // Standard binary: use the side field directly
    yesPos = polyPos.side === "YES" ? polyPos : opinionPos;
    noPos = polyPos.side === "NO" ? polyPos : opinionPos;
  }
  
  // Entry prices
  const entryYesCents = yesPos.avgPriceCents;
  const entryNoCents = noPos.avgPriceCents;
  const entryTotalCents = entryYesCents + entryNoCents;
  
  // Current prices
  const currentYesCents = yesPos.currentPriceCents;
  const currentNoCents = noPos.currentPriceCents;
  const currentTotalCents = currentYesCents + currentNoCents;
  
  // Calculate arbitrage percentage at entry
  // If entry total < 100¢, arbitrage = (100 - total) / total * 100
  const arbitragePct = entryTotalCents < 100 
    ? ((100 - entryTotalCents) / entryTotalCents) * 100 
    : 0;
  
  // Calculate PnL
  // Use minimum shares between the two positions (since arb requires both)
  const matchedShares = Math.min(polyPos.shares, opinionPos.shares);
  
  // Current PnL = sum of individual PnLs
  const currentPnlUsd = polyPos.pnlUsd + opinionPos.pnlUsd;
  
  // Potential PnL if closed at 100¢ combined
  // = matched_shares * (100 - entry_total) / 100
  const potentialPnlUsd = (matchedShares * (100 - entryTotalCents)) / 100;
  
  // Exit status
  const canSellNow = currentTotalCents >= 100;
  const needsPctToClose = canSellNow ? 0 : ((100 - currentTotalCents) / currentTotalCents) * 100;
  
  return {
    id: `${polyPos.marketId}_${opinionPos.marketId}`,
    
    // Market info (use Opinion title - shorter format, append outcome name if available)
    marketTitle: opinionPos.outcomeName 
      ? `${opinionPos.marketTitle} - ${opinionPos.outcomeName}`
      : opinionPos.marketTitle,
    marketTitleBase: opinionPos.marketTitle,
    outcomeDisplay: opinionPos.outcomeName || "",
    thumbnailUrl: polyPos.thumbnailUrl || opinionPos.thumbnailUrl,
    matchScore: matchScore,
    
    // Legs
    legs: [
      {
        platform: "polymarket",
        side: polyPos.side,
        shares: polyPos.shares,
        entryPriceCents: polyPos.avgPriceCents,
        currentPriceCents: polyPos.currentPriceCents,
        valueUsd: polyPos.currentValueUsd,
        link: polyPos.marketUrl,
      },
      {
        platform: "opinion",
        side: opinionPos.side,
        shares: opinionPos.shares,
        entryPriceCents: opinionPos.avgPriceCents,
        currentPriceCents: opinionPos.currentPriceCents,
        valueUsd: opinionPos.currentValueUsd,
        link: opinionPos.marketUrl,
      },
    ],
    
    // Computed values
    entryTotalCents,
    currentTotalCents,
    arbitragePct: Math.round(arbitragePct * 10) / 10, // 1 decimal
    currentPnlUsd: Math.round(currentPnlUsd * 100) / 100,
    potentialPnlUsd: Math.round(potentialPnlUsd * 100) / 100,
    
    // Exit status
    canSellNow,
    needsPctToClose: Math.round(needsPctToClose * 10) / 10,
  };
}

// ============================================================================
// API Handler
// ============================================================================

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    
    // Get wallet addresses
    const polyWallet = searchParams.get("polyWallet")?.trim();
    const opinionWallet = searchParams.get("opinionWallet")?.trim() || polyWallet;
    const requestType = searchParams.get("type")?.trim() || "active"; // "active" or "closed"
    
    // Validate wallets
    if (!polyWallet) {
      return NextResponse.json(
        { error: "polyWallet parameter is required" },
        { status: 400 }
      );
    }
    
    if (!isValidWallet(polyWallet)) {
      return NextResponse.json(
        { error: "Invalid polyWallet address format" },
        { status: 400 }
      );
    }
    
    if (!isValidWallet(opinionWallet)) {
      return NextResponse.json(
        { error: "Invalid opinionWallet address format" },
        { status: 400 }
      );
    }
    
    console.log("[wallet-positions] Fetching for poly:", polyWallet, "opinion:", opinionWallet, "type:", requestType);
    
    // Fetch active positions from both platforms in parallel
    const [polyPositions, opinionPositions] = await Promise.all([
      fetchPolymarketPositions(polyWallet),
      fetchOpinionPositions(opinionWallet),
    ]);
    
    // Match active positions to find arb pairs
    const arbPositions = matchArbPositions(polyPositions, opinionPositions);
    
    // Sort by arbitrage percentage (highest first)
    arbPositions.sort((a, b) => b.arbitragePct - a.arbitragePct);
    
    console.log("[wallet-positions] Found", arbPositions.length, "active arb pairs");
    
    // If requesting closed positions, fetch and match them
    let closedArbPositions = [];
    
    if (requestType === "closed") {
      // Fetch raw trades from both platforms
      const [polyTrades, opinionTrades] = await Promise.all([
        fetchPolymarketTrades(polyWallet),
        fetchOpinionTrades(opinionWallet),
      ]);
      
      // Get active position IDs to exclude
      const activePolyConditionIds = new Set(polyPositions.map(p => p.conditionId));
      const activeOpinionMarketIds = new Set(opinionPositions.map(p => String(p.marketId)));
      
      // Aggregate trades into closed positions
      const polyClosedPositions = aggregatePolymarketTrades(polyTrades, activePolyConditionIds);
      const opinionClosedPositions = aggregateOpinionTrades(opinionTrades, activeOpinionMarketIds);
      
      // Match closed positions to find completed arb trades
      closedArbPositions = matchClosedArbPositions(polyClosedPositions, opinionClosedPositions);
      
      // Sort by P&L (highest first)
      closedArbPositions.sort((a, b) => (b.closedPnl || 0) - (a.closedPnl || 0));
      
      console.log("[wallet-positions] Found", closedArbPositions.length, "closed arb pairs");
    }
    
    return NextResponse.json({
      success: true,
      matched: arbPositions, // For frontend compatibility
      arbPositions,          // Also keep original name
      closedArb: closedArbPositions, // Closed arb pairs
      polyPositions,
      opinionPositions,
      summary: {
        polyCount: polyPositions.length,
        opinionCount: opinionPositions.length,
        arbCount: arbPositions.length,
        closedArbCount: closedArbPositions.length,
      },
    });
    
  } catch (error) {
    console.error("[wallet-positions] Error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  }
}
