// lib/arbitageAutoMatcher.js
// Auto-match markets between Opinion and Polymarket using fuzzy text matching
// This enables automatic arbitrage opportunity detection without manual mapping

import { opinionFetch } from "@/lib/opinion";

const GAMMA_BASE = "https://gamma-api.polymarket.com";

/** ---------------- Cache ---------------- */
const CACHE = new Map();
const CACHE_TTL = 60000; // 1 minute

function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    CACHE.delete(key);
    return null;
  }
  return hit.val;
}

function cacheSet(key, val, ttlMs = CACHE_TTL) {
  CACHE.set(key, { val, exp: Date.now() + ttlMs });
}

export function clearAutoMatchCache() {
  CACHE.clear();
  console.log("[AutoMatcher] Cache cleared");
}

/** ---------------- Fetch helpers ---------------- */

async function fetchJson(url, opts = {}) {
  const { timeoutMs = 20000 } = opts;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Filter patterns for events that shouldn't be matched (crypto micro-trading events)
const EXCLUDED_EVENT_PATTERNS = [
  /up or down/i,
  /\d{1,2}:\d{2}\s*(AM|PM)/i,  // Time-based events like "2:15AM-2:30AM"
  /\d{1,2}(AM|PM)\s*-\s*\d{1,2}(AM|PM)/i,  // Time ranges
  /\d{1,2}(AM|PM)\s*ET/i,  // "2AM ET" style
];

/**
 * Check if an event should be excluded from matching
 */
function shouldExcludeEvent(title) {
  if (!title) return true;
  return EXCLUDED_EVENT_PATTERNS.some(pattern => pattern.test(title));
}

/**
 * Fetch all active events from Polymarket with pagination
 * Returns array of events, each with nested markets[]
 * Filters out crypto micro-trading "up or down" events
 */
export async function fetchAllPolymarketEvents({ limit = 200, maxPages = 20 } = {}) {
  const cacheKey = "poly:allEvents";
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const allEvents = [];
  let offset = 0;
  const seenIds = new Set();

  for (let page = 0; page < maxPages; page++) {
    // Fetch ALL open events, sorted by volume (most liquid first)
    const url = `${GAMMA_BASE}/events?closed=false&limit=${limit}&offset=${offset}`;
    const data = await fetchJson(url);

    if (!data || !Array.isArray(data) || data.length === 0) break;

    // Filter out micro-trading events and deduplicate
    for (const e of data) {
      if (seenIds.has(e.id)) continue;
      seenIds.add(e.id);
      if (!shouldExcludeEvent(e.title)) {
        allEvents.push(e);
      }
    }
    
    offset += limit;

    // Debug: Check if Backpack is in this batch
    const backpackEvent = data.find(e => e.title && e.title.toLowerCase().includes('backpack'));
    if (backpackEvent) {
      console.log(`[AutoMatcher] ✓ Found Backpack event in batch ${page}: "${backpackEvent.title}"`);
    }

    // If we got less than limit, we've reached the end
    if (data.length < limit) {
      console.log(`[AutoMatcher] Reached end of Poly events at page ${page} (got ${data.length} < ${limit})`);
      break;
    }
  }

  // Final check for Backpack
  const backpack = allEvents.find(e => e.title && e.title.toLowerCase().includes('backpack'));
  if (backpack) {
    console.log(`[AutoMatcher] ✓ Backpack event included: "${backpack.title}"`);
  } else {
    console.log(`[AutoMatcher] ⚠ Backpack event NOT found in ${allEvents.length} events - will try search API`);
    
    // Try to fetch Backpack directly via search as fallback
    try {
      const searchUrl = `${GAMMA_BASE}/events?slug=backpack-fdv-above-one-day-after-launch`;
      const backpackData = await fetchJson(searchUrl);
      if (Array.isArray(backpackData) && backpackData.length > 0) {
        for (const e of backpackData) {
          if (!seenIds.has(e.id)) {
            seenIds.add(e.id);
            allEvents.push(e);
            console.log(`[AutoMatcher] ✓ Added Backpack via slug lookup: "${e.title}"`);
          }
        }
      }
    } catch (err) {
      console.log(`[AutoMatcher] Failed to fetch Backpack via slug: ${err.message}`);
    }
  }

  console.log(`[AutoMatcher] Fetched ${allEvents.length} events total`);
  cacheSet(cacheKey, allEvents, 120000); // Cache for 2 minutes
  return allEvents;
}

/**
 * Search Polymarket events by query text
 */
export async function searchPolymarketEvents(query) {
  if (!query || query.length < 3) return [];

  const cacheKey = `poly:search:${query.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = `${GAMMA_BASE}/public-search?q=${encodeURIComponent(query)}&limit_per_type=20`;
  const data = await fetchJson(url);

  const events = Array.isArray(data?.events) ? data.events : [];
  cacheSet(cacheKey, events, 60000);
  return events;
}

/**
 * Fetch all active markets from Opinion (binary + categorical)
 * 
 * IMPORTANT: Opinion API logic:
 * - Binary markets (marketType=0): status=2 (Activated) when active
 * - Categorical PARENT markets (marketType=1): status=1 (Created), NOT "Activated"
 * - Categorical CHILD markets: status=2 (Activated)
 * 
 * So we need to:
 * 1. Fetch binary markets with marketType=0, status=activated
 * 2. Fetch categorical parents with marketType=1 (NO status filter - they have status=1)
 * 3. For each categorical parent, get child markets via /market/categorical/{id}
 */
/**
 * Helper: Fetch all pages in parallel after knowing total
 */
async function fetchAllPagesParallel(endpoint, baseParams, maxPages = 50) {
  const API_PAGE_SIZE = 20;
  
  // Step 1: Fetch first page to get total
  const firstPage = await opinionFetch(endpoint, { params: { ...baseParams, page: 1 } });
  const total = firstPage?.result?.total ?? 0;
  const firstList = firstPage?.result?.list ?? [];
  
  if (!total || !firstList.length) return firstList;
  
  const totalPages = Math.min(Math.ceil(total / API_PAGE_SIZE), maxPages);
  console.log(`[AutoMatcher] ${endpoint} has ${total} items across ${totalPages} pages, fetching in parallel...`);
  
  if (totalPages <= 1) return firstList;
  
  // Step 2: Fetch remaining pages in parallel
  const pagePromises = [];
  for (let page = 2; page <= totalPages; page++) {
    pagePromises.push(opinionFetch(endpoint, { params: { ...baseParams, page } }));
  }
  
  const results = await Promise.all(pagePromises);
  const allItems = [...firstList];
  
  for (const res of results) {
    const list = res?.result?.list ?? [];
    allItems.push(...list);
  }
  
  return allItems;
}

/**
 * Fetch all active markets from Opinion (binary + categorical)
 * Uses PARALLEL pagination for speed
 * 
 * NOTE: Limited to maxTotalMarkets (default 100) to avoid Opinion API rate limits
 */
export async function fetchAllOpinionMarkets({ limit = 20, maxPages = 50, maxTotalMarkets = 100 } = {}) {
  const cacheKey = "opinion:allMarkets";
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const allMarkets = [];
  const seenIds = new Set();
  const startTime = Date.now();

  // Step 1: Fetch BINARY markets in parallel
  console.log(`[AutoMatcher] Fetching binary markets (marketType=0)... (max total: ${maxTotalMarkets})`);
  const binaryList = await fetchAllPagesParallel("/market", {
    status: "activated", sortBy: 5, limit, marketType: 0
  }, maxPages);
  
  for (const m of binaryList) {
    if (seenIds.has(m.marketId)) continue;
    seenIds.add(m.marketId);
    allMarkets.push({ ...m, isCategorical: false, childMarkets: [] });
    
    // Check limit after adding binary market
    if (allMarkets.length >= maxTotalMarkets) {
      console.log(`[AutoMatcher] Reached maxTotalMarkets limit (${maxTotalMarkets}) with binary markets`);
      cacheSet(cacheKey, allMarkets, 300000);
      return allMarkets;
    }
  }
  console.log(`[AutoMatcher] Found ${allMarkets.length} binary markets (${Date.now() - startTime}ms)`);

  // Step 2: Fetch CATEGORICAL parent list in parallel
  // Check if we can still add more markets
  const remainingSlots = maxTotalMarkets - allMarkets.length;
  if (remainingSlots <= 0) {
    console.log(`[AutoMatcher] Already at maxTotalMarkets limit (${maxTotalMarkets}), skipping categorical markets`);
    cacheSet(cacheKey, allMarkets, 300000);
    return allMarkets;
  }
  
  console.log(`[AutoMatcher] Fetching categorical parent markets (marketType=1)... (remaining slots: ${remainingSlots})`);
  const categoricalList = await fetchAllPagesParallel("/market", {
    sortBy: 5, limit, marketType: 1
  }, maxPages);
  
  // Filter unique categorical parents
  const categoricalParents = [];
  for (const m of categoricalList) {
    if (seenIds.has(m.marketId)) continue;
    seenIds.add(m.marketId);
    categoricalParents.push(m);
  }
  console.log(`[AutoMatcher] Found ${categoricalParents.length} categorical parents, fetching details in parallel...`);

  // Step 3: Fetch categorical details in PARALLEL (batch of 20 concurrent)
  const BATCH_SIZE = 20;
  let categoricalCount = 0;
  let reachedLimit = false;
  
  for (let i = 0; i < categoricalParents.length && !reachedLimit; i += BATCH_SIZE) {
    const batch = categoricalParents.slice(i, i + BATCH_SIZE);
    const detailPromises = batch.map(m => 
      opinionFetch(`/market/categorical/${m.marketId}`)
        .then(detail => ({ marketId: m.marketId, detail }))
        .catch(() => ({ marketId: m.marketId, detail: null }))
    );
    
    const details = await Promise.all(detailPromises);
    
    for (const { marketId, detail } of details) {
      // Check if we've reached the limit
      if (allMarkets.length >= maxTotalMarkets) {
        console.log(`[AutoMatcher] Reached maxTotalMarkets limit (${maxTotalMarkets}) with categorical markets`);
        reachedLimit = true;
        break;
      }
      
      const fullData = detail?.result?.data;
      if (!fullData) continue;
      
      const children = Array.isArray(fullData.childMarkets) ? fullData.childMarkets : [];
      const hasActiveChildren = children.some(c => c.status === 2 || c.statusEnum === "Activated");
      
      if (hasActiveChildren) {
        allMarkets.push({ ...fullData, isCategorical: true, childMarkets: children });
        categoricalCount++;
      }
    }
    
    // Log progress
    const progress = Math.min(i + BATCH_SIZE, categoricalParents.length);
    console.log(`[AutoMatcher] Categorical progress: ${progress}/${categoricalParents.length}`);
  }

  const elapsed = Date.now() - startTime;
  console.log(`[AutoMatcher] Found ${categoricalCount} categorical markets with active children`);
  console.log(`[AutoMatcher] Total: ${allMarkets.length} Opinion markets in ${elapsed}ms`);
  
  // Cache for 5 minutes since market list doesn't change often
  cacheSet(cacheKey, allMarkets, 300000);
  return allMarkets;
}

/** ---------------- Text normalization & matching ---------------- */

// Prefixes that can be ignored when matching (e.g., "US" in "US Fed Rate Decision")
const IGNORABLE_PREFIXES = ["us", "u.s.", "u.s", "usa", "will", "the"];

/**
 * Normalize text for comparison:
 * - lowercase
 * - replace placeholders like ___, ..., --- with a standard placeholder
 * - KEEP important symbols like + (for "8+" vs "8")
 * - remove other punctuation except alphanumeric, spaces, and +
 * - collapse multiple spaces
 * - trim
 */
function normalizeText(text) {
  if (!text) return "";
  return String(text)
    .toLowerCase()
    // Replace common placeholders with a standard one
    .replace(/_{2,}/g, " PLACEHOLDER ")   // ___ → PLACEHOLDER
    .replace(/\.{2,}/g, " PLACEHOLDER ")  // ... → PLACEHOLDER
    .replace(/-{2,}/g, " PLACEHOLDER ")   // --- → PLACEHOLDER
    .replace(/…/g, " PLACEHOLDER ")       // … (ellipsis) → PLACEHOLDER
    // IMPORTANT: Keep + symbol as it differentiates "8+" from "8"
    // Remove other punctuation except alphanumeric, spaces, and +
    .replace(/[^\w\s+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Remove common ignorable prefixes from normalized text
 */
function removeIgnorablePrefixes(normalizedText) {
  let result = normalizedText;
  for (const prefix of IGNORABLE_PREFIXES) {
    if (result.startsWith(prefix + " ")) {
      result = result.slice(prefix.length + 1);
    }
  }
  return result.trim();
}

/**
 * STRICT EXACT MATCH ONLY
 * 
 * Only match if titles are EXACTLY the same (after normalization).
 * This prevents false positives like:
 * - "MLB World Series Champion 2026" matching "Super Bowl Champion 2026"
 * 
 * Returns 1.0 for exact match, 0 otherwise.
 */
function calculateSimilarity(text1, text2) {
  const norm1 = normalizeText(text1);
  const norm2 = normalizeText(text2);
  
  if (!norm1 || !norm2) return 0;
  
  // EXACT match only
  if (norm1 === norm2) return 1.0;
  
  // Try with prefix removal (e.g., "US Fed Rate" vs "Fed Rate")
  const norm1NoPrefix = removeIgnorablePrefixes(norm1);
  const norm2NoPrefix = removeIgnorablePrefixes(norm2);
  
  if (norm1NoPrefix === norm2NoPrefix) return 0.95;
  
  // NO fuzzy matching, NO substring matching, NO LCS matching
  // If not exact match, return 0
  return 0;
}

/** ---------------- Auto-matching logic ---------------- */

/**
 * Find matching Polymarket event/market for an Opinion market
 * @param {Object} opinionMarket - Opinion market object
 * @param {Array} polyEvents - Array of Polymarket events
 * @param {number} minSimilarity - Minimum similarity threshold (0-1, default 0.5 for substring matching)
 * @returns {Object|null} - Match result with poly event/market info
 */
function findPolyMatchForOpinionMarket(opinionMarket, polyEvents, minSimilarity = 0.5) {
  const opTitle = opinionMarket.marketTitle || opinionMarket.tittle || opinionMarket.title || "";
  if (!opTitle) return null;

  const opNorm = normalizeText(opTitle);
  let bestMatch = null;
  let bestScore = 0;

  // Debug logging for specific markets we want to track
  const debugKeywords = ["backpack", "fdv", "launch"];
  const shouldDebug = debugKeywords.some(kw => opNorm.includes(kw));
  
  if (shouldDebug) {
    console.log(`[DEBUG-MATCH] Opinion: "${opTitle}" → normalized: "${opNorm}"`);
  }

  for (const event of polyEvents) {
    const eventTitle = event.title || "";
    const eventNorm = normalizeText(eventTitle);
    const eventSimilarity = calculateSimilarity(opTitle, eventTitle);

    // Debug: log any Poly events that might be related
    if (shouldDebug && debugKeywords.some(kw => eventNorm.includes(kw))) {
      console.log(`[DEBUG-MATCH]   Poly event: "${eventTitle}" → normalized: "${eventNorm}" | similarity: ${eventSimilarity}`);
    }

    // Check event-level match
    if (eventSimilarity >= minSimilarity && eventSimilarity > bestScore) {
      bestScore = eventSimilarity;
      bestMatch = {
        type: "event",
        polyEvent: event,
        polyMarket: null,
        similarity: eventSimilarity,
      };
    }

    // Check individual markets within the event
    const markets = Array.isArray(event.markets) ? event.markets : [];
    for (const market of markets) {
      const marketQuestion = market.question || market.title || "";
      const marketNorm = normalizeText(marketQuestion);
      const marketSimilarity = calculateSimilarity(opTitle, marketQuestion);

      // Debug: log any Poly markets that might be related
      if (shouldDebug && debugKeywords.some(kw => marketNorm.includes(kw))) {
        console.log(`[DEBUG-MATCH]   Poly market: "${marketQuestion}" → normalized: "${marketNorm}" | similarity: ${marketSimilarity}`);
      }

      if (marketSimilarity >= minSimilarity && marketSimilarity > bestScore) {
        bestScore = marketSimilarity;
        bestMatch = {
          type: "market",
          polyEvent: event,
          polyMarket: market,
          similarity: marketSimilarity,
        };
      }
    }
  }

  if (shouldDebug && !bestMatch) {
    console.log(`[DEBUG-MATCH]   NO MATCH FOUND for "${opTitle}"`);
  }

  return bestMatch;
}

/**
 * Extract outcome identifier from text for strict matching
 * E.g., "8+ (200+ bps)" → "8+" and "8 (200 bps)" → "8"
 * This ensures "8+" won't match "8" as they're different outcomes
 */
function extractOutcomeIdentifier(text) {
  if (!text) return "";
  // Match patterns like "8+", "8", "$1B", "200+ bps", etc.
  // Keep the + symbol as it's semantically important
  const match = text.match(/^[\$]?(\d+\+?)\b/);
  if (match) return match[1]; // Return "8+" or "8" etc.
  return normalizeText(text);
}

/**
 * For categorical Opinion markets, find matching Poly markets for each child outcome
 * Uses STRICT matching - "8+" must match "8+", not "8"
 * @param {Object} opinionCategorical - Opinion categorical market with childMarkets
 * @param {Object} polyEvent - Polymarket event with markets array
 * @returns {Array} - Array of matched pairs { opinionChild, polyMarket, similarity }
 */
function matchCategoricalOutcomes(opinionCategorical, polyEvent) {
  const opChildren = opinionCategorical.childMarkets || [];
  const polyMarkets = Array.isArray(polyEvent.markets) ? polyEvent.markets : [];

  const matches = [];

  for (const opChild of opChildren) {
    // For categorical children, use marketTitle which is like "$1B", "8+ (200+ bps)", etc.
    const opChildTitle = opChild.marketTitle || opChild.tittle || opChild.title || "";
    if (!opChildTitle) continue;

    // Normalize the child title for matching
    const normalizedChildTitle = normalizeText(opChildTitle);
    // Extract the outcome identifier for strict matching (e.g., "8+" vs "8")
    const opOutcomeId = extractOutcomeIdentifier(opChildTitle);

    let bestMatch = null;
    let bestScore = 0;

    for (const polyMarket of polyMarkets) {
      const polyQuestion = polyMarket.question || polyMarket.title || "";
      const groupItemTitle = polyMarket.groupItemTitle || "";
      
      // Extract outcome identifiers
      const normalizedGroupTitle = normalizeText(groupItemTitle);
      const polyGroupOutcomeId = extractOutcomeIdentifier(groupItemTitle);
      const polyQuestionOutcomeId = extractOutcomeIdentifier(polyQuestion);
      
      // STRICT match 1: groupItemTitle exact match (most reliable)
      if (normalizedGroupTitle && normalizedChildTitle === normalizedGroupTitle) {
        bestScore = 1.0;
        bestMatch = {
          opinionChild: opChild,
          polyMarket: polyMarket,
          similarity: 1.0,
        };
        break; // Perfect exact match
      }
      
      // STRICT match 2: Check outcome identifier match
      // "8+" must match "8+", NOT "8"
      if (opOutcomeId && polyGroupOutcomeId && opOutcomeId === polyGroupOutcomeId) {
        const score = 0.95;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = {
            opinionChild: opChild,
            polyMarket: polyMarket,
            similarity: score,
          };
        }
        continue;
      }
      
      // STRICT match 3: Check question for outcome identifier
      if (opOutcomeId && polyQuestionOutcomeId && opOutcomeId === polyQuestionOutcomeId) {
        const score = 0.9;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = {
            opinionChild: opChild,
            polyMarket: polyMarket,
            similarity: score,
          };
        }
        continue;
      }
      
      // STRICT match 4: Full normalized title match only (no loose substring matching)
      const normalizedQuestion = normalizeText(polyQuestion);
      if (normalizedQuestion === normalizedChildTitle || normalizedGroupTitle === normalizedChildTitle) {
        const score = 0.85;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = {
            opinionChild: opChild,
            polyMarket: polyMarket,
            similarity: score,
          };
        }
      }
      
      // NO MORE loose substring matching like `includes()` - this caused false positives
    }

    // Only accept high-confidence matches (>= 0.8)
    if (bestMatch && bestScore >= 0.8) {
      matches.push(bestMatch);
    }
  }

  return matches;
}

/**
 * Parse outcomes array from Polymarket (may be JSON string)
 */
function parseOutcomesArray(outcomes) {
  if (!outcomes) return null;
  if (Array.isArray(outcomes)) return outcomes;
  if (typeof outcomes !== "string") return null;

  try {
    const parsed = JSON.parse(outcomes);
    if (Array.isArray(parsed)) return parsed;
  } catch {}

  // Try comma-separated
  return outcomes.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Main function: Auto-discover arbitrage pairs between Opinion and Polymarket
 * @param {Object} options
 * @param {number} options.minSimilarity - Minimum similarity threshold
 * @param {Function} options.onProgress - Progress callback ({ current, total, message })
 * @returns {Array} - Array of matched pairs ready for arbitrage calculation
 */
export async function discoverArbitagePairs({ minSimilarity = 0.5, onProgress = () => {} } = {}) {
  // Fetch all markets from both exchanges
  // Opinion: Limited to 100 markets max due to API rate limits
  // Polymarket: Fetch more since their API is more permissive
  onProgress({ current: 0, total: 0, message: "Fetching Opinion markets..." });
  
  const [opinionMarkets, polyEvents] = await Promise.all([
    fetchAllOpinionMarkets({ limit: 20, maxPages: 50, maxTotalMarkets: 100 }),
    fetchAllPolymarketEvents({ limit: 100, maxPages: 15 }),
  ]);

  onProgress({ current: 0, total: opinionMarkets.length, message: `Found ${opinionMarkets.length} Opinion markets, matching...` });

  console.log(`[AutoMatcher] Matching ${opinionMarkets.length} Opinion markets against ${polyEvents.length} Poly events`);

  const pairs = [];

  for (let i = 0; i < opinionMarkets.length; i++) {
    const opMarket = opinionMarkets[i];
    const match = findPolyMatchForOpinionMarket(opMarket, polyEvents, minSimilarity);

    // Report progress every 50 markets
    if (i % 50 === 0 || i === opinionMarkets.length - 1) {
      onProgress({ current: i + 1, total: opinionMarkets.length, message: `Matching markets ${i + 1}/${opinionMarkets.length}` });
    }

    if (!match) continue;

    if (opMarket.isCategorical && match.type === "event") {
      // Categorical market - match each child outcome
      const childMatches = matchCategoricalOutcomes(opMarket, match.polyEvent);

      for (const cm of childMatches) {
        pairs.push({
          id: `auto-cat-${opMarket.marketId}-${cm.opinionChild.marketId}`,
          type: "event_outcome",
          opinionMarketId: String(cm.opinionChild.marketId),
          opinionParentId: String(opMarket.marketId),
          opinionParentTitle: opMarket.marketTitle || opMarket.tittle || opMarket.title,
          opinionTitle: cm.opinionChild.marketTitle || cm.opinionChild.tittle,
          opinionYesToken: cm.opinionChild.yesTokenId,
          opinionNoToken: cm.opinionChild.noTokenId,
          polyEventSlug: match.polyEvent.slug,
          polyMarketSlug: cm.polyMarket?.slug,
          polyMarket: cm.polyMarket,
          polyTitle: cm.polyMarket?.question || cm.polyMarket?.title,
          similarity: cm.similarity,
          autoMatched: true,
        });
      }
    } else {
      // Binary market or direct market match
      // IMPORTANT: Only use if we matched a specific market, not just event
      // If we only matched the event, try to find the best market within it
      let polyMarket = match.polyMarket;
      
      if (!polyMarket && match.polyEvent.markets?.length > 0) {
        // Try to find best matching market within the event
        const markets = match.polyEvent.markets;
        const opTitle = opMarket.marketTitle || opMarket.tittle || opMarket.title || "";
        
        let bestMarket = null;
        let bestMarketScore = 0;
        
        for (const m of markets) {
          const mq = m.question || m.title || "";
          const sim = calculateSimilarity(opTitle, mq);
          if (sim >= minSimilarity && sim > bestMarketScore) {
            bestMarketScore = sim;
            bestMarket = m;
          }
        }
        
        // Only use if we found a good match
        if (bestMarket && bestMarketScore >= minSimilarity) {
          polyMarket = bestMarket;
          match.similarity = Math.max(match.similarity, bestMarketScore);
        }
      }
      
      if (!polyMarket) continue;

      pairs.push({
        id: `auto-bin-${opMarket.marketId}`,
        type: "binary",
        opinionMarketId: String(opMarket.marketId),
        opinionTitle: opMarket.marketTitle || opMarket.tittle,
        opinionYesToken: opMarket.yesTokenId,
        opinionNoToken: opMarket.noTokenId,
        polyEventSlug: match.polyEvent.slug,
        polyMarketSlug: polyMarket.slug,
        polyMarket: polyMarket,
        polyTitle: polyMarket.question || polyMarket.title,
        similarity: match.similarity,
        autoMatched: true,
      });
    }
  }

  // Sort by similarity descending
  pairs.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));

  return pairs;
}

/**
 * Get Polymarket token IDs from a market object
 */
export function getPolyTokenIds(polyMarket) {
  if (!polyMarket) return null;

  let tokenIds = polyMarket.clobTokenIds;
  if (typeof tokenIds === "string") {
    try {
      tokenIds = JSON.parse(tokenIds);
    } catch {
      tokenIds = tokenIds.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }

  if (!Array.isArray(tokenIds) || tokenIds.length < 2) return null;

  let outcomes = polyMarket.outcomes;
  if (typeof outcomes === "string") {
    try {
      outcomes = JSON.parse(outcomes);
    } catch {
      outcomes = outcomes.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }

  // Find Yes/No indices
  let yesIdx = 0;
  let noIdx = 1;

  if (Array.isArray(outcomes) && outcomes.length >= 2) {
    const yesI = outcomes.findIndex((x) => String(x).toLowerCase() === "yes");
    const noI = outcomes.findIndex((x) => String(x).toLowerCase() === "no");
    if (yesI >= 0 && noI >= 0) {
      yesIdx = yesI;
      noIdx = noI;
    }
  }

  return {
    yesTokenId: String(tokenIds[yesIdx]),
    noTokenId: String(tokenIds[noIdx]),
  };
}

// Export utilities for testing
export { normalizeText, calculateSimilarity };
