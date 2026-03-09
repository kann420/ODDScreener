/**
 * Simple in-memory IP rate limiter for API routes.
 * Uses a sliding window approach with automatic cleanup.
 */

const DEFAULT_WINDOW_MS = 60_000; // 1 minute
const DEFAULT_MAX_REQUESTS = 10;
const CLEANUP_INTERVAL_MS = 5 * 60_000; // Clean up every 5 minutes
const MAX_ENTRIES = 10_000; // Prevent unbounded memory growth

const stores = new Map(); // name -> { hits: Map, cleanupTimer }

/**
 * Create or retrieve a named rate limiter.
 * @param {string} name - Unique limiter name (e.g. "access-validate")
 * @param {{ windowMs?: number, maxRequests?: number }} opts
 */
function getStore(name, { windowMs = DEFAULT_WINDOW_MS, maxRequests = DEFAULT_MAX_REQUESTS } = {}) {
  if (stores.has(name)) return stores.get(name);

  const hits = new Map(); // key -> [timestamp, ...]

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of hits) {
      const valid = timestamps.filter(t => now - t < windowMs);
      if (valid.length === 0) hits.delete(key);
      else hits.set(key, valid);
    }
  }, CLEANUP_INTERVAL_MS);

  // Don't keep Node process alive just for cleanup
  if (cleanupTimer.unref) cleanupTimer.unref();

  const store = { hits, windowMs, maxRequests };
  stores.set(name, store);
  return store;
}

/**
 * Extract client IP from Next.js request.
 */
function getClientIp(request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * Check rate limit for a request.
 * @param {Request} request - Next.js Request object
 * @param {string} name - Limiter name
 * @param {{ windowMs?: number, maxRequests?: number }} opts
 * @returns {{ limited: boolean, remaining: number, resetMs: number }}
 */
export function checkRateLimit(request, name, opts = {}) {
  const store = getStore(name, opts);
  const key = getClientIp(request);
  const now = Date.now();

  let timestamps = store.hits.get(key) || [];
  timestamps = timestamps.filter(t => now - t < store.windowMs);

  if (timestamps.length >= store.maxRequests) {
    const oldestInWindow = timestamps[0];
    const resetMs = store.windowMs - (now - oldestInWindow);
    return { limited: true, remaining: 0, resetMs };
  }

  // Prevent unbounded memory growth
  if (store.hits.size >= MAX_ENTRIES && !store.hits.has(key)) {
    // Evict oldest entry
    const firstKey = store.hits.keys().next().value;
    store.hits.delete(firstKey);
  }

  timestamps.push(now);
  store.hits.set(key, timestamps);

  return {
    limited: false,
    remaining: store.maxRequests - timestamps.length,
    resetMs: store.windowMs,
  };
}
