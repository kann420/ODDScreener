/**
 * Polymarket Fetch Helper
 * 
 * Uses direct IP connection via Google DNS to bypass local DNS issues.
 * This is needed because some routers/ISPs return incorrect DNS for Polymarket domains.
 */

import dns from "dns";
import https from "https";

// Cloudflare DNS resolver
const cloudflareResolver = new dns.Resolver();
cloudflareResolver.setServers(["1.1.1.1"]);
console.log("[PolyFetch][DNS] Using Cloudflare DNS resolver: 1.1.1.1");

// DNS cache
const dnsCache = new Map();
const DNS_CACHE_TTL = 300000; // 5 minutes

/**
 * Resolve hostname using Google DNS
 */
async function resolveWithCloudflareDns(hostname) {
  const cached = dnsCache.get(hostname);
  if (cached && Date.now() < cached.exp) {
    return cached.ip;
  }
  
  return new Promise((resolve, reject) => {
    cloudflareResolver.resolve4(hostname, (err, addresses) => {
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
 * Fetch from Polymarket using direct IP connection
 * 
 * @param {string} url - Full URL to fetch
 * @param {Object} options - Fetch options
 * @param {number} options.timeoutMs - Timeout in milliseconds (default: 15000)
 * @param {string} options.method - HTTP method (default: "GET")
 * @param {Object} options.headers - Additional headers
 * @returns {Promise<Response>} - Fetch-like response object
 */
export async function polyFetch(url, options = {}) {
  const { timeoutMs = 15000, method = "GET", headers = {} } = options;
  
  const urlObj = new URL(url);
  const hostname = urlObj.hostname;
  
  // Only use direct IP for polymarket domains
  if (!hostname.includes("polymarket.com")) {
    // Fall back to standard fetch for non-Polymarket URLs
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        method,
        headers,
        signal: controller.signal,
        cache: "no-store",
      });
    } finally {
      clearTimeout(timeout);
    }
  }
  
  const ip = await resolveWithCloudflareDns(hostname);
  
  return new Promise((resolve, reject) => {
    const reqOptions = {
      host: ip,
      path: urlObj.pathname + urlObj.search,
      method: method,
      timeout: timeoutMs,
      headers: {
        'Host': hostname,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0',
        ...headers,
      },
      servername: hostname, // For SNI
    };
    
    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // Create a fetch-like response object
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage || '',
          headers: new Map(Object.entries(res.headers)),
          text: async () => data,
          json: async () => {
            try {
              return JSON.parse(data);
            } catch (e) {
              throw new Error('Invalid JSON response');
            }
          },
        });
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

/**
 * Fetch JSON from Polymarket
 * 
 * @param {string} url - Full URL to fetch
 * @param {Object} options - Fetch options
 * @returns {Promise<any>} - Parsed JSON response or null on error
 */
export async function polyFetchJson(url, options = {}) {
  const MAX_RETRIES = 2;
  const _retryCount = options._retryCount || 0;

  try {
    const res = await polyFetch(url, options);

    // --- 429 retry with exponential backoff ---
    if (res.status === 429 && _retryCount < MAX_RETRIES) {
      const backoffMs = (2 ** _retryCount) * 1500 + Math.random() * 500;
      console.warn(`[polyFetchJson] 429 on ${url.substring(0, 60)} – retry ${_retryCount + 1} in ${Math.round(backoffMs)}ms`);
      await new Promise(r => setTimeout(r, backoffMs));
      return polyFetchJson(url, { ...options, _retryCount: _retryCount + 1 });
    }

    if (!res.ok) {
      console.error(`[polyFetchJson] HTTP ${res.status} for ${url.substring(0, 80)}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`[polyFetchJson] Error fetching ${url.substring(0, 80)}:`, err.message);
    return null;
  }
}
