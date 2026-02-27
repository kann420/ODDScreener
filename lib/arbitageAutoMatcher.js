// lib/arbitageAutoMatcher.js
// Auto-match markets between Opinion and Polymarket using fuzzy text matching
// This enables automatic arbitrage opportunity detection without manual mapping

import { opinionFetch } from "@/lib/opinion";
import dns from "dns";
import https from "https";

// Create custom DNS resolver using Google DNS (bypasses local DNS issues)
const googleResolver = new dns.Resolver();
googleResolver.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);

// DNS cache for resolved IPs
const dnsCache = new Map();
const DNS_CACHE_TTL = 300000; // 5 minutes

async function resolveWithGoogleDns(hostname) {
  const cached = dnsCache.get(hostname);
  if (cached && Date.now() < cached.exp) {
    return cached.ip;
  }
  
  return new Promise((resolve, reject) => {
    googleResolver.resolve4(hostname, (err, addresses) => {
      if (err || !addresses?.length) {
        reject(err || new Error(`DNS resolution failed for ${hostname}`));
      } else {
        const ip = addresses[0];
        dnsCache.set(hostname, { ip, exp: Date.now() + DNS_CACHE_TTL });
        console.log(`[AutoMatcher] DNS resolved ${hostname} -> ${ip}`);
        resolve(ip);
      }
    });
  });
}

/**
 * Fetch JSON using direct IP connection (bypasses corrupted local DNS)
 * Used for Polymarket API which may have DNS resolution issues
 */
async function fetchJsonDirectIp(hostname, path, timeoutMs = 20000) {
  const ip = await resolveWithGoogleDns(hostname);
  
  return new Promise((resolve, reject) => {
    const options = {
      host: ip,
      path: path,
      method: 'GET',
      timeout: timeoutMs,
      headers: {
        'Host': hostname,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      },
      servername: hostname // For SNI (SSL)
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Invalid JSON'));
        }
      });
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.on('error', reject);
    req.end();
  });
}

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
  const { timeoutMs = 20000, retries = 2 } = opts;
  
  // Determine if this is a Polymarket URL (needs direct IP connection)
  const isPolymarket = url.includes("polymarket.com");
  
  // For Polymarket, use direct IP connection to bypass local DNS issues
  if (isPolymarket) {
    const urlObj = new URL(url);
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await fetchJsonDirectIp(urlObj.hostname, urlObj.pathname + urlObj.search, timeoutMs);
        return result;
      } catch (err) {
        const isLastAttempt = attempt === retries;
        if (isLastAttempt) {
          console.error(`[AutoMatcher] Polymarket fetch FAILED after ${retries + 1} attempts: ${err.message}`);
          return null;
        }
        console.warn(`[AutoMatcher] Polymarket attempt ${attempt + 1} failed, retrying...`);
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    return null;
  }
  
  // Standard fetch for non-Polymarket URLs
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
        console.warn(`[AutoMatcher] fetchJson HTTP ${res.status} for ${url.substring(0, 80)}`);
        return null;
      }
      return await res.json();
    } catch (err) {
      clearTimeout(t);
      const isLastAttempt = attempt === retries;
      
      if (isLastAttempt) {
        console.error(`[AutoMatcher] fetchJson FAILED after ${retries + 1} attempts for ${url.substring(0, 80)}`);
        console.error(`[AutoMatcher] Error: ${err?.message || err}`);
      } else {
        console.warn(`[AutoMatcher] fetchJson attempt ${attempt + 1} failed, retrying...`);
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  return null;
}

// Filter patterns for events that shouldn't be matched (crypto micro-trading events)
const EXCLUDED_EVENT_PATTERNS = [
  /up or down/i,
  /\d{1,2}:\d{2}\s*(AM|PM)/i,  // Time-based events like "2:15AM-2:30AM"
  /\d{1,2}(AM|PM)\s*-\s*\d{1,2}(AM|PM)/i,  // Time ranges
  /\d{1,2}(AM|PM)\s*ET/i,  // "2AM ET" style
];

/** ---------------- Date/Time Period Matching ---------------- */

/**
 * Extract time period information from a market title
 * Returns { month, quarter, year, dateStr } or null if no date found
 * 
 * Examples:
 * - "end of February" → { month: "february" }
 * - "end of March?" → { month: "march" }
 * - "by June 30" → { month: "june" }
 * - "in Q1 2026" → { quarter: "q1", year: "2026" }
 * - "by February 28" → { month: "february", dateStr: "february 28" }
 */
function extractTimePeriod(title) {
  if (!title) return null;
  const lower = title.toLowerCase();
  
  // Month names with various prefixes
  const monthPattern = /(?:end of|by|in|before|after)?\s*(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{1,2}))?/i;
  const monthMatch = lower.match(monthPattern);
  
  if (monthMatch) {
    return {
      month: monthMatch[1].toLowerCase(),
      dateStr: monthMatch[2] ? `${monthMatch[1]} ${monthMatch[2]}` : monthMatch[1],
    };
  }
  
  // Quarter pattern (Q1, Q2, etc.)
  const quarterPattern = /\b(q[1-4]|1q|2q|3q|4q)\s*(\d{4})?\b/i;
  const quarterMatch = lower.match(quarterPattern);
  
  if (quarterMatch) {
    return {
      quarter: quarterMatch[1].toLowerCase().replace(/(\d)q/, 'q$1'),
      year: quarterMatch[2] || null,
    };
  }
  
  return null;
}

/**
 * Check if two market titles have a TIME PERIOD MISMATCH
 * This prevents matching "end of February" with "end of June"
 * 
 * @returns {boolean} true if there's a mismatch (should NOT match), false if OK to match
 */
function hasTimePeriodMismatch(title1, title2) {
  const period1 = extractTimePeriod(title1);
  const period2 = extractTimePeriod(title2);
  
  // If neither has a time period, no mismatch
  if (!period1 && !period2) return false;
  
  // If only one has a time period, allow match (might be generic vs specific)
  if (!period1 || !period2) return false;
  
  // Check month mismatch
  if (period1.month && period2.month && period1.month !== period2.month) {
    console.log(`[AutoMatcher] TIME MISMATCH: "${title1}" (${period1.month}) vs "${title2}" (${period2.month})`);
    return true;
  }
  
  // Check quarter mismatch
  if (period1.quarter && period2.quarter && period1.quarter !== period2.quarter) {
    console.log(`[AutoMatcher] TIME MISMATCH: "${title1}" (${period1.quarter}) vs "${title2}" (${period2.quarter})`);
    return true;
  }
  
  return false;
}

/**
 * Detect commodity intent to prevent mismatching different contract types.
 * Example to block:
 * - "What will Silver settle at in June?" ↔ "Will Silver hit ... by end of June?"
 */
function getCommodityIntent(title) {
  const raw = String(title || "");
  if (!raw) return null;
  const norm = normalizeText(raw);
  const isCommodity = /\b(silver|gold|si|gc)\b/i.test(norm);
  if (!isCommodity) return null;

  if (/\bsettle(?:d)?\b/.test(norm)) return "settle";
  if (/\babove\b/.test(norm)) return "above";
  if (/\bhit\b/.test(norm)) return "hit";
  if (/\bclose\b/.test(norm)) return "close";
  return null;
}

function hasCommodityIntentMismatch(title1, title2) {
  const intent1 = getCommodityIntent(title1);
  const intent2 = getCommodityIntent(title2);
  if (!intent1 || !intent2) return false;
  return intent1 !== intent2;
}

function isIsraelIranStrikeTitle(text) {
  const norm = normalizeText(text);
  if (!norm) return false;
  return /\bisrael\b/.test(norm) && /\biran\b/.test(norm) && /\bstrik(?:e|es|ing|ed)\b/.test(norm);
}

/**
 * Prevent mismatching two different geopolitical scopes:
 * - "Israel strikes Iran by ...?" vs "US/Israel strikes Iran by ...?"
 */
function hasIsraelStrikeScopeMismatch(title1, title2) {
  if (!isIsraelIranStrikeTitle(title1) || !isIsraelIranStrikeTitle(title2)) return false;
  const norm1 = normalizeText(title1);
  const norm2 = normalizeText(title2);
  const hasUs1 = /\bus\b/.test(norm1) || /\bu s\b/.test(norm1);
  const hasUs2 = /\bus\b/.test(norm2) || /\bu s\b/.test(norm2);
  return hasUs1 !== hasUs2;
}

function isPolyEventOpen(event) {
  return !!event && event.closed !== true;
}

function isPolyMarketTradable(market) {
  if (!market) return false;
  if (market.closed === true) return false;
  if (market.active === false) return false;
  return true;
}

function sanitizePolyEvent(event) {
  if (!event || !isPolyEventOpen(event)) return null;
  const markets = Array.isArray(event.markets) ? event.markets.filter(isPolyMarketTradable) : [];
  return { ...event, markets };
}

/**
 * WHITELIST: Manual market pairs that should always match
 * Format: Array of { opinionPattern, polyPattern } where patterns are regex or exact strings
 * These are checked BEFORE the normal fuzzy matching logic
 * Whitelist matches are prioritized and shown first in results
 */
const MANUAL_MATCH_WHITELIST = [
  // ECB Rates Decision - Opinion uses "ECB Rates Decision (DFR)", Poly uses "ECB Interest Rates"
  { opinionPattern: /ecb rates decision.*february/i, polyPattern: /ecb interest rates.*february/i },
  { opinionPattern: /ecb rates decision.*march/i, polyPattern: /ecb interest rates.*march/i },
  { opinionPattern: /ecb rates decision.*april/i, polyPattern: /ecb interest rates.*april/i },
  { opinionPattern: /ecb rates decision.*june/i, polyPattern: /ecb interest rates.*june/i },
  { opinionPattern: /ecb rates decision.*july/i, polyPattern: /ecb interest rates.*july/i },
  // Fed Rate Decision markets - Opinion uses full name, Poly uses short name
  { opinionPattern: /us fed rate decision.*march/i, polyPattern: /fed decision.*march/i },
  { opinionPattern: /us fed rate decision.*april/i, polyPattern: /fed decision.*april/i },
  { opinionPattern: /us fed rate decision.*may/i, polyPattern: /fed decision.*may/i },
  { opinionPattern: /us fed rate decision.*june/i, polyPattern: /fed decision.*june/i },
  { opinionPattern: /us fed rate decision.*july/i, polyPattern: /fed decision.*july/i },
  
  // ===== CRYPTO / FDV MARKETS =====
  // StandX - Poly uses "___", Opinion uses "..."
  { opinionPattern: /standx fdv/i, polyPattern: /standx fdv/i },
  { opinionPattern: /standx/i, polyPattern: /standx/i },
  // Nansen token launch
  { opinionPattern: /nansen.*token/i, polyPattern: /nansen.*token/i },
  // MegaETH - Opinion has "(FDV)", Poly might have different format
  { opinionPattern: /megaeth/i, polyPattern: /megaeth/i },
  // Fabric public sale
  { opinionPattern: /fabric.*public.*sale/i, polyPattern: /fabric.*public.*sale/i },
  { opinionPattern: /fabric/i, polyPattern: /fabric/i },
  // MicroStrategy Bitcoin
  { opinionPattern: /microstrategy.*bitcoin/i, polyPattern: /microstrategy.*bitcoin/i },
  
  // ===== BITCOIN HIT PRICE (Monthly) =====
  // Opinion: "What price will Bitcoin hit in February?" (ID 332)
  // Poly: "What price will Bitcoin hit in February?" (event slug: what-price-will-bitcoin-hit-in-february-2026)
  // Match all months - exact title match
  { opinionPattern: /what price will bitcoin hit in february/i, polyPattern: /what price will bitcoin hit in february/i },
  { opinionPattern: /what price will bitcoin hit in march/i, polyPattern: /what price will bitcoin hit in march/i },
  { opinionPattern: /what price will bitcoin hit in april/i, polyPattern: /what price will bitcoin hit in april/i },
  { opinionPattern: /what price will bitcoin hit in may/i, polyPattern: /what price will bitcoin hit in may/i },
  { opinionPattern: /what price will bitcoin hit in june/i, polyPattern: /what price will bitcoin hit in june/i },
  { opinionPattern: /what price will bitcoin hit in july/i, polyPattern: /what price will bitcoin hit in july/i },
  { opinionPattern: /what price will bitcoin hit in august/i, polyPattern: /what price will bitcoin hit in august/i },
  { opinionPattern: /what price will bitcoin hit in september/i, polyPattern: /what price will bitcoin hit in september/i },
  { opinionPattern: /what price will bitcoin hit in october/i, polyPattern: /what price will bitcoin hit in october/i },
  { opinionPattern: /what price will bitcoin hit in november/i, polyPattern: /what price will bitcoin hit in november/i },
  { opinionPattern: /what price will bitcoin hit in december/i, polyPattern: /what price will bitcoin hit in december/i },
  // Generic pattern for year-based
  { opinionPattern: /what price will bitcoin hit in 2026/i, polyPattern: /what price will bitcoin hit in 2026/i },
  // ETH/SOL monthly hit price (reported missing in scan due deep pagination in Poly events)
  { opinionPattern: /what price will ethereum hit in february/i, polyPattern: /what price will ethereum hit in february/i },
  { opinionPattern: /what price will solana hit in february/i, polyPattern: /what price will solana hit in february/i },
  
  // ===== POLITICS =====
  // Taiwan President
  { opinionPattern: /lai ching-te out as president of taiwan/i, polyPattern: /lai ching-te out as president of taiwan/i },
  // Ukraine President (date-series on Opinion vs split binary events on Poly)
  { opinionPattern: /zelenskyy out as ukraine president/i, polyPattern: /zelenskyy out as ukraine president/i },
  // Israel/Iran strike date-series - keep non-US variant separate from US/Israel series
  { opinionPattern: /^israel strikes iran by/i, polyPattern: /^israel strikes iran by/i },
  // US strike on Mexico
  { opinionPattern: /us strike on mexico by/i, polyPattern: /us strike on mexico by/i },
  // Companies acquired
  { opinionPattern: /which companies will be acquired before 2027/i, polyPattern: /which companies will be acquired before 2027/i },
  
  // ===== JOBS REPORT =====
  // Jobs report - Opinion adds "in the U.S." 
  { opinionPattern: /how many jobs added in the u\.?s\.? in january/i, polyPattern: /how many jobs added in january/i },
  { opinionPattern: /how many jobs added in the u\.?s\.? in february/i, polyPattern: /how many jobs added in february/i },
  { opinionPattern: /how many jobs added in the u\.?s\.? in march/i, polyPattern: /how many jobs added in march/i },
  { opinionPattern: /how many jobs added in the u\.?s\.? in/i, polyPattern: /how many jobs added in/i },
  
  // ===== SPORTS =====
  // UEFA Champions League - Opinion adds year suffix
  { opinionPattern: /uefa champions league winner 2026/i, polyPattern: /uefa champions league winner$/i },
  { opinionPattern: /uefa champions league winner 2025/i, polyPattern: /uefa champions league winner$/i },
  { opinionPattern: /uefa champions league winner/i, polyPattern: /uefa champions league winner/i },
  // F1 Drivers' Champion - Opinion: "F1 World Drivers' Champion 2026", Poly: "F1 Drivers' Champion"
  { opinionPattern: /f1 world drivers.* champion/i, polyPattern: /f1 drivers.* champion/i },
  // Oscars winner markets
  { opinionPattern: /oscars 2026.*best cinematography winner/i, polyPattern: /oscars 2026.*best cinematography winner/i },
  
  // ===== BUSINESS / COMPANIES =====
  // Largest Company - "end of December 2026" vs "end of 2026"
  { opinionPattern: /largest company/i, polyPattern: /largest company/i },
  // MSFT monthly close-above series
  { opinionPattern: /microsoft.*msft.*close above.*february/i, polyPattern: /microsoft.*msft.*close above.*february/i },
  // AMZN/META monthly close-above series
  { opinionPattern: /amazon.*amzn.*close above.*february/i, polyPattern: /amazon.*amzn.*close above.*february/i },
  { opinionPattern: /meta.*meta.*close above.*february/i, polyPattern: /meta.*meta.*close above.*february/i },
  
  // ===== AI RANKINGS =====
  // AI model rankings - keep generic series only; block subtype markets like "for coding"/"for math"
  { opinionPattern: /best ai model(?!.*for (coding|math))/i, polyPattern: /best ai model(?!.*for (coding|math))/i },
  
  // ===== COMMODITIES =====
  // Silver - Poly has "(SI)" and "hit__", Opinion has "hit ..."
  { opinionPattern: /silver.*hit/i, polyPattern: /silver.*hit/i },
  { opinionPattern: /silver.*above/i, polyPattern: /silver.*above/i },
  { opinionPattern: /silver.*settle at/i, polyPattern: /silver.*settle at/i },
  
  // Gold - Poly has "(GC)" and "hit__", Opinion has "hit ..."
  { opinionPattern: /gold.*hit/i, polyPattern: /gold.*hit/i },
  { opinionPattern: /gold.*above/i, polyPattern: /gold.*above/i },
  { opinionPattern: /gold.*settle at/i, polyPattern: /gold.*settle at/i },
  
  // Companies acquired
  { opinionPattern: /companies.*acquired/i, polyPattern: /companies.*acquired/i },
  { opinionPattern: /acquired/i, polyPattern: /acquired/i },
  
  // ===== ESPORTS (League of Legends - LEC) =====
  // Opinion: binary market (e.g. "LEC: VIT vs MKOI")
  // Polymarket: sports event with multiple bet types; we want the Moneyline ("Match Winner") market
  { opinionPattern: /lec.*kc.*gx/i, polyPattern: /karmine corp.*giantx/i, polyOutcomeMatch: "match winner" },
  { opinionPattern: /lec.*th.*g2/i, polyPattern: /heretics.*g2 esports/i, polyOutcomeMatch: "match winner" },
  { opinionPattern: /lec.*navi.*fnc/i, polyPattern: /natus vincere.*fnatic/i, polyOutcomeMatch: "match winner" },
  { opinionPattern: /lec.*vit.*mkoi/i, polyPattern: /vitality.*movistar.*koi/i, polyOutcomeMatch: "match winner" },
  
  // ===== ESPORTS (League of Legends - LPL) =====
  // Opinion: binary market (e.g. "LPL: AL vs Team WE")
  // Polymarket: sports event with multiple bet types; we want the Moneyline ("Match Winner") market
  { opinionPattern: /lpl.*al.*team we/i, polyPattern: /anyone.*legend.*team we/i, polyOutcomeMatch: "match winner" },
  { opinionPattern: /lpl.*blg.*nip/i, polyPattern: /bilibili.*gaming.*ninjas.*pyjamas/i, polyOutcomeMatch: "match winner" },
  
  // ===== ESPORTS (League of Legends - CBLOL) =====
  { opinionPattern: /cblol.*loud.*red/i, polyPattern: /loud.*red canids/i, polyOutcomeMatch: "match winner" },
  
  // ===== ESPORTS (League of Legends - LCK) =====
  { opinionPattern: /lck.*dnf.*drx/i, polyPattern: /dn freecs.*drx/i, polyOutcomeMatch: "match winner" },
  { opinionPattern: /lck.*dk.*dns/i, polyPattern: /dplus kia.*dn freecs/i, polyOutcomeMatch: "match winner" },
  { opinionPattern: /lck.*gen.*bfx/i, polyPattern: /gen\.g.*bnk fearx/i, polyOutcomeMatch: "match winner" },

  // ===== ESPORTS (League of Legends - LEC new matchups) =====
  { opinionPattern: /lec.*navi.*mkoi/i, polyPattern: /natus vincere.*movistar.*koi/i, polyOutcomeMatch: "match winner" },
  { opinionPattern: /lec.*kc.*g2/i, polyPattern: /karmine corp.*g2 esports/i, polyOutcomeMatch: "match winner" },
  { opinionPattern: /lec.*fnc.*vit/i, polyPattern: /fnatic.*team vitality/i, polyOutcomeMatch: "match winner" },
  { opinionPattern: /lec.*gx.*th/i, polyPattern: /giantx.*team heretics/i, polyOutcomeMatch: "match winner" },

  // ===== ESPORTS (League of Legends - LCS) =====
  { opinionPattern: /lcs.*tlaw.*dsg/i, polyPattern: /disguised.*team liquid/i, polyOutcomeMatch: "match winner" },
  { opinionPattern: /lcs.*lyon.*fly/i, polyPattern: /lyon.*flyquest/i, polyOutcomeMatch: "match winner" },
  { opinionPattern: /lcs.*sen.*c9/i, polyPattern: /sentinels.*cloud9/i, polyOutcomeMatch: "match winner" },

  // ===== ESPORTS (League of Legends - LPL new matchups) =====
  { opinionPattern: /lpl.*jdg.*tes/i, polyPattern: /jd gaming.*top esports/i, polyOutcomeMatch: "match winner" },

  // ===== ESPORTS (League of Legends - LCP) =====
  { opinionPattern: /lcp.*tsw.*dcg/i, polyPattern: /team secret whales.*deep cross/i, polyOutcomeMatch: "match winner" },
  { opinionPattern: /lcp.*shg.*gz/i, polyPattern: /hawks gaming.*ground zero/i, polyOutcomeMatch: "match winner" },

  // ===== ESPORTS (League of Legends - CBLOL new matchups) =====
  { opinionPattern: /cblol.*los.*fur/i, polyPattern: /los.*furia/i, polyOutcomeMatch: "match winner" },

  // ===== ESPORTS (CS2 - PGL 2026) =====
  { opinionPattern: /cs2.*prv.*fal/i, polyPattern: /falcons.*parivision/i, polyOutcomeMatch: "match winner" },
  { opinionPattern: /cs2.*mouz.*navi/i, polyPattern: /mouz.*natus vincere/i, polyOutcomeMatch: "match winner" },
  { opinionPattern: /cs2.*vit.*aur/i, polyPattern: /vitality.*aurora gaming/i, polyOutcomeMatch: "match winner" },
  { opinionPattern: /cs2.*fur.*mglz/i, polyPattern: /furia.*themongolz/i, polyOutcomeMatch: "match winner" },

  // ===== ESPORTS (Valorant - VCT Masters 2026) =====
  { opinionPattern: /vct.*g2.*prx/i, polyPattern: /g2 esports.*paper rex/i, polyOutcomeMatch: "match winner" },
  { opinionPattern: /vct.*t1.*tl/i, polyPattern: /t1.*team liquid/i, polyOutcomeMatch: "match winner" },

  // ===== ESPORTS (Honor of Kings - KPL) =====
  { opinionPattern: /kpl.*ksg.*ttg/i, polyPattern: /kuaishow.*gaming.*talent.*gaming/i, polyOutcomeMatch: "match winner" },

  // ===== ESPORTS (Dota 2 - DreamLeague) =====
  { opinionPattern: /dreamleague.*mouz.*bb/i, polyPattern: /mouz.*betboom/i, polyOutcomeMatch: "match winner" },
  { opinionPattern: /dreamleague.*pari.*xg/i, polyPattern: /parivision.*xtreme/i, polyOutcomeMatch: "match winner" },
  { opinionPattern: /dreamleague.*aur.*tundra/i, polyPattern: /aurora.*tundra/i, polyOutcomeMatch: "match winner" },
  { opinionPattern: /dreamleague.*tl.*fal/i, polyPattern: /team liquid.*team falcons/i, polyOutcomeMatch: "match winner" },

  // ===== CRYPTO / INVESTIGATIONS =====
  // ZachXBT insider trading investigation
  // Opinion: "What company will be the main target of ZachXBT's upcoming investigation?" (topicId 398, multi)
  // Poly: "Which crypto company will ZachXBT expose for insider trading?"
  { opinionPattern: /zachxbt.*investigation/i, polyPattern: /zachxbt.*insider trading/i },
  { opinionPattern: /zachxbt.*upcoming.*investigation/i, polyPattern: /zachxbt.*expose.*insider/i },
  { opinionPattern: /main target.*zachxbt/i, polyPattern: /crypto company.*zachxbt/i },

  // Add more manual matches here as needed
];

/**
 * Check if a market title matches any whitelist pattern (Opinion side)
 * Used to preserve markets even if they don't have active children yet
 */
function isWhitelistedMarket(title) {
  if (!title) return false;
  const norm = title.toLowerCase();
  
  for (const rule of MANUAL_MATCH_WHITELIST) {
    const matchesOpinionPattern = rule.opinionPattern instanceof RegExp 
      ? rule.opinionPattern.test(norm)
      : norm.includes(rule.opinionPattern.toLowerCase());
    
    if (matchesOpinionPattern) return true;
  }
  return false;
}

/**
 * Check if an Opinion market matches a Poly market/event via whitelist
 * NOTE: We check BOTH directions since patterns may work either way
 * IMPORTANT: Also checks for TIME PERIOD MISMATCH to prevent "end of February" matching "end of June"
 * @returns {Object|null} - { polyEvent, polyMarket } if matched, null otherwise
 */
function checkWhitelistMatch(opinionTitle, polyEvents) {
  const opNorm = (opinionTitle || "").toLowerCase();
  
  for (const rule of MANUAL_MATCH_WHITELIST) {
    // Check if Opinion title matches the opinionPattern
    const opMatchesOpinionPattern = rule.opinionPattern instanceof RegExp 
      ? rule.opinionPattern.test(opNorm)
      : opNorm.includes(rule.opinionPattern.toLowerCase());
    
    // Also check if Opinion title matches polyPattern (reverse check for flexibility)
    const opMatchesPolyPattern = rule.polyPattern instanceof RegExp 
      ? rule.polyPattern.test(opNorm)
      : opNorm.includes(rule.polyPattern.toLowerCase());
    
    if (!opMatchesOpinionPattern && !opMatchesPolyPattern) continue;
    
    // Search for matching Poly event/market
    for (const event of polyEvents) {
      if (!isPolyEventOpen(event)) continue;
      const eventTitle = (event.title || "").toLowerCase();
      
      // Check both patterns against event
      const eventMatchesPoly = rule.polyPattern instanceof RegExp
        ? rule.polyPattern.test(eventTitle)
        : eventTitle.includes(rule.polyPattern.toLowerCase());
      const eventMatchesOpinion = rule.opinionPattern instanceof RegExp
        ? rule.opinionPattern.test(eventTitle)
        : eventTitle.includes(rule.opinionPattern.toLowerCase());
      
      if (eventMatchesPoly || eventMatchesOpinion) {
        // ===== CRITICAL: Check for time period mismatch =====
        // This prevents "end of February" from matching "end of June"
        if (hasTimePeriodMismatch(opinionTitle, event.title)) {
          // Skip this match, continue searching
          continue;
        }
        if (hasCommodityIntentMismatch(opinionTitle, event.title)) {
          // Prevent settle vs hit mismatches for silver/gold.
          continue;
        }
        if (hasIsraelStrikeScopeMismatch(opinionTitle, event.title)) {
          // Prevent Israel-only series from matching US/Israel series.
          continue;
        }
        
        console.log(`[AutoMatcher] ✓ Whitelist match: "${opinionTitle}" ↔ "${event.title}"`);
        
        // If rule specifies polyOutcomeMatch, find the specific market within the event
        // This is used for sports events where we need e.g. the "Match Winner" (moneyline) market
        if (rule.polyOutcomeMatch) {
          const targetOutcome = rule.polyOutcomeMatch.toLowerCase();
          const targetMarket = (event.markets || []).find(m => {
            if (!isPolyMarketTradable(m)) return false;
            const gTitle = (m.groupItemTitle || "").toLowerCase();
            const q = (m.question || m.title || "").toLowerCase();
            const sType = (m.sportsMarketType || "").toLowerCase();
            return gTitle.includes(targetOutcome) || q.includes(targetOutcome) || sType.includes(targetOutcome);
          });
          if (targetMarket) {
            console.log(`[AutoMatcher]   → Picked polyOutcomeMatch "${rule.polyOutcomeMatch}" → "${targetMarket.groupItemTitle || targetMarket.question}"`);
            return { polyEvent: event, polyMarket: targetMarket };
          }
        }
        
        // Return the event, let the normal flow find the best market within
        return { polyEvent: event, polyMarket: null };
      }
      
      // Also check individual markets within event
      const markets = Array.isArray(event.markets) ? event.markets : [];
      for (const market of markets) {
        if (!isPolyMarketTradable(market)) continue;
        const marketTitle = (market.question || market.title || "").toLowerCase();
        
        const marketMatchesPoly = rule.polyPattern instanceof RegExp
          ? rule.polyPattern.test(marketTitle)
          : marketTitle.includes(rule.polyPattern.toLowerCase());
        const marketMatchesOpinion = rule.opinionPattern instanceof RegExp
          ? rule.opinionPattern.test(marketTitle)
          : marketTitle.includes(rule.opinionPattern.toLowerCase());
        
        if (marketMatchesPoly || marketMatchesOpinion) {
          // ===== CRITICAL: Check for time period mismatch =====
          if (hasTimePeriodMismatch(opinionTitle, market.question || market.title)) {
            // Skip this match, continue searching
            continue;
          }
          if (hasCommodityIntentMismatch(opinionTitle, market.question || market.title)) {
            // Prevent settle vs hit mismatches for silver/gold.
            continue;
          }
          if (hasIsraelStrikeScopeMismatch(opinionTitle, market.question || market.title)) {
            // Prevent Israel-only series from matching US/Israel series.
            continue;
          }
          
          console.log(`[AutoMatcher] ✓ Whitelist match: "${opinionTitle}" ↔ "${market.question || market.title}"`);
          return { polyEvent: event, polyMarket: market };
        }
      }
    }
  }
  
  return null;
}

/**
 * Check if an event should be excluded from matching
 */
function shouldExcludeEvent(title) {
  if (!title) return true;
  return EXCLUDED_EVENT_PATTERNS.some(pattern => pattern.test(title));
}

/**
 * Keywords to search for whitelist markets that may not appear in top volume events
 * These are extracted from MANUAL_MATCH_WHITELIST patterns
 */
const WHITELIST_SEARCH_KEYWORDS = [
  // Crypto / FDV markets
  "StandX",
  "Nansen token",
  "MegaETH",
  "Fabric",
  "MicroStrategy Bitcoin",
  // Bitcoin hit price (monthly series)
  "bitcoin hit price",
  "bitcoin hit february",
  "bitcoin hit march",
  "bitcoin hit april",
  "what price will ethereum hit in february",
  "what price will solana hit in february",
  // Politics
  "Lai Ching-te Taiwan",
  "Zelenskyy out as Ukraine president",
  "Israel strikes Iran by",
  "US strike on Mexico",
  "companies acquired 2027",
  // Jobs
  "jobs added January",
  "jobs added February", 
  "jobs added March",
  // Sports
  "UEFA Champions League",
  "F1 Drivers Champion",
  "Oscars 2026 cinematography",
  // Business
  "Largest Company 2026",
  "Microsoft MSFT close above February",
  "Amazon AMZN close above February",
  "Meta META close above February",
  // AI
  "best AI model",
  // Commodities
  "Silver SI",
  "Gold GC",
  "Silver settle June",
  "Gold settle June",
  "Silver above end of June",
  "Gold above end of June",
  "Silver hit June",
  "Gold hit June",
  // ECB/Fed
  "ECB interest rates",
  "Fed decision",
  // Esports - LEC League of Legends
  "Karmine Corp GIANTX LEC",
  "Team Heretics G2 Esports LEC",
  "Natus Vincere Fnatic LEC",
  "Team Vitality Movistar KOI LEC",
  // Esports - LPL League of Legends
  "Anyone's Legend Team WE LPL",
  "Bilibili Gaming Ninjas in Pyjamas LPL",
  // Esports - CBLOL League of Legends
  "LOUD RED Canids CBLOL",
  // Esports - LCK League of Legends
  "DN Freecs DRX LCK",
  "Dplus KIA DN Freecs LCK",
  "Gen.G BNK FEARX LCK",
  // Esports - LEC League of Legends (new matchups)
  "Natus Vincere Movistar KOI LEC",
  "Karmine Corp G2 Esports LEC",
  "Fnatic Team Vitality LEC",
  "GIANTX Team Heretics LEC",
  // Esports - LCS League of Legends
  "Team Liquid Disguised LCS",
  "LYON FlyQuest LCS",
  "Sentinels Cloud9 LCS",
  // Esports - LPL League of Legends (new matchups)
  "JD Gaming Top Esports LPL",
  // Esports - LCP League of Legends
  "Team Secret Whales Deep Cross Gaming LCP",
  "SoftBank Hawks Ground Zero LCP",
  // Esports - CBLOL League of Legends (new matchups)
  "LOS FURIA CBLOL",
  // Esports - CS2 PGL 2026
  "Team Falcons PARIVISION CS2",
  "MOUZ Natus Vincere CS2",
  "Team Vitality Aurora Gaming CS2",
  "FURIA TheMongolz CS2",
  // Esports - Valorant VCT Masters 2026
  "G2 Esports Paper Rex VCT Masters",
  "T1 Team Liquid VCT Masters",
  // Esports - Honor of Kings KPL
  "KuaiShow Gaming Talent Gaming Honor of Kings",
  // Esports - Dota 2 DreamLeague
  "MOUZ BetBoom DreamLeague Dota2",
  "PARIVISION Xtreme Gaming DreamLeague Dota2",
  "Aurora Tundra Esports DreamLeague Dota2",
  "Team Liquid Team Falcons DreamLeague Dota2",
  // Crypto / Investigations
  "ZachXBT insider trading crypto company",
  "ZachXBT investigation expose",
];

/**
 * Fetch events via public-search API for whitelist keywords
 */
async function fetchWhitelistEventsViaSearch() {
  const allEvents = [];
  const seenIds = new Set();
  
  console.log(`[AutoMatcher] Fetching whitelist events via search API for ${WHITELIST_SEARCH_KEYWORDS.length} keywords...`);
  
  // Process in batches (10 concurrent to speed up discovery)
  const BATCH_SIZE = 10;
  for (let i = 0; i < WHITELIST_SEARCH_KEYWORDS.length; i += BATCH_SIZE) {
    const batch = WHITELIST_SEARCH_KEYWORDS.slice(i, i + BATCH_SIZE);
    
    const searchPromises = batch.map(async (keyword) => {
      try {
        const url = `${GAMMA_BASE}/public-search?q=${encodeURIComponent(keyword)}&limit_per_type=10`;
        const data = await fetchJson(url);
        return data?.events || [];
      } catch {
        return [];
      }
    });
    
    const results = await Promise.all(searchPromises);
    
    for (const events of results) {
      for (const e of events) {
        if (!e?.id || seenIds.has(e.id)) continue;
        if (!isPolyEventOpen(e)) continue;
        if (shouldExcludeEvent(e.title)) continue;
        const sanitized = sanitizePolyEvent(e);
        if (!sanitized) continue;
        seenIds.add(sanitized.id);
        allEvents.push(sanitized);
      }
    }
    
    // Minimal delay between batches
    if (i + BATCH_SIZE < WHITELIST_SEARCH_KEYWORDS.length) {
      await new Promise(r => setTimeout(r, 50));
    }
  }
  
  console.log(`[AutoMatcher] Found ${allEvents.length} whitelist events via search`);
  return { events: allEvents, seenIds };
}

/**
 * Fetch all active events from Polymarket with pagination
 * Returns array of events, each with nested markets[]
 * Filters out crypto micro-trading "up or down" events
 * 
 * ENHANCED: Also fetches whitelist markets via search API to ensure they're included
 */
export async function fetchAllPolymarketEvents({ limit = 200, maxPages = 20 } = {}) {
  const cacheKey = "poly:allEvents";
  const cached = cacheGet(cacheKey);
  if (cached) {
    console.log(`[AutoMatcher] Using cached ${cached.length} Poly events`);
    return cached;
  }

  console.log(`[AutoMatcher] Fetching Polymarket events from ${GAMMA_BASE}...`);
  
  // First, fetch whitelist events via search API (they may not appear in top volume)
  const { events: whitelistEvents, seenIds } = await fetchWhitelistEventsViaSearch();
  
  const allEvents = [...whitelistEvents];

  let offset = 0;
  let fetchFailed = false;

  for (let page = 0; page < maxPages; page++) {
    // Fetch ALL open events, sorted by volume (most liquid first)
    const url = `${GAMMA_BASE}/events?closed=false&limit=${limit}&offset=${offset}`;
    console.log(`[AutoMatcher] Fetching Poly events page ${page + 1}: ${url.substring(0, 80)}...`);
    const data = await fetchJson(url);

    if (!data || !Array.isArray(data) || data.length === 0) {
      if (page === 0 && whitelistEvents.length === 0) {
        console.error(`[AutoMatcher] ❌ FAILED to fetch Polymarket events - connection refused`);
        fetchFailed = true;
      }
      break;
    }
    
    console.log(`[AutoMatcher] Page ${page + 1}: received ${data.length} events`);

    // Filter out micro-trading events and deduplicate
    for (const e of data) {
      if (seenIds.has(e.id)) continue;
      seenIds.add(e.id);
      if (!shouldExcludeEvent(e.title) && isPolyEventOpen(e)) {
        const sanitized = sanitizePolyEvent(e);
        if (sanitized) allEvents.push(sanitized);
      }
    }
    
    offset += limit;

    // If we got less than limit, we've reached the end
    if (data.length < limit) {
      console.log(`[AutoMatcher] Reached end of Poly events at page ${page} (got ${data.length} < ${limit})`);
      break;
    }
  }

  console.log(`[AutoMatcher] Fetched ${allEvents.length} events total (${whitelistEvents.length} from whitelist search)`);
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
  // IMPORTANT:
  // Opinion marketId can overlap between marketType=0 (binary) and marketType=1 (categorical parent).
  // Use separate dedupe sets to avoid dropping valid categorical markets due cross-type ID collisions.
  const seenBinaryIds = new Set();
  const seenCategoricalIds = new Set();
  const startTime = Date.now();

  // Step 1: Fetch BINARY markets in parallel
  console.log(`[AutoMatcher] Fetching binary markets (marketType=0)... (max total: ${maxTotalMarkets})`);
  const binaryList = await fetchAllPagesParallel("/market", {
    status: "activated", sortBy: 5, limit, marketType: 0
  }, maxPages);
  
  for (const m of binaryList) {
    if (seenBinaryIds.has(m.marketId)) continue;
    seenBinaryIds.add(m.marketId);
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
    if (seenCategoricalIds.has(m.marketId)) continue;
    seenCategoricalIds.add(m.marketId);
    categoricalParents.push(m);
  }
  console.log(`[AutoMatcher] Found ${categoricalParents.length} categorical parents, fetching details in parallel...`);

  // OPTIMIZATION: Sort categorical parents to prioritize whitelisted markets FIRST
  // This ensures important markets are fetched before hitting the limit
  const prioritizedParents = [...categoricalParents].sort((a, b) => {
    const aWhitelisted = isWhitelistedMarket(a.marketTitle);
    const bWhitelisted = isWhitelistedMarket(b.marketTitle);
    if (aWhitelisted && !bWhitelisted) return -1; // a comes first
    if (!aWhitelisted && bWhitelisted) return 1;  // b comes first
    return 0; // keep original order
  });
  
  const whitelistedCount = prioritizedParents.filter(m => isWhitelistedMarket(m.marketTitle)).length;
  console.log(`[AutoMatcher] Prioritizing ${whitelistedCount} whitelisted markets first`);

  // Step 3: Fetch categorical details in PARALLEL (batch of 20 concurrent)
  const BATCH_SIZE = 20;
  let categoricalCount = 0;
  let whitelistKeptCount = 0;
  let skippedNoChildren = 0;
  let reachedLimit = false;
  
  for (let i = 0; i < prioritizedParents.length && !reachedLimit; i += BATCH_SIZE) {
    const batch = prioritizedParents.slice(i, i + BATCH_SIZE);
    const detailPromises = batch.map(m => 
      opinionFetch(`/market/categorical/${m.marketId}`)
        .then(detail => ({ marketId: m.marketId, title: m.marketTitle, detail }))
        .catch(() => ({ marketId: m.marketId, title: m.marketTitle, detail: null }))
    );
    
    const details = await Promise.all(detailPromises);
    
    for (const { marketId, title, detail } of details) {
      // Check if we've reached the limit
      if (allMarkets.length >= maxTotalMarkets) {
        console.log(`[AutoMatcher] Reached maxTotalMarkets limit (${maxTotalMarkets}) with categorical markets`);
        reachedLimit = true;
        break;
      }
      
      const fullData = detail?.result?.data;
      if (!fullData) {
        // Log markets where we couldn't fetch details
        console.log(`[AutoMatcher] WARN: No detail data for categorical market ${marketId}: ${title}`);
        continue;
      }
      
      const children = Array.isArray(fullData.childMarkets) ? fullData.childMarkets : [];
      const activeChildren = children.filter(c => c.status === 2 || c.statusEnum === "Activated");
      const hasActiveChildren = activeChildren.length > 0;
      
      // IMPORTANT: Keep markets that are in whitelist even without active children
      // This ensures we don't miss important markets that might have children in "Created" status
      const inWhitelist = isWhitelistedMarket(title);
      
      if (hasActiveChildren || inWhitelist) {
        allMarkets.push({ ...fullData, isCategorical: true, childMarkets: children });
        categoricalCount++;
        if (!hasActiveChildren && inWhitelist) {
          whitelistKeptCount++;
          console.log(`[AutoMatcher] WHITELIST KEEP: "${title}" (no active children but in whitelist)`);
        }
      } else {
        // Log markets that are skipped due to no active children
        skippedNoChildren++;
        // Only log first few for debugging
        if (skippedNoChildren <= 10) {
          console.log(`[AutoMatcher] SKIP: No active children for "${title}" (${children.length} total children)`);
        }
      }
    }
    
    // Log progress
    const progress = Math.min(i + BATCH_SIZE, prioritizedParents.length);
    console.log(`[AutoMatcher] Categorical progress: ${progress}/${prioritizedParents.length}`);
  }

  const elapsed = Date.now() - startTime;
  console.log(`[AutoMatcher] Found ${categoricalCount} categorical markets (${whitelistKeptCount} kept via whitelist)`);
  console.log(`[AutoMatcher] Skipped ${skippedNoChildren} categorical markets with no active children`);
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
    .replace(/\.{3,}/g, " PLACEHOLDER ")  // ... → PLACEHOLDER (at least 3 dots)
    .replace(/\.{2}/g, " PLACEHOLDER ")   // .. → PLACEHOLDER (exactly 2 dots)  
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
  
  // Check if one contains the other completely (useful for slight naming variations)
  // E.g., "MegaETH market cap (FDV) one day after launch" should match itself
  // Note: This is for cases where normalization slightly differs
  const shorter = norm1.length <= norm2.length ? norm1 : norm2;
  const longer = norm1.length > norm2.length ? norm1 : norm2;
  
  // If the shorter is substantially contained in longer (>90% of shorter's length matches)
  // and the difference is small, consider it a match
  if (shorter.length > 20 && longer.startsWith(shorter)) {
    return 0.92;
  }
  if (shorter.length > 20 && longer.endsWith(shorter)) {
    return 0.92;
  }
  
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

  // ===== CHECK WHITELIST FIRST =====
  const whitelistMatch = checkWhitelistMatch(opTitle, polyEvents);
  if (whitelistMatch) {
    return {
      type: whitelistMatch.polyMarket ? "market" : "event",
      polyEvent: whitelistMatch.polyEvent,
      polyMarket: whitelistMatch.polyMarket,
      similarity: 1.0, // Whitelist matches are perfect matches
      isWhitelisted: true, // Flag to prioritize in results
    };
  }

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
    if (!isPolyEventOpen(event)) continue;
    const eventTitle = event.title || "";
    const eventNorm = normalizeText(eventTitle);
    const eventSimilarity = calculateSimilarity(opTitle, eventTitle);

    // Debug: log any Poly events that might be related
    if (shouldDebug && debugKeywords.some(kw => eventNorm.includes(kw))) {
      console.log(`[DEBUG-MATCH]   Poly event: "${eventTitle}" → normalized: "${eventNorm}" | similarity: ${eventSimilarity}`);
    }

    // Check event-level match
    if (eventSimilarity >= minSimilarity && eventSimilarity > bestScore) {
      // ===== CRITICAL: Check for time period mismatch =====
      if (hasTimePeriodMismatch(opTitle, eventTitle)) {
        // Skip this match due to time period mismatch
        continue;
      }
      if (hasCommodityIntentMismatch(opTitle, eventTitle)) {
        // Prevent settle vs hit mismatches for silver/gold.
        continue;
      }
      if (hasIsraelStrikeScopeMismatch(opTitle, eventTitle)) {
        // Prevent Israel-only series from matching US/Israel series.
        continue;
      }
      
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
      if (!isPolyMarketTradable(market)) continue;
      const marketQuestion = market.question || market.title || "";
      const marketNorm = normalizeText(marketQuestion);
      const marketSimilarity = calculateSimilarity(opTitle, marketQuestion);

      // Debug: log any Poly markets that might be related
      if (shouldDebug && debugKeywords.some(kw => marketNorm.includes(kw))) {
        console.log(`[DEBUG-MATCH]   Poly market: "${marketQuestion}" → normalized: "${marketNorm}" | similarity: ${marketSimilarity}`);
      }

      if (marketSimilarity >= minSimilarity && marketSimilarity > bestScore) {
        // ===== CRITICAL: Check for time period mismatch =====
        if (hasTimePeriodMismatch(opTitle, marketQuestion)) {
          // Skip this match due to time period mismatch
          continue;
        }
        if (hasCommodityIntentMismatch(opTitle, marketQuestion)) {
          // Prevent settle vs hit mismatches for silver/gold.
          continue;
        }
        if (hasIsraelStrikeScopeMismatch(opTitle, marketQuestion)) {
          // Prevent Israel-only series from matching US/Israel series.
          continue;
        }
        
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
  // Match patterns like "8+", "8", "$1B", "$70-$80", etc.
  // Keep the + symbol as it differentiates "8+" from "8".
  // Use lookahead instead of \b so trailing "+" is preserved.
  const match = text.match(/^[\$]?(\d+\+?)(?=\s|$|\(|-)/);
  if (match) return match[1]; // Return "8+" or "8" etc.
  return normalizeText(text);
}

function isDateLikeOutcomeText(text) {
  const norm = normalizeText(text);
  if (!norm) return false;
  return /\b(january|february|march|april|may|june|july|august|september|october|november|december|q[1-4])\b/.test(norm);
}

function isEndOfYearAliasMatch(normalizedChildTitle, normalizedQuestion) {
  const childYearMatch = normalizedChildTitle.match(/\bdecember 31 (20\d{2})\b/);
  if (!childYearMatch) return false;
  const year = childYearMatch[1];
  const nextYear = String(Number(year) + 1);
  return normalizedQuestion.includes(`end of ${year}`) || normalizedQuestion.includes(`before ${nextYear}`);
}

function buildSeriesAnchorFromParentTitle(parentTitle) {
  const norm = normalizeText(parentTitle);
  if (!norm) return "";

  const withoutPlaceholder = norm
    .replace(/\bplaceholder\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const trimmed = withoutPlaceholder
    .replace(/\b(by|before|after|in|on|at)\s*$/i, "")
    .trim();

  return trimmed.length >= 12 ? trimmed : "";
}

/**
 * For categorical Opinion markets, find matching Poly markets for each child outcome
 * Uses STRICT matching - "8+" must match "8+", not "8"
 * @param {Object} opinionCategorical - Opinion categorical market with childMarkets
 * @param {Object|Array} polyEventOrEvents - One event or multiple candidate events
 * @returns {Array} - Array of matched pairs { opinionChild, polyMarket, similarity }
 */
function matchCategoricalOutcomes(opinionCategorical, polyEventOrEvents) {
  // Include ALL children regardless of status - some might be "Created" but still tradable
  // The orderbook fetch will fail gracefully if they're not actually tradable
  const opChildren = opinionCategorical.childMarkets || [];
  const polyEvents = Array.isArray(polyEventOrEvents)
    ? polyEventOrEvents.filter((event) => isPolyEventOpen(event))
    : (polyEventOrEvents ? [polyEventOrEvents] : []);
  const polyMarketCandidates = polyEvents.flatMap((event) => {
    const markets = Array.isArray(event.markets) ? event.markets.filter(isPolyMarketTradable) : [];
    return markets.map((market) => ({ market, event }));
  });

  const matches = [];
  const usedPolyMarketKeys = new Set();

  for (const opChild of opChildren) {
    // For categorical children, use marketTitle which is like "$1B", "8+ (200+ bps)", etc.
    const opChildTitle = opChild.marketTitle || opChild.tittle || opChild.title || "";
    if (!opChildTitle) continue;

    // Normalize the child title for matching
    const normalizedChildTitle = normalizeText(opChildTitle);
    // Extract the outcome identifier for strict matching (e.g., "8+" vs "8")
    const opOutcomeId = extractOutcomeIdentifier(opChildTitle);
    const childLooksDateLike = isDateLikeOutcomeText(opChildTitle);

    let bestMatch = null;
    let bestScore = 0;

    for (const candidate of polyMarketCandidates) {
      const polyMarket = candidate.market;
      const polyEvent = candidate.event;
      const polyQuestion = polyMarket.question || polyMarket.title || "";
      const groupItemTitle = polyMarket.groupItemTitle || "";
      const marketKey = String(polyMarket.id || polyMarket.slug || `${polyEvent?.id || polyEvent?.slug || "event"}:${polyQuestion}`);
      if (usedPolyMarketKeys.has(marketKey)) continue;
      
      // Extract outcome identifiers
      const normalizedGroupTitle = normalizeText(groupItemTitle);
      const polyGroupOutcomeId = extractOutcomeIdentifier(groupItemTitle);
      const polyQuestionOutcomeId = extractOutcomeIdentifier(polyQuestion);
      const normalizedQuestion = normalizeText(polyQuestion);
      
      // STRICT match 1: groupItemTitle exact match (most reliable)
      if (normalizedGroupTitle && normalizedChildTitle === normalizedGroupTitle) {
        bestScore = 1.0;
        bestMatch = {
          opinionChild: opChild,
          polyMarket: polyMarket,
          polyEvent: polyEvent,
          marketKey,
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
            polyEvent: polyEvent,
            marketKey,
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
            polyEvent: polyEvent,
            marketKey,
            similarity: score,
          };
        }
        continue;
      }
      
      // STRICT match 4: Full normalized title match only (no loose substring matching)
      if (normalizedQuestion === normalizedChildTitle || normalizedGroupTitle === normalizedChildTitle) {
        const score = 0.85;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = {
            opinionChild: opChild,
            polyMarket: polyMarket,
            polyEvent: polyEvent,
            marketKey,
            similarity: score,
          };
        }
      }

      // STRICT match 5: Date-like child outcome vs full Poly question
      // Example:
      // - Opinion child: "March 31 2026"
      // - Poly question: "Zelenskyy out as Ukraine president by March 31, 2026?"
      if (childLooksDateLike) {
        const containsExactDate = normalizedQuestion.includes(normalizedChildTitle);
        const endOfYearAlias = isEndOfYearAliasMatch(normalizedChildTitle, normalizedQuestion);
        if (containsExactDate || endOfYearAlias) {
          const score = containsExactDate ? 0.93 : 0.9;
          if (score > bestScore) {
            bestScore = score;
            bestMatch = {
              opinionChild: opChild,
              polyMarket: polyMarket,
              polyEvent: polyEvent,
              marketKey,
              similarity: score,
            };
          }
        }
      }
      
      // NO MORE loose substring matching like `includes()` - this caused false positives
    }

    // Only accept high-confidence matches (>= 0.8)
    if (bestMatch && bestScore >= 0.8) {
      if (bestMatch.marketKey) usedPolyMarketKeys.add(bestMatch.marketKey);
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
 * @param {number} options.maxTotalMarkets - Max Opinion markets to scan (default 100, set high for full scan)
 * @param {Function} options.onProgress - Progress callback ({ current, total, message })
 * @returns {Object} - { pairs: Array, error: string|null, polymarketAvailable: boolean }
 */
export async function discoverArbitagePairs({ minSimilarity = 0.5, maxTotalMarkets = 100, onProgress = () => {} } = {}) {
  // Fetch all markets from both exchanges
  // Opinion: Limited by maxTotalMarkets param (default 100 for quick scan, higher for full scan)
  // Polymarket: Fetch more since their API is more permissive
  const isFullScan = maxTotalMarkets > 100;
  onProgress({ current: 0, total: 0, message: isFullScan ? "Full scan - fetching all Opinion markets..." : "Fetching Opinion markets..." });
  
  // For full scan, increase maxPages to fetch more markets
  const maxPages = isFullScan ? 200 : 50;
  
  const [opinionMarkets, polyEvents] = await Promise.all([
    fetchAllOpinionMarkets({ limit: 20, maxPages, maxTotalMarkets }),
    fetchAllPolymarketEvents({ limit: 100, maxPages: isFullScan ? 30 : 15 }),
  ]);

  // Check if Polymarket API is available
  if (!polyEvents || polyEvents.length === 0) {
    console.error(`[AutoMatcher] ⚠️ Polymarket API unavailable - returning empty pairs with error flag`);
    return {
      pairs: [],
      error: "POLYMARKET_UNAVAILABLE",
      errorMessage: "Cannot connect to Polymarket API. Please check your network connection.",
      polymarketAvailable: false,
      opinionMarketsCount: opinionMarkets.length,
    };
  }

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
      // Fallback support:
      // Some Poly date-series are split into multiple single-market events.
      // For date-like categorical outcomes, expand candidate events by shared parent anchor.
      const candidateEvents = [match.polyEvent];
      const parentTitle = opMarket.marketTitle || opMarket.tittle || opMarket.title || "";
      const hasDateLikeChild = (opMarket.childMarkets || []).some((child) => {
        const childTitle = child?.marketTitle || child?.tittle || child?.title || "";
        return isDateLikeOutcomeText(childTitle);
      });

      if (hasDateLikeChild) {
        const anchor = buildSeriesAnchorFromParentTitle(parentTitle);
        if (anchor) {
          const seenEventKeys = new Set(candidateEvents.map((e) => String(e?.id || e?.slug || "")));
          const relatedEvents = polyEvents.filter((event) => {
            if (!isPolyEventOpen(event)) return false;
            const eventKey = String(event?.id || event?.slug || "");
            if (!eventKey || seenEventKeys.has(eventKey)) return false;
            const eventNorm = normalizeText(event.title || "");
            if (!eventNorm.includes(anchor)) return false;
            if (hasIsraelStrikeScopeMismatch(parentTitle, event.title || "")) return false;
            return true;
          });
          if (relatedEvents.length > 0) {
            candidateEvents.push(...relatedEvents);
            console.log(`[AutoMatcher] Date-series fallback: "${parentTitle}" expanded to ${candidateEvents.length} candidate events`);
          }
        }
      }

      const childMatches = matchCategoricalOutcomes(opMarket, candidateEvents);

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
          polyEventSlug: cm.polyEvent?.slug || match.polyEvent.slug,
          polyMarketSlug: cm.polyMarket?.slug,
          polyMarket: cm.polyMarket,
          polyTitle: cm.polyMarket?.question || cm.polyMarket?.title,
          similarity: cm.similarity,
          isWhitelisted: match.isWhitelisted || false, // Prioritized display
          autoMatched: true,
          // Volume & liquidity for stats columns (use 24h volume)
          opinionVolume: Number(cm.opinionChild.volume24h ?? cm.opinionChild.vol24h ?? cm.opinionChild.volume_24h ?? 0),
          opinionLiquidity: Number(cm.opinionChild.liquidity ?? cm.opinionChild.totalLiquidity ?? 0),
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
          if (!isPolyMarketTradable(m)) continue;
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

      // Detect if this is a sports moneyline market (polyOutcomeMatch was set in whitelist rule)
      const isSportsMoneyline = polyMarket.sportsMarketType === "moneyline" 
        || (polyMarket.groupItemTitle || "").toLowerCase().includes("match winner");

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
        isWhitelisted: match.isWhitelisted || false, // Prioritized display
        autoMatched: true,
        polyLabel: isSportsMoneyline ? "Poly-Moneyline" : undefined,
        // Volume & liquidity for stats columns (use 24h volume)
        opinionVolume: Number(opMarket.volume24h ?? opMarket.vol24h ?? opMarket.volume_24h ?? 0),
        opinionLiquidity: Number(opMarket.liquidity ?? opMarket.totalLiquidity ?? 0),
      });
    }
  }

  // Sort by similarity descending
  pairs.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));

  // Return with metadata for better error handling
  return {
    pairs,
    error: null,
    polymarketAvailable: true,
    opinionMarketsCount: opinionMarkets.length,
    polyEventsCount: polyEvents.length,
  };
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

  // Parse outcomes for display (e.g. ["Team Vitality", "Movistar KOI"] instead of ["Yes", "No"])
  const parsedOutcomes = Array.isArray(outcomes) ? outcomes.map(String) : null;
  const isStandardYesNo = parsedOutcomes && parsedOutcomes.length >= 2
    && parsedOutcomes[0].toLowerCase() === "yes" && parsedOutcomes[1].toLowerCase() === "no";

  return {
    yesTokenId: String(tokenIds[yesIdx]),
    noTokenId: String(tokenIds[noIdx]),
    // If outcomes are NOT standard Yes/No, expose them for strategy labels
    outcomes: parsedOutcomes,
    yesLabel: isStandardYesNo ? null : (parsedOutcomes?.[yesIdx] || null),
    noLabel: isStandardYesNo ? null : (parsedOutcomes?.[noIdx] || null),
  };
}

// Export utilities for testing
export { normalizeText, calculateSimilarity };
