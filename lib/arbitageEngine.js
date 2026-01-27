// lib/arbitageEngine.js
// Alpha logic: compare BEST BID or BEST ASK from both venues.
// Supports:
// - binary: Opinion marketId + Polymarket market slug
// - event_outcome (categorical outcome-specific): Opinion child marketId + Polymarket event slug + match text
// - auto-matched pairs from arbitageAutoMatcher.js

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
} from "@/lib/polymarket";
import { discoverArbitagePairs, getPolyTokenIds, clearAutoMatchCache } from "@/lib/arbitageAutoMatcher";

/** ---------------- small cache (server) ---------------- */
const CACHE = new Map();
function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    CACHE.delete(key);
    return null;
  }
  return hit.val;
}
function cacheSet(key, val, ttlMs = 8000) {
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

async function getOpinionBestBid(tokenId) {
  const key = `opBid:${tokenId}`;
  const cached = cacheGet(key);
  if (cached !== null) return cached;

  try {
    const ob = await opinionFetch(`/token/orderbook`, { params: { token_id: tokenId } });
    const { bids } = normalizeOpinionOrderbook(ob);
    const best = bids?.[0]?.price;
    const bestSize = bids?.[0]?.shares ?? 0;
    const val = Number.isFinite(best) ? { price: best, size: bestSize } : null;
    cacheSet(key, val, 6000);
    return val;
  } catch {
    cacheSet(key, null, 3000);
    return null;
  }
}

async function getOpinionBestAsk(tokenId) {
  const key = `opAsk:${tokenId}`;
  const cached = cacheGet(key);
  if (cached !== null) return cached;

  try {
    const ob = await opinionFetch(`/token/orderbook`, { params: { token_id: tokenId } });
    const { asks } = normalizeOpinionOrderbook(ob);
    const best = asks?.[0]?.price;
    const bestSize = asks?.[0]?.shares ?? 0;
    const val = Number.isFinite(best) ? { price: best, size: bestSize } : null;
    cacheSet(key, val, 6000);
    return val;
  } catch {
    cacheSet(key, null, 3000);
    return null;
  }
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

async function readPairs() {
  const file = path.join(process.cwd(), "data", "arbitagePairs.json");
  const raw = await fs.readFile(file, "utf8");
  const json = JSON.parse(raw);
  return Array.isArray(json) ? json : [];
}

/**
 * Best BID only alpha:
 * Direction A: Buy YES (Poly) + Buy NO (Opinion) => cost = polyYes + opNo
 * Direction B: Buy NO (Poly)  + Buy YES (Opinion) => cost = polyNo + opYes
 * 
 * All prices should be normalized to decimal (0-1) before passing here.
 * E.g., 97.5¢ = 0.975, 98.6¢ = 0.986
 * Arb exists when cost < 1 (i.e., polyYes + opNo < 1 or polyNo + opYes < 1)
 */
function computeBinaryArb({ opYes, opNo, polyYes, polyNo }) {
  const dirs = [];

  // Always include all prices for display
  const allPrices = {
    polyYes: decimalToCents(polyYes),
    polyNo: decimalToCents(polyNo),
    opYes: decimalToCents(opYes),
    opNo: decimalToCents(opNo),
  };

  // Direction A: Buy YES on Poly + Buy NO on Opinion
  if (Number.isFinite(polyYes) && Number.isFinite(opNo)) {
    const cost = polyYes + opNo;
    const arb = 1 - cost; // positive arb means profit
    dirs.push({
      cost,
      arb,
      strategy: ["Buy YES (Poly)", "Buy NO (Opinion)"],
      prices: allPrices,
    });
  }
  
  // Direction B: Buy NO on Poly + Buy YES on Opinion
  if (Number.isFinite(polyNo) && Number.isFinite(opYes)) {
    const cost = polyNo + opYes;
    const arb = 1 - cost;
    dirs.push({
      cost,
      arb,
      strategy: ["Buy NO (Poly)", "Buy YES (Opinion)"],
      prices: allPrices,
    });
  }

  dirs.sort((a, b) => b.arb - a.arb);
  return dirs[0] || null;
}

/** ---------------- main compute ---------------- */

export async function computeArbitageOpportunities({ minArbPct = 0.1, limit = 50 } = {}) {
  const pairs = await readPairs();
  const debug = [];
  if (!pairs.length) return { rows: [], debug: [{ step: "no_pairs" }] };

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
        let polyUrl = "https://polymarket.com";

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
          polyUrl = polyEventUrlFromSlug(polyEventSlug);
        } else {
          debug.push({ pairId, step: "skip_unknown_type", type });
          return null;
        }

        // ---------- fetch BEST BIDs ----------
        const [opYesBid, opNoBid, polyBids] = await Promise.all([
          getOpinionBestBid(String(opYesToken)),
          getOpinionBestBid(String(opNoToken)),
          getPolyBestBids([String(polyYesTid), String(polyNoTid)]),
        ]);

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
          title,
          imageUrl,
          poly: { title: "Polymarket", url: polyUrl },
          opinion: { title: "Opinion", url: opinionUrl(opinionMarketId) },
          strategy: best.strategy,
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
 */
export async function scanArbitageOpportunities({ minArbPct = 0.1, minSimilarity = 0.9, limit = 50, priceMode = "bids" } = {}) {
  const debug = [];
  const useAsks = priceMode === "asks";

  try {
    // Clear cache to force fresh data
    clearAutoMatchCache();
    
    // Step 1: Discover matching pairs between Opinion and Polymarket
    debug.push({ step: "discovering_pairs", minSimilarity, priceMode });
    console.log("[AUTO-SCAN] Discovering pairs with minSimilarity:", minSimilarity, "| priceMode:", priceMode);
    const pairs = await discoverArbitagePairs({ minSimilarity });
    debug.push({ step: "pairs_found", count: pairs.length });
    console.log("[AUTO-SCAN] Found", pairs.length, "pairs");

    // Log top 3 matches for debugging
    pairs.slice(0, 3).forEach((p, i) => {
      console.log(`  ${i + 1}. Opinion: "${p.opinionTitle}"`);
      console.log(`     Poly: "${p.polyTitle}" (similarity: ${(p.similarity * 100).toFixed(1)}%)`);
    });

    if (!pairs.length) {
      return { rows: [], debug: [...debug, { step: "no_pairs_found" }] };
    }

    // Step 2: For each pair, fetch orderbook and compute arb
    const jobs = pairs.map((pair) =>
      withConcurrency(async () => {
        const pairId = pair.id;

        try {
          // Get Opinion token IDs
          const opYesToken = pair.opinionYesToken;
          const opNoToken = pair.opinionNoToken;

          if (!opYesToken || !opNoToken) {
            debug.push({ pairId, step: "skip_missing_opinion_tokens" });
            return null;
          }

          // Get Polymarket token IDs from the matched market
          const polyTokens = getPolyTokenIds(pair.polyMarket);
          if (!polyTokens) {
            debug.push({ pairId, step: "skip_missing_poly_tokens" });
            return null;
          }

          const { yesTokenId: polyYesTid, noTokenId: polyNoTid } = polyTokens;

          // Fetch orderbooks (with sizes) based on mode
          let opYesData, opNoData, polyOrderbooks;
          
          if (useAsks) {
            // Asks mode: get best ask prices with sizes
            [opYesData, opNoData, polyOrderbooks] = await Promise.all([
              getOpinionBestAsk(String(opYesToken)),
              getOpinionBestAsk(String(opNoToken)),
              getPolyOrderbooks([String(polyYesTid), String(polyNoTid)]),
            ]);
          } else {
            // Bids mode: get best bid prices with sizes
            [opYesData, opNoData, polyOrderbooks] = await Promise.all([
              getOpinionBestBid(String(opYesToken)),
              getOpinionBestBid(String(opNoToken)),
              getPolyOrderbooks([String(polyYesTid), String(polyNoTid)]),
            ]);
          }

          // Extract prices and sizes
          const opYesPrice = opYesData?.price ?? null;
          const opNoPrice = opNoData?.price ?? null;
          const opYesSize = opYesData?.size ?? 0;
          const opNoSize = opNoData?.size ?? 0;
          
          const polyYesOb = polyOrderbooks.get(String(polyYesTid));
          const polyNoOb = polyOrderbooks.get(String(polyNoTid));
          
          const polyYesPrice = useAsks ? polyYesOb?.bestAsk : polyYesOb?.bestBid;
          const polyNoPrice = useAsks ? polyNoOb?.bestAsk : polyNoOb?.bestBid;
          const polyYesSize = useAsks ? polyYesOb?.bestAskSize : polyYesOb?.bestBidSize;
          const polyNoSize = useAsks ? polyNoOb?.bestAskSize : polyNoOb?.bestBidSize;

          if (!Number.isFinite(opYesPrice) || !Number.isFinite(opNoPrice)) {
            debug.push({ pairId, step: `fail_opinion_${priceMode}`, opYesPrice, opNoPrice });
            return null;
          }
          if (!Number.isFinite(polyYesPrice) || !Number.isFinite(polyNoPrice)) {
            debug.push({ pairId, step: `fail_poly_${priceMode}`, polyYesPrice, polyNoPrice });
            return null;
          }

          // Compute arbitrage
          const best = computeBinaryArb({
            opYes: opYesPrice,
            opNo: opNoPrice,
            polyYes: polyYesPrice,
            polyNo: polyNoPrice,
          });

          if (!best || !Number.isFinite(best.arb)) {
            debug.push({ pairId, step: "no_arb", best });
            return null;
          }

          const arbPct = best.arb * 100;
          if (arbPct < minArbPct) return null;

          // Build result row
          // Use polyEventSlug if available, fallback to polyMarketSlug, then generate from title
          const polyTitle = pair.polyTitle || pair.polyMarket?.title || pair.polyMarket?.question;
          const polyUrl = pair.polyEventSlug
            ? polyEventUrlFromSlug(pair.polyEventSlug, polyTitle)
            : polyMarketUrlFromSlug(pair.polyMarketSlug, polyTitle);

          // Get end date from polyMarket (Gamma API provides endDate or end_date_iso)
          const polyEndDate = pair.polyMarket?.endDate || pair.polyMarket?.end_date_iso || null;

          // Log URL for debugging
          console.log(`[AUTO-SCAN] Row: "${pair.opinionTitle}" -> polyUrl: ${polyUrl}`);

          return {
            id: pairId,
            title: pair.opinionTitle || pair.polyTitle || "—",
            parentTitle: pair.opinionParentTitle || null,
            outcome: pair.opinionTitle || null,
            imageUrl: pair.polyMarket?.image || null,
            endDate: polyEndDate,
            poly: {
              title: polyTitle || "Polymarket",
              url: polyUrl,
            },
            opinion: {
              title: pair.opinionTitle || "Opinion",
              url: opinionUrl(pair.opinionMarketId),
            },
            strategy: best.strategy,
            prices: best.prices,
            // Add size/shares info
            sizes: {
              polyYes: polyYesSize ?? 0,
              polyNo: polyNoSize ?? 0,
              opYes: opYesSize ?? 0,
              opNo: opNoSize ?? 0,
            },
            arbPct,
            similarity: pair.similarity,
            autoMatched: true,
            priceMode,
            label: priceMode === "asks" ? "Asks" : "Bids",
            // Debug info
            debug: {
              polyTokens,
              opTokens: { yes: opYesToken, no: opNoToken },
              rawPrices: {
                opYes: opYesPrice,
                opNo: opNoPrice,
                polyYes: polyYesPrice,
                polyNo: polyNoPrice,
              },
            },
          };
        } catch (e) {
          debug.push({ pairId, step: "exception", msg: String(e?.message || e) });
          return null;
        }
      }, 6)
    );

    const rows = (await Promise.all(jobs)).filter(Boolean);
    rows.sort((a, b) => (b.arbPct ?? 0) - (a.arbPct ?? 0));

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
 * This allows UI to show results as they come in
 * 
 * @param {Object} options
 * @param {number} options.minArbPct - Minimum arbitrage percentage
 * @param {number} options.minSimilarity - Minimum similarity for matching
 * @param {number} options.limit - Max results
 * @param {string} options.priceMode - "bids" or "asks"
 * @param {Function} options.onProgress - Called with progress updates
 * @param {Function} options.onMatch - Called for each match found
 * @param {Function} options.onBatch - Called with batch of matches
 */
export async function streamArbitageOpportunities({
  minArbPct = 0.1,
  minSimilarity = 0.9,
  limit = 100,
  priceMode = "bids",
  onProgress = () => {},
  onMatch = () => {},
  onBatch = () => {},
} = {}) {
  const useAsks = priceMode === "asks";
  const results = [];

  try {
    // Phase 1: Discover pairs
    onProgress({ phase: "discovering", current: 0, total: 0, message: "Scanning Opinion markets..." });
    
    clearAutoMatchCache();
    const pairs = await discoverArbitagePairs({ 
      minSimilarity,
      onProgress: (progress) => {
        onProgress({ phase: "discovering", ...progress });
      }
    });
    
    onProgress({ phase: "matching", current: 0, total: pairs.length, message: `Found ${pairs.length} potential pairs` });

    if (!pairs.length) {
      return { rows: [], total: 0 };
    }

    // Phase 2: Process pairs in batches and stream results
    const BATCH_SIZE = 15;
    let processed = 0;

    for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
      const batch = pairs.slice(i, i + BATCH_SIZE);
      
      const batchJobs = batch.map((pair) =>
        (async () => {
          try {
            const opYesToken = pair.opinionYesToken;
            const opNoToken = pair.opinionNoToken;
            if (!opYesToken || !opNoToken) return null;

            const polyTokens = getPolyTokenIds(pair.polyMarket);
            if (!polyTokens) return null;

            const { yesTokenId: polyYesTid, noTokenId: polyNoTid } = polyTokens;

            // Fetch orderbooks with sizes
            let opYesData, opNoData, polyOrderbooks;
            if (useAsks) {
              [opYesData, opNoData, polyOrderbooks] = await Promise.all([
                getOpinionBestAsk(String(opYesToken)),
                getOpinionBestAsk(String(opNoToken)),
                getPolyOrderbooks([String(polyYesTid), String(polyNoTid)]),
              ]);
            } else {
              [opYesData, opNoData, polyOrderbooks] = await Promise.all([
                getOpinionBestBid(String(opYesToken)),
                getOpinionBestBid(String(opNoToken)),
                getPolyOrderbooks([String(polyYesTid), String(polyNoTid)]),
              ]);
            }

            // Extract prices and sizes
            const opYesPrice = opYesData?.price ?? null;
            const opNoPrice = opNoData?.price ?? null;
            const opYesSize = opYesData?.size ?? 0;
            const opNoSize = opNoData?.size ?? 0;
            
            const polyYesOb = polyOrderbooks.get(String(polyYesTid));
            const polyNoOb = polyOrderbooks.get(String(polyNoTid));
            
            const polyYesPrice = useAsks ? polyYesOb?.bestAsk : polyYesOb?.bestBid;
            const polyNoPrice = useAsks ? polyNoOb?.bestAsk : polyNoOb?.bestBid;
            const polyYesSize = useAsks ? polyYesOb?.bestAskSize : polyYesOb?.bestBidSize;
            const polyNoSize = useAsks ? polyNoOb?.bestAskSize : polyNoOb?.bestBidSize;

            if (!Number.isFinite(opYesPrice) || !Number.isFinite(opNoPrice)) return null;
            if (!Number.isFinite(polyYesPrice) || !Number.isFinite(polyNoPrice)) return null;

            const best = computeBinaryArb({
              opYes: opYesPrice,
              opNo: opNoPrice,
              polyYes: polyYesPrice,
              polyNo: polyNoPrice,
            });

            if (!best || !Number.isFinite(best.arb)) return null;

            const arbPct = best.arb * 100;
            if (arbPct < minArbPct) return null;

            const polyTitle = pair.polyTitle || pair.polyMarket?.title || pair.polyMarket?.question;
            const polyUrl = pair.polyEventSlug
              ? polyEventUrlFromSlug(pair.polyEventSlug, polyTitle)
              : polyMarketUrlFromSlug(pair.polyMarketSlug, polyTitle);
            
            // Get end date from polyMarket
            const polyEndDate = pair.polyMarket?.endDate || pair.polyMarket?.end_date_iso || null;

            return {
              id: pair.id,
              title: pair.opinionTitle || pair.polyTitle || "—",
              parentTitle: pair.opinionParentTitle || null,
              outcome: pair.opinionTitle || null,
              imageUrl: pair.polyMarket?.image || null,
              endDate: polyEndDate,
              poly: { title: polyTitle || "Polymarket", url: polyUrl },
              opinion: { title: pair.opinionTitle || "Opinion", url: opinionUrl(pair.opinionMarketId) },
              strategy: best.strategy,
              prices: best.prices,
              sizes: {
                polyYes: polyYesSize ?? 0,
                polyNo: polyNoSize ?? 0,
                opYes: opYesSize ?? 0,
                opNo: opNoSize ?? 0,
              },
              arbPct,
              similarity: pair.similarity,
              autoMatched: true,
              priceMode,
              label: priceMode === "asks" ? "Asks" : "Bids",
            };
          } catch {
            return null;
          }
        })()
      );

      const batchResults = (await Promise.all(batchJobs)).filter(Boolean);
      processed += batch.length;

      // Stream this batch
      if (batchResults.length > 0) {
        results.push(...batchResults);
        onBatch({ rows: batchResults, total: results.length });
        
        // Also send individual matches for real-time updates
        batchResults.forEach(match => onMatch(match));
      }

      onProgress({
        phase: "processing",
        current: processed,
        total: pairs.length,
        message: `Processed ${processed}/${pairs.length} pairs, found ${results.length} opportunities`
      });

      // Stop if we have enough results
      if (results.length >= limit) break;
    }

    // Sort and return final results
    results.sort((a, b) => (b.arbPct ?? 0) - (a.arbPct ?? 0));
    return { rows: results.slice(0, limit), total: results.length };

  } catch (e) {
    console.error("[streamArbitageOpportunities] Error:", e);
    return { rows: results, total: results.length, error: e.message };
  }
}
