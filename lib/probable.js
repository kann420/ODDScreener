// lib/probable.js
// Probable market data fetcher for arbitrage integration
// Public endpoints — no API key required
// Docs: https://developer.probable.markets/api/market-public/overview

const MARKET_API_BASE = "https://market-api.probable.markets";
const ORDERBOOK_API_BASE = "https://api.probable.markets";

/** ---- small cache ---- */
const CACHE = new Map();
const CACHE_TTL = 120000; // 2 minutes (server-side caching is ~3min)

function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) { CACHE.delete(key); return null; }
  return hit.val;
}
function cacheSet(key, val, ttl = CACHE_TTL) {
  CACHE.set(key, { val, exp: Date.now() + ttl });
}
export function clearProbableCache() {
  CACHE.clear();
  console.log("[Probable] Cache cleared");
}

/** ---- fetch helpers ---- */
async function fetchJson(url, opts = {}) {
  const { timeoutMs = 20000, retries = 2 } = opts;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(t);
      if (!res.ok) {
        console.warn(`[Probable] HTTP ${res.status} for ${url.substring(0, 80)}`);
        return null;
      }
      return await res.json();
    } catch (err) {
      clearTimeout(t);
      if (attempt === retries) {
        console.error(`[Probable] fetch FAILED after ${retries + 1} attempts: ${err?.message || err}`);
      } else {
        console.warn(`[Probable] attempt ${attempt + 1} failed, retrying...`);
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  return null;
}

async function postJson(url, body, opts = {}) {
  const { timeoutMs = 25000, retries = 2 } = opts;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      clearTimeout(t);
      if (!res.ok) {
        console.warn(`[Probable] POST HTTP ${res.status} for ${url.substring(0, 80)}`);
        return null;
      }
      return await res.json();
    } catch (err) {
      clearTimeout(t);
      if (attempt === retries) {
        console.error(`[Probable] POST FAILED after ${retries + 1} attempts: ${err?.message || err}`);
      } else {
        console.warn(`[Probable] POST attempt ${attempt + 1} failed, retrying...`);
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  return null;
}

/** ---- Market listing (paginated) ---- */
async function fetchProbableMarketsPage({ page = 1, limit = 100, active = true } = {}) {
  const url = `${MARKET_API_BASE}/public/api/v1/markets/?page=${page}&limit=${limit}&active=${active}`;
  return fetchJson(url);
}

/**
 * Fetch all active Probable markets with pagination
 */
export async function fetchAllProbableMarkets({ active = true, limit = 100, maxPages = 50 } = {}) {
  const cacheKey = "probable:allMarkets";
  const cached = cacheGet(cacheKey);
  if (cached) {
    console.log(`[Probable] Using cached ${cached.length} markets`);
    return cached;
  }

  console.log(`[Probable] Fetching all active markets...`);
  const out = [];
  let page = 1;

  while (page <= maxPages) {
    const data = await fetchProbableMarketsPage({ page, limit, active });
    if (!data) break;

    // Handle various response shapes
    const markets = data?.markets || data?.data || data?.items || data?.results || [];
    if (!Array.isArray(markets) || markets.length === 0) {
      // If first page returns nothing, the response might be the array itself
      if (page === 1 && Array.isArray(data) && data.length > 0) {
        out.push(...data);
      }
      break;
    }
    out.push(...markets);

    // Check pagination
    const pagination = data?.pagination || data?.meta || {};
    const hasMore =
      pagination.hasMore === true ||
      pagination.has_more === true ||
      (typeof pagination.page === "number" && typeof pagination.totalPages === "number"
        ? pagination.page < pagination.totalPages
        : false) ||
      (typeof pagination.total === "number" ? out.length < pagination.total : false);

    if (!hasMore || markets.length < limit) break;
    page += 1;
  }

  console.log(`[Probable] Fetched ${out.length} markets across ${page} pages`);
  cacheSet(cacheKey, out, 180000); // 3 min
  return out;
}

/**
 * Normalize raw Probable markets into a consistent internal format
 */
export function normalizeProbableMarkets(rawMarkets) {
  const normalized = [];
  const now = Date.now();

  for (const m of rawMarkets) {
    const marketId = m?.id;
    const question = m?.question || m?.title || m?.name || "";
    const rawOutcomes = m?.outcomes;
    const outcomes = Array.isArray(rawOutcomes) ? rawOutcomes : 
                      (typeof rawOutcomes === "string" ? tryParseJson(rawOutcomes) : []);
    let clobTokenIds = Array.isArray(m?.clobTokenIds) ? m.clobTokenIds : 
                          (typeof m?.clobTokenIds === "string" ? tryParseJson(m.clobTokenIds) : []);

    // Fallback: use tokens[] array if clobTokenIds is empty
    const tokens = Array.isArray(m?.tokens) ? m.tokens : [];
    if (clobTokenIds.length === 0 && tokens.length > 0) {
      clobTokenIds = tokens.map(t => t?.token_id).filter(Boolean);
    }

    if (!marketId || !question || outcomes.length === 0 || clobTokenIds.length === 0) continue;

    if (outcomes.length !== clobTokenIds.length) {
      console.warn("[Probable] outcomes/tokenIds length mismatch", {
        marketId,
        question: question.substring(0, 60),
        outcomesLen: outcomes.length,
        tokenIdsLen: clobTokenIds.length,
      });
      continue; // Skip mismatched markets
    }

    const mappedOutcomes = outcomes.map((name, i) => ({
      name: String(name),
      tokenId: String(clobTokenIds[i]),
    }));

    normalized.push({
      source: "probable",
      marketId: marketId,
      question: String(question),
      slug: m?.market_slug || m?.slug || m?.condition_id || null,
      eventId: m?.event_id || null,
      eventSlug: null,  // enriched later from events API
      eventTitle: null, // enriched later from events API
      groupItemTitle: m?.groupItemTitle || null,
      active: m?.active !== false,
      closed: Boolean(m?.closed),
      outcomes: mappedOutcomes,
      image: m?.image || m?.icon || m?.thumbnailUrl || null,
      endDate: m?.endDate || m?.end_date_iso || m?.endDateIso || null,
      volume24h: Number(m?.volume24hr ?? m?.volume24h ?? m?.volume ?? 0),
      liquidity: Number(m?.liquidity ?? m?.liquidityNum ?? 0),
      // Boosted points — enriched later from events API
      isBoosted: false,
      multiplier: 1,
      updatedAtMs: now,
    });
  }

  return normalized;
}

function tryParseJson(str) {
  try { return JSON.parse(str); } catch { return []; }
}

/** ---- Bulk price fetch (recommended) ---- */
export async function fetchProbableBulkPrices(tokenIds) {
  if (!tokenIds || tokenIds.length === 0) return {};

  const cacheKey = `probable:prices:${tokenIds.slice(0, 5).join(",")}:${tokenIds.length}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // Build POST body: BUY + SELL for each token
  const body = [];
  for (const tokenId of tokenIds) {
    body.push({ token_id: tokenId, side: "BUY" });
    body.push({ token_id: tokenId, side: "SELL" });
  }

  // Bulk pricing endpoint
  const url = `${ORDERBOOK_API_BASE}/public/api/v1/prices`;
  const data = await postJson(url, body);

  if (!data) {
    console.warn("[Probable] Bulk prices returned null");
    return {};
  }

  // Normalize response: { tokenId: { BUY: "0.xx", SELL: "0.yy" } }
  const priceMap = {};
  if (typeof data === "object" && !Array.isArray(data)) {
    // Response is already a map: { tokenId: { BUY: "...", SELL: "..." } }
    for (const [tokenId, prices] of Object.entries(data)) {
      priceMap[tokenId] = {
        BUY: prices?.BUY ?? prices?.buy ?? prices?.bid ?? null,
        SELL: prices?.SELL ?? prices?.sell ?? prices?.ask ?? null,
      };
    }
  } else if (Array.isArray(data)) {
    // If array of results per request item
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      const tokenId = item?.token_id || body[i]?.token_id;
      const side = item?.side || body[i]?.side;
      const price = item?.price ?? item?.best_price ?? null;
      if (!tokenId) continue;
      if (!priceMap[tokenId]) priceMap[tokenId] = {};
      priceMap[tokenId][side] = price;
    }
  }

  cacheSet(cacheKey, priceMap, 15000); // 15s for prices
  return priceMap;
}

/**
 * Fetch single token best price (fallback for individual fetches)
 */
export async function fetchProbableBestPrice(tokenId, side = "BUY") {
  const url = `${ORDERBOOK_API_BASE}/public/api/v1/price?token_id=${encodeURIComponent(tokenId)}&side=${side}`;
  const data = await fetchJson(url);
  if (!data) return null;
  const price = data?.price ?? data?.best_price ?? data?.result ?? null;
  if (price == null) return null;
  const num = Number(price);
  return Number.isFinite(num) ? num : null;
}

/**
 * Fetch full orderbook for a token (optional, for depth view)
 */
export async function fetchProbableOrderbook(tokenId) {
  const cacheKey = `probable:book:${tokenId}`;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached;

  const url = `${ORDERBOOK_API_BASE}/public/api/v1/book?token_id=${encodeURIComponent(tokenId)}`;
  const data = await fetchJson(url);
  if (!data) { cacheSet(cacheKey, null, 5000); return null; }

  const bids = (data?.bids || []).map(b => ({
    price: Number(b?.price ?? b?.p ?? 0),
    shares: Number(b?.size ?? b?.quantity ?? b?.qty ?? 0),
  })).filter(b => Number.isFinite(b.price)).sort((a, b) => b.price - a.price);

  const asks = (data?.asks || []).map(a => ({
    price: Number(a?.price ?? a?.p ?? 0),
    shares: Number(a?.size ?? a?.quantity ?? a?.qty ?? 0),
  })).filter(a => Number.isFinite(a.price)).sort((a, b) => a.price - b.price);

  const result = { bids, asks };
  cacheSet(cacheKey, result, 15000);
  return result;
}

/**
 * Attach bestBid / bestAsk prices into normalized market objects
 */
export function attachProbablePrices(markets, priceMap) {
  for (const m of markets) {
    for (const o of m.outcomes) {
      const row = priceMap?.[o.tokenId];
      if (!row) continue;
      const bid = row.BUY != null ? Number(row.BUY) : undefined;
      const ask = row.SELL != null ? Number(row.SELL) : undefined;
      if (bid != null && Number.isFinite(bid)) o.bestBid = bid;
      if (ask != null && Number.isFinite(ask)) o.bestAsk = ask;
    }
    m.updatedAtMs = Date.now();
  }
  return markets;
}

/**
 * Fetch all active Probable events with slugs and titles
 * Returns a Map: event_id → { slug, title }
 */
export async function fetchProbableEventsMap() {
  const cacheKey = "probable:eventsMap";
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const evMap = new Map();
  let page = 1;
  const maxPages = 20;

  while (page <= maxPages) {
    const url = `${MARKET_API_BASE}/public/api/v1/events/?page=${page}&limit=100&active=true`;
    const data = await fetchJson(url);
    if (!data) break;

    const events = Array.isArray(data) ? data : (data?.events || data?.data || data?.results || []);
    if (!Array.isArray(events) || events.length === 0) break;

    for (const ev of events) {
      if (ev?.id && ev?.slug) {
        evMap.set(String(ev.id), {
          slug: ev.slug,
          title: ev.title || ev.slug,
          isBoosted: Boolean(ev.isBoosted),
          multiplier: Number(ev.multiplier ?? 1),
        });
      }
    }

    if (events.length < 100) break;
    page++;
  }

  console.log(`[Probable] Fetched ${evMap.size} events across ${page} pages`);
  cacheSet(cacheKey, evMap, 180000); // 3 min
  return evMap;
}

/**
 * One-shot: Fetch all active Probable markets with prices
 * Also fetches events to enrich markets with eventSlug and eventTitle
 */
export async function fetchProbableMarketsWithPrices() {
  const [rawMarkets, eventsMap] = await Promise.all([
    fetchAllProbableMarkets({ active: true, limit: 100 }),
    fetchProbableEventsMap(),
  ]);
  const markets = normalizeProbableMarkets(rawMarkets);

  // Enrich markets with event slug, title, and boosted info
  for (const m of markets) {
    if (m.eventId) {
      const ev = eventsMap.get(String(m.eventId));
      if (ev) {
        m.eventSlug = ev.slug;
        m.eventTitle = ev.title;
        m.isBoosted = ev.isBoosted || false;
        m.multiplier = ev.multiplier || 1;
      }
    }
  }

  // Collect all tokenIds
  const tokenIds = [];
  for (const m of markets) {
    for (const o of m.outcomes) {
      tokenIds.push(o.tokenId);
    }
  }

  if (tokenIds.length === 0) return markets;

  // Bulk fetch prices (split into batches of 200 to avoid huge POST body)
  const BATCH_SIZE = 200;
  const fullPriceMap = {};
  for (let i = 0; i < tokenIds.length; i += BATCH_SIZE) {
    const batch = tokenIds.slice(i, i + BATCH_SIZE);
    const batchPrices = await fetchProbableBulkPrices(batch);
    Object.assign(fullPriceMap, batchPrices);
  }

  return attachProbablePrices(markets, fullPriceMap);
}

/**
 * Fetch all active Probable market IDs that belong to boosted-points events
 * (events where isBoosted === true)
 * Returns an array of market ID strings.
 */
export async function fetchProbableBoostedMarketIds() {
  const cacheKey = "probable:boostedMarketIds";
  const cached = cacheGet(cacheKey);
  if (cached) {
    console.log(`[Probable] Using cached ${cached.length} boosted market IDs`);
    return cached;
  }

  const eventsMap = await fetchProbableEventsMap();
  const boostedEventIds = new Set();
  for (const [evId, ev] of eventsMap.entries()) {
    if (ev.isBoosted) boostedEventIds.add(evId);
  }

  if (boostedEventIds.size === 0) {
    cacheSet(cacheKey, [], 300000); // 5 min
    return [];
  }

  // Match markets to boosted events
  const rawMarkets = await fetchAllProbableMarkets({ active: true, limit: 100 });
  const boostedIds = rawMarkets
    .filter((m) => m?.event_id && boostedEventIds.has(String(m.event_id)))
    .map((m) => String(m.id))
    .filter(Boolean);

  console.log(`[Probable] Found ${boostedIds.length} boosted market IDs across ${boostedEventIds.size} boosted events`);
  cacheSet(cacheKey, boostedIds, 300000); // 5 min
  return boostedIds;
}

/**
 * Get Probable token IDs from a normalized market (for arb engine compatibility)
 * Handles both shapes:
 *   1) Object array from normalizeProbableMarkets: [{ name: "Yes", tokenId: "abc" }, ...]
 *   2) String array from pseudoMarket in probableMarketsToEvents: ["Yes", "No"]
 *      with separate clobTokenIds (may be JSON string)
 *   3) _probableOutcomes (rich objects) attached by probableMarketsToEvents
 * Returns { yesTokenId, noTokenId, outcomes, yesLabel, noLabel } or null
 */
export function getProbableTokenIds(market) {
  if (!market) return null;

  // Prefer _probableOutcomes (always correct object format)
  let outcomes = market._probableOutcomes || market.outcomes;
  if (!Array.isArray(outcomes) || outcomes.length < 2) return null;

  // If outcomes are plain strings, reconstruct objects using clobTokenIds
  if (typeof outcomes[0] === "string") {
    let tokenIds = market.clobTokenIds;
    if (typeof tokenIds === "string") tokenIds = tryParseJson(tokenIds);
    if (!Array.isArray(tokenIds) || tokenIds.length < outcomes.length) return null;
    outcomes = outcomes.map((name, i) => ({ name: String(name), tokenId: String(tokenIds[i]) }));
  }

  // Now outcomes should be [{ name, tokenId }, ...]
  let yesIdx = 0;
  let noIdx = 1;
  const yesI = outcomes.findIndex(o => String(o?.name || "").toLowerCase() === "yes");
  const noI = outcomes.findIndex(o => String(o?.name || "").toLowerCase() === "no");
  if (yesI >= 0 && noI >= 0) {
    yesIdx = yesI;
    noIdx = noI;
  }

  const isStandardYesNo = outcomes.length >= 2 &&
    String(outcomes[0]?.name || "").toLowerCase() === "yes" &&
    String(outcomes[1]?.name || "").toLowerCase() === "no";

  return {
    yesTokenId: outcomes[yesIdx]?.tokenId,
    noTokenId: outcomes[noIdx]?.tokenId,
    outcomes: outcomes.map(o => String(o?.name || "")),
    yesLabel: isStandardYesNo ? null : (outcomes[yesIdx]?.name || null),
    noLabel: isStandardYesNo ? null : (outcomes[noIdx]?.name || null),
  };
}

/**
 * Get best bid/ask price for a Probable outcome
 */
export function getProbableBestBid(outcome) {
  if (!outcome) return null;
  return Number.isFinite(outcome.bestBid) ? outcome.bestBid : null;
}

export function getProbableBestAsk(outcome) {
  if (!outcome) return null;
  return Number.isFinite(outcome.bestAsk) ? outcome.bestAsk : null;
}

/**
 * Fetch all active Probable events with nested markets from /events API.
 * Returns array of event objects, each containing:
 *   { id, slug, title, isBoosted, multiplier, markets: [{ id, question, market_slug, outcomes, clobTokenIds, tokens, groupItemTitle, ... }] }
 * Markets are enriched with prices.
 */
export async function fetchProbableEventsGrouped() {
  const cacheKey = "probable:eventsGrouped";
  const cached = cacheGet(cacheKey);
  if (cached) {
    console.log(`[Probable] Using cached ${cached.length} grouped events`);
    return cached;
  }

  console.log(`[Probable] Fetching grouped events from /events API...`);
  const allEvents = [];
  let page = 1;
  const maxPages = 30;

  while (page <= maxPages) {
    const url = `${MARKET_API_BASE}/public/api/v1/events/?page=${page}&limit=100&active=true`;
    const data = await fetchJson(url);
    if (!data) break;

    const events = Array.isArray(data) ? data : (data?.events || data?.data || data?.results || []);
    if (!Array.isArray(events) || events.length === 0) break;

    for (const ev of events) {
      if (!ev?.id) continue;
      if (ev.closed || ev.archived) continue;
      const markets = Array.isArray(ev.markets) ? ev.markets.filter(m => m?.active && !m?.closed) : [];
      if (markets.length === 0) continue;

      allEvents.push({
        id: String(ev.id),
        slug: ev.slug || "",
        title: ev.title || "",
        isBoosted: Boolean(ev.isBoosted),
        multiplier: Number(ev.multiplier ?? 1),
        image: ev.image || ev.icon || "",
        markets,
      });
    }

    if (events.length < 100) break;
    page++;
  }

  console.log(`[Probable] Fetched ${allEvents.length} active events (grouped) across ${page} pages`);

  // Collect all tokenIds from all markets for bulk price fetch
  const tokenIds = [];
  for (const ev of allEvents) {
    for (const m of ev.markets) {
      const tokens = Array.isArray(m.tokens) ? m.tokens : [];
      for (const t of tokens) {
        if (t?.token_id) tokenIds.push(t.token_id);
      }
      // Also try clobTokenIds
      let clob = m.clobTokenIds;
      if (typeof clob === "string") { try { clob = JSON.parse(clob); } catch { clob = []; } }
      if (Array.isArray(clob)) {
        for (const tid of clob) { if (tid && !tokenIds.includes(tid)) tokenIds.push(String(tid)); }
      }
    }
  }

  // Bulk fetch prices
  if (tokenIds.length > 0) {
    const BATCH_SIZE = 200;
    const fullPriceMap = {};
    for (let i = 0; i < tokenIds.length; i += BATCH_SIZE) {
      const batch = tokenIds.slice(i, i + BATCH_SIZE);
      const batchPrices = await fetchProbableBulkPrices(batch);
      Object.assign(fullPriceMap, batchPrices);
    }

    // Attach prices to each market's tokens
    for (const ev of allEvents) {
      for (const m of ev.markets) {
        const tokens = Array.isArray(m.tokens) ? m.tokens : [];
        for (const t of tokens) {
          const row = fullPriceMap[t?.token_id];
          if (row) {
            t.bestBid = row.BUY != null ? Number(row.BUY) : undefined;
            t.bestAsk = row.SELL != null ? Number(row.SELL) : undefined;
          }
        }
      }
    }
  }

  cacheSet(cacheKey, allEvents, 180000); // 3 min
  return allEvents;
}

/**
 * Build a URL to open a Probable market
 * Format: https://probable.markets/event/{slug}?market={id}
 */
export function probableMarketUrl(marketId, eventSlug) {
  if (eventSlug) return `https://probable.markets/event/${eventSlug}?market=${marketId}`;
  return `https://probable.markets/event/${marketId}`;
}
