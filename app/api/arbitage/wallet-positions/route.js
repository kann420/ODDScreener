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
import { polyFetch } from "@/lib/polyFetch";
import { enforceIpRateLimit } from "@/lib/apiRouteProtection";
import { clearArbitrageSessionCookie, requireArbitrageAccess } from "@/lib/arbitrageAccessSession";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RATE_LIMIT_OPTS = { windowMs: 5 * 60_000, maxRequests: 12 };

// ============================================================================
// Configuration
// ============================================================================

const POLYMARKET_DATA_API = "https://data-api.polymarket.com";
// Use proxy base URL to bypass geo-restrictions on datacenter IPs (e.g. Render)
const OPINION_OPENAPI_BASE = (process.env.OPINION_OPENAPI_BASE || process.env.OPINION_BASE_URL || "https://proxy.opinion.trade:8443/openapi").replace(/\/+$/, "");
const OPINION_API_KEY = process.env.OPINION_API_KEY || "";
const CLOSED_NET_SHARES_EPSILON = 0.01;
const OPINION_PRACTICAL_CLOSE_SHARES = 3;
const OPINION_PRACTICAL_CLOSE_VALUE_USD = 1;
const CLOSED_ROUND_MAX_TIME_GAP_MS = 14 * 24 * 60 * 60 * 1000;

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
 * Normalize unix timestamp to seconds.
 * Polymarket endpoints may return seconds or milliseconds.
 */
function normalizeUnixSeconds(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  // If value is too large for seconds (beyond year 2100), treat as milliseconds.
  return n > 4102444800 ? Math.floor(n / 1000) : Math.floor(n);
}

/**
 * Fetch with timeout - uses polyFetch for Polymarket domains
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  // Use polyFetch for Polymarket domains (bypasses DNS issues)
  if (url.includes("polymarket.com")) {
    return polyFetch(url, { ...options, timeoutMs });
  }
  
  // Standard fetch for other domains
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
    url.searchParams.set("sortBy", "CURRENT"); // Valid: CURRENT INITIAL TOKENS CASHPNL PERCENTPNL TITLE RESOLVING PRICE AVGPRICE
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
        marketId: pos.market || pos.conditionId || pos.asset,
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
      
      // Filter for TRADE and REDEEM activities that are not already in trades.
      // REDEEM = Polymarket settled the position (losing side redeemed at $0, or winning auto-payout).
      const tradeActivities = activities.filter(a => 
        (a.type === 'TRADE' || a.type === 'REDEEM') && 
        a.transactionHash && 
        !tradeHashes.has(a.transactionHash)
      );
      
      if (tradeActivities.length > 0) {
        console.log("[Polymarket-Activity] Found", tradeActivities.length, "trades missing from /trades endpoint");
        
        // Sort so TRADE activities come before REDEEM.
        // REDEEM has empty outcome and needs to look up from existing trades by conditionId.
        // If all trades for that conditionId also come from activity, we need BUYs
        // added to `trades` first so the lookup succeeds.
        tradeActivities.sort((a, b) => {
          const typeOrder = { TRADE: 0, REDEEM: 1 };
          return (typeOrder[a.type] ?? 0) - (typeOrder[b.type] ?? 0);
        });
        
        // Convert activity to trade format and add to trades
        for (const activity of tradeActivities) {
          // Activity API has direct side field (BUY/SELL) - use it directly
          // Also use activity.size (not activity.shares)
          const isRedeem = activity.type === 'REDEEM';
          // REDEEM activities usually have empty outcome - look it up from existing trades
          // for the same conditionId so it maps to the correct group.
          const redeemOutcome = isRedeem && !activity.outcome
            ? (trades.find(t => t.conditionId === activity.conditionId)?.outcome || '')
            : activity.outcome;
          const convertedTrade = {
            transactionHash: activity.transactionHash,
            timestamp: normalizeUnixSeconds(activity.timestamp),
            conditionId: activity.conditionId,
            title: activity.title,
            slug: activity.slug,
            eventSlug: activity.eventSlug,
            outcome: redeemOutcome,
            // REDEEM = implicit SELL at settlement price.
            // Winning REDEEM: usdcSize > 0, price = usdcSize / size ($1/share for binary).
            // Losing REDEEM: size=0 (filtered out by size > 0 check below).
            side: isRedeem ? 'SELL' : activity.side,
            size: Math.abs(Number(activity.size) || 0),
            price: isRedeem
              ? (Number(activity.size) > 0 ? Number(activity.usdcSize) / Number(activity.size) : 0)
              : (Number(activity.price) || 0),
            usdcSize: Number(activity.usdcSize) || 0,
            icon: activity.icon,
            _fromActivity: true,
            _fromRedeem: isRedeem, // Flag for debugging
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

  // Normalize timestamps from both /trades and /activity to seconds
  for (const trade of trades) {
    trade.timestamp = normalizeUnixSeconds(trade.timestamp);
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
 * Groups by conditionId + outcome and splits into closed rounds:
 * open -> flat (closed) -> reopen
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
    // Sort trades by timestamp (oldest first)
    groupTrades.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    let roundIndex = 0;
    let roundNetShares = 0;
    let round = null;

    for (const trade of groupTrades) {
      const shares = Number(trade.size) || 0;
      const price = Number(trade.price) || 0;
      const amount = shares * price;
      const side = (trade.side || "").toUpperCase();

      if (!Number.isFinite(shares) || shares <= 0) continue;
      if (side !== "BUY" && side !== "SELL") continue;

      if (!round) {
        round = {
          firstTrade: trade,
          lastTrade: trade,
          totalBought: 0,
          totalSold: 0,
          buyPriceWeightedSum: 0,
          buySharesForAvg: 0,
          sellPriceWeightedSum: 0,
          sellSharesForAvg: 0,
          totalSharesBought: 0,
          totalSharesSold: 0,
          tradeCount: 0,
        };
      }

      round.lastTrade = trade;
      round.tradeCount += 1;

      if (side === "BUY") {
        roundNetShares += shares;
        round.totalBought += amount;
        round.totalSharesBought += shares;
        round.buyPriceWeightedSum += price * shares;
        round.buySharesForAvg += shares;
      } else {
        roundNetShares -= shares;
        round.totalSold += amount;
        round.totalSharesSold += shares;
        round.sellPriceWeightedSum += price * shares;
        round.sellSharesForAvg += shares;
      }

      const isRoundClosed = Math.abs(roundNetShares) < CLOSED_NET_SHARES_EPSILON;
      // hasSells: use share count (not dollar amount) so REDEEM at $0 (losing settlement) still counts
      const hasSells = (round.totalSharesSold || 0) > 0;
      const hasBuys = round.totalBought > 0;

      if (!isRoundClosed || !hasSells || !hasBuys) {
        continue;
      }

      const firstTrade = round.firstTrade;
      const lastTrade = round.lastTrade;
      const conditionId = firstTrade?.conditionId;
      const isActiveCondition = activeConditionIds.has(conditionId);
      if (isActiveCondition && Math.abs(roundNetShares) >= CLOSED_NET_SHARES_EPSILON) {
        continue;
      }

      const realizedPnl = round.totalSold - round.totalBought;
      const realizedPnlPercent = round.totalBought > 0 ? (realizedPnl / round.totalBought) * 100 : 0;
      const entryPrice = round.buySharesForAvg > 0 ? (round.buyPriceWeightedSum / round.buySharesForAvg) : 0;
      const entryPriceCents = Math.round(entryPrice * 1000) / 10;
      const exitPrice = round.sellSharesForAvg > 0 ? (round.sellPriceWeightedSum / round.sellSharesForAvg) : entryPrice;
      const exitPriceCents = Math.round(exitPrice * 1000) / 10;
      const outcomeRaw = firstTrade?.outcome || "";
      const outcomeNorm = String(outcomeRaw).toLowerCase();

      closedPositions.push({
        platform: "polymarket",
        roundKey: `${conditionId}:${outcomeNorm}:r${roundIndex}`,
        roundIndex,
        conditionId: conditionId,
        marketTitle: firstTrade?.title || "",
        marketSlug: firstTrade?.slug || "",
        eventSlug: firstTrade?.eventSlug || "",
        outcome: outcomeRaw,
        side: outcomeRaw?.toUpperCase() === "YES"
          ? "YES"
          : outcomeRaw?.toLowerCase() === "no"
            ? "NO"
            : String(outcomeRaw || "").toUpperCase(),
        thumbnailUrl: firstTrade?.icon || null,
        marketUrl: firstTrade?.eventSlug
          ? `https://polymarket.com/event/${firstTrade.eventSlug}`
          : (firstTrade?.slug ? `https://polymarket.com/market/${firstTrade.slug}` : null),

        // Position metrics
        shares: Math.round(round.totalSharesBought * 100) / 100,
        entryPriceCents,
        avgPriceCents: entryPriceCents,
        exitPriceCents,
        avgExitPriceCents: exitPriceCents,

        // P&L
        initialValueUsd: round.totalBought,
        pnlUsd: realizedPnl,
        pnlPercent: realizedPnlPercent,

        // Closed info
        isClosed: true,
        openedAt: firstTrade?.timestamp ? firstTrade.timestamp * 1000 : null,
        closedAt: lastTrade?.timestamp ? lastTrade.timestamp * 1000 : Date.now(),
        totalTrades: round.tradeCount,

        // Debug
        _debug: {
          netShares: roundNetShares,
          totalBought: round.totalBought,
          totalSold: round.totalSold,
          totalSharesSold: round.totalSharesSold,
        },
      });

      roundIndex += 1;
      round = null;
      roundNetShares = 0;
    }

    // End of group: partial-expiry close.
    // Handles cases like: user sold some shares before market resolved, remaining expired worthless
    // (e.g. REDEEM with size=0, meaning nothing to claim — the inactive conditionId confirms expiry).
    // Use totalSharesSold > 0 so REDEEM (price=0) still counts as a sell event.
    if (round && round.totalBought > 0 && (round.totalSharesSold || 0) > 0) {
      const conditionIdEoG = round.firstTrade?.conditionId;
      if (conditionIdEoG && !activeConditionIds.has(conditionIdEoG)) {
        const firstTrade = round.firstTrade;
        const lastTrade = round.lastTrade;
        // Remaining shares expired at $0 — P&L is only what we actually sold
        const realizedPnl = round.totalSold - round.totalBought;
        const realizedPnlPercent = round.totalBought > 0 ? (realizedPnl / round.totalBought) * 100 : 0;
        const entryPrice = round.buySharesForAvg > 0 ? (round.buyPriceWeightedSum / round.buySharesForAvg) : 0;
        const entryPriceCents = Math.round(entryPrice * 1000) / 10;
        const exitPrice = round.sellSharesForAvg > 0 ? (round.sellPriceWeightedSum / round.sellSharesForAvg) : 0;
        const exitPriceCents = Math.round(exitPrice * 1000) / 10;
        const outcomeRaw = firstTrade?.outcome || "";
        const outcomeNorm = String(outcomeRaw).toLowerCase();
        closedPositions.push({
          platform: "polymarket",
          roundKey: `${conditionIdEoG}:${outcomeNorm}:r${roundIndex}`,
          roundIndex,
          conditionId: conditionIdEoG,
          marketTitle: firstTrade?.title || "",
          marketSlug: firstTrade?.slug || "",
          eventSlug: firstTrade?.eventSlug || "",
          outcome: outcomeRaw,
          side: outcomeRaw?.toUpperCase() === "YES" ? "YES" : outcomeRaw?.toLowerCase() === "no" ? "NO" : String(outcomeRaw || "").toUpperCase(),
          thumbnailUrl: firstTrade?.icon || null,
          marketUrl: firstTrade?.eventSlug
            ? `https://polymarket.com/event/${firstTrade.eventSlug}`
            : (firstTrade?.slug ? `https://polymarket.com/market/${firstTrade.slug}` : null),
          shares: Math.round(round.totalSharesBought * 100) / 100,
          entryPriceCents,
          avgPriceCents: entryPriceCents,
          exitPriceCents,
          avgExitPriceCents: exitPriceCents,
          initialValueUsd: round.totalBought,
          pnlUsd: realizedPnl,
          pnlPercent: realizedPnlPercent,
          isClosed: true,
          _isPartialExpiry: true,
          openedAt: firstTrade?.timestamp ? firstTrade.timestamp * 1000 : null,
          closedAt: lastTrade?.timestamp ? lastTrade.timestamp * 1000 : Date.now(),
          totalTrades: round.tradeCount,
          _debug: { netShares: roundNetShares, totalBought: round.totalBought, totalSold: round.totalSold, totalSharesSold: round.totalSharesSold },
        });
        console.log(`[Poly-Aggregate] Partial-expiry close: "${firstTrade?.title?.slice(0, 40)}" outcome=${outcomeRaw} P&L=${realizedPnl.toFixed(2)}`);
        roundIndex += 1;
      }
    }

    // BUY-only fully expired: user bought but never sold, market resolved and they lost everything.
    // The losing REDEEM has size=0 so it gets filtered out, leaving only BUY trades.
    // Detect via: has buys, zero sells, inactive conditionId.
    if (round && round.totalBought > 0 && (round.totalSharesSold || 0) === 0) {
      const conditionIdExp = round.firstTrade?.conditionId;
      if (conditionIdExp && !activeConditionIds.has(conditionIdExp)) {
        const firstTrade = round.firstTrade;
        const lastTrade = round.lastTrade;
        const entryPrice = round.buySharesForAvg > 0 ? (round.buyPriceWeightedSum / round.buySharesForAvg) : 0;
        const entryPriceCents = Math.round(entryPrice * 1000) / 10;
        const realizedPnl = -round.totalBought; // Lost everything
        const outcomeRaw = firstTrade?.outcome || "";
        const outcomeNorm = String(outcomeRaw).toLowerCase();
        closedPositions.push({
          platform: "polymarket",
          roundKey: `${conditionIdExp}:${outcomeNorm}:r${roundIndex}`,
          roundIndex,
          conditionId: conditionIdExp,
          marketTitle: firstTrade?.title || "",
          marketSlug: firstTrade?.slug || "",
          eventSlug: firstTrade?.eventSlug || "",
          outcome: outcomeRaw,
          side: outcomeRaw?.toUpperCase() === "YES" ? "YES" : outcomeRaw?.toLowerCase() === "no" ? "NO" : String(outcomeRaw || "").toUpperCase(),
          thumbnailUrl: firstTrade?.icon || null,
          marketUrl: firstTrade?.eventSlug
            ? `https://polymarket.com/event/${firstTrade.eventSlug}`
            : (firstTrade?.slug ? `https://polymarket.com/market/${firstTrade.slug}` : null),
          shares: Math.round(round.totalSharesBought * 100) / 100,
          entryPriceCents,
          avgPriceCents: entryPriceCents,
          exitPriceCents: 0, // Expired worthless
          avgExitPriceCents: 0,
          initialValueUsd: round.totalBought,
          pnlUsd: realizedPnl,
          pnlPercent: -100,
          isClosed: true,
          _isFullyExpired: true,
          openedAt: firstTrade?.timestamp ? firstTrade.timestamp * 1000 : null,
          closedAt: lastTrade?.timestamp ? lastTrade.timestamp * 1000 : Date.now(),
          totalTrades: round.tradeCount,
          _debug: { netShares: roundNetShares, totalBought: round.totalBought, totalSold: 0, totalSharesSold: 0 },
        });
        console.log(`[Poly-Aggregate] Fully-expired close: "${firstTrade?.title?.slice(0, 40)}" outcome=${outcomeRaw} lost=$${round.totalBought.toFixed(2)}`);
        roundIndex += 1;
      }
    }
  }

  console.log("[Poly-Aggregate] Created", closedPositions.length, "closed positions");
  return closedPositions;
}

/**
 * Aggregate Opinion trades into closed positions
 * Groups by marketId + outcome side and splits into closed rounds:
 * open -> flat (closed) -> reopen
 */
function aggregateOpinionTrades(trades, activePositionsByKey = new Map()) {
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
    // Sort trades by timestamp (oldest first)
    groupTrades.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const activePosition = activePositionsByKey.get(key) || null;

    let roundIndex = 0;
    let roundNetShares = 0;
    let round = null;

    const estimateResidualValueUsd = (preferActiveValue = false) => {
      const remainingShares = Math.abs(roundNetShares);
      if (!round || remainingShares <= CLOSED_NET_SHARES_EPSILON) return 0;

      if (preferActiveValue) {
        const activeValue = Number(activePosition?.currentValueUsd);
        if (Number.isFinite(activeValue) && activeValue >= 0) {
          return activeValue;
        }
      }

      const lastTradePrice = Number(round.lastTrade?.price) || 0;
      if (lastTradePrice <= 0) return 0;
      return remainingShares * lastTradePrice;
    };

    const canPracticalClose = (preferActiveValue = false) => {
      const hasSells = (round?.totalSold || 0) > 0;
      const hasBuys = (round?.totalBought || 0) > 0;
      if (!hasSells || !hasBuys) return false;

      const remainingShares = Math.abs(roundNetShares);
      if (remainingShares <= CLOSED_NET_SHARES_EPSILON) return false;

      if (remainingShares <= OPINION_PRACTICAL_CLOSE_SHARES) return true;

      // If the market is no longer in active positions (resolved/settled),
      // close any partial round regardless of residual share value.
      const _closePractKey = `${round?.firstTrade?.marketId}:${round?.firstTrade?.outcomeSide}`;
      if (!activePositionsByKey.has(_closePractKey)) return true;

      const remainingValueUsd = estimateResidualValueUsd(preferActiveValue);
      return remainingValueUsd > 0 && remainingValueUsd < OPINION_PRACTICAL_CLOSE_VALUE_USD;
    };

    const finalizeRound = (closeReason) => {
      if (!round) return false;

      const hasSells = round.totalSold > 0;
      const hasBuys = round.totalBought > 0;
      if (!hasSells || !hasBuys) return false;

      const isFullyClosed = Math.abs(roundNetShares) < CLOSED_NET_SHARES_EPSILON;
      const preferActiveResidual = closeReason === "practical-end";
      const isPracticallyClosed = canPracticalClose(preferActiveResidual);
      if (!isFullyClosed && !isPracticallyClosed) return false;

      const firstTrade = round.firstTrade;
      const lastTrade = round.lastTrade;
      const marketId = String(firstTrade?.marketId || "");
      const residualValueUsd = isPracticallyClosed
        ? estimateResidualValueUsd(preferActiveResidual)
        : 0;
      const avgBuyPrice = round.totalSharesBought > 0 ? (round.totalBought / round.totalSharesBought) : 0;
      const soldSharesForPnl = Math.min(round.totalSharesSold || 0, round.totalSharesBought || 0);
      // For practical close with leftovers, use realized-only P&L on sold shares.
      const realizedPnl = (isPracticallyClosed && !isFullyClosed)
        ? (round.totalSold - (soldSharesForPnl * avgBuyPrice))
        : (round.totalSold - round.totalBought);
      const realizedPnlPercent = round.totalBought > 0 ? (realizedPnl / round.totalBought) * 100 : 0;
      const entryPrice = round.buySharesForAvg > 0 ? (round.buyPriceWeightedSum / round.buySharesForAvg) : 0;
      const entryPriceCents = Math.round(entryPrice * 1000) / 10;
      const exitPrice = round.sellSharesForAvg > 0 ? (round.sellPriceWeightedSum / round.sellSharesForAvg) : entryPrice;
      const exitPriceCents = Math.round(exitPrice * 1000) / 10;
      const outcomeSide = Number(firstTrade?.outcomeSide) || 0;

      closedPositions.push({
        platform: "opinion",
        roundKey: `${marketId}:${outcomeSide}:r${roundIndex}`,
        roundIndex,
        marketId,
        rootMarketId: String(firstTrade?.rootMarketId || firstTrade?.marketId || ""),
        // Binary markets (rootMarketId=0 or absent): the primary title IS marketTitle
        // Categorical sub-markets (rootMarketId≠0): rootMarketTitle is the parent event title
        marketTitle: (firstTrade?.rootMarketId && Number(firstTrade.rootMarketId) !== 0)
          ? (firstTrade?.rootMarketTitle || "")
          : (firstTrade?.marketTitle || ""),
        outcomeName: (firstTrade?.rootMarketId && Number(firstTrade.rootMarketId) !== 0)
          ? (firstTrade?.marketTitle || firstTrade?.outcome || "")
          : "",
        outcome: firstTrade?.outcome || "",
        side: outcomeSide === 1 ? "YES" : "NO",
        thumbnailUrl: null,
        marketUrl: (firstTrade?.rootMarketId && Number(firstTrade.rootMarketId) !== 0)
          ? `https://app.opinion.trade/detail?topicId=${firstTrade.rootMarketId}&type=multi`
          : `https://app.opinion.trade/detail?topicId=${firstTrade?.marketId}`,

        // Position metrics
        shares: Math.round(round.totalSharesBought * 100) / 100,
        entryPriceCents,
        avgPriceCents: entryPriceCents,
        exitPriceCents,
        avgExitPriceCents: exitPriceCents,

        // P&L
        initialValueUsd: round.totalBought,
        pnlUsd: realizedPnl,
        pnlPercent: realizedPnlPercent,

        // Closed info
        isClosed: true,
        openedAt: firstTrade?.createdAt ? firstTrade.createdAt * 1000 : null,
        closedAt: lastTrade?.createdAt ? lastTrade.createdAt * 1000 : Date.now(),
        totalTrades: round.tradeCount,

        // Debug
        _debug: {
          netShares: roundNetShares,
          totalBought: round.totalBought,
          totalSold: round.totalSold,
          totalSharesBought: round.totalSharesBought,
          totalSharesSold: round.totalSharesSold,
          avgBuyPrice,
          soldSharesForPnl,
          residualValueUsd,
          totalProfit: round.totalProfit,
          isPracticallyClosed,
          remainingShares: Math.round(Math.abs(roundNetShares) * 10000) / 10000,
          closeReason,
        },
      });

      roundIndex += 1;
      round = null;
      roundNetShares = 0;
      return true;
    };

    for (const trade of groupTrades) {
      const shares = Number(trade.shares) || 0;
      const price = Number(trade.price) || 0;
      const amount = Number(trade.amount) || 0;
      const profit = Number(trade.profit) || 0;
      const side = (trade.side || "").toUpperCase();

      if (!Number.isFinite(shares) || shares <= 0) continue;
      if (side !== "BUY" && side !== "SELL") continue;

      // If a new BUY arrives after a practically-closed round, treat it as a reopen.
      if (side === "BUY" && round && canPracticalClose()) {
        finalizeRound("practical-reopen");
      }

      if (!round) {
        round = {
          firstTrade: trade,
          lastTrade: trade,
          totalBought: 0,
          totalSold: 0,
          buyPriceWeightedSum: 0,
          buySharesForAvg: 0,
          sellPriceWeightedSum: 0,
          sellSharesForAvg: 0,
          totalSharesBought: 0,
          totalSharesSold: 0,
          totalProfit: 0,
          tradeCount: 0,
        };
      }

      round.lastTrade = trade;
      round.tradeCount += 1;
      round.totalProfit += profit;

      if (side === "BUY") {
        roundNetShares += shares;
        round.totalBought += amount;
        round.totalSharesBought += shares;
        round.buyPriceWeightedSum += price * shares;
        round.buySharesForAvg += shares;
      } else {
        roundNetShares -= shares;
        round.totalSold += amount;
        round.totalSharesSold += shares;
        round.sellPriceWeightedSum += price * shares;
        round.sellSharesForAvg += shares;
      }

      const isRoundClosed = Math.abs(roundNetShares) < CLOSED_NET_SHARES_EPSILON;
      const hasSells = round.totalSold > 0;
      const hasBuys = round.totalBought > 0;

      if (isRoundClosed && hasSells && hasBuys) {
        finalizeRound("full-close");
      }
    }

    // End of group: keep a practical-close round even with tiny leftovers.
    if (round && canPracticalClose(true)) {
      finalizeRound("practical-end");
    }

    // Settlement detection: BUY-only round not in current active positions.
    // Occurs when market resolves without the user explicitly selling
    // (winning payout or losing expiry with no manual sell).
    if (round && round.totalBought > 0 && round.totalSold === 0 && round.totalSharesBought > 0) {
      const settleKey = `${round.firstTrade?.marketId}:${round.firstTrade?.outcomeSide}`;
      if (!activePositionsByKey.has(settleKey)) {
        const firstTrade = round.firstTrade;
        const marketId = String(firstTrade?.marketId || "");
        const outcomeSide = Number(firstTrade?.outcomeSide) || 0;
        const _isSubMkt = firstTrade?.rootMarketId && Number(firstTrade.rootMarketId) !== 0;
        const entryPrice = round.buySharesForAvg > 0 ? (round.buyPriceWeightedSum / round.buySharesForAvg) : 0;
        const entryPriceCents = Math.round(entryPrice * 1000) / 10;
        closedPositions.push({
          platform: "opinion",
          roundKey: `${marketId}:${outcomeSide}:r${roundIndex}`,
          roundIndex,
          marketId,
          rootMarketId: String(firstTrade?.rootMarketId || firstTrade?.marketId || ""),
          marketTitle: _isSubMkt ? (firstTrade?.rootMarketTitle || "") : (firstTrade?.marketTitle || ""),
          outcomeName: _isSubMkt ? (firstTrade?.marketTitle || firstTrade?.outcome || "") : "",
          outcome: firstTrade?.outcome || "",
          side: outcomeSide === 1 ? "YES" : "NO",
          thumbnailUrl: null,
          marketUrl: _isSubMkt
            ? `https://app.opinion.trade/detail?topicId=${firstTrade?.rootMarketId}&type=multi`
            : `https://app.opinion.trade/detail?topicId=${firstTrade?.marketId}`,
          shares: Math.round(round.totalSharesBought * 100) / 100,
          entryPriceCents,
          avgPriceCents: entryPriceCents,
          exitPriceCents: null,   // Settlement price unknown without market resolution data
          avgExitPriceCents: null,
          initialValueUsd: round.totalBought,
          pnlUsd: null,           // P&L unknown - market settled, no manual sell recorded
          pnlPercent: null,
          isClosed: true,
          _isSettlement: true,
          openedAt: firstTrade?.createdAt ? firstTrade.createdAt * 1000 : null,
          closedAt: null,         // Settlement time not available from trade API
          totalTrades: round.tradeCount,
        });
        console.log(`[Opinion-Aggregate] Settlement close (no sell): "${firstTrade?.marketTitle}" outcomeSide=${outcomeSide}`);
        roundIndex += 1;
      }
    }
  }

  console.log("[Opinion-Aggregate] Created", closedPositions.length, "closed positions");
  return closedPositions;
}

function getClosedRoundTimeScore(polyClosedAt, opinionClosedAt) {
  const polyTs = Number(polyClosedAt) || 0;
  const opinionTs = Number(opinionClosedAt) || 0;
  if (!polyTs || !opinionTs) return 0.5;

  const gapMs = Math.abs(polyTs - opinionTs);
  if (gapMs > CLOSED_ROUND_MAX_TIME_GAP_MS) return 0;
  if (gapMs <= 60 * 60 * 1000) return 1.0;
  if (gapMs <= 6 * 60 * 60 * 1000) return 0.95;
  if (gapMs <= 24 * 60 * 60 * 1000) return 0.9;
  if (gapMs <= 3 * 24 * 60 * 60 * 1000) return 0.75;
  if (gapMs <= 7 * 24 * 60 * 60 * 1000) return 0.5;
  return 0.35;
}

function matchClosedArbPositions(polyClosedPositions, opinionClosedPositions) {
  const closedArbPairs = [];
  const usedOpinionRoundKeys = new Set();

  // DEBUG: Log all positions for debugging
  console.log("\n=== DEBUG: matchClosedArbPositions ===");
  console.log("Poly closed positions:", polyClosedPositions.length);
  polyClosedPositions.forEach(p => {
    console.log(`  [POLY] "${p.marketTitle}" side=${p.side} outcome=${p.outcome} shares=${p.shares} pnl=${p.pnlUsd} closedAt=${p.closedAt} round=${p.roundKey}`);
  });
  console.log("Opinion closed positions:", opinionClosedPositions.length);
  opinionClosedPositions.forEach(p => {
    console.log(`  [OPINION] "${p.marketTitle}" outcomeName=${p.outcomeName} side=${p.side} shares=${p.shares} pnl=${p.pnlUsd} closedAt=${p.closedAt} round=${p.roundKey}`);
  });

  const SIMILARITY_THRESHOLD = 0.3;

  console.log("[Matching-Closed] Matching", polyClosedPositions.length, "poly closed with", opinionClosedPositions.length, "opinion closed");

  const sortedPoly = [...polyClosedPositions].sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
  const sortedOpinion = [...opinionClosedPositions].sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));

  // NOTE: Previously we skipped Opinion markets with positions on BOTH sides
  // (opinionBothSidesMarkets). This was too aggressive — each closed round is
  // already independent with its own roundKey, and the matching uses opposite
  // sides + time proximity + usedOpinionRoundKeys to prevent double-matching.
  // Removing the blanket skip fixes missing arb pairs like edgeX $5B and $1B
  // where the user had separate YES and NO rounds at different times.

  // Match each Poly closed round with best Opinion closed round
  for (const polyPos of sortedPoly) {
    let bestMatch = null;
    let bestCombinedScore = 0;
    let bestTitleScore = 0;
    let bestTimeScore = 0;
    let matchType = "standard";

    for (const opinionPos of sortedOpinion) {
      const opinionRoundKey = opinionPos.roundKey || `${opinionPos.marketId}:${opinionPos.side}:${opinionPos.closedAt || 0}`;
      if (usedOpinionRoundKeys.has(opinionRoundKey)) continue;

      if (hasFdvSeriesMismatch(polyPos.marketTitle, opinionPos.marketTitle, opinionPos.outcomeName)) {
        continue;
      }

      const timeScore = getClosedRoundTimeScore(polyPos.closedAt, opinionPos.closedAt);
      if (timeScore <= 0) continue;
      const opinionComparableTitle = buildOpinionComparableTitle(opinionPos.marketTitle, opinionPos.outcomeName);

      // CASE 1: Poly binary market -> Opinion categorical outcome
      const binaryMatch = matchPolyBinaryToOpinionCategorical(
        polyPos.marketTitle,
        opinionPos.marketTitle,
        opinionPos.outcomeName
      );

      if (binaryMatch.matched) {
        const isArbPair = (polyPos.side === "YES" && opinionPos.side === "NO") ||
                          (polyPos.side === "NO" && opinionPos.side === "YES");

        if (isArbPair) {
          console.log(`[Matching-Closed] Binary-to-Categorical match: "${polyPos.marketTitle.slice(0, 40)}" <-> "${opinionPos.outcomeName}"`);
          const titleScore = 1.0;
          const combinedScore = (titleScore * 0.85) + (timeScore * 0.15);

          if (combinedScore > bestCombinedScore) {
            bestMatch = opinionPos;
            bestCombinedScore = combinedScore;
            bestTitleScore = titleScore;
            bestTimeScore = timeScore;
            matchType = "binary-to-categorical";
          }

          continue;
        }
      }

      // CASE 1.5: Poly categorical (team name outcome) ↔ Opinion binary (YES/NO) — esports arb
      const catBinaryMatch = matchPolyCategoricalToOpinionBinary(
        polyPos.marketTitle,
        polyPos.outcome,
        opinionPos.marketTitle
      );
      if (catBinaryMatch.matched) {
        const polyMapsToOpinionSide = catBinaryMatch.polyMapsToOpinionSide;
        const isArbPairCat = (polyMapsToOpinionSide === "YES" && opinionPos.side === "NO") ||
                             (polyMapsToOpinionSide === "NO" && opinionPos.side === "YES");
        if (isArbPairCat) {
          const titleScore = 0.95;
          const combinedScore = (titleScore * 0.85) + (timeScore * 0.15);
          if (combinedScore > bestCombinedScore) {
            bestMatch = opinionPos;
            bestCombinedScore = combinedScore;
            bestTitleScore = titleScore;
            bestTimeScore = timeScore;
            matchType = "esports-categorical";
          }
          continue;
        }
      }

      // CASE 2: Standard title matching with opposite sides
      const isOppositeSide = polyPos.side !== opinionPos.side;
      if (!isOppositeSide) continue;

      const titleScore = titleSimilarity(polyPos.marketTitle, opinionComparableTitle);
      if (titleScore < SIMILARITY_THRESHOLD) continue;

      const combinedScore = (titleScore * 0.85) + (timeScore * 0.15);
      if (combinedScore > bestCombinedScore) {
        bestCombinedScore = combinedScore;
        bestTitleScore = titleScore;
        bestTimeScore = timeScore;
        bestMatch = opinionPos;
        matchType = "standard";
      }
    }

    if (bestMatch) {
      const opinionRoundKey = bestMatch.roundKey || `${bestMatch.marketId}:${bestMatch.side}:${bestMatch.closedAt || 0}`;
      usedOpinionRoundKeys.add(opinionRoundKey);

      const pair = createClosedArbPair(polyPos, bestMatch, bestCombinedScore, {
        matchType,
        titleScore: bestTitleScore,
        timeScore: bestTimeScore,
      });
      closedArbPairs.push(pair);

      console.log(`[Matching-Closed] matched (${matchType}): "${polyPos.marketTitle.slice(0, 50)}" (title=${bestTitleScore.toFixed(2)}, time=${bestTimeScore.toFixed(2)}, score=${bestCombinedScore.toFixed(2)})`);
    }
  }

  console.log("[Matching-Closed] Found", closedArbPairs.length, "closed arb pairs");
  return closedArbPairs;
}

function createClosedArbPair(polyPos, opinionPos, matchScore, matchMeta = {}) {
  // Determine which was YES and which was NO
  const yesPos = polyPos.side === "YES" ? polyPos : opinionPos;
  const noPos = polyPos.side === "NO" ? polyPos : opinionPos;

  // Entry prices (historical) - use avgPriceCents from each position
  const entryYesCents = yesPos.avgPriceCents || 0;
  const entryNoCents = noPos.avgPriceCents || 0;
  const entryTotalCents = entryYesCents + entryNoCents;

  // Calculate entry arbitrage percentage
  const entryArbPct = (entryTotalCents > 0 && entryTotalCents < 100)
    ? (100 - entryTotalCents)
    : 0;

  // Total bet = sum of money spent buying on both exchanges
  const polyBet = polyPos.initialValueUsd || 0;
  const opinionBet = opinionPos.initialValueUsd || 0;
  const totalBet = polyBet + opinionBet;

  // Get individual platform P&L
  const polyPnl = polyPos.pnlUsd || 0;
  const opinionPnl = opinionPos.pnlUsd || 0;
  const summedPnl = polyPnl + opinionPnl;

  // Get raw cash flow data
  const polyDebug = polyPos._debug || {};
  const opinionDebug = opinionPos._debug || {};
  const hasPracticalClose = Boolean(polyDebug.isPracticallyClosed || opinionDebug.isPracticallyClosed);

  const polyTotalBought = polyDebug.totalBought || polyPos.initialValueUsd || 0;
  const polyTotalSold = polyDebug.totalSold || 0;
  let opinionTotalBought = opinionDebug.totalBought || opinionPos.initialValueUsd || 0;
  let opinionTotalSold = opinionDebug.totalSold || 0;

  // --- Settlement inference ---
  // When Opinion leg is a settlement (BUY only, no SELL), we infer the outcome
  // from the Poly leg's P&L: if Poly profited → Poly outcome won → Opinion lost ($0),
  // if Poly lost → Opinion won ($1/share payout).
  let opinionSettlementPriceCents = null;

  if (opinionPos._isSettlement && opinionTotalSold === 0) {
    const polyNetProfit = polyTotalSold - polyTotalBought;
    if (polyNetProfit > 0) {
      // Poly won → Opinion lost → payout = $0
      opinionTotalSold = 0;
      opinionSettlementPriceCents = 0;
      console.log(`[createClosedArbPair] Opinion settlement: LOST (Poly profited +${polyNetProfit.toFixed(2)}) → payout $0`);
    } else {
      // Poly lost → Opinion won → payout = shares × $1
      opinionTotalSold = (opinionPos.shares || 0) * 1.0;
      opinionSettlementPriceCents = 100;
      console.log(`[createClosedArbPair] Opinion settlement: WON (Poly lost ${polyNetProfit.toFixed(2)}) → payout $${opinionTotalSold.toFixed(2)}`);
    }
  }

  const totalBoughtAll = polyTotalBought + opinionTotalBought;
  const totalSoldAll = polyTotalSold + opinionTotalSold;
  const cashFlowPnl = totalSoldAll - totalBoughtAll;

  const hasSells = polyTotalSold > 0 || opinionTotalSold > 0;
  const isValidArbitrage = entryTotalCents > 0 && entryTotalCents < 100;

  let closedPnl;
  let usedArbCalculation = false;
  let calculationMethod = "cashflow";

  // Practical close keeps tiny leftovers, so use leg-level realized P&L sum.
  if (hasPracticalClose) {
    closedPnl = summedPnl;
    calculationMethod = "summed-practical";
    console.log(`[createClosedArbPair] Using SUMMED PRACTICAL P&L for "${opinionPos.marketTitle}":`);
    console.log(`  - Poly P&L=${polyPnl.toFixed(2)}, Opinion P&L=${opinionPnl.toFixed(2)}, Total=${summedPnl.toFixed(2)}`);
  } else if (hasSells) {
    closedPnl = cashFlowPnl;
    console.log(`[createClosedArbPair] Using CASH FLOW P&L for "${opinionPos.marketTitle}":`);
    console.log(`  - Poly: bought=${polyTotalBought.toFixed(2)}, sold=${polyTotalSold.toFixed(2)}`);
    console.log(`  - Opinion: bought=${opinionTotalBought.toFixed(2)}, sold=${opinionTotalSold.toFixed(2)}`);
    console.log(`  - Total: bought=${totalBoughtAll.toFixed(2)}, sold=${totalSoldAll.toFixed(2)}`);
    console.log(`  - Cash Flow P&L=${cashFlowPnl.toFixed(2)} (vs summed=${summedPnl.toFixed(2)})`);
  } else if (isValidArbitrage) {
    const yesShares = yesPos.shares || 0;
    const noShares = noPos.shares || 0;
    const matchedShares = Math.min(yesShares, noShares);
    const payout = matchedShares;
    closedPnl = payout - totalBet;
    usedArbCalculation = true;
    calculationMethod = "arb-resolution";

    console.log("[createClosedArbPair] Using ARB RESOLUTION P&L (no sells detected):");
    console.log(`  - matchedShares=${matchedShares}, payout=${payout.toFixed(2)}`);
    console.log(`  - P&L=${closedPnl.toFixed(2)}`);
  } else {
    calculationMethod = "summed-no-sells";
    closedPnl = summedPnl;
  }

  const closedPnlPercent = totalBet > 0 ? (closedPnl / totalBet) * 100 : 0;
  const result = closedPnl > 0.01 ? "won" : closedPnl < -0.01 ? "lost" : "even";
  const closedAt = Math.max(polyPos.closedAt || 0, opinionPos.closedAt || 0);

  const safePolyKey = String(polyPos.roundKey || polyPos.conditionId || polyPos.marketId || "poly").replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeOpinionKey = String(opinionPos.roundKey || opinionPos.marketId || "opinion").replace(/[^a-zA-Z0-9_-]/g, "_");

  return {
    id: `closed_${safePolyKey}_${safeOpinionKey}`,

    // Market info (use Opinion title - shorter format)
    marketTitle: opinionPos.outcomeName
      ? `${opinionPos.marketTitle} - ${opinionPos.outcomeName}`
      : opinionPos.marketTitle,
    marketTitleBase: opinionPos.marketTitle,
    outcomeDisplay: opinionPos.outcomeName || "",
    thumbnailUrl: polyPos.thumbnailUrl || opinionPos.thumbnailUrl,
    matchScore: matchScore,
    matchType: matchMeta.matchType || "standard",

    // Legs
    legs: (() => {
      let polySideLabel = undefined;
      let opinionSideLabel = undefined;

      if (matchMeta.matchType === "esports-categorical") {
        // Poly side = team name outcome (e.g. "NATUS VINCERE"), keep as sideLabel
        polySideLabel = polyPos.outcome || polyPos.side;
        // Opinion side = YES/NO → parse team name from marketTitle
        const teams = parseEsportsTeamNames(opinionPos.marketTitle);
        if (teams) {
          opinionSideLabel = opinionPos.side === "YES" ? teams.yes : teams.no;
        }
      }

      // Exit price overrides for settlement
      const polyExitCents = polyPos.exitPriceCents ?? polyPos.avgPriceCents;
      const opinionExitCents = opinionSettlementPriceCents != null
        ? opinionSettlementPriceCents
        : (opinionPos.exitPriceCents ?? opinionPos.avgPriceCents);

      return [
        {
          platform: "polymarket",
          side: polyPos.side,
          sideLabel: polySideLabel,
          shares: polyPos.shares,
          entryPriceCents: polyPos.avgPriceCents,
          exitPriceCents: polyExitCents,
          currentPriceCents: polyPos.currentPriceCents,
          valueUsd: polyPos.initialValueUsd,
          pnlUsd: polyPos.pnlUsd,
          link: polyPos.marketUrl,
        },
        {
          platform: "opinion",
          side: opinionPos.side,
          sideLabel: opinionSideLabel,
          shares: opinionPos.shares,
          entryPriceCents: opinionPos.avgPriceCents,
          exitPriceCents: opinionExitCents,
          currentPriceCents: opinionPos.currentPriceCents,
          valueUsd: opinionPos.initialValueUsd,
          pnlUsd: opinionPos.pnlUsd,
          link: opinionPos.marketUrl,
        },
      ];
    })(),

    // Entry metrics
    entryTotalCents,
    entryYesCents,
    entryNoCents,
    arbitragePct: Math.round(entryArbPct * 100) / 100,
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

    // Round metadata (for multi-round debug)
    roundMeta: {
      polyRoundKey: polyPos.roundKey || null,
      opinionRoundKey: opinionPos.roundKey || null,
      polyClosedAt: polyPos.closedAt || null,
      opinionClosedAt: opinionPos.closedAt || null,
      closedGapMs: (polyPos.closedAt && opinionPos.closedAt)
        ? Math.abs((polyPos.closedAt || 0) - (opinionPos.closedAt || 0))
        : null,
      titleScore: Number.isFinite(matchMeta.titleScore) ? Math.round(matchMeta.titleScore * 1000) / 1000 : null,
      timeScore: Number.isFinite(matchMeta.timeScore) ? Math.round(matchMeta.timeScore * 1000) / 1000 : null,
    },
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
  { poly: "fed decision in april", opinion: "us fed rate decision april 2026" },
  
  // ECB markets
  { poly: "ecb interest rates: march 2026", opinion: "ecb rates decision (dfr): march 2026" },
  { poly: "ecb interest rates march 2026", opinion: "ecb rates decision dfr march 2026" },
  
  // ZachXBT investigation - categorical ↔ categorical
  // Poly: "Which crypto company will ZachXBT expose for insider trading?"
  // Opinion: "What company will be the main target of ZachXBT's upcoming investigation?" (topicId 398)
  { poly: "zachxbt expose for insider trading", opinion: "zachxbt upcoming investigation" },
  { poly: "which crypto company will zachxbt expose for insider trading", opinion: "what company will be the main target of zachxbt" },
  { poly: "zachxbt", opinion: "zachxbt" },
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
  // Poly: "Will there be no change in Fed interest rates after the June" (may not have "2026")
  {
    polyKeywords: ["no change", "fed", "june"],
    opinionMarket: "us fed decision in june",
    outcome: "no change",
  },
  // Fed March 2026 - "No change" outcome  
  {
    polyKeywords: ["no change", "fed", "march"],
    opinionMarket: "us fed rate decision in march",
    outcome: "no change",
  },
  // Fed April 2026 - "25 bps decrease" outcome
  // Poly: "Will the Fed decrease interest rates by 25 bps after the April 2026 meeting?"
  // Opinion: "US Fed Rate Decision: April 2026" outcome="25 bps decrease"
  {
    polyKeywords: ["25 bps", "fed", "april"],
    opinionMarket: "us fed rate decision april 2026",
    outcome: "25 bps decrease",
  },
];

/**
 * Special mapping for Polymarket categorical team markets → Opinion binary markets
 * Polymarket esports markets are categorical (outcome = team full name),
 * while Opinion markets are binary (YES = first team, NO = second team).
 *
 * Format: {
 *   polyKeywords: [...],     // keywords to match in Poly title
 *   opinionKeywords: [...],  // keywords to match in Opinion title
 *   teamYes: "full name",   // Poly outcome that maps to Opinion YES (first team)
 *   teamNo: "full name",    // Poly outcome that maps to Opinion NO (second team)
 * }
 */
const POLY_CATEGORICAL_TO_OPINION_BINARY = [
  // ── LEC 2026 ──
  {
    polyKeywords: ["karmine corp", "giantx"],
    opinionKeywords: ["kc", "gx"],
    teamYes: "karmine corp",
    teamNo: "giantx",
  },
  {
    polyKeywords: ["team heretics", "g2 esports"],
    opinionKeywords: ["th", "g2"],
    teamYes: "team heretics",
    teamNo: "g2 esports",
  },
  {
    polyKeywords: ["natus vincere", "fnatic"],
    opinionKeywords: ["navi", "fnc"],
    teamYes: "natus vincere",
    teamNo: "fnatic",
  },
  {
    polyKeywords: ["team vitality", "movistar koi"],
    opinionKeywords: ["vit", "mkoi"],
    teamYes: "team vitality",
    teamNo: "movistar koi",
  },
  // ── LPL 2026 ──
  {
    polyKeywords: ["anyone's legend", "team we"],
    opinionKeywords: ["al", "team we"],
    teamYes: "anyone's legend",
    teamNo: "team we",
  },
  {
    polyKeywords: ["bilibili gaming", "ninjas in pyjamas"],
    opinionKeywords: ["blg", "nip"],
    teamYes: "bilibili gaming",
    teamNo: "ninjas in pyjamas",
  },
  // ── CBLOL 2026 ──
  {
    polyKeywords: ["loud", "red canids"],
    opinionKeywords: ["loud", "red canids"],
    teamYes: "loud",
    teamNo: "red canids",
  },
  // ── LCK 2026 ──
  {
    polyKeywords: ["dn freecs", "drx"],
    opinionKeywords: ["dnf", "drx"],
    teamYes: "dn freecs",
    teamNo: "drx",
  },
  {
    polyKeywords: ["dplus kia", "dn freecs"],
    opinionKeywords: ["dk", "dns"],
    teamYes: "dplus kia",
    teamNo: "dn freecs",
  },
  {
    polyKeywords: ["gen.g", "bnk fearx"],
    opinionKeywords: ["gen", "bfx"],
    teamYes: "gen.g",
    teamNo: "bnk fearx",
  },
  // ── LEC 2026 (new matchups) ──
  {
    polyKeywords: ["natus vincere", "movistar koi"],
    opinionKeywords: ["navi", "mkoi"],
    teamYes: "natus vincere",
    teamNo: "movistar koi",
  },
  {
    polyKeywords: ["karmine corp", "g2 esports"],
    opinionKeywords: ["kc", "g2"],
    teamYes: "karmine corp",
    teamNo: "g2 esports",
  },
  {
    polyKeywords: ["fnatic", "team vitality"],
    opinionKeywords: ["fnc", "vit"],
    teamYes: "fnatic",
    teamNo: "team vitality",
  },
  {
    polyKeywords: ["giantx", "team heretics"],
    opinionKeywords: ["gx", "th"],
    teamYes: "giantx",
    teamNo: "team heretics",
  },
  // ── LCS 2026 ──
  {
    polyKeywords: ["disguised", "team liquid"],
    opinionKeywords: ["tlaw", "dsg"],
    teamYes: "team liquid",
    teamNo: "disguised",
  },
  {
    polyKeywords: ["lyon", "flyquest"],
    opinionKeywords: ["lyon", "fly"],
    teamYes: "lyon",
    teamNo: "flyquest",
  },
  {
    polyKeywords: ["sentinels", "cloud9"],
    opinionKeywords: ["sen", "c9"],
    teamYes: "sentinels",
    teamNo: "cloud9",
  },
  // ── LPL 2026 (new matchups) ──
  {
    polyKeywords: ["jd gaming", "top esports"],
    opinionKeywords: ["jdg", "tes"],
    teamYes: "jd gaming",
    teamNo: "top esports",
  },
  // ── LCP 2026 ──
  {
    polyKeywords: ["team secret whales", "deep cross gaming"],
    opinionKeywords: ["tsw", "dcg"],
    teamYes: "team secret whales",
    teamNo: "deep cross gaming",
  },
  {
    polyKeywords: ["softbank hawks", "ground zero"],
    opinionKeywords: ["shg", "gz"],
    teamYes: "fukuoka softbank hawks gaming",
    teamNo: "ground zero gaming",
  },
  // ── CBLOL 2026 (new matchups) ──
  {
    polyKeywords: ["los", "furia"],
    opinionKeywords: ["los", "fur"],
    teamYes: "los",
    teamNo: "furia",
  },
  // ── CS2 - PGL 2026 ──
  {
    polyKeywords: ["falcons", "parivision"],
    opinionKeywords: ["prv", "fal"],
    teamYes: "parivision",
    teamNo: "team falcons",
  },
  {
    polyKeywords: ["mouz", "natus vincere"],
    opinionKeywords: ["mouz", "navi"],
    teamYes: "mouz",
    teamNo: "natus vincere",
  },
  {
    polyKeywords: ["vitality", "aurora gaming"],
    opinionKeywords: ["vit", "aur"],
    teamYes: "vitality",
    teamNo: "aurora gaming",
  },
  {
    polyKeywords: ["furia", "themongolz"],
    opinionKeywords: ["fur", "mglz"],
    teamYes: "furia",
    teamNo: "themongolz",
  },
  // ── Valorant - VCT Masters 2026 ──
  {
    polyKeywords: ["g2 esports", "paper rex"],
    opinionKeywords: ["g2", "prx"],
    teamYes: "g2 esports",
    teamNo: "paper rex",
  },
  {
    polyKeywords: ["t1", "team liquid"],
    opinionKeywords: ["t1", "tl"],
    teamYes: "t1",
    teamNo: "team liquid",
  },
  // ── Honor of Kings - KPL ──
  {
    polyKeywords: ["kuaishow gaming", "talent gaming"],
    opinionKeywords: ["ksg", "ttg"],
    teamYes: "kuaishow gaming",
    teamNo: "talent gaming",
  },
  // ── Dota 2 - DreamLeague ──
  {
    polyKeywords: ["mouz", "betboom"],
    opinionKeywords: ["mouz", "bb"],
    teamYes: "mouz",
    teamNo: "betboom team",
  },
  {
    polyKeywords: ["parivision", "xtreme gaming"],
    opinionKeywords: ["pari", "xg"],
    teamYes: "parivision",
    teamNo: "xtreme gaming",
  },
  {
    polyKeywords: ["aurora", "tundra"],
    opinionKeywords: ["aur", "tundra"],
    teamYes: "aurora",
    teamNo: "tundra esports",
  },
  {
    polyKeywords: ["team liquid", "team falcons"],
    opinionKeywords: ["tl", "fal"],
    teamYes: "team liquid",
    teamNo: "team falcons",
  },
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
 * Check if Poly categorical team market matches Opinion binary esports market
 * Returns { matched: true, polyMapsToOpinionSide: "YES"|"NO" } or { matched: false }
 *
 * Polymarket esports outcomes are full team names (e.g. "Natus Vincere"),
 * while Opinion uses short abbreviations with binary YES/NO sides
 * where YES = first team, NO = second team.
 */
function matchPolyCategoricalToOpinionBinary(polyTitle, polyOutcome, opinionTitle) {
  const polyNorm = normalizeForWhitelist(polyTitle);
  const opinionNorm = normalizeForWhitelist(opinionTitle);
  const polyOutcomeNorm = normalizeForWhitelist(polyOutcome);

  for (const mapping of POLY_CATEGORICAL_TO_OPINION_BINARY) {
    // Check if Poly title contains all polyKeywords
    const polyMatch = mapping.polyKeywords.every(kw =>
      polyNorm.includes(kw.toLowerCase())
    );
    if (!polyMatch) continue;

    // Check if Opinion title contains all opinionKeywords
    const opinionMatch = mapping.opinionKeywords.every(kw =>
      opinionNorm.includes(kw.toLowerCase())
    );
    if (!opinionMatch) continue;

    // Determine which Opinion side this Poly outcome maps to
    const teamYesNorm = normalizeForWhitelist(mapping.teamYes);
    const teamNoNorm = normalizeForWhitelist(mapping.teamNo);

    if (polyOutcomeNorm === teamYesNorm || polyOutcomeNorm.includes(teamYesNorm) || teamYesNorm.includes(polyOutcomeNorm)) {
      console.log(`[Whitelist-Esports] ✓ Poly "${polyOutcome}" → Opinion YES (${mapping.teamYes})`);
      console.log(`  Poly: "${polyTitle}"`);
      console.log(`  Opinion: "${opinionTitle}"`);
      return { matched: true, polyMapsToOpinionSide: "YES" };
    }

    if (polyOutcomeNorm === teamNoNorm || polyOutcomeNorm.includes(teamNoNorm) || teamNoNorm.includes(polyOutcomeNorm)) {
      console.log(`[Whitelist-Esports] ✓ Poly "${polyOutcome}" → Opinion NO (${mapping.teamNo})`);
      console.log(`  Poly: "${polyTitle}"`);
      console.log(`  Opinion: "${opinionTitle}"`);
      return { matched: true, polyMapsToOpinionSide: "NO" };
    }
  }

  return { matched: false };
}

/**
 * Parse team names from Opinion esports title
 * e.g. "LEC: NAVI vs FNC (Feb. 16 10:45AM ET)" → { yes: "NAVI", no: "FNC" }
 * YES = first team, NO = second team
 */
function parseEsportsTeamNames(title) {
  if (!title) return null;
  // Match "PREFIX: TEAM1 vs TEAM2 (...)" pattern
  const m = title.match(/:\s*(.+?)\s+vs\s+(.+?)(?:\s*\(|$)/i);
  if (!m) return null;
  return { yes: m[1].trim(), no: m[2].trim() };
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

function buildOpinionComparableTitle(opinionTitle, opinionOutcome = "") {
  const title = String(opinionTitle || "").trim();
  const outcome = String(opinionOutcome || "").trim();
  if (!outcome) return title;
  return `${title} ${outcome}`.trim();
}

function extractFdvSeriesKey(title, outcome = "") {
  const normalized = normalizeForWhitelist(`${title || ""} ${outcome || ""}`);
  if (!normalized.includes("fdv above")) return null;

  const projectMatch = normalized.match(/^(.*?)\s+fdv\s+above\b/i);
  const project = projectMatch?.[1]?.replace(/\s+/g, " ").trim() || "";

  const thresholdMatch = normalized.match(/\$\s*(\d+(?:\.\d+)?)\s*([kmbt])/i);
  const threshold = thresholdMatch
    ? `${thresholdMatch[1]}${thresholdMatch[2].toLowerCase()}`
    : "";

  return { project, threshold };
}

function hasFdvSeriesMismatch(polyTitle, opinionTitle, opinionOutcome = "") {
  const polyKey = extractFdvSeriesKey(polyTitle, "");
  const opinionKey = extractFdvSeriesKey(opinionTitle, opinionOutcome);
  if (!polyKey || !opinionKey) return false;

  if (polyKey.project && opinionKey.project && polyKey.project !== opinionKey.project) {
    return true;
  }

  if (polyKey.threshold && opinionKey.threshold && polyKey.threshold !== opinionKey.threshold) {
    return true;
  }

  return false;
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

      if (hasFdvSeriesMismatch(polyPos.marketTitle, opinionPos.marketTitle, opinionPos.outcomeName)) {
        console.log("    -> Skipped: FDV project/threshold mismatch");
        continue;
      }
      const opinionComparableTitle = buildOpinionComparableTitle(opinionPos.marketTitle, opinionPos.outcomeName);
      
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
      // CASE 1.5: Poly categorical team → Opinion binary esports
      // Example: Poly "LoL: Natus Vincere vs Fnatic" outcome="Natus Vincere"
      //        + Opinion "LEC: NAVI vs FNC" side="NO" (=FNC)
      // ============================================================
      if (polyPos.isCategorical) {
        const esportsMatch = matchPolyCategoricalToOpinionBinary(
          polyPos.marketTitle, polyPos.outcome, opinionPos.marketTitle
        );
        
        if (esportsMatch.matched) {
          // polyMapsToOpinionSide tells us which Opinion side the Poly outcome corresponds to
          // For arb, Opinion must be on the OPPOSITE side
          const isArbPair = opinionPos.side !== esportsMatch.polyMapsToOpinionSide;
          
          if (!isArbPair) {
            console.log(`    -> Skipped: same effective side (Poly "${polyPos.outcome}" = Opinion ${esportsMatch.polyMapsToOpinionSide}, user has Opinion ${opinionPos.side})`);
            continue;
          }
          
          console.log(`    -> ESPORTS MATCH! Poly "${polyPos.outcome}" (=${esportsMatch.polyMapsToOpinionSide}) + Opinion ${opinionPos.side}`);
          bestMatch = opinionPos;
          bestScore = 1.0;
          matchType = "esports-categorical";
          // Store which side Poly maps to for createArbPair
          polyPos._esportsPolyMapsTo = esportsMatch.polyMapsToOpinionSide;
          break;
        }
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
      const isWhitelisted = isWhitelistedMatch(polyPos.marketTitle, opinionComparableTitle);
      if (isWhitelisted) {
        console.log(`    -> WHITELIST MATCH!`);
      }
      
      // Calculate title similarity
      const score = titleSimilarity(polyPos.marketTitle, opinionComparableTitle);
      
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
  } else if (matchType === "esports-categorical") {
    // Poly categorical team ↔ Opinion binary esports
    // Poly outcome (e.g. "Natus Vincere") maps to an Opinion side via whitelist
    // _esportsPolyMapsTo tells us which Opinion side the Poly outcome corresponds to
    if (polyPos._esportsPolyMapsTo === "YES") {
      // Poly bought first team (= Opinion YES), Opinion is on NO → arb
      yesPos = polyPos;
      noPos = opinionPos;
    } else {
      // Poly bought second team (= Opinion NO), Opinion is on YES → arb
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
  
  // For esports-categorical, parse team names from Opinion title for display
  let polySideLabel = null;
  let opinionSideLabel = null;
  if (matchType === "esports-categorical") {
    const teamNames = parseEsportsTeamNames(opinionPos.marketTitle);
    if (teamNames) {
      // Poly side label = the outcome name (full team name)
      polySideLabel = polyPos.outcome;
      // Opinion side label = the team the user bet on
      opinionSideLabel = opinionPos.side === "YES" ? teamNames.yes : teamNames.no;
    }
  }

  // outcomeDisplay: skip if same as marketTitle (e.g. binary esports)
  const outcomeDisplay = (opinionPos.outcomeName && opinionPos.outcomeName !== opinionPos.marketTitle)
    ? opinionPos.outcomeName
    : "";

  return {
    id: `${polyPos.marketId}_${opinionPos.marketId}`,
    
    // Market info (use Opinion title - shorter format, append outcome name if different)
    marketTitle: outcomeDisplay
      ? `${opinionPos.marketTitle} - ${outcomeDisplay}`
      : opinionPos.marketTitle,
    marketTitleBase: opinionPos.marketTitle,
    outcomeDisplay,
    thumbnailUrl: polyPos.thumbnailUrl || opinionPos.thumbnailUrl,
    matchScore: matchScore,
    matchType: matchType,
    
    // Legs
    legs: [
      {
        platform: "polymarket",
        side: polyPos.side,
        sideLabel: polySideLabel,
        shares: polyPos.shares,
        entryPriceCents: polyPos.avgPriceCents,
        currentPriceCents: polyPos.currentPriceCents,
        valueUsd: polyPos.currentValueUsd,
        link: polyPos.marketUrl,
      },
      {
        platform: "opinion",
        side: opinionPos.side,
        sideLabel: opinionSideLabel,
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
    const auth = await requireArbitrageAccess(request);
    if (!auth.ok) {
      const response = NextResponse.json(
        { success: false, error: auth.error, reason: auth.reason },
        { status: auth.status }
      );
      clearArbitrageSessionCookie(response);
      return response;
    }

    const limited = enforceIpRateLimit(
      request,
      "arbitrage-wallet-positions",
      RATE_LIMIT_OPTS,
      "Too many wallet position requests. Please wait before refreshing again."
    );
    if (limited) return limited;

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
      const activeOpinionPositionsByKey = new Map();
      for (const pos of opinionPositions) {
        const outcomeSide = pos.side === "YES" ? 1 : 2;
        activeOpinionPositionsByKey.set(`${String(pos.marketId)}:${outcomeSide}`, pos);
      }
      
      // Aggregate trades into closed positions
      const polyClosedPositions = aggregatePolymarketTrades(polyTrades, activePolyConditionIds);
      const opinionClosedPositions = aggregateOpinionTrades(opinionTrades, activeOpinionPositionsByKey);
      
      // Match closed positions to find completed arb trades
      closedArbPositions = matchClosedArbPositions(polyClosedPositions, opinionClosedPositions);
      
      // Sort by P&L (highest first)
      closedArbPositions.sort((a, b) => (b.closedPnl || 0) - (a.closedPnl || 0));
      
      console.log("[wallet-positions] Found", closedArbPositions.length, "closed arb pairs");
    }
    
    // Strip internal debug fields before sending to client
    const stripInternal = (arr) => arr.map(({ _raw, _debug, _cashFlow, ...rest }) => rest);

    return NextResponse.json({
      success: true,
      matched: stripInternal(arbPositions),
      arbPositions: stripInternal(arbPositions),
      closedArb: stripInternal(closedArbPositions),
      polyPositions: stripInternal(polyPositions),
      opinionPositions: stripInternal(opinionPositions),
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
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
