// lib/predictfun.js
// Predict.fun read-only API client for ODDScreeners arbitrage
// Docs: https://dev.predict.fun/ | https://docs.predict.fun/

import { predictFunRateLimiter } from "@/lib/concurrency";
import { buildPredictFunSideSnapshot, complementYesPrice } from "./utils/predictfunOrderbook.js";
import { appendPredictFunReferral } from "./utils/predictfunFee.js";
import { fetchPredictFunAllMatchEvents } from "./predictfunHiddenGraphql.js";

const BASE_URL = process.env.PREDICTFUN_BASE_URL || "https://api.predict.fun";
const API_KEY = process.env.PREDICTFUN_API_KEY || "";

/** ---------- fetch helper ---------- */

/**
 * Core fetch with x-api-key, timeout, retry/backoff
 * @param {string} path - API path (e.g. "/v1/markets")
 * @param {Object} options
 * @param {Record<string,string>} options.params - Query params
 * @param {number} options.timeoutMs - Timeout in ms (default 15000)
 * @param {number} options.retries - Max retries (default 2)
 */
export async function predictFunFetch(path, { params = {}, timeoutMs = 15000, retries = 2 } = {}) {
  if (!API_KEY) {
    throw new Error("[PredictFun] PREDICTFUN_API_KEY is not set");
  }

  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(1000 * 2 ** (attempt - 1), 5000);
      console.warn(`[PredictFun] Retry ${attempt}/${retries} after ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }

    // Rate limit
    await predictFunRateLimiter.acquire();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "x-api-key": API_KEY,
          "Accept": "application/json",
        },
        signal: controller.signal,
        cache: "no-store",
      });

      clearTimeout(timer);

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after") || 2);
        console.warn(`[PredictFun] 429 rate limited, waiting ${retryAfter}s`);
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        lastErr = new Error("429 rate limited");
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (err.name === "AbortError") {
        lastErr = new Error(`Timeout after ${timeoutMs}ms`);
      }
    }
  }

  throw lastErr || new Error("[PredictFun] fetch failed");
}

/** ---------- liquidity helpers ---------- */

function computeTotalLiquidity(ob) {
  if (!ob) return 0;
  const bidQty = (ob.bids || []).reduce((sum, [, qty]) => sum + qty, 0);
  const askQty = (ob.asks || []).reduce((sum, [, qty]) => sum + qty, 0);
  return bidQty + askQty;
}

function computeNotional(levels) {
  if (!Array.isArray(levels)) return 0;
  return levels.reduce((sum, [price, qty]) => sum + price * qty, 0);
}

/** ---------- market meta cache ---------- */

const _marketMetaCache = new Map();        // marketId -> { decimalPrecision, fetchedAt }
const _marketCache = new Map();            // marketId -> { data, fetchedAt }
const MARKET_META_CACHE_TTL = 10 * 60 * 1000;
const MARKET_CACHE_TTL = 60 * 1000;

function normalizeDecimalPrecision(decimalPrecision, fallback = 2) {
  const parsed = Number(decimalPrecision);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return parsed;
}

function parseDecimalPrecision(decimalPrecision) {
  const parsed = Number(decimalPrecision);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function rememberPredictFunMarketMeta(market) {
  const marketId = market?.id ?? market?.marketId ?? market?._marketId;
  if (!marketId) return;

  const existing = _marketMetaCache.get(String(marketId));
  const parsedPrecision = parseDecimalPrecision(market?.decimalPrecision);

  _marketMetaCache.set(String(marketId), {
    decimalPrecision: parsedPrecision ?? existing?.decimalPrecision ?? null,
    fetchedAt: Date.now(),
  });
}

function getCachedPredictFunMarketMeta(marketId) {
  const cached = _marketMetaCache.get(String(marketId));
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt > MARKET_META_CACHE_TTL) {
    _marketMetaCache.delete(String(marketId));
    return null;
  }
  return cached;
}

function getCachedPredictFunMarket(marketId) {
  const cached = _marketCache.get(String(marketId));
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt > MARKET_CACHE_TTL) {
    _marketCache.delete(String(marketId));
    return null;
  }
  return cached.data;
}

function rememberPredictFunMarket(market) {
  const marketId = market?.id ?? market?.marketId ?? market?._marketId;
  if (!marketId || !market || typeof market !== "object") return;
  rememberPredictFunMarketMeta(market);
  _marketCache.set(String(marketId), {
    data: market,
    fetchedAt: Date.now(),
  });
}

export function primePredictFunMarketCache(market) {
  rememberPredictFunMarket(market);
}

/** ---------- category cache (for endDate) ---------- */

const _categoryCache = new Map();           // slug → { endsAt, fetchedAt }
const CATEGORY_CACHE_TTL = 10 * 60 * 1000;  // 10 min

/**
 * Fetch a Predict.fun category by slug (cached).
 * Returns { endsAt, startsAt, slug, imageUrl, ... } or null.
 */
export async function getPredictFunCategory(slug) {
  if (!slug) return null;
  const cached = _categoryCache.get(slug);
  if (cached && Date.now() - cached.fetchedAt < CATEGORY_CACHE_TTL) return cached.data;
  try {
    const res = await predictFunFetch(`/v1/categories/${encodeURIComponent(slug)}`);
    const data = res?.success ? res.data : null;
    _categoryCache.set(slug, { data, fetchedAt: Date.now() });
    return data;
  } catch (err) {
    console.warn(`[PredictFun] Category fetch failed for ${slug}:`, err?.message);
    _categoryCache.set(slug, { data: null, fetchedAt: Date.now() });
    return null;
  }
}

/**
 * Fetch a Predict.fun market detail by ID (cached for metadata such as decimalPrecision).
 */
export async function getPredictFunMarket(marketId) {
  if (!marketId) return null;

  const cachedMarket = getCachedPredictFunMarket(marketId);
  if (cachedMarket) {
    return cachedMarket;
  }

  try {
    const res = await predictFunFetch(`/v1/markets/${marketId}`);
    const data = res?.success ? res.data : null;
    if (data) rememberPredictFunMarket(data);
    return data;
  } catch (err) {
    console.warn(`[PredictFun] Market fetch failed for ${marketId}:`, err?.message);
    return null;
  }
}

async function resolvePredictFunDecimalPrecision(marketId, decimalPrecision = null) {
  if (Number.isInteger(decimalPrecision) && decimalPrecision >= 0) {
    return decimalPrecision;
  }

  const cached = getCachedPredictFunMarketMeta(marketId);
  if (cached?.decimalPrecision != null) {
    return cached.decimalPrecision;
  }

  const market = await getPredictFunMarket(marketId);
  return normalizeDecimalPrecision(market?.decimalPrecision, 2);
}

/** ---------- market fetching ---------- */

/**
 * Fetch all Predict.fun markets with cursor pagination.
 * Uses server-side status=OPEN filter and VOLUME_24H_DESC sort
 * so we only receive tradable markets, highest volume first.
 * Enriches each market with _categoryEndsAt from category endpoint.
 * @param {Object} options
 * @param {number} options.pageSize - Items per page (default 50)
 * @param {number} options.maxMarkets - Max markets to fetch (default 600)
 * @param {boolean} options.enrichCategoryEndDate - Fetch category endsAt for each market (default true)
 */
export async function fetchAllPredictFunMarkets({ pageSize = 100, maxMarkets = 600, enrichCategoryEndDate = true } = {}) {
  const allMarkets = [];
  let cursor = null;
  let pages = 0;
  const maxPages = Math.ceil(maxMarkets / pageSize) + 5; // safety margin

  try {
    do {
      const params = {
        first: String(pageSize),
        status: "OPEN",               // server-side filter: only open markets
        sort: "VOLUME_24H_DESC",      // highest volume first (best for arb)
        includeStats: "true",         // inline stats (volume24hUsd, totalLiquidityUsd)
      };
      if (cursor) params.after = cursor;

      const res = await predictFunFetch("/v1/markets", { params });

      if (!res?.success || !Array.isArray(res.data)) {
        console.warn("[PredictFun] Unexpected market list response:", res?.success);
        break;
      }

      for (const market of res.data) {
        // Safety net: double-check visibility & tradability client-side
        if (!market.isVisible) {
          continue;
        }
        if (market.tradingStatus !== "OPEN") {
          continue;
        }
        if (market.resolution != null) {
          continue;
        }

        rememberPredictFunMarket(market);
        allMarkets.push(market);
        if (allMarkets.length >= maxMarkets) break;
      }

      cursor = res.cursor || null;
      pages++;

      if (allMarkets.length >= maxMarkets) break;
      if (res.data.length < pageSize) break; // last page
    } while (cursor && pages < maxPages);

    console.log(`[PredictFun] Fetched ${allMarkets.length} markets in ${pages} pages`);

    if (enrichCategoryEndDate) {
      // Enrich with category endsAt (batch by unique slug, parallel with concurrency limit)
      const uniqueSlugs = [...new Set(allMarkets.map(m => m.categorySlug).filter(Boolean))];
      const slugToCategory = {};
      const BATCH = 25;
      for (let i = 0; i < uniqueSlugs.length; i += BATCH) {
        const batch = uniqueSlugs.slice(i, i + BATCH);
        const results = await Promise.allSettled(batch.map(s => getPredictFunCategory(s)));
        for (let j = 0; j < batch.length; j++) {
          const cat = results[j].status === "fulfilled" ? results[j].value : null;
          slugToCategory[batch[j]] = {
            endsAt: cat?.endsAt || null,
            title: cat?.title || cat?.name || null,
            imageUrl: cat?.imageUrl || null,
          };
        }
      }
      for (const m of allMarkets) {
        const catData = slugToCategory[m.categorySlug];
        m._categoryEndsAt = catData?.endsAt || null;
        m._categoryTitle = catData?.title || null;
        // Use category image as fallback if market has no image
        if (!m.imageUrl && catData?.imageUrl) {
          m.imageUrl = catData.imageUrl;
        }
      }
      if (uniqueSlugs.length) {
        const withEnd = allMarkets.filter(m => m._categoryEndsAt).length;
        console.log(`[PredictFun] Enriched endDate for ${withEnd}/${allMarkets.length} markets (${uniqueSlugs.length} categories)`);
      }
    }

    return allMarkets;
  } catch (err) {
    console.error("[PredictFun] fetchAllPredictFunMarkets failed:", err?.message || err);
    return allMarkets; // return whatever we got
  }
}

/** ---------- market detail endpoints ---------- */

/**
 * Fetch market stats (volume, liquidity)
 */
export async function getPredictFunStats(marketId) {
  try {
    const res = await predictFunFetch(`/v1/markets/${marketId}/stats`);
    return res?.success ? res.data : null;
  } catch (err) {
    console.error(`[PredictFun] Stats failed for ${marketId}:`, err?.message);
    return null;
  }
}

/**
 * Fetch market last sale
 */
export async function getPredictFunLastSale(marketId) {
  try {
    const res = await predictFunFetch(`/v1/markets/${marketId}/last-sale`);
    return res?.success ? res.data : null;
  } catch (err) {
    console.error(`[PredictFun] LastSale failed for ${marketId}:`, err?.message);
    return null;
  }
}

/**
 * Fetch market orderbook (YES-side prices)
 */
export async function getPredictFunOrderbook(marketId) {
  try {
    const res = await predictFunFetch(`/v1/markets/${marketId}/orderbook`);
    return res?.success ? res.data : null;
  } catch (err) {
    console.error(`[PredictFun] Orderbook failed for ${marketId}:`, err?.message);
    return null;
  }
}

/** ---------- orderbook cache ---------- */
const OB_CACHE = new Map();
const OB_CACHE_TTL = 15000; // 15 seconds

function obCacheGet(key) {
  const hit = OB_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) { OB_CACHE.delete(key); return null; }
  // LRU promotion
  OB_CACHE.delete(key);
  OB_CACHE.set(key, hit);
  return hit.val;
}
function obCacheSet(key, val) {
  OB_CACHE.delete(key);
  if (OB_CACHE.size > 500) {
    const lruKey = OB_CACHE.keys().next().value;
    OB_CACHE.delete(lruKey);
  }
  OB_CACHE.set(key, { val, exp: Date.now() + OB_CACHE_TTL });
}

/**
 * Get Predict.fun orderbook data with cache, normalized for arb engine.
 * Returns { bestYesBid, bestYesAsk, bestYesBidSize, bestYesAskSize,
 *           bestNoBuy, bestNoSell, totalLiquidity } or null.
 */
export async function getPredictFunOrderbookData(marketId, decimalPrecision = null) {
  const key = `pfOB:${marketId}`;
  const cached = obCacheGet(key);
  if (cached !== null) return cached;

  try {
    const ob = await getPredictFunOrderbook(marketId);
    if (!ob) {
      obCacheSet(key, null);
      return null;
    }

    const resolvedPrecision = await resolvePredictFunDecimalPrecision(marketId, decimalPrecision);
    const yesSide = buildPredictFunSideSnapshot(ob, { side: "yes", decimalPrecision: resolvedPrecision });
    const noSide = buildPredictFunSideSnapshot(ob, { side: "no", decimalPrecision: resolvedPrecision });

    const val = {
      decimalPrecision: resolvedPrecision,
      bestBid: yesSide.bestBid,
      bestAsk: yesSide.bestAsk,
      bestBidSize: yesSide.bestBidSize,
      bestAskSize: yesSide.bestAskSize,
      bestNoBuy: noSide.bestAsk,
      bestNoSell: noSide.bestBid,
      totalLiquidity: yesSide.totalLiquidity,
      orderbookUpdatedAtMs: ob?.updateTimestampMs ?? null,
      rawBids: yesSide.rawBids,
      rawAsks: yesSide.rawAsks,
      yes: yesSide,
      no: noSide,
    };

    obCacheSet(key, val);
    return val;
  } catch (err) {
    console.error("[PredictFun] getOrderbookData failed:", err?.message || err);
    obCacheSet(key, null);
    return null;
  }
}

/** ---------- normalize market ---------- */

/**
 * Normalize a Predict.fun market into ODDScreeners shape.
 * @param {Object} market - Raw market from /v1/markets
 * @param {Object} stats - Optional stats from /v1/markets/{id}/stats
 * @param {Object} lastSale - Optional last sale from /v1/markets/{id}/last-sale
 * @param {Object} orderbook - Optional orderbook from /v1/markets/{id}/orderbook
 */
export function normalizePredictFunMarket(market, { stats, lastSale, orderbook } = {}) {
  const dp = market.decimalPrecision ?? 2;
  rememberPredictFunMarketMeta(market);

  const yesSide = buildPredictFunSideSnapshot(orderbook, { side: "yes", decimalPrecision: dp });
  const noSide = buildPredictFunSideSnapshot(orderbook, { side: "no", decimalPrecision: dp });

  return {
    source: "predictfun",
    marketId: market.id,
    title: market.title ?? "",
    question: market.question ?? "",
    status: market.status ?? null,
    tradingStatus: market.tradingStatus ?? null,
    isVisible: market.isVisible ?? false,
    marketVariant: market.marketVariant ?? null,
    variantData: market.variantData ?? null,
    decimalPrecision: dp,
    feeRateBps: market.feeRateBps ?? null,
    categorySlug: market.categorySlug ?? null,
    questionIndex: market.questionIndex ?? null,
    isNegRisk: market.isNegRisk ?? false,
    conditionId: market.conditionId ?? null,
    oracleQuestionId: market.oracleQuestionId ?? null,
    resolverAddress: market.resolverAddress ?? null,
    resolution: market.resolution ?? null,
    polymarketConditionIds: market.polymarketConditionIds ?? [],
    kalshiMarketTicker: market.kalshiMarketTicker ?? null,
    imageUrl: market.imageUrl ?? null,
    // Stats
    volume24hUsd: stats?.volume24hUsd ?? null,
    volumeTotalUsd: stats?.volumeTotalUsd ?? null,
    totalLiquidityUsd: stats?.totalLiquidityUsd ?? null,
    // Orderbook
    bestYesBid: yesSide.bestBid,
    bestYesAsk: yesSide.bestAsk,
    bestYesBidSize: yesSide.bestBidSize,
    bestYesAskSize: yesSide.bestAskSize,
    bestNoBuy: noSide.bestAsk,
    bestNoSell: noSide.bestBid,
    totalOrderbookLiquidity: yesSide.totalLiquidity,
    bidNotional: yesSide.bidNotional,
    askNotional: yesSide.askNotional,
    // Last sale
    lastPrice: lastSale?.priceInCurrency != null ? Number(lastSale.priceInCurrency) : null,
    lastOutcome: lastSale?.outcome ?? null,
    // Timestamps
    orderbookUpdatedAtMs: orderbook?.updateTimestampMs ?? null,
    createdAtMs: market.createdAt ? new Date(market.createdAt).getTime() : null,
    // Raw for debugging
    raw: market,
  };
}

/**
 * Extract virtual YES/NO token IDs from a predict.fun market object.
 * Predict.fun uses a single marketId for both sides (YES orderbook only,
 * NO derived via complement math). We prefix with "pfyes:" and "pfno:"
 * so the engine can route to the correct handler.
 */
export function getPredictFunTokenIds(market) {
  if (!market) return null;
  rememberPredictFunMarketMeta(market);
  const marketId = market.id || market.marketId || market._marketId;
  if (!marketId) return null;
  return {
    yesTokenId: `pfyes:${marketId}`,
    noTokenId: `pfno:${marketId}`,
    marketId: String(marketId),
    yesLabel: null,
    noLabel: null,
  };
}

/**
 * Fetch predict.fun orderbook for a specific side (yes/no).
 * Since predict.fun has a single YES orderbook, the NO side is derived
 * via complement math. Results are cached via getPredictFunOrderbookData.
 * @param {string} prefixedTokenId - "pfyes:<marketId>" or "pfno:<marketId>"
 * @returns Normalized { bestBid, bestAsk, bestBidSize, bestAskSize, totalLiquidity, bidNotional, askNotional }
 */
export async function getPredictFunSideOrderbook(prefixedTokenId) {
  const isNo = prefixedTokenId.startsWith("pfno:");
  const marketId = prefixedTokenId.replace(/^pf(?:yes|no):/, "");
  if (!marketId) return null;

  const data = await getPredictFunOrderbookData(marketId);
  if (!data) return null;
  const side = isNo ? data.no : data.yes;

  return {
    bestBid: side.bestBid,
    bestAsk: side.bestAsk,
    bestBidSize: side.bestBidSize,
    bestAskSize: side.bestAskSize,
    totalLiquidity: side.totalLiquidity,
    bidNotional: side.bidNotional,
    askNotional: side.askNotional,
    bids: side.bids,
    asks: side.asks,
  };
}

/**
 * Fetch predict.fun full orderbook levels for a specific side (yes/no).
 * Used by the arbitrage orderbook panel so UI and engine share the same math.
 */
export async function getPredictFunDisplayOrderbook(prefixedTokenId) {
  const isNo = prefixedTokenId.startsWith("pfno:");
  const marketId = prefixedTokenId.replace(/^pf(?:yes|no):/, "");
  if (!marketId) return null;

  const data = await getPredictFunOrderbookData(marketId);
  if (!data) return null;

  const side = isNo ? data.no : data.yes;
  return {
    bids: side.bids,
    asks: side.asks,
    totalLiquidity: side.totalLiquidity,
    decimalPrecision: data.decimalPrecision,
  };
}

/**
 * Build a Predict.fun market URL.
 * Uses categorySlug (the event/category slug) which is required for correct URLs.
 * Example: https://predict.fun/market/fed-decision-in-march-2026
 * Fallback to numeric ID if slug is unavailable.
 * @param {string|number} marketIdOrSlug - categorySlug preferred, numeric ID as fallback
 * @param {string} [categorySlug] - explicit categorySlug override
 */
export function predictFunMarketUrl(marketIdOrSlug, categorySlug) {
  const slug = categorySlug || marketIdOrSlug;
  return appendPredictFunReferral(`https://predict.fun/market/${slug}`);
}

/** ---------- price history via order matches ---------- */

const MATCHES_CACHE = new Map();
const MATCHES_CACHE_TTL = 60_000; // 1 minute

function normalizeHistoryLimit(limit, fallback = 50) {
  const parsed = Math.round(Number(limit) || fallback);
  return Math.min(5000, Math.max(10, parsed));
}

function parsePredictFunPrice01(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return null;
  return raw > 1 ? raw / 1e18 : raw;
}

function normalizeOutcomeKey(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "YES" || normalized === "NO") return normalized;
  return null;
}

function extractMatchOutcomeKey(match) {
  return (
    normalizeOutcomeKey(match?.outcome?.name) ||
    normalizeOutcomeKey(match?.taker?.outcome?.name) ||
    normalizeOutcomeKey(match?.makers?.[0]?.outcome?.name) ||
    null
  );
}

function extractMatchTimestampMs(match) {
  const rawTimestamp =
    match?.timestamp ??
    match?.executedAt ??
    match?.createdAt ??
    null;
  if (!rawTimestamp) return null;

  const ms = new Date(rawTimestamp).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function mapMatchToYesHistoryPoint(match, decimalPrecision) {
  const outcomePrice = parsePredictFunPrice01(
    match?.priceExecuted ??
    match?.taker?.price ??
    match?.makers?.[0]?.price
  );
  const timestampMs = extractMatchTimestampMs(match);
  if (!Number.isFinite(outcomePrice) || !Number.isFinite(timestampMs)) return null;
  if (outcomePrice <= 0 || outcomePrice > 1) return null;

  const outcomeKey = extractMatchOutcomeKey(match);
  const yesPrice = outcomeKey === "NO"
    ? complementYesPrice(outcomePrice, decimalPrecision)
    : outcomePrice;

  if (!Number.isFinite(yesPrice) || yesPrice <= 0 || yesPrice > 1) return null;

  return {
    p: yesPrice,
    t: timestampMs,
  };
}

/**
 * Fetch order matches for a market to build price history.
 * Returns array of { p, t } where p = YES price (0..1) and t = timestamp ms.
 * Sorted oldest first (ascending time).
 */
export async function getPredictFunPriceHistory(marketId, { limit = 50 } = {}) {
  const safeLimit = normalizeHistoryLimit(limit, 50);
  const key = `pfMatches:${marketId}:${safeLimit}`;
  const cached = MATCHES_CACHE.get(key);
  if (cached && Date.now() - cached.fetchedAt < MATCHES_CACHE_TTL) return cached.data;

  try {
    const decimalPrecision = await resolvePredictFunDecimalPrecision(marketId, null);
    let allMatches = [];

    try {
      const edges = await fetchPredictFunAllMatchEvents({
        marketId,
        maxEvents: safeLimit,
        pageSize: Math.min(100, safeLimit),
      });
      allMatches = edges
        .map((edge) => edge?.node)
        .filter(Boolean);
    } catch (err) {
      console.warn(`[PredictFun] PriceHistory GraphQL failed for ${marketId}:`, err?.message);
    }

    if (!allMatches.length) {
      let after = null;
      const MAX_PAGE_SIZE = 200;

      for (let page = 0; page < 30; page += 1) {
        const remaining = safeLimit - allMatches.length;
        if (remaining <= 0) break;

        const first = Math.min(MAX_PAGE_SIZE, remaining);
        const res = await predictFunFetch("/v1/orders/matches", {
          params: {
            marketId: String(marketId),
            first: String(first),
            ...(after ? { after: String(after) } : {}),
          },
        });

        if (!res?.success || !Array.isArray(res.data) || res.data.length === 0) {
          break;
        }

        allMatches.push(...res.data);
        after = res?.cursor || null;
        if (!after || res.data.length < first) break;
      }
    }

    if (!allMatches.length) {
      MATCHES_CACHE.set(key, { data: [], fetchedAt: Date.now() });
      return [];
    }

    const points = allMatches
      .map((match) => mapMatchToYesHistoryPoint(match, decimalPrecision))
      .filter(Boolean)
      .sort((a, b) => a.t - b.t);

    // Keep latest point for duplicate timestamps to avoid vertical jitter artifacts.
    const dedupedPoints = [];
    for (const point of points) {
      const last = dedupedPoints[dedupedPoints.length - 1];
      if (last && last.t === point.t) {
        dedupedPoints[dedupedPoints.length - 1] = point;
        continue;
      }
      dedupedPoints.push(point);
    }

    MATCHES_CACHE.set(key, { data: dedupedPoints, fetchedAt: Date.now() });

    // Prune cache
    if (MATCHES_CACHE.size > 500) {
      const oldest = MATCHES_CACHE.keys().next().value;
      MATCHES_CACHE.delete(oldest);
    }

    return dedupedPoints;
  } catch (err) {
    console.error(`[PredictFun] PriceHistory failed for ${marketId}:`, err?.message);
    MATCHES_CACHE.set(key, { data: [], fetchedAt: Date.now() });
    return [];
  }
}
