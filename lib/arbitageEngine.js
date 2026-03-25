// lib/arbitageEngine.js
// Alpha logic: compare BEST BID or BEST ASK from both venues.
// Supports:
// - binary: Opinion marketId + Polymarket market slug
// - event_outcome (categorical outcome-specific): Opinion child marketId + Polymarket event slug + match text
// - auto-matched pairs from arbitageAutoMatcher.js
// - Multi-platform: Opinion, Polymarket, Probable (any 2 of 3)

import fs from "fs/promises";
import path from "path";
import { opinionFetch } from "@/lib/opinion";
import { withConcurrency } from "@/lib/concurrency";
import {
  getPolyMarketBySlug,
  getPolyEventBySlug,
  getYesNoTokenIds,
  getPolyBestBids,
  getPolyBestAsks,
  getPolyOrderbooks,
  polyMarketUrlFromSlug,
  polyEventUrlFromSlug,
  polyEventMarketUrl,
} from "@/lib/polymarket";
import { discoverArbitagePairs, discoverMultiPlatformPairs, getPolyTokenIds, clearAutoMatchCache } from "@/lib/arbitageAutoMatcher";
import {
  getProbableTokenIds,
  fetchProbableOrderbook,
  fetchProbableBulkPrices,
  probableMarketUrl,
} from "@/lib/probable";
import {
  getPredictFunTokenIds,
  getPredictFunSideOrderbook,
  predictFunMarketUrl,
} from "@/lib/predictfun";
import { isPredictFunLiveMarket, normalizePredictFunEventKey } from "@/lib/utils/predictfunEventFilter";

/** ---------------- small cache (server) ---------------- */
const CACHE = new Map();
const MAX_ENGINE_CACHE = 2000;
function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    CACHE.delete(key);
    return null;
  }
  // LRU promotion
  CACHE.delete(key);
  CACHE.set(key, hit);
  return hit.val;
}
function cacheSet(key, val, ttlMs = 8000) {
  CACHE.delete(key);
  if (CACHE.size >= MAX_ENGINE_CACHE) {
    const lruKey = CACHE.keys().next().value;
    CACHE.delete(lruKey);
  }
  CACHE.set(key, { val, exp: Date.now() + ttlMs });
}

/** ---------------- helpers ---------------- */

/**
 * Normalize price to decimal (0-1) range.
 * - If price > 1, assume it's in cents (0-100) and divide by 100
 * - If price <= 1, assume it's already decimal
 */
function normalizePriceToDecimal(price) {
  if (!Number.isFinite(price)) return null;
  // If price > 1, it's likely in cents (e.g., 98.5 means 98.5¢ = 0.985)
  if (price > 1) return price / 100;
  return price;
}

/**
 * Convert decimal price (0-1) to cents (0-100) for display
 */
function decimalToCents(decimal) {
  if (!Number.isFinite(decimal)) return null;
  return decimal * 100;
}

function isLivePredictFunPair(pair) {
  const pfMarket = pair?._predictfunMarketB || pair?._predictfunMarketA || null;
  if (!pfMarket) return false;

  const raw = pfMarket._predictfunRaw || pfMarket;
  const liveCandidate = {
    ...raw,
    marketVariant: pfMarket._categoryMarketVariant || raw.marketVariant || pfMarket.marketVariant || null,
    _categoryStatus: pfMarket._categoryStatus || raw._categoryStatus || null,
    _categoryIsVisible: pfMarket._categoryIsVisible ?? raw._categoryIsVisible ?? null,
    _categoryStartsAt: pfMarket.startDate || pfMarket._categoryStartsAt || raw._categoryStartsAt || null,
    _categoryEndsAt: pfMarket.endDate || pfMarket._categoryEndsAt || raw._categoryEndsAt || null,
  };

  return isPredictFunLiveMarket(liveCandidate);
}

function normalizeOpinionOrderbook(raw) {
  const root = raw?.result ?? raw ?? {};
  const rawBids = Array.isArray(root?.bids) ? root.bids : Array.isArray(root?.buy) ? root.buy : [];
  const rawAsks = Array.isArray(root?.asks) ? root.asks : Array.isArray(root?.sell) ? root.sell : [];
  
  const bids = rawBids
    .map((r) => {
      const p = Number(r?.price ?? r?.p ?? r?.px ?? r?.rate ?? r?.value);
      // Opinion API returns "size" field for shares
      const s = Number(r?.size ?? r?.shares ?? r?.s ?? r?.qty ?? r?.quantity ?? r?.amount ?? 0);
      // Normalize price to decimal (0-1)
      const normalizedPrice = normalizePriceToDecimal(p);
      return Number.isFinite(normalizedPrice) ? { price: normalizedPrice, shares: Number.isFinite(s) ? s : 0 } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.price - a.price); // Best bid first (highest)
    
  const asks = rawAsks
    .map((r) => {
      const p = Number(r?.price ?? r?.p ?? r?.px ?? r?.rate ?? r?.value);
      // Opinion API returns "size" field for shares
      const s = Number(r?.size ?? r?.shares ?? r?.s ?? r?.qty ?? r?.quantity ?? r?.amount ?? 0);
      const normalizedPrice = normalizePriceToDecimal(p);
      return Number.isFinite(normalizedPrice) ? { price: normalizedPrice, shares: Number.isFinite(s) ? s : 0 } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.price - b.price); // Best ask first (lowest)
    
  return { bids, asks };
}

/**
 * Unified Opinion orderbook fetch - returns BOTH bid and ask data from a single API call.
 * Caches for 15s to avoid redundant fetches when both bid and ask are needed.
 */
async function getOpinionOrderbookData(tokenId) {
  const key = `opOB:${tokenId}`;
  const cached = cacheGet(key);
  if (cached !== null) return cached;

  try {
    const ob = await opinionFetch(`/token/orderbook`, { params: { token_id: tokenId } });
    const { bids, asks } = normalizeOpinionOrderbook(ob);
    const totalBidLiq = bids.reduce((sum, lvl) => sum + (lvl.shares || 0), 0);
    const totalAskLiq = asks.reduce((sum, lvl) => sum + (lvl.shares || 0), 0);
    const bidNotional = bids.reduce((sum, lvl) => sum + ((lvl.price || 0) * (lvl.shares || 0)), 0);
    const askNotional = asks.reduce((sum, lvl) => sum + ((lvl.price || 0) * (lvl.shares || 0)), 0);
    const val = {
      bestBid: Number.isFinite(bids?.[0]?.price) ? bids[0].price : null,
      bestBidSize: bids?.[0]?.shares ?? 0,
      bestAsk: Number.isFinite(asks?.[0]?.price) ? asks[0].price : null,
      bestAskSize: asks?.[0]?.shares ?? 0,
      totalLiquidity: totalBidLiq + totalAskLiq,
      bidNotional,
      askNotional,
      bids,
      asks,
    };
    cacheSet(key, val, 15000);
    return val;
  } catch (err) {
    console.error("[ArbEngine] getOpinionOrderbookData failed:", err?.message || err);
    cacheSet(key, null, 3000);
    return null;
  }
}

/**
 * Unified Probable orderbook fetch - returns BOTH bid and ask data.
 * Uses the full orderbook endpoint, caches for 15s.
 */
async function getProbableOrderbookData(tokenId) {
  const key = `probOB:${tokenId}`;
  const cached = cacheGet(key);
  if (cached !== null) return cached;

  try {
    const ob = await fetchProbableOrderbook(tokenId);
    if (!ob) {
      cacheSet(key, null, 5000);
      return null;
    }
    const { bids, asks } = ob;
    const totalBidLiq = (bids || []).reduce((sum, lvl) => sum + (lvl.shares || 0), 0);
    const totalAskLiq = (asks || []).reduce((sum, lvl) => sum + (lvl.shares || 0), 0);
    const bidNotional = (bids || []).reduce((sum, lvl) => sum + ((lvl.price || 0) * (lvl.shares || 0)), 0);
    const askNotional = (asks || []).reduce((sum, lvl) => sum + ((lvl.price || 0) * (lvl.shares || 0)), 0);
    const val = {
      bestBid: Number.isFinite(bids?.[0]?.price) ? bids[0].price : null,
      bestBidSize: bids?.[0]?.shares ?? 0,
      bestAsk: Number.isFinite(asks?.[0]?.price) ? asks[0].price : null,
      bestAskSize: asks?.[0]?.shares ?? 0,
      totalLiquidity: totalBidLiq + totalAskLiq,
      bidNotional,
      askNotional,
      bids: bids || [],
      asks: asks || [],
    };
    cacheSet(key, val, 15000);
    return val;
  } catch (err) {
    console.error("[ArbEngine] getProbableOrderbookData failed:", err?.message || err);
    cacheSet(key, null, 3000);
    return null;
  }
}

async function getOpinionBestBid(tokenId) {
  const ob = await getOpinionOrderbookData(tokenId);
  if (!ob || ob.bestBid === null) return null;
  return { price: ob.bestBid, size: ob.bestBidSize, totalLiquidity: ob.totalLiquidity };
}

async function getOpinionBestAsk(tokenId) {
  const ob = await getOpinionOrderbookData(tokenId);
  if (!ob || ob.bestAsk === null) return null;
  return { price: ob.bestAsk, size: ob.bestAskSize, totalLiquidity: ob.totalLiquidity };
}

async function getOpinionMarketSmart(marketId) {
  const key = `opMarket:${marketId}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  // Try normal market endpoint first
  let payload = await opinionFetch(`/market/${marketId}`);
  const d = payload?.result?.data;

  // If categorical/multi, try categorical endpoint too
  if (!d || typeof d !== "object" || d.marketType === 1) {
    const cat = await opinionFetch(`/market/categorical/${marketId}`);
    if (cat?.result?.data) payload = cat;
  }

  cacheSet(key, payload, 15000);
  return payload;
}

function keyOutcome(s) {
  return String(s || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function opinionUrl(marketId) {
  // Your site uses topicId; keep as-is
  return `https://app.opinion.trade/detail?topicId=${marketId}`;
}

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function getOrderbookBidNotional(orderbook) {
  if (!orderbook || typeof orderbook !== "object") return 0;
  if (Number.isFinite(orderbook.bidNotional)) return Number(orderbook.bidNotional);
  const bids = Array.isArray(orderbook.bids) ? orderbook.bids : [];
  return bids.reduce((sum, lvl) => {
    const price = Number(lvl?.price ?? 0);
    const size = Number(lvl?.shares ?? lvl?.size ?? 0);
    return sum + ((Number.isFinite(price) ? price : 0) * (Number.isFinite(size) ? size : 0));
  }, 0);
}

function resolvePlatformLiquidity(platform, { yesOrderbook, noOrderbook, market, fallback = 0 } = {}) {
  if (platform === "opinion") {
    const yesBidNotional = getOrderbookBidNotional(yesOrderbook);
    const noBidNotional = getOrderbookBidNotional(noOrderbook);
    return yesBidNotional + noBidNotional || toFiniteNumber(fallback);
  }

  if (platform === "polymarket") {
    return toFiniteNumber(market?.liquidityNum ?? market?.liquidity ?? fallback);
  }

  if (platform === "probable") {
    return toFiniteNumber(market?.liquidity ?? market?.liquidityNum ?? fallback);
  }

  if (platform === "predictfun") {
    const yesBidNotional = getOrderbookBidNotional(yesOrderbook);
    const noBidNotional = getOrderbookBidNotional(noOrderbook);
    return yesBidNotional + noBidNotional || toFiniteNumber(fallback);
  }

  return toFiniteNumber(fallback);
}

async function readPairs() {
  const file = path.join(process.cwd(), "data", "arbitagePairs.json");
  const raw = await fs.readFile(file, "utf8");
  const json = JSON.parse(raw);
  return Array.isArray(json) ? json : [];
}

/**
 * Parse short team abbreviations from Opinion esports titles.
 * Pattern: "LEC: TH vs G2 (Feb.17 10:45AM ET)" → { yes: "TH", no: "G2" }
 * The first team maps to YES outcome, second to NO outcome.
 * Returns null if the title doesn't match the pattern.
 */
function parseOpinionTeamNames(opinionTitle) {
  if (!opinionTitle) return null;
  // Match pattern: "PREFIX: TEAM1 vs TEAM2 (date...)" or "PREFIX: TEAM1 vs TEAM2"
  const m = opinionTitle.match(/:\s*([A-Za-z0-9\s]+?)\s+vs\.?\s+([A-Za-z0-9\s]+?)(?:\s*\(|$)/i);
  if (!m) return null;
  return { yes: m[1].trim(), no: m[2].trim() };
}

/**
 * Price-mode aware arb:
 * - asks mode: buy-side arb, profit = 1 - total cost
 * - bids mode: sell-side arb, profit = total proceeds - 1
 * 
 * All prices should be normalized to decimal (0-1) before passing here.
 * E.g., 97.5¢ = 0.975, 98.6¢ = 0.986
 * In asks mode arb exists when cost < 1.
 * In bids mode arb exists when proceeds > 1.
 */
function computeBinaryArb({ opYes, opNo, polyYes, polyNo, labels, priceMode = "asks" }) {
  const dirs = [];
  const isAsks = priceMode === "asks";
  const actionWord = isAsks ? "Buy" : "Sell";

  // Resolve labels: use custom outcome names if provided, otherwise YES/NO
  const polyYesLabel = labels?.polyYes || "YES";
  const polyNoLabel = labels?.polyNo || "NO";
  const opYesLabel = labels?.opYes || "YES";
  const opNoLabel = labels?.opNo || "NO";
  const polyTag = labels?.polyTag || "Poly";
  const opTag = labels?.opTag || "Opinion";

  // Always include all prices for display
  const allPrices = {
    polyYes: decimalToCents(polyYes),
    polyNo: decimalToCents(polyNo),
    opYes: decimalToCents(opYes),
    opNo: decimalToCents(opNo),
    // Include labels for frontend price display
    polyYesLabel,
    polyNoLabel,
    opYesLabel,
    opNoLabel,
    polyTag,
    opTag,
  };

  // Direction A: YES on Poly + NO on Opinion
  if (Number.isFinite(polyYes) && Number.isFinite(opNo)) {
    const total = polyYes + opNo;
    const arb = isAsks ? 1 - total : total - 1;
    dirs.push({
      cost: total,
      arb,
      strategy: [`${actionWord} ${polyYesLabel} (${polyTag})`, `${actionWord} ${opNoLabel} (${opTag})`],
      prices: allPrices,
    });
  }
  
  // Direction B: NO on Poly + YES on Opinion
  if (Number.isFinite(polyNo) && Number.isFinite(opYes)) {
    const total = polyNo + opYes;
    const arb = isAsks ? 1 - total : total - 1;
    dirs.push({
      cost: total,
      arb,
      strategy: [`${actionWord} ${polyNoLabel} (${polyTag})`, `${actionWord} ${opYesLabel} (${opTag})`],
      prices: allPrices,
    });
  }

  dirs.sort((a, b) => b.arb - a.arb);
  const best = dirs[0] || null;
  if (!best) return null;
  return {
    ...best,
    strategyMode: isAsks ? "buy" : "sell",
  };
}

/**
 * Simulate executable arbitrage profit by walking two orderbook sides.
 *
 * For buy-mode arb (asks): consume asks on both legs.
 * For sell-mode arb (bids): consume bids on both legs.
 *
 * All prices are in USD decimal (0-1). Sizes are share counts.
 *
 * @param {Array<{price:number, shares?:number, size?:number}>} bookA - levels for leg A
 * @param {Array<{price:number, shares?:number, size?:number}>} bookB - levels for leg B
 * @param {object} opts
 * @param {"buy"|"sell"} opts.mode - "buy" consumes asks (lowest first), "sell" consumes bids (highest first)
 * @param {number} opts.feePerShareA - fee per share leg A (default 0)
 * @param {number} opts.feePerShareB - fee per share leg B (default 0)
 * @returns {{evPerShareUsd:number, maxShares:number, maxProfitUsd:number, evCalcMode:string}}
 */
function simulateArbProfit(bookA, bookB, { mode = "buy", feePerShareA = 0, feePerShareB = 0 } = {}) {
  const isBuy = mode === "buy";

  // Normalize levels: ensure {price, shares} with correct sort
  const normLevel = (lvl) => ({
    price: Number(lvl?.price ?? 0),
    shares: Number(lvl?.shares ?? lvl?.size ?? 0),
  });

  let levelsA = (bookA || []).map(normLevel).filter(l => l.shares > 0 && Number.isFinite(l.price));
  let levelsB = (bookB || []).map(normLevel).filter(l => l.shares > 0 && Number.isFinite(l.price));

  // Sort: for buy mode (asks), lowest price first; for sell mode (bids), highest price first
  if (isBuy) {
    levelsA.sort((a, b) => a.price - b.price);
    levelsB.sort((a, b) => a.price - b.price);
  } else {
    levelsA.sort((a, b) => b.price - a.price);
    levelsB.sort((a, b) => b.price - a.price);
  }

  // If no depth available, return null
  if (!levelsA.length || !levelsB.length) return null;

  let totalShares = 0;
  let totalProfit = 0;
  let idxA = 0;
  let idxB = 0;
  let remA = levelsA[0].shares;
  let remB = levelsB[0].shares;

  while (idxA < levelsA.length && idxB < levelsB.length) {
    const pA = levelsA[idxA].price;
    const pB = levelsB[idxB].price;

    // Marginal EV for this chunk
    const marginalEv = isBuy
      ? 1 - pA - pB - feePerShareA - feePerShareB
      : pA + pB - 1 - feePerShareA - feePerShareB;

    if (marginalEv <= 0) break; // Stop: no longer profitable

    const chunk = Math.min(remA, remB);
    totalShares += chunk;
    totalProfit += marginalEv * chunk;

    remA -= chunk;
    remB -= chunk;

    if (remA <= 0) {
      idxA++;
      if (idxA < levelsA.length) remA = levelsA[idxA].shares;
    }
    if (remB <= 0) {
      idxB++;
      if (idxB < levelsB.length) remB = levelsB[idxB].shares;
    }
  }

  const hasDepth = levelsA.length > 1 || levelsB.length > 1;
  return {
    evPerShareUsd: totalShares > 0 ? totalProfit / totalShares : 0,
    maxShares: totalShares,
    maxProfitUsd: totalProfit,
    evCalcMode: hasDepth ? "depth_simulated" : "top_of_book",
  };
}

/**
 * Compute profit fields for an arb opportunity using orderbook depth.
 *
 * @param {object} opts
 * @param {object} opts.best - result from computeBinaryArb (has strategy, prices, strategyMode)
 * @param {object} opts.aYesOB - sideA YES orderbook (with bids/asks arrays)
 * @param {object} opts.aNoOB  - sideA NO orderbook
 * @param {object} opts.bYesOB - sideB YES orderbook
 * @param {object} opts.bNoOB  - sideB NO orderbook
 * @param {string} opts.priceMode - "asks" or "bids"
 * @param {object} opts.labels - label config from computeBinaryArb
 * @returns {{evPerShareUsd:number, maxShares:number, maxProfitUsd:number, evCalcMode:string}}
 */
function computeArbProfit({ best, aYesOB, aNoOB, bYesOB, bNoOB, priceMode = "asks", labels = {} }) {
  if (!best || !best.strategy || best.strategy.length < 2) return null;

  const isAsks = priceMode === "asks";
  const mode = isAsks ? "buy" : "sell";
  const side = isAsks ? "asks" : "bids";

  // Determine which book sides are consumed based on strategy lines
  // Strategy format: ["Buy YES (Poly)", "Buy NO (OPN)"] or similar
  const polyTag = labels?.polyTag || "Poly";
  const opTag = labels?.opTag || "Opinion";
  const polyYesLabel = (labels?.polyYes || "YES").toLowerCase();
  const polyNoLabel = (labels?.polyNo || "NO").toLowerCase();
  const opYesLabel = (labels?.opYes || "YES").toLowerCase();
  const opNoLabel = (labels?.opNo || "NO").toLowerCase();

  // Parse strategy lines to determine which orderbook side each leg uses
  function resolveBook(line) {
    const text = String(line || "").toLowerCase();
    const isSideB = line.includes(`(${polyTag})`);

    if (isSideB) {
      // This leg is on sideB (polymarket/probable/predictfun)
      if (text.includes(polyYesLabel) && (!text.includes(polyNoLabel) || polyYesLabel === polyNoLabel)) {
        return (bYesOB?.[side] || []);
      }
      return (bNoOB?.[side] || []);
    } else {
      // This leg is on sideA (opinion/etc)
      if (text.includes(opYesLabel) && (!text.includes(opNoLabel) || opYesLabel === opNoLabel)) {
        return (aYesOB?.[side] || []);
      }
      return (aNoOB?.[side] || []);
    }
  }

  const bookLegA = resolveBook(best.strategy[0]);
  const bookLegB = resolveBook(best.strategy[1]);

  return simulateArbProfit(bookLegA, bookLegB, { mode });
}

/** ---------------- main compute ---------------- */

export async function computeArbitageOpportunities({ minArbPct = 0.1, limit = 50, priceMode = "asks" } = {}) {
  const pairs = await readPairs();
  const debug = [];
  if (!pairs.length) return { rows: [], debug: [{ step: "no_pairs" }] };
  const normalizedPriceMode = priceMode === "bids" ? "bids" : "asks";

  const jobs = pairs.map((pair) =>
    withConcurrency(async () => {
      const pairId = String(pair.id || "");
      const type = String(pair.type || "binary");

      try {
        const opinionMarketId = String(pair.opinionMarketId || "");
        if (!opinionMarketId) {
          debug.push({ pairId, step: "skip_missing_opinionMarketId" });
          return null;
        }

        // ---------- fetch Opinion (market child is fine) ----------
        const opPayload = await getOpinionMarketSmart(opinionMarketId);
        const opData = opPayload?.result?.data;
        if (!opData) {
          debug.push({ pairId, step: "fail_opinion_market" });
          return null;
        }

        // Opinion API uses "tittle" (typo) or various other field names
        const title = opData?.tittle || opData?.title || opData?.question || opData?.marketTitle || opData?.name || "—";
        const imageUrl = opData?.thumbnailUrl || opData?.coverUrl || opData?.image || null;
        
        // Check for bonus (incentiveFactor field exists)
        const hasBonus = "incentiveFactor" in opData || "incentive_factor" in opData || "incentive" in opData;

        // Opinion must be binary YES/NO (because we're comparing per-outcome market)
        const opYesToken = opData?.yesTokenId ?? opData?.yes_token_id;
        const opNoToken = opData?.noTokenId ?? opData?.no_token_id;
        if (!opYesToken || !opNoToken) {
          debug.push({ pairId, step: "fail_opinion_not_binary", got: { yes: !!opYesToken, no: !!opNoToken } });
          return null;
        }

        // ---------- fetch Polymarket side ----------
        let polyYesTid = null;
        let polyNoTid = null;
        let polyUrl = "https://polymarket.com?r=User42069";

        if (type === "binary") {
          const polySlug = String(pair.polySlug || "");
          if (!polySlug) {
            debug.push({ pairId, step: "skip_missing_polySlug" });
            return null;
          }

          const polyMarket = await getPolyMarketBySlug(polySlug);
          if (!polyMarket) {
            debug.push({ pairId, step: "fail_poly_market", polySlug });
            return null;
          }

          const yn = getYesNoTokenIds(polyMarket);
          if (!yn) {
            debug.push({ pairId, step: "fail_poly_yesno_tokens", polySlug });
            return null;
          }

          polyYesTid = yn.yesTokenId;
          polyNoTid = yn.noTokenId;
          polyUrl = polyMarketUrlFromSlug(polySlug);
        } else if (type === "event_outcome" || type === "categorical") {
          // categorical here means: pick ONE outcome-market inside an event (like <400m)
          const polyEventSlug = String(pair.polyEventSlug || "");
          const outcomeMatch = String(pair.polyOutcomeMatch || pair.outcomeMatch || "").toLowerCase().trim();

          if (!polyEventSlug || !outcomeMatch) {
            debug.push({ pairId, step: "skip_missing_polyEventSlug_or_outcomeMatch", polyEventSlug, outcomeMatch });
            return null;
          }

          const ev = await getPolyEventBySlug(polyEventSlug);
          if (!ev) {
            debug.push({ pairId, step: "fail_poly_event", polyEventSlug });
            return null;
          }

          const markets = Array.isArray(ev?.markets) ? ev.markets : [];
          if (!markets.length) {
            debug.push({ pairId, step: "fail_poly_event_no_markets", polyEventSlug });
            return null;
          }

          // Try to find the right child market by matching question/title/outcomes/groupItemTitle text
          const pick = markets.find((m) => {
            const q = String(m?.question || m?.title || "").toLowerCase();
            const outs = Array.isArray(m?.outcomes) ? m.outcomes.join(" ").toLowerCase() : "";
            // Also check groupItemTitle which Polymarket uses for categorical outcomes
            const groupTitle = String(m?.groupItemTitle || "").toLowerCase();
            return q.includes(outcomeMatch) || outs.includes(outcomeMatch) || groupTitle.includes(outcomeMatch);
          });

          debug.push({
            pairId,
            step: "poly_event_markets_found",
            polyEventSlug,
            outcomeMatch,
            marketCount: markets.length,
            marketTitles: markets.map(m => m?.groupItemTitle || m?.question || m?.title).slice(0, 10),
          });

          if (!pick) {
            debug.push({
              pairId,
              step: "fail_poly_event_pick_market",
              polyEventSlug,
              outcomeMatch,
              marketCount: markets.length,
            });
            return null;
          }

          const yn = getYesNoTokenIds(pick);
          
          debug.push({
            pairId,
            step: "poly_picked_market_tokens",
            groupItemTitle: pick?.groupItemTitle,
            yesTokenId: yn?.yesTokenId?.substring(0, 30) + "...",
            noTokenId: yn?.noTokenId?.substring(0, 30) + "...",
          });

          if (!yn) {
            debug.push({ pairId, step: "fail_poly_pick_yesno_tokens", polyEventSlug, outcomeMatch });
            return null;
          }

          polyYesTid = yn.yesTokenId;
          polyNoTid = yn.noTokenId;
          polyUrl = polyEventMarketUrl(polyEventSlug, pick.slug);
        } else {
          debug.push({ pairId, step: "skip_unknown_type", type });
          return null;
        }

        // ---------- fetch BEST BIDs ----------
        const [opYesBidObj, opNoBidObj, polyBids] = await Promise.all([
          getOpinionBestBid(String(opYesToken)),
          getOpinionBestBid(String(opNoToken)),
          getPolyBestBids([String(polyYesTid), String(polyNoTid)]),
        ]);

        // getOpinionBestBid returns { price, size, totalLiquidity } or null
        const opYesBid = opYesBidObj?.price ?? null;
        const opNoBid = opNoBidObj?.price ?? null;
        const polyYesBid = polyBids.get(String(polyYesTid)) ?? null;
        const polyNoBid = polyBids.get(String(polyNoTid)) ?? null;

        if (!Number.isFinite(opYesBid) || !Number.isFinite(opNoBid)) {
          debug.push({ pairId, step: "fail_opinion_bids", opYesBid, opNoBid });
          return null;
        }
        if (!Number.isFinite(polyYesBid) || !Number.isFinite(polyNoBid)) {
          debug.push({ pairId, step: "fail_poly_bids", polyYesBid, polyNoBid });
          return null;
        }

        // ---------- compute ----------
        debug.push({ 
          pairId, 
          step: "prices_before_compute", 
          opYesBid, 
          opNoBid, 
          polyYesBid, 
          polyNoBid,
          sumPolyYesOpNo: polyYesBid + opNoBid,
          sumPolyNoOpYes: polyNoBid + opYesBid
        });

        const best = computeBinaryArb({
          opYes: opYesBid,
          opNo: opNoBid,
          polyYes: polyYesBid,
          polyNo: polyNoBid,
          priceMode: normalizedPriceMode,
        });

        if (!best || !Number.isFinite(best.arb)) {
          debug.push({ pairId, step: "fail_compute_best_null", best });
          return null;
        }

        debug.push({ pairId, step: "compute_result", best });

        const arbPct = best.arb * 100;
        if (arbPct < minArbPct) return null;

        return {
          id: String(pair.id || `${opinionMarketId}`),
          opinionMarketId, // For bonus detection
          hasBonus, // Detected from market detail
          title,
          imageUrl,
          poly: { title: "Polymarket", url: polyUrl },
          opinion: { title: "Opinion", url: opinionUrl(opinionMarketId) },
          strategy: best.strategy,
          strategyMode: best.strategyMode || (normalizedPriceMode === "asks" ? "buy" : "sell"),
          arbPct,
          label: "Spread",
          prices: {
            polyYes: decimalToCents(polyYesBid),
            polyNo: decimalToCents(polyNoBid),
            opYes: decimalToCents(opYesBid),
            opNo: decimalToCents(opNoBid),
          },
        };
      } catch (e) {
        debug.push({ pairId, step: "exception", msg: String(e?.message || e) });
        return null;
      }
    }, 8)
  );

  const rows = (await Promise.all(jobs)).filter(Boolean);
  rows.sort((a, b) => (b.arbPct ?? 0) - (a.arbPct ?? 0));

  return { rows: rows.slice(0, limit), debug };
}

/**
 * Auto-scan for arbitrage opportunities using fuzzy matching
 * This discovers pairs automatically instead of using manual mapping
 * @param {Object} options
 * @param {number} options.minArbPct - Minimum arbitrage percentage
 * @param {number} options.minSimilarity - Minimum similarity for matching
 * @param {number} options.limit - Max results
 * @param {string} options.priceMode - "bids" or "asks"
 * @param {string} options.scanMode - "quick" (90 markets) or "full" (unlimited)
 * @param {string} options.platformA - "opinion", "polymarket", or "probable"
 * @param {string} options.platformB - "opinion", "polymarket", or "probable"
 */
export async function scanArbitageOpportunities({ minArbPct = 0.1, minSimilarity = 0.9, limit = 50, priceMode = "asks", scanMode = "quick", platformA = "polymarket", platformB = "opinion", predictFunEvent = null } = {}) {
  const debug = [];
  const normalizedPriceMode = priceMode === "bids" ? "bids" : "asks";
  const useAsks = normalizedPriceMode === "asks";
  const hasProbable = platformA === "probable" || platformB === "probable";
  const hasPredictFun = platformA === "predictfun" || platformB === "predictfun";
  const useMultiPlatform = hasProbable || hasPredictFun;
  const predictFunEventKey = normalizePredictFunEventKey(predictFunEvent);
  const isPolyPredictFun =
    (platformA === "polymarket" && platformB === "predictfun") ||
    (platformA === "predictfun" && platformB === "polymarket");
  const allowNegativeArb = (predictFunEventKey === "march-madness" || predictFunEventKey === "live") && isPolyPredictFun;
  const scanStartTs = Date.now();

  // For full scan, set maxTotalMarkets to a very high number (effectively unlimited)
  const maxTotalMarkets = scanMode === "full" ? 9999 : scanMode === "med" ? 140 : 80;

  try {
    // Clear cache to force fresh data
    clearAutoMatchCache();

    // Step 1: Discover matching pairs between the two selected platforms
    debug.push({ step: "discovering_pairs", minSimilarity, priceMode: normalizedPriceMode, scanMode, maxTotalMarkets, platformA, platformB });
    console.log("[AUTO-SCAN] Discovering pairs:", platformA, "+", platformB, "| minSimilarity:", minSimilarity, "| priceMode:", normalizedPriceMode, "| scanMode:", scanMode);
    const discoverStartTs = Date.now();

    const discoveryResult = useMultiPlatform
      ? await discoverMultiPlatformPairs({ platformA, platformB, minSimilarity, maxTotalMarkets, predictFunEventFilter: predictFunEventKey })
      : await discoverArbitagePairs({ minSimilarity, maxTotalMarkets });
    const discoverMs = Date.now() - discoverStartTs;
    console.log(`[AUTO-SCAN][Timing] discover_pairs: ${discoverMs}ms`);
    debug.push({ step: "timing_discover_pairs_ms", ms: discoverMs });
    
    // Handle new return format (object with pairs, error, etc.) vs old format (array)
    const pairs = Array.isArray(discoveryResult) ? discoveryResult : (discoveryResult?.pairs || []);
    const apiError = discoveryResult?.error;
    const platformBAvailable = discoveryResult?.polymarketAvailable !== false;
    
    debug.push({ step: "pairs_found", count: pairs.length, platformBAvailable });
    console.log("[AUTO-SCAN] Found", pairs.length, "pairs | Platform B available:", platformBAvailable);

    // Check for platform API unavailability
    if (!platformBAvailable || apiError === "POLYMARKET_UNAVAILABLE" || apiError === "PROBABLE_UNAVAILABLE" || apiError === "PREDICTFUN_UNAVAILABLE") {
      debug.push({ 
        step: "platform_unavailable",
        error: apiError,
        errorMessage: discoveryResult?.errorMessage,
      });
      return { 
        rows: [], 
        debug,
        error: apiError || "PLATFORM_UNAVAILABLE",
        errorMessage: discoveryResult?.errorMessage || `Cannot connect to ${platformB} API. Please try again later.`,
      };
    }

    // Log top 3 matches for debugging
    pairs.slice(0, 3).forEach((p, i) => {
      console.log(`  ${i + 1}. Opinion: "${p.opinionTitle}"`);
      console.log(`     Poly: "${p.polyTitle}" (similarity: ${(p.similarity * 100).toFixed(1)}%)`);
    });

    if (!pairs.length) {
      debug.push({ 
        step: "no_pairs_found",
        hint: "If this persists, check console logs for DNS/network issues with Polymarket API"
      });
      return { rows: [], debug };
    }

    // Step 2: For each pair, fetch orderbook and compute arb
    const platformLabelMap = { opinion: "Opinion", polymarket: "Poly", probable: "Probable" };
    const tagA = platformLabelMap[platformA] || platformA;
    const tagB = platformLabelMap[platformB] || platformB;
    const pricingStartTs = Date.now();

    const jobs = pairs.map((pair) =>
      withConcurrency(async () => {
        const pairId = pair.id;
        const pA = pair._platformA || platformA;
        const pB = pair._platformB || platformB;

        try {
          // Resolve token IDs for both sides
          let aYesTid, aNoTid, bYesTid, bNoTid;
          let aYesLabel = "YES", aNoLabel = "NO", bYesLabel = "YES", bNoLabel = "NO";

          if (pA === "opinion") {
            aYesTid = pair.opinionYesToken; aNoTid = pair.opinionNoToken;
            if (!aYesTid || !aNoTid) { debug.push({ pairId, step: "skip_missing_sideA_tokens" }); return null; }
          } else if (pA === "polymarket") {
            const tk = getPolyTokenIds(pair._polyMarketA || pair.polyMarket);
            if (!tk) { debug.push({ pairId, step: "skip_missing_poly_tokens_A" }); return null; }
            aYesTid = String(tk.yesTokenId); aNoTid = String(tk.noTokenId);
            aYesLabel = tk.yesLabel || "YES"; aNoLabel = tk.noLabel || "NO";
          } else if (pA === "probable") {
            const tk = getProbableTokenIds(pair._probableMarketA);
            if (!tk) { debug.push({ pairId, step: "skip_missing_prob_tokens_A" }); return null; }
            aYesTid = String(tk.yesTokenId); aNoTid = String(tk.noTokenId);
            aYesLabel = tk.yesLabel || "YES"; aNoLabel = tk.noLabel || "NO";
          } else if (pA === "predictfun") {
            const tk = getPredictFunTokenIds(pair._predictfunMarketA);
            if (!tk) { debug.push({ pairId, step: "skip_missing_pf_tokens_A" }); return null; }
            aYesTid = String(tk.yesTokenId); aNoTid = String(tk.noTokenId);
          }

          if (pB === "polymarket") {
            const tk = getPolyTokenIds(pair.polyMarket);
            if (!tk) { debug.push({ pairId, step: "skip_missing_poly_tokens_B" }); return null; }
            bYesTid = String(tk.yesTokenId); bNoTid = String(tk.noTokenId);
            bYesLabel = tk.yesLabel || "YES"; bNoLabel = tk.noLabel || "NO";
          } else if (pB === "probable") {
            const tk = getProbableTokenIds(pair._probableMarketB);
            if (!tk) { debug.push({ pairId, step: "skip_missing_prob_tokens_B" }); return null; }
            bYesTid = String(tk.yesTokenId); bNoTid = String(tk.noTokenId);
            bYesLabel = tk.yesLabel || "YES"; bNoLabel = tk.noLabel || "NO";
          } else if (pB === "predictfun") {
            const tk = getPredictFunTokenIds(pair._predictfunMarketB);
            if (!tk) { debug.push({ pairId, step: "skip_missing_pf_tokens_B" }); return null; }
            bYesTid = String(tk.yesTokenId); bNoTid = String(tk.noTokenId);
          } else if (pB === "opinion") {
            bYesTid = pair.opinionYesToken; bNoTid = pair.opinionNoToken;
            if (!bYesTid || !bNoTid) { debug.push({ pairId, step: "skip_missing_opinion_tokens_B" }); return null; }
          }

          if (!aYesTid || !aNoTid || !bYesTid || !bNoTid) return null;

          // Helper: get orderbook for non-poly, non-predictfun platforms
          function getOBForPlatform(p, tid) {
            if (p === "opinion") return getOpinionOrderbookData(String(tid));
            if (p === "probable") return getProbableOrderbookData(String(tid));
            if (p === "predictfun") return getPredictFunSideOrderbook(String(tid));
            return null;
          }

          // Fetch orderbooks
          let aYesOB, aNoOB, bYesOB, bNoOB;
          if (pA === "polymarket") {
            const [obMap, bY, bN] = await Promise.all([
              getPolyOrderbooks([aYesTid, aNoTid]),
              getOBForPlatform(pB, bYesTid),
              getOBForPlatform(pB, bNoTid),
            ]);
            aYesOB = obMap.get(aYesTid) || null; aNoOB = obMap.get(aNoTid) || null;
            bYesOB = bY; bNoOB = bN;
          } else if (pB === "polymarket") {
            const [aY, aN, obMap] = await Promise.all([
              getOBForPlatform(pA, aYesTid),
              getOBForPlatform(pA, aNoTid),
              getPolyOrderbooks([bYesTid, bNoTid]),
            ]);
            aYesOB = aY; aNoOB = aN;
            bYesOB = obMap.get(bYesTid) || null; bNoOB = obMap.get(bNoTid) || null;
          } else {
            const [aY, aN, bY, bN] = await Promise.all([
              getOBForPlatform(pA, aYesTid),
              getOBForPlatform(pA, aNoTid),
              getOBForPlatform(pB, bYesTid),
              getOBForPlatform(pB, bNoTid),
            ]);
            aYesOB = aY; aNoOB = aN; bYesOB = bY; bNoOB = bN;
          }

          // Extract prices
          const aYesPrice = useAsks ? aYesOB?.bestAsk : aYesOB?.bestBid;
          const aNoPrice  = useAsks ? aNoOB?.bestAsk  : aNoOB?.bestBid;
          const aYesSize  = useAsks ? aYesOB?.bestAskSize : aYesOB?.bestBidSize;
          const aNoSize   = useAsks ? aNoOB?.bestAskSize  : aNoOB?.bestBidSize;
          const aLiquidity = resolvePlatformLiquidity(pA, {
            yesOrderbook: aYesOB,
            noOrderbook: aNoOB,
            market:
              pA === "polymarket"
                ? (pair._polyMarketA || pair.polyMarket)
                : pA === "probable"
                  ? pair._probableMarketA
                  : pA === "predictfun"
                    ? pair._predictfunMarketA
                    : null,
            fallback: pair.opinionLiquidity,
          });

          const bYesPrice = useAsks ? bYesOB?.bestAsk : bYesOB?.bestBid;
          const bNoPrice  = useAsks ? bNoOB?.bestAsk  : bNoOB?.bestBid;
          const bYesSize  = useAsks ? bYesOB?.bestAskSize : bYesOB?.bestBidSize;
          const bNoSize   = useAsks ? bNoOB?.bestAskSize  : bNoOB?.bestBidSize;
          const bLiquidity = resolvePlatformLiquidity(pB, {
            yesOrderbook: bYesOB,
            noOrderbook: bNoOB,
            market:
              pB === "polymarket"
                ? pair.polyMarket
                : pB === "probable"
                  ? (pair._probableMarketB || pair.polyMarket)
                  : pB === "predictfun"
                    ? (pair._predictfunMarketB || pair.polyMarket)
                    : null,
            fallback: pair.opinionLiquidity,
          });

          if (!Number.isFinite(aYesPrice) || !Number.isFinite(aNoPrice)) {
            debug.push({ pairId, step: `fail_sideA_${priceMode}`, aYesPrice, aNoPrice });
            return null;
          }
          if (!Number.isFinite(bYesPrice) || !Number.isFinite(bNoPrice)) {
            debug.push({ pairId, step: `fail_sideB_${priceMode}`, bYesPrice, bNoPrice });
            return null;
          }

          const teamNames = parseOpinionTeamNames(pair.opinionTitle || pair.polyTitle || "");
          const best = computeBinaryArb({
            opYes: aYesPrice, opNo: aNoPrice,
            polyYes: bYesPrice, polyNo: bNoPrice,
            priceMode,
            labels: {
              polyYes: teamNames?.yes || bYesLabel, polyNo: teamNames?.no || bNoLabel,
              opYes: teamNames?.yes || aYesLabel, opNo: teamNames?.no || aNoLabel,
              polyTag: tagB, opTag: tagA,
            },
          });

          if (!best || !Number.isFinite(best.arb)) {
            debug.push({ pairId, step: "no_arb", best });
            return null;
          }

          const arbPct = best.arb * 100;
          const pairAllowsNegativeArb =
            allowNegativeArb ||
            Boolean(pair._marchMadnessPair) ||
            (isPolyPredictFun && isLivePredictFunPair(pair));
          if (!pairAllowsNegativeArb && arbPct < minArbPct) return null;

          // Compute executable profit via orderbook depth simulation
          const profitLabels = {
            polyYes: teamNames?.yes || bYesLabel, polyNo: teamNames?.no || bNoLabel,
            opYes: teamNames?.yes || aYesLabel, opNo: teamNames?.no || aNoLabel,
            polyTag: tagB, opTag: tagA,
          };
          const profitResult = computeArbProfit({
            best, aYesOB, aNoOB, bYesOB, bNoOB,
            priceMode: normalizedPriceMode, labels: profitLabels,
          });

          // Build URLs per platform
          let sideAUrl, sideATitle, sideBUrl, sideBTitle;
          if (pA === "opinion") {
            sideAUrl = opinionUrl(pair.opinionMarketId); sideATitle = pair.opinionTitle || "Opinion";
          } else if (pA === "polymarket") {
            const pt = pair.polyTitle || pair._polyMarketA?.question || "";
            sideAUrl = pair._polyEventA?.slug
              ? polyEventMarketUrl(pair._polyEventA.slug, pair._polyMarketA?.slug || pair.polyMarketSlug)
              : polyMarketUrlFromSlug(pair._polyMarketA?.slug || pair.polyMarketSlug, pt);
            sideATitle = pt || "Polymarket";
          } else if (pA === "probable") {
            sideAUrl = probableMarketUrl(pair._probableMarketA?._marketId || pair._probableMarketA?.id, pair._probableMarketA?._eventSlug || pair._probableMarketA?.slug);
            sideATitle = pair._probableMarketA?.title || pair._probableMarketA?.question || "Probable";
          } else if (pA === "predictfun") {
            sideAUrl = predictFunMarketUrl(pair._predictfunMarketA?._marketId || pair._predictfunMarketA?.id, pair._predictfunMarketA?._categorySlug);
            sideATitle = pair._predictfunMarketA?.title || pair._predictfunMarketA?.question || "Predict.fun";
          }
          if (pB === "polymarket") {
            const pt = pair.polyTitle || pair.polyMarket?.title || pair.polyMarket?.question || "";
            sideBUrl = pair.polyEventSlug
              ? polyEventMarketUrl(pair.polyEventSlug, pair.polyMarketSlug)
              : polyMarketUrlFromSlug(pair.polyMarketSlug, pt);
            sideBTitle = pt || "Polymarket";
          } else if (pB === "probable") {
            sideBUrl = probableMarketUrl(pair._probableMarketB?._marketId || pair._probableMarketB?.id, pair._probableMarketB?._eventSlug || pair._probableMarketB?.slug);
            sideBTitle = pair._probableMarketB?.title || pair._probableMarketB?.question || "Probable";
          } else if (pB === "predictfun") {
            sideBUrl = predictFunMarketUrl(pair._predictfunMarketB?._marketId || pair._predictfunMarketB?.id, pair._predictfunMarketB?._categorySlug);
            sideBTitle = pair._predictfunMarketB?.title || pair._predictfunMarketB?.question || "Predict.fun";
          } else if (pB === "opinion") {
            sideBUrl = opinionUrl(pair.opinionMarketId); sideBTitle = pair.opinionTitle || "Opinion";
          }

          const endDate = pair.polyMarket?.endDate || pair.polyMarket?.end_date_iso || pair._probableMarketB?.endDate || pair._predictfunMarketB?.endDate || pair._predictfunMarketA?.endDate || null;
          const startDate = pair._predictfunMarketB?.startDate || pair._predictfunMarketA?.startDate || null;
          const pfCategoryMarketVariant = pair._predictfunMarketB?._categoryMarketVariant || pair._predictfunMarketB?.marketVariant || pair._predictfunMarketB?._predictfunRaw?.marketVariant || pair._predictfunMarketA?._categoryMarketVariant || pair._predictfunMarketA?.marketVariant || pair._predictfunMarketA?._predictfunRaw?.marketVariant || null;

          // Live detection fields
          const pfB = pair._predictfunMarketB;
          const pfA = pair._predictfunMarketA;
          const pfCategoryStatus = pfB?._categoryStatus || pfA?._categoryStatus || null;
          const pfCategoryIsVisible = pfB?._categoryIsVisible ?? pfA?._categoryIsVisible ?? null;
          const pfMarketTradingStatus = pfB?._predictfunRaw?.tradingStatus || pfA?._predictfunRaw?.tradingStatus || null;
          const pfMarketResolution = pfB?._predictfunRaw?.resolution ?? pfA?._predictfunRaw?.resolution ?? null;
          const pfMarketIsVisible = pfB?._predictfunRaw?.isVisible ?? pfA?._predictfunRaw?.isVisible ?? null;

          let opinionVolume24h = Number(pair.opinionVolume ?? 0);
          if (!opinionVolume24h && pair.opinionMarketId && (pA === "opinion" || pB === "opinion")) {
            try {
              const mkt = await getOpinionMarketSmart(pair.opinionMarketId);
              const d = mkt?.result?.data;
              opinionVolume24h = Number(d?.volume24h ?? d?.vol24h ?? 0);
            } catch (err) {
              console.warn("[ArbEngine] Lazy volume fetch failed:", err?.message || err);
            }
          }

          // Resolve sideA volume — platform-aware
          let sideAVolume = opinionVolume24h;
          if (!sideAVolume && pA === "polymarket") {
            sideAVolume = Number(pair._polyMarketA?.volume24hr ?? pair._polyMarketA?.volume24h ?? 0);
          }
          if (!sideAVolume && pA === "probable") {
            sideAVolume = Number(pair._probableMarketA?.volume24hr ?? pair._probableMarketA?.volume24h ?? 0);
          }
          if (!sideAVolume && pA === "predictfun") {
            sideAVolume = Number(pair._predictfunMarketA?.volume24h ?? pair._predictfunMarketA?.volume24hr ?? 0);
          }

          // Resolve sideB volume — volume24hr is real 24h for all platforms
          const sideBVolume = Number(pair.polyMarket?.volume24hr ?? pair.polyMarket?.volume24h ?? 0);

          // Title: prefer Probable display title (eventTitle - groupItemTitle) when available
          const probTitle = pair._probableMarketB?.title || pair._probableMarketA?.title || null;

          return {
            id: pairId,
            opinionMarketId: pair.opinionMarketId,
            title: probTitle || pair.opinionTitle || pair.polyTitle || "—",
            parentTitle: pair.opinionParentTitle || null,
            outcome: pair.opinionTitle || null,
            imageUrl: pair._opinionImageUrl || pair._polyMarketA?.image || pair._polyEventA?.image || pair._probableMarketA?.image || pair._probableMarketB?.image || pair.polyMarket?.image || pair._predictfunMarketB?._imageUrl || pair._predictfunMarketA?._imageUrl || null,
            endDate,
            startDate,
            pfCategoryMarketVariant,
            pfCategoryStatus,
            pfCategoryIsVisible,
            pfMarketTradingStatus,
            pfMarketResolution,
            pfMarketIsVisible,
            platformA: pA,
            platformB: pB,
            sideA: { title: sideATitle, url: sideAUrl, platform: pA },
            sideB: { title: sideBTitle, url: sideBUrl, platform: pB },
            poly: { title: sideBTitle, url: sideBUrl },
            opinion: { title: sideATitle, url: sideAUrl },
            strategy: best.strategy,
            strategyMode: best.strategyMode || (normalizedPriceMode === "asks" ? "buy" : "sell"),
            prices: best.prices,
            sizes: { polyYes: bYesSize ?? 0, polyNo: bNoSize ?? 0, opYes: aYesSize ?? 0, opNo: aNoSize ?? 0 },
            polyStats: {
              volume: sideBVolume,
              liquidity: bLiquidity,
            },
            opinionStats: {
              volume: sideAVolume,
              liquidity: aLiquidity,
            },
            tokenIds: { polyYes: String(bYesTid), polyNo: String(bNoTid), opYes: String(aYesTid), opNo: String(aNoTid) },
            arbPct,
            evPerShareUsd: profitResult?.evPerShareUsd ?? null,
            maxShares: profitResult?.maxShares ?? 0,
            maxProfitUsd: profitResult?.maxProfitUsd ?? 0,
            evCalcMode: profitResult?.evCalcMode ?? null,
            similarity: pair.similarity,
            isWhitelisted: pair.isWhitelisted || false,
            autoMatched: true,
            priceMode: normalizedPriceMode,
            label: normalizedPriceMode === "asks" ? "Asks" : "Bids",
            marchMadnessPair: Boolean(pair._marchMadnessPair),
            probableMarketId: (pA === "probable" || pB === "probable")
              ? String(pair._probableMarketB?._marketId || pair._probableMarketA?._marketId || "")
              : null,
            probableIsBoosted: (pA === "probable" || pB === "probable")
              ? Boolean(pair._probableMarketB?._isBoosted || pair._probableMarketA?._isBoosted)
              : false,
            probableMultiplier: (pA === "probable" || pB === "probable")
              ? Number(pair._probableMarketB?._multiplier || pair._probableMarketA?._multiplier || 1)
              : null,
            predictfunIsBoosted: (pA === "predictfun" || pB === "predictfun")
              ? Boolean(
                  pair._predictfunMarketA?._predictfunRaw?.isBoosted ||
                  pair._predictfunMarketB?._predictfunRaw?.isBoosted
                )
              : false,
            predictfunBoostStartsAt: (pA === "predictfun" || pB === "predictfun")
              ? (pair._predictfunMarketA?._predictfunRaw?.boostStartsAt ||
                 pair._predictfunMarketB?._predictfunRaw?.boostStartsAt || null)
              : null,
            predictfunBoostEndsAt: (pA === "predictfun" || pB === "predictfun")
              ? (pair._predictfunMarketA?._predictfunRaw?.boostEndsAt ||
                 pair._predictfunMarketB?._predictfunRaw?.boostEndsAt || null)
              : null,
          };
        } catch (e) {
          debug.push({ pairId, step: "exception", msg: String(e?.message || e) });
          return null;
        }
      }, 6)
    );

    const rows = (await Promise.all(jobs)).filter(Boolean);
    const pricingMs = Date.now() - pricingStartTs;
    console.log(`[AUTO-SCAN][Timing] price_and_compute: ${pricingMs}ms`);
    debug.push({ step: "timing_price_and_compute_ms", ms: pricingMs });
    rows.sort((a, b) => (b.arbPct ?? 0) - (a.arbPct ?? 0));

    const totalMs = Date.now() - scanStartTs;
    console.log(`[AUTO-SCAN][Timing] total_scan: ${totalMs}ms`);
    debug.push({ step: "timing_total_scan_ms", ms: totalMs });
    return { rows: rows.slice(0, limit), debug };
  } catch (e) {
    debug.push({ step: "fatal_error", msg: String(e?.message || e) });
    return { rows: [], debug };
  }
}

// Backward-compat alias for spelling variants (avoid future import pain)
export const computeArbitrageOpportunities = computeArbitageOpportunities;

/**
 * Stream arbitrage opportunities progressively via callbacks
 * Uses a concurrent WORKER POOL pattern for maximum throughput.
 * Each worker pulls pairs from a shared queue and streams results immediately.
 * 
 * Performance notes:
 * - Worker pool (25 concurrent) vs old batch-15-and-wait pattern
 * - Unified Opinion orderbook fetch (single call for both bid+ask, 15s cache)
 * - Poly orderbook cached 15s to deduplicate
 * - Probable orderbook fetched via REST API
 * - Lazy volume24h fetch (only for arb matches, not all 800 pairs)
 * - Rate limiters: Poly 20 req/s, Opinion 100 req/s
 * 
 * @param {Object} options
 * @param {number} options.minArbPct - Minimum arbitrage percentage
 * @param {number} options.minSimilarity - Minimum similarity for matching
 * @param {number} options.limit - Max results
 * @param {string} options.priceMode - "bids" or "asks"
 * @param {string} options.scanMode - "quick" (90 markets) or "full" (unlimited)
 * @param {string} options.platformA - "opinion", "polymarket", or "probable"
 * @param {string} options.platformB - "opinion", "polymarket", or "probable"
 * @param {Function} options.onProgress - Called with progress updates
 * @param {Function} options.onMatch - Called for each match found
 * @param {Function} options.onBatch - Called with batch of matches
 */
export async function streamArbitageOpportunities({
  minArbPct = 0.1,
  minSimilarity = 0.9,
  limit = 80,
  priceMode = "asks",
  scanMode = "quick",
  platformA = "polymarket",
  platformB = "opinion",
  predictFunEvent = null,
  signal = null, // AbortSignal – stop early when client disconnects
  onProgress = () => {},
  onMatch = () => {},
  onBatch = () => {},
} = {}) {
  const normalizedPriceMode = priceMode === "bids" ? "bids" : "asks";
  const useAsks = normalizedPriceMode === "asks";
  const results = [];
  const streamStartTs = Date.now();
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 80;
  const isFullScan = scanMode === "full";
  const isMedScan = scanMode === "med";
  const resultLimit = isFullScan ? Number.POSITIVE_INFINITY : safeLimit;
  const hasProbable = platformA === "probable" || platformB === "probable";
  const hasPredictFun = platformA === "predictfun" || platformB === "predictfun";
  const useMultiPlatform = hasProbable || hasPredictFun;
  const predictFunEventKey = normalizePredictFunEventKey(predictFunEvent);
  const isPolyPredictFun =
    (platformA === "polymarket" && platformB === "predictfun") ||
    (platformA === "predictfun" && platformB === "polymarket");
  const allowNegativeArb = (predictFunEventKey === "march-madness" || predictFunEventKey === "live") && isPolyPredictFun;

  // Determine platform labels/tags for display
  const platformLabelMap = { opinion: "Opinion", polymarket: "Poly", probable: "Probable", predictfun: "PredictFun" };
  const tagA = platformLabelMap[platformA] || platformA;
  const tagB = platformLabelMap[platformB] || platformB;

  try {
    // Phase 1: Discover pairs
    const maxTotalMarkets = isFullScan ? 9999 : isMedScan ? 140 : 80;
    onProgress({ phase: "discovering", current: 0, total: 0, message: scanMode === "full" ? `Full scan - fetching ${platformA} & ${platformB} markets...` : `Scanning ${platformA} & ${platformB} markets...` });
    const discoverStartTs = Date.now();

    clearAutoMatchCache();
      const discoveryResult = useMultiPlatform
      ? await discoverMultiPlatformPairs({
        platformA,
        platformB,
        minSimilarity,
        maxTotalMarkets,
        predictFunEventFilter: predictFunEventKey,
        onProgress: (progress) => {
          onProgress({ phase: "discovering", ...progress });
        },
      })
      : await discoverArbitagePairs({ 
          minSimilarity,
          maxTotalMarkets,
          onProgress: (progress) => {
            onProgress({ phase: "discovering", ...progress });
          }
        });
    
    const pairs = Array.isArray(discoveryResult) ? discoveryResult : (discoveryResult?.pairs || []);
    const apiError = discoveryResult?.error;
    const platformBAvailable = discoveryResult?.polymarketAvailable !== false;
    const discoverMs = Date.now() - discoverStartTs;
    console.log(`[streamArbitageOpportunities][Timing] discover_pairs: ${discoverMs}ms`);
    
    if (!platformBAvailable || apiError === "POLYMARKET_UNAVAILABLE" || apiError === "PROBABLE_UNAVAILABLE" || apiError === "PREDICTFUN_UNAVAILABLE") {
      onProgress({ 
        phase: "error", 
        current: 0, 
        total: 0, 
        message: `Cannot connect to ${platformB} API`,
        error: apiError || "PLATFORM_UNAVAILABLE",
        errorMessage: discoveryResult?.errorMessage || `Cannot connect. Please try again later.`,
      });
      return { 
        rows: [], 
        total: 0, 
        error: apiError || "PLATFORM_UNAVAILABLE",
        errorMessage: discoveryResult?.errorMessage,
      };
    }
    
    // Check abort after discovery (may have taken a long time)
    if (signal?.aborted) {
      return { rows: [], total: 0, error: "ABORTED" };
    }

    onProgress({ phase: "matching", current: 0, total: pairs.length, message: `Found ${pairs.length} potential pairs` });

    if (!pairs.length) {
      return { rows: [], total: 0 };
    }

    // Phase 2: Process pairs using concurrent WORKER POOL
    // This replaces the old batch-15-and-wait pattern for better throughput
    const WORKER_COUNT = 50;
    let processed = 0;
    let pairIndex = 0;
    const processingStartTs = Date.now();

    // Helper: get orderbook data for a token based on platform
    async function getOrderbookForPlatform(platform, tokenId) {
      if (platform === "opinion") return getOpinionOrderbookData(tokenId);
      if (platform === "probable") return getProbableOrderbookData(tokenId);
      if (platform === "predictfun") return getPredictFunSideOrderbook(tokenId);
      // polymarket — use getPolyOrderbooks (returns Map)
      const obMap = await getPolyOrderbooks([tokenId]);
      return obMap.get(tokenId) || null;
    }

    // Worker function: pulls pairs from shared queue, processes them, streams results
    async function worker() {
      while (pairIndex < pairs.length && results.length < resultLimit) {
        // Abort early if client disconnected
        if (signal?.aborted) break;

        const idx = pairIndex++;
        if (idx >= pairs.length) break;
        
        const pair = pairs[idx];
        try {
          // Determine this pair's actual platforms
          const pA = pair._platformA || platformA;
          const pB = pair._platformB || platformB;

          // --- Resolve token IDs for both sides ---
          let aYesTid, aNoTid, bYesTid, bNoTid;
          let aYesLabel = "YES", aNoLabel = "NO", bYesLabel = "YES", bNoLabel = "NO";

          if (pA === "opinion") {
            aYesTid = pair.opinionYesToken;
            aNoTid = pair.opinionNoToken;
            if (!aYesTid || !aNoTid) { processed++; continue; }
          } else if (pA === "polymarket") {
            const tk = getPolyTokenIds(pair._polyMarketA || pair.polyMarket);
            if (!tk) { processed++; continue; }
            aYesTid = String(tk.yesTokenId); aNoTid = String(tk.noTokenId);
            aYesLabel = tk.yesLabel || "YES"; aNoLabel = tk.noLabel || "NO";
          } else if (pA === "probable") {
            const tk = getProbableTokenIds(pair._probableMarketA);
            if (!tk) { processed++; continue; }
            aYesTid = String(tk.yesTokenId); aNoTid = String(tk.noTokenId);
            aYesLabel = tk.yesLabel || "YES"; aNoLabel = tk.noLabel || "NO";
          } else if (pA === "predictfun") {
            const tk = getPredictFunTokenIds(pair._predictfunMarketA);
            if (!tk) { processed++; continue; }
            aYesTid = String(tk.yesTokenId); aNoTid = String(tk.noTokenId);
          }

          if (pB === "polymarket") {
            const tk = getPolyTokenIds(pair.polyMarket);
            if (!tk) { processed++; continue; }
            bYesTid = String(tk.yesTokenId); bNoTid = String(tk.noTokenId);
            bYesLabel = tk.yesLabel || "YES"; bNoLabel = tk.noLabel || "NO";
          } else if (pB === "probable") {
            const tk = getProbableTokenIds(pair._probableMarketB);
            if (!tk) { processed++; continue; }
            bYesTid = String(tk.yesTokenId); bNoTid = String(tk.noTokenId);
            bYesLabel = tk.yesLabel || "YES"; bNoLabel = tk.noLabel || "NO";
          } else if (pB === "predictfun") {
            const tk = getPredictFunTokenIds(pair._predictfunMarketB);
            if (!tk) { processed++; continue; }
            bYesTid = String(tk.yesTokenId); bNoTid = String(tk.noTokenId);
          } else if (pB === "opinion") {
            bYesTid = pair.opinionYesToken;
            bNoTid = pair.opinionNoToken;
            if (!bYesTid || !bNoTid) { processed++; continue; }
          }

          if (!aYesTid || !aNoTid || !bYesTid || !bNoTid) { processed++; continue; }

          // --- Fetch orderbooks (special handling for Poly's batch API) ---
          let aYesOB, aNoOB, bYesOB, bNoOB;

          if (pA === "polymarket") {
            const [obMap, bY, bN] = await Promise.all([
              getPolyOrderbooks([aYesTid, aNoTid]),
              getOrderbookForPlatform(pB, bYesTid),
              getOrderbookForPlatform(pB, bNoTid),
            ]);
            aYesOB = obMap.get(aYesTid) || null;
            aNoOB = obMap.get(aNoTid) || null;
            bYesOB = bY; bNoOB = bN;
          } else if (pB === "polymarket") {
            const [aY, aN, obMap] = await Promise.all([
              getOrderbookForPlatform(pA, String(aYesTid)),
              getOrderbookForPlatform(pA, String(aNoTid)),
              getPolyOrderbooks([bYesTid, bNoTid]),
            ]);
            aYesOB = aY; aNoOB = aN;
            bYesOB = obMap.get(bYesTid) || null;
            bNoOB = obMap.get(bNoTid) || null;
          } else {
            const [aY, aN, bY, bN] = await Promise.all([
              getOrderbookForPlatform(pA, String(aYesTid)),
              getOrderbookForPlatform(pA, String(aNoTid)),
              getOrderbookForPlatform(pB, String(bYesTid)),
              getOrderbookForPlatform(pB, String(bNoTid)),
            ]);
            aYesOB = aY; aNoOB = aN; bYesOB = bY; bNoOB = bN;
          }

          // Extract prices based on priceMode
          const aYesPrice = useAsks ? aYesOB?.bestAsk : aYesOB?.bestBid;
          const aNoPrice  = useAsks ? aNoOB?.bestAsk  : aNoOB?.bestBid;
          const aYesSize  = useAsks ? aYesOB?.bestAskSize : aYesOB?.bestBidSize;
          const aNoSize   = useAsks ? aNoOB?.bestAskSize  : aNoOB?.bestBidSize;
          const aLiquidity = resolvePlatformLiquidity(pA, {
            yesOrderbook: aYesOB,
            noOrderbook: aNoOB,
            market:
              pA === "polymarket"
                ? (pair._polyMarketA || pair.polyMarket)
                : pA === "probable"
                  ? pair._probableMarketA
                  : pA === "predictfun"
                    ? pair._predictfunMarketA
                    : null,
            fallback: pair.opinionLiquidity,
          });

          const bYesPrice = useAsks ? bYesOB?.bestAsk : bYesOB?.bestBid;
          const bNoPrice  = useAsks ? bNoOB?.bestAsk  : bNoOB?.bestBid;
          const bYesSize  = useAsks ? bYesOB?.bestAskSize : bYesOB?.bestBidSize;
          const bNoSize   = useAsks ? bNoOB?.bestAskSize  : bNoOB?.bestBidSize;
          const bLiquidity = resolvePlatformLiquidity(pB, {
            yesOrderbook: bYesOB,
            noOrderbook: bNoOB,
            market:
              pB === "polymarket"
                ? pair.polyMarket
                : pB === "probable"
                  ? (pair._probableMarketB || pair.polyMarket)
                  : pB === "predictfun"
                    ? (pair._predictfunMarketB || pair.polyMarket)
                    : null,
            fallback: pair.opinionLiquidity,
          });

          if (!Number.isFinite(aYesPrice) || !Number.isFinite(aNoPrice)) { processed++; continue; }
          if (!Number.isFinite(bYesPrice) || !Number.isFinite(bNoPrice)) { processed++; continue; }

          // computeBinaryArb — op* = sideA, poly* = sideB (internal naming)
          const teamNames = parseOpinionTeamNames(pair.opinionTitle || pair.polyTitle || "");
          const best = computeBinaryArb({
            opYes: aYesPrice,
            opNo: aNoPrice,
            polyYes: bYesPrice,
            polyNo: bNoPrice,
            priceMode,
            labels: {
              polyYes: teamNames?.yes || bYesLabel,
              polyNo: teamNames?.no || bNoLabel,
              opYes: teamNames?.yes || aYesLabel,
              opNo: teamNames?.no || aNoLabel,
              polyTag: tagB,
              opTag: tagA,
            },
          });

          if (!best || !Number.isFinite(best.arb)) { processed++; continue; }

          const arbPct = best.arb * 100;
          const pairAllowsNegativeArb =
            allowNegativeArb ||
            Boolean(pair._marchMadnessPair) ||
            (isPolyPredictFun && isLivePredictFunPair(pair));
          if (!pairAllowsNegativeArb && arbPct < minArbPct) { processed++; continue; }

          // Compute executable profit via orderbook depth simulation
          const profitLabels = {
            polyYes: teamNames?.yes || bYesLabel, polyNo: teamNames?.no || bNoLabel,
            opYes: teamNames?.yes || aYesLabel, opNo: teamNames?.no || aNoLabel,
            polyTag: tagB, opTag: tagA,
          };
          const profitResult = computeArbProfit({
            best, aYesOB, aNoOB, bYesOB, bNoOB,
            priceMode: normalizedPriceMode, labels: profitLabels,
          });

          // ✅ ARB FOUND — build URLs per platform
          let sideAUrl, sideATitle, sideBUrl, sideBTitle;

          // Side A URL
          if (pA === "opinion") {
            sideAUrl = opinionUrl(pair.opinionMarketId);
            sideATitle = pair.opinionTitle || "Opinion";
          } else if (pA === "polymarket") {
            const pt = pair.polyTitle || pair._polyMarketA?.question || pair._polyMarketA?.title || "";
            sideAUrl = pair._polyEventA?.slug
              ? polyEventMarketUrl(pair._polyEventA.slug, pair._polyMarketA?.slug || pair.polyMarketSlug)
              : polyMarketUrlFromSlug(pair._polyMarketA?.slug || pair.polyMarketSlug, pt);
            sideATitle = pt || "Polymarket";
          } else if (pA === "probable") {
            sideAUrl = probableMarketUrl(pair._probableMarketA?._marketId || pair._probableMarketA?.id, pair._probableMarketA?._eventSlug || pair._probableMarketA?.slug);
            sideATitle = pair._probableMarketA?.title || pair._probableMarketA?.question || "Probable";
          } else if (pA === "predictfun") {
            sideAUrl = predictFunMarketUrl(pair._predictfunMarketA?._marketId || pair._predictfunMarketA?.id, pair._predictfunMarketA?._categorySlug);
            sideATitle = pair._predictfunMarketA?.title || pair._predictfunMarketA?.question || "Predict.fun";
          }

          // Side B URL
          if (pB === "polymarket") {
            const pt = pair.polyTitle || pair.polyMarket?.title || pair.polyMarket?.question || "";
            sideBUrl = pair.polyEventSlug
              ? polyEventMarketUrl(pair.polyEventSlug, pair.polyMarketSlug)
              : polyMarketUrlFromSlug(pair.polyMarketSlug, pt);
            sideBTitle = pt || "Polymarket";
          } else if (pB === "probable") {
            sideBUrl = probableMarketUrl(pair._probableMarketB?._marketId || pair._probableMarketB?.id, pair._probableMarketB?._eventSlug || pair._probableMarketB?.slug);
            sideBTitle = pair._probableMarketB?.title || pair._probableMarketB?.question || "Probable";
          } else if (pB === "predictfun") {
            sideBUrl = predictFunMarketUrl(pair._predictfunMarketB?._marketId || pair._predictfunMarketB?.id, pair._predictfunMarketB?._categorySlug);
            sideBTitle = pair._predictfunMarketB?.title || pair._predictfunMarketB?.question || "Predict.fun";
          } else if (pB === "opinion") {
            sideBUrl = opinionUrl(pair.opinionMarketId);
            sideBTitle = pair.opinionTitle || "Opinion";
          }

          const endDate = pair.polyMarket?.endDate || pair.polyMarket?.end_date_iso
            || pair._probableMarketB?.endDate || pair._probableMarketA?.endDate
            || pair._predictfunMarketB?.endDate || pair._predictfunMarketA?.endDate || null;
          const startDate = pair._predictfunMarketB?.startDate || pair._predictfunMarketA?.startDate || null;
          const pfCategoryMarketVariant = pair._predictfunMarketB?._categoryMarketVariant || pair._predictfunMarketB?.marketVariant || pair._predictfunMarketB?._predictfunRaw?.marketVariant || pair._predictfunMarketA?._categoryMarketVariant || pair._predictfunMarketA?.marketVariant || pair._predictfunMarketA?._predictfunRaw?.marketVariant || null;

          // Live detection fields (streaming path)
          const pfB = pair._predictfunMarketB;
          const pfA = pair._predictfunMarketA;
          const pfCategoryStatus = pfB?._categoryStatus || pfA?._categoryStatus || null;
          const pfCategoryIsVisible = pfB?._categoryIsVisible ?? pfA?._categoryIsVisible ?? null;
          const pfMarketTradingStatus = pfB?._predictfunRaw?.tradingStatus || pfA?._predictfunRaw?.tradingStatus || null;
          const pfMarketResolution = pfB?._predictfunRaw?.resolution ?? pfA?._predictfunRaw?.resolution ?? null;
          const pfMarketIsVisible = pfB?._predictfunRaw?.isVisible ?? pfA?._predictfunRaw?.isVisible ?? null;

          // Lazy volume fetch for opinion side
          let opinionVolume24h = Number(pair.opinionVolume ?? 0);
          if (!opinionVolume24h && pair.opinionMarketId && (pA === "opinion" || pB === "opinion")) {
            try {
              const mkt = await getOpinionMarketSmart(pair.opinionMarketId);
              const d = mkt?.result?.data;
              opinionVolume24h = Number(d?.volume24h ?? d?.vol24h ?? 0);
            } catch (err) {
              console.warn("[ArbEngine] Lazy volume fetch failed:", err?.message || err);
            }
          }

          // Resolve sideA volume — platform-aware
          let sideAVolume = opinionVolume24h;
          if (!sideAVolume && pA === "polymarket") {
            sideAVolume = Number(pair._polyMarketA?.volume24hr ?? pair._polyMarketA?.volume24h ?? 0);
          }
          if (!sideAVolume && pA === "probable") {
            sideAVolume = Number(pair._probableMarketA?.volume24hr ?? pair._probableMarketA?.volume24h ?? 0);
          }
          if (!sideAVolume && pA === "predictfun") {
            sideAVolume = Number(pair._predictfunMarketA?.volume24h ?? pair._predictfunMarketA?.volume24hr ?? 0);
          }

          // Resolve sideB volume — volume24hr is real 24h for all platforms
          const sideBVolume = Number(pair.polyMarket?.volume24hr ?? pair.polyMarket?.volume24h ?? 0);

          // Title: prefer Probable display title (eventTitle - groupItemTitle) when available
          const probTitle = pair._probableMarketB?.title || pair._probableMarketA?.title || null;

          const row = {
            id: pair.id,
            opinionMarketId: pair.opinionMarketId,
            title: probTitle || pair.opinionTitle || pair.polyTitle || "—",
            parentTitle: pair.opinionParentTitle || null,
            outcome: pair.opinionTitle || null,
            imageUrl: pair._opinionImageUrl || pair._polyMarketA?.image || pair._polyEventA?.image || pair._probableMarketA?.image || pair._probableMarketB?.image || pair.polyMarket?.image || pair._predictfunMarketB?._imageUrl || pair._predictfunMarketA?._imageUrl || null,
            endDate,
            startDate,
            pfCategoryMarketVariant,
            pfCategoryStatus,
            pfCategoryIsVisible,
            pfMarketTradingStatus,
            pfMarketResolution,
            pfMarketIsVisible,
            platformA: pA,
            platformB: pB,
            sideA: { title: sideATitle, url: sideAUrl, platform: pA },
            sideB: { title: sideBTitle, url: sideBUrl, platform: pB },
            // Legacy fields for backward-compatible UI rendering
            poly: { title: sideBTitle, url: sideBUrl },
            opinion: { title: sideATitle, url: sideAUrl },
            strategy: best.strategy,
            strategyMode: best.strategyMode || (normalizedPriceMode === "asks" ? "buy" : "sell"),
            prices: best.prices,
            sizes: {
              polyYes: bYesSize ?? 0,
              polyNo: bNoSize ?? 0,
              opYes: aYesSize ?? 0,
              opNo: aNoSize ?? 0,
            },
            polyStats: {
              volume: sideBVolume,
              liquidity: bLiquidity,
            },
            opinionStats: {
              volume: sideAVolume,
              liquidity: aLiquidity,
            },
            tokenIds: {
              polyYes: String(bYesTid),
              polyNo: String(bNoTid),
              opYes: String(aYesTid),
              opNo: String(aNoTid),
            },
            arbPct,
            evPerShareUsd: profitResult?.evPerShareUsd ?? null,
            maxShares: profitResult?.maxShares ?? 0,
            maxProfitUsd: profitResult?.maxProfitUsd ?? 0,
            evCalcMode: profitResult?.evCalcMode ?? null,
            similarity: pair.similarity,
            isWhitelisted: pair.isWhitelisted || false,
            autoMatched: true,
            priceMode: normalizedPriceMode,
            label: normalizedPriceMode === "asks" ? "Asks" : "Bids",
            marchMadnessPair: Boolean(pair._marchMadnessPair),
            probableMarketId: (pA === "probable" || pB === "probable")
              ? String(pair._probableMarketB?._marketId || pair._probableMarketA?._marketId || "")
              : null,
            probableIsBoosted: (pA === "probable" || pB === "probable")
              ? Boolean(pair._probableMarketB?._isBoosted || pair._probableMarketA?._isBoosted)
              : false,
            probableMultiplier: (pA === "probable" || pB === "probable")
              ? Number(pair._probableMarketB?._multiplier || pair._probableMarketA?._multiplier || 1)
              : null,
            predictfunIsBoosted: (pA === "predictfun" || pB === "predictfun")
              ? Boolean(
                  pair._predictfunMarketA?._predictfunRaw?.isBoosted ||
                  pair._predictfunMarketB?._predictfunRaw?.isBoosted
                )
              : false,
            predictfunBoostStartsAt: (pA === "predictfun" || pB === "predictfun")
              ? (pair._predictfunMarketA?._predictfunRaw?.boostStartsAt ||
                 pair._predictfunMarketB?._predictfunRaw?.boostStartsAt || null)
              : null,
            predictfunBoostEndsAt: (pA === "predictfun" || pB === "predictfun")
              ? (pair._predictfunMarketA?._predictfunRaw?.boostEndsAt ||
                 pair._predictfunMarketB?._predictfunRaw?.boostEndsAt || null)
              : null,
          };

          results.push(row);

          // Stream result immediately (no waiting for batch to finish)
          onMatch(row);
        } catch (err) {
          console.warn("[ArbEngine] Worker pair processing failed:", err?.message || err);
        }

        processed++;

        // Report progress every 10 pairs (avoid flooding SSE with 800 events)
        if (processed % 10 === 0 || processed === pairs.length) {
          onProgress({
            phase: "processing",
            current: processed,
            total: pairs.length,
            message: `Processing ${processed}/${pairs.length} pairs • ${results.length} opportunities found`
          });
        }
      }
    }

    // Launch N concurrent workers
    const workers = Array.from(
      { length: Math.min(WORKER_COUNT, pairs.length) },
      () => worker()
    );
    await Promise.all(workers);

    // Final progress
    const processingMs = Date.now() - processingStartTs;
    const elapsed = (processingMs / 1000).toFixed(1);
    console.log(`[streamArbitageOpportunities][Timing] process_pairs: ${processingMs}ms`);
    console.log(`[streamArbitageOpportunities][Timing] total_scan: ${Date.now() - streamStartTs}ms`);
    console.log(`[streamArbitageOpportunities] Done: ${results.length} matches from ${pairs.length} pairs in ${elapsed}s`);
    onProgress({
      phase: "processing",
      current: pairs.length,
      total: pairs.length,
      message: `Processed ${pairs.length}/${pairs.length} pairs, found ${results.length} opportunities`
    });

    // Sort and return final results
    results.sort((a, b) => (b.arbPct ?? 0) - (a.arbPct ?? 0));
    return {
      rows: Number.isFinite(resultLimit) ? results.slice(0, resultLimit) : results,
      total: results.length,
    };

  } catch (e) {
    console.error("[streamArbitageOpportunities] Error:", e);
    return { rows: results, total: results.length, error: e.message };
  }
}
