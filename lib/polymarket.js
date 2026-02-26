// lib/polymarket.js
// NO API KEYS. Public endpoints only.
// Gamma API (metadata): https://gamma-api.polymarket.com
// CLOB API (orderbook): https://clob.polymarket.com

import dns from "dns";
import https from "https";
import { mapWithConcurrency, polyRateLimiter } from "@/lib/concurrency";

const DEFAULT_GAMMA_BASE = "https://gamma-api.polymarket.com";
const DEFAULT_CLOB_BASE = "https://clob.polymarket.com";

// Google DNS resolver to bypass local DNS issues
const googleResolver = new dns.Resolver();
googleResolver.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);

// DNS cache
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
        resolve(ip);
      }
    });
  });
}

/**
 * Fetch JSON using direct IP connection (bypasses corrupted local DNS)
 */
async function fetchJsonDirectIp(hostname, path, opts = {}) {
  const { timeoutMs = 15000, method = "GET", _retryCount = 0 } = opts;
  const MAX_RETRIES = 2;
  const ip = await resolveWithGoogleDns(hostname);
  
  return new Promise((resolve, reject) => {
    const options = {
      host: ip,
      path: path,
      method: method,
      timeout: timeoutMs,
      headers: {
        'Host': hostname,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      },
      servername: hostname
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', async () => {
        // --- 429 retry with exponential backoff ---
        if (res.statusCode === 429 && _retryCount < MAX_RETRIES) {
          const backoffMs = (2 ** _retryCount) * 1500 + Math.random() * 500;
          console.warn(`[polymarket] 429 on ${path.substring(0, 60)} – retry ${_retryCount + 1} in ${Math.round(backoffMs)}ms`);
          await new Promise(r => setTimeout(r, backoffMs));
          try {
            const result = await fetchJsonDirectIp(hostname, path, { ...opts, _retryCount: _retryCount + 1 });
            resolve(result);
          } catch (e) { reject(e); }
          return;
        }
        if (res.statusCode !== 200) {
          const err = new Error(`HTTP ${res.statusCode}`);
          err.status = res.statusCode;
          reject(err);
          return;
        }
        try {
          resolve(data ? JSON.parse(data) : null);
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

function gammaBase() {
  return (process.env.POLY_GAMMA_BASE || DEFAULT_GAMMA_BASE).replace(/\/+$/, "");
}
function clobBase() {
  return (process.env.POLY_CLOB_BASE || DEFAULT_CLOB_BASE).replace(/\/+$/, "");
}

async function fetchJson(url, opts = {}) {
  const {
    method = "GET",
    headers = {},
    body,
    timeoutMs = 15000,
  } = opts;

  // Use direct IP for Polymarket domains (bypasses local DNS issues)
  if (url.includes("polymarket.com")) {
    try {
      const urlObj = new URL(url);
      return await fetchJsonDirectIp(urlObj.hostname, urlObj.pathname + urlObj.search, { timeoutMs, method });
    } catch (err) {
      // Silently fail and return null (standard behavior)
      return null;
    }
  }

  // Standard fetch for other URLs
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
      cache: "no-store",
    });

    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!res.ok) {
      const err = new Error(
        `fetchJson failed: HTTP ${res.status} ${typeof data === "string" ? data : ""}`.trim()
      );
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  } finally {
    clearTimeout(t);
  }
}

/** ---------------- Gamma (metadata) ---------------- **/

/**
 * Get market details from CLOB API (includes end_date_iso)
 * @param {string} conditionId - The condition ID of the market
 * @returns {Object|null} - Market data including end_date_iso
 */
export async function getPolyClobMarket(conditionId) {
  if (!conditionId) return null;
  try {
    return fetchJson(`${clobBase()}/markets/${encodeURIComponent(conditionId)}`, { timeoutMs: 10000 });
  } catch {
    return null;
  }
}

/**
 * Get multiple markets from CLOB API
 * @param {string[]} conditionIds - Array of condition IDs
 * @returns {Map<string, Object>} - Map of conditionId -> market data
 */
export async function getPolyClobMarkets(conditionIds) {
  const ids = (conditionIds || []).filter(Boolean);
  const out = new Map();
  if (!ids.length) return out;
  
  // Rate-limited concurrent fetch (max 6 parallel, 8 req/s)
  await mapWithConcurrency(ids, async (cid) => {
    const market = await polyRateLimiter.run(() => getPolyClobMarket(cid));
    if (market) out.set(cid, market);
  }, { concurrency: 6 });
  
  return out;
}

export async function getPolyMarketBySlug(slug) {
  if (!slug) return null;
  // Newer Gamma supports /markets/slug/:slug
  return fetchJson(`${gammaBase()}/markets/slug/${encodeURIComponent(slug)}`);
}

export async function getPolyEventBySlug(slug) {
  if (!slug) return null;
  return fetchJson(`${gammaBase()}/events/slug/${encodeURIComponent(slug)}`);
}

/**
 * Gamma sometimes returns arrays as JSON-string. Normalize.
 */
function parseMaybeJsonArray(v) {
  if (!v) return null;
  if (Array.isArray(v)) return v;
  if (typeof v !== "string") return null;

  try {
    const j = JSON.parse(v);
    if (Array.isArray(j)) return j;
  } catch {}

  const s = v.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!s) return null;
  return s
    .split(",")
    .map((x) => x.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function getClobTokenIds(gammaMarket) {
  return (
    parseMaybeJsonArray(gammaMarket?.clobTokenIds) ||
    parseMaybeJsonArray(gammaMarket?.clob_token_ids) ||
    null
  );
}

function getOutcomesArray(gammaMarket) {
  return (
    parseMaybeJsonArray(gammaMarket?.outcomes) ||
    parseMaybeJsonArray(gammaMarket?.shortOutcomes) ||
    parseMaybeJsonArray(gammaMarket?.short_outcomes) ||
    null
  );
}

/**
 * For a binary market, return YES/NO token ids.
 * NOTE: order can vary, so we try to detect "Yes"/"No" by outcome labels.
 */
export function getYesNoTokenIds(gammaMarket) {
  const tokenIds = getClobTokenIds(gammaMarket);
  const outcomes = getOutcomesArray(gammaMarket);

  if (!tokenIds || tokenIds.length < 2) return null;

  let yesIdx = 0;
  let noIdx = 1;

  if (outcomes && outcomes.length >= 2) {
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
    outcomes: outcomes || null,
  };
}

/** ---------------- CLOB (orderbook) ---------------- **/

/**
 * Normalize price to decimal (0-1) range.
 * Polymarket CLOB typically returns prices in decimal (0-1), e.g., 0.975
 * But just in case, we handle both formats.
 */
function normalizePriceToDecimal(price) {
  if (!Number.isFinite(price)) return null;
  // If price > 1, assume it's in cents (0-100) and divide by 100
  if (price > 1) return price / 100;
  return price;
}

function normalizeBook(b) {
  // CLOB /book and /books usually returns shape:
  // { market, asset_id, bids:[{price,size}], asks:[...], ... }
  // Some wrappers might return { result: { bids, asks } } etc.
  const root = b?.result ?? b ?? {};
  const bids = Array.isArray(root?.bids) ? root.bids : [];
  const asks = Array.isArray(root?.asks) ? root.asks : [];

  // IMPORTANT: Polymarket CLOB sorts bids ASC and asks DESC
  // Best bid = highest price buyer willing to pay = LAST item in bids array
  // Best ask = lowest price seller willing to accept = LAST item in asks array
  const rawBestBid = bids.length ? Number(bids[bids.length - 1]?.price) : null;
  const rawBestAsk = asks.length ? Number(asks[asks.length - 1]?.price) : null;
  
  // Normalize to decimal (0-1)
  const bestBid = normalizePriceToDecimal(rawBestBid);
  const bestAsk = normalizePriceToDecimal(rawBestAsk);

  return {
    bestBid: Number.isFinite(bestBid) ? bestBid : null,
    bestAsk: Number.isFinite(bestAsk) ? bestAsk : null,
  };
}

/**
 * Get full orderbook for a token using /book endpoint
 * Returns bids and asks with price and size (shares)
 * @param {string} tokenId - Token ID
 * @returns {Object} - { bids: [{price, size}], asks: [{price, size}], bestBid, bestAsk, bestBidSize, bestAskSize }
 */
export async function getPolyOrderbook(tokenId) {
  if (!tokenId) return null;
  
  try {
    const url = `${clobBase()}/book?token_id=${encodeURIComponent(tokenId)}`;
    const data = await fetchJson(url, { timeoutMs: 10000 });
    
    // Response: { market, asset_id, bids: [{price, size}], asks: [{price, size}], ... }
    // CLOB sorts bids ASC (best bid = last), asks DESC (best ask = last)
    const bids = Array.isArray(data?.bids) ? data.bids : [];
    const asks = Array.isArray(data?.asks) ? data.asks : [];
    
    // Get best bid (last in ASC sorted array) and best ask (last in DESC sorted array)
    const bestBidEntry = bids.length ? bids[bids.length - 1] : null;
    const bestAskEntry = asks.length ? asks[asks.length - 1] : null;
    
    const bestBid = bestBidEntry ? Number(bestBidEntry.price) : null;
    const bestAsk = bestAskEntry ? Number(bestAskEntry.price) : null;
    const bestBidSize = bestBidEntry ? Number(bestBidEntry.size) : null;
    const bestAskSize = bestAskEntry ? Number(bestAskEntry.size) : null;
    
    return {
      bids: bids.map(b => ({ price: Number(b.price), size: Number(b.size) })),
      asks: asks.map(a => ({ price: Number(a.price), size: Number(a.size) })),
      bestBid: Number.isFinite(bestBid) ? bestBid : null,
      bestAsk: Number.isFinite(bestAsk) ? bestAsk : null,
      bestBidSize: Number.isFinite(bestBidSize) ? bestBidSize : null,
      bestAskSize: Number.isFinite(bestAskSize) ? bestAskSize : null,
    };
  } catch {
    return null;
  }
}

/**
 * Get best bid price for a single token using /price endpoint
 * This is more reliable than /books for categorical/negRisk markets
 * @param {string} tokenId - Token ID
 * @returns {number|null} - Best bid price in decimal (0-1) or null
 */
async function getPolyPriceForToken(tokenId) {
  if (!tokenId) return null;
  
  try {
    // side=buy returns the best bid price (highest price buyers are willing to pay)
    // This is what you would receive if you market SELL your tokens
    // Example: side=buy returns 0.013 = 1.3¢ best bid
    const url = `${clobBase()}/price?token_id=${encodeURIComponent(tokenId)}&side=buy`;
    const data = await fetchJson(url, { timeoutMs: 10000 });
    
    // Response: { price: "0.013" } for 1.3¢ bid
    const price = Number(data?.price);
    if (Number.isFinite(price) && price >= 0 && price <= 1) {
      return price;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get best ask price for a single token using /price endpoint
 * @param {string} tokenId - Token ID
 * @returns {number|null} - Best ask price in decimal (0-1) or null
 */
async function getPolyAskForToken(tokenId) {
  if (!tokenId) return null;
  
  try {
    // side=sell returns the best ask price (lowest price sellers are willing to accept)
    // This is what you would pay if you market BUY tokens
    const url = `${clobBase()}/price?token_id=${encodeURIComponent(tokenId)}&side=sell`;
    const data = await fetchJson(url, { timeoutMs: 10000 });
    
    const price = Number(data?.price);
    if (Number.isFinite(price) && price >= 0 && price <= 1) {
      return price;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get best bid prices for multiple tokens
 * Uses /price endpoint (more accurate than /books for categorical markets)
 * @param {string[]} tokenIds - Array of token IDs
 * @returns {Map<string, number>} - Map of tokenId -> best bid price (decimal 0-1)
 */
export async function getPolyBestBids(tokenIds) {
  const ids = (tokenIds || []).map(String).filter(Boolean);
  const out = new Map();
  if (!ids.length) return out;

  // Rate-limited concurrent fetch (max 6 parallel, 8 req/s)
  await mapWithConcurrency(ids, async (tid) => {
    const price = await polyRateLimiter.run(() => getPolyPriceForToken(tid));
    if (Number.isFinite(price)) out.set(tid, price);
  }, { concurrency: 6 });

  return out;
}

/**
 * Get orderbooks for multiple tokens (with size/shares info)
 * Uses /book endpoint to get full orderbook data
 * @param {string[]} tokenIds - Array of token IDs
 * @returns {Map<string, Object>} - Map of tokenId -> orderbook { bestBid, bestAsk, bestBidSize, bestAskSize, ... }
 */
export async function getPolyOrderbooks(tokenIds) {
  const ids = (tokenIds || []).map(String).filter(Boolean);
  const out = new Map();
  if (!ids.length) return out;

  // Rate-limited concurrent fetch (max 6 parallel, 8 req/s)
  await mapWithConcurrency(ids, async (tid) => {
    const ob = await polyRateLimiter.run(() => getPolyOrderbook(tid));
    if (ob) out.set(tid, ob);
  }, { concurrency: 6 });

  return out;
}

/**
 * Get best ask prices for multiple tokens
 * Uses /price endpoint with side=sell
 * @param {string[]} tokenIds - Array of token IDs
 * @returns {Map<string, number>} - Map of tokenId -> best ask price (decimal 0-1)
 */
export async function getPolyBestAsks(tokenIds) {
  const ids = (tokenIds || []).map(String).filter(Boolean);
  const out = new Map();
  if (!ids.length) return out;

  // Rate-limited concurrent fetch (max 6 parallel, 8 req/s)
  await mapWithConcurrency(ids, async (tid) => {
    const price = await polyRateLimiter.run(() => getPolyAskForToken(tid));
    if (Number.isFinite(price)) out.set(tid, price);
  }, { concurrency: 6 });

  return out;
}

/** ---------------- URL helpers ---------------- **/

/**
 * Generate a URL-friendly slug from title
 * Example: "How many Fed rate cuts in 2026?" -> "how-many-fed-rate-cuts-in-2026"
 */
function titleToSlug(title) {
  if (!title) return "";
  return String(title)
    .toLowerCase()
    .replace(/[?!.,;:'"()[\]{}]/g, "")  // Remove punctuation
    .replace(/[^\w\s-]/g, "")           // Remove special chars except alphanumeric, space, hyphen
    .replace(/\s+/g, "-")               // Replace spaces with hyphens
    .replace(/-+/g, "-")                // Collapse multiple hyphens
    .replace(/^-|-$/g, "");             // Remove leading/trailing hyphens
}

export function polyMarketUrlFromSlug(slug, title = null) {
  if (!slug && !title) return "https://polymarket.com";
  // Use slug directly if available, otherwise generate from title
  const finalSlug = slug || titleToSlug(title);
  // Don't encode the slug - Polymarket uses clean URLs like /event/fed-decision-january
  return `https://polymarket.com/market/${finalSlug}`;
}

export function polyEventUrlFromSlug(slug, title = null) {
  if (!slug && !title) return "https://polymarket.com";
  // Use slug directly if available, otherwise generate from title
  const finalSlug = slug || titleToSlug(title);
  // Don't encode the slug - Polymarket uses clean URLs like /event/fed-decision-january
  return `https://polymarket.com/event/${finalSlug}`;
}
