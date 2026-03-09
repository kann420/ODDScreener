/**
 * Simple in-memory IP rate limiter for API routes.
 * Uses a sliding window approach with automatic cleanup.
 */

const DEFAULT_WINDOW_MS = 60_000; // 1 minute
const DEFAULT_MAX_REQUESTS = 10;
const CLEANUP_INTERVAL_MS = 5 * 60_000; // Clean up every 5 minutes
const MAX_ENTRIES = 10_000; // Prevent unbounded memory growth

const stores = new Map(); // name -> { hits: Map, cleanupTimer }
const concurrentStores = new Map(); // name -> { hits: Map, cleanupTimer, staleMs }

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
export function getClientIp(request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function getConcurrentStore(name, { staleMs = 30 * 60_000 } = {}) {
  if (concurrentStores.has(name)) return concurrentStores.get(name);

  const hits = new Map(); // key -> { count, updatedAt }
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of hits) {
      if (!value || now - value.updatedAt >= staleMs) {
        hits.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);

  if (cleanupTimer.unref) cleanupTimer.unref();

  const store = { hits, staleMs };
  concurrentStores.set(name, store);
  return store;
}

export function checkRateLimitByKey(key, name, opts = {}) {
  const store = getStore(name, opts);
  const normalizedKey = key || "unknown";
  const now = Date.now();

  let timestamps = store.hits.get(normalizedKey) || [];
  timestamps = timestamps.filter((t) => now - t < store.windowMs);

  if (timestamps.length >= store.maxRequests) {
    const oldestInWindow = timestamps[0];
    const resetMs = store.windowMs - (now - oldestInWindow);
    return { limited: true, remaining: 0, resetMs };
  }

  if (store.hits.size >= MAX_ENTRIES && !store.hits.has(normalizedKey)) {
    const firstKey = store.hits.keys().next().value;
    store.hits.delete(firstKey);
  }

  timestamps.push(now);
  store.hits.set(normalizedKey, timestamps);

  return {
    limited: false,
    remaining: store.maxRequests - timestamps.length,
    resetMs: store.windowMs,
  };
}

/**
 * Check rate limit for a request.
 * @param {Request} request - Next.js Request object
 * @param {string} name - Limiter name
 * @param {{ windowMs?: number, maxRequests?: number }} opts
 * @returns {{ limited: boolean, remaining: number, resetMs: number }}
 */
export function checkRateLimit(request, name, opts = {}) {
  return checkRateLimitByKey(getClientIp(request), name, opts);
}

export function acquireConcurrentLimitByKey(key, name, opts = {}) {
  const { maxConcurrent = 1, staleMs = 30 * 60_000 } = opts;
  const store = getConcurrentStore(name, { staleMs });
  const normalizedKey = key || "unknown";
  const now = Date.now();
  const current = store.hits.get(normalizedKey);
  const activeCount = current && now - current.updatedAt < store.staleMs ? current.count : 0;

  if (activeCount >= maxConcurrent) {
    return { limited: true, activeCount, maxConcurrent };
  }

  store.hits.set(normalizedKey, {
    count: activeCount + 1,
    updatedAt: now,
  });

  return { limited: false, activeCount: activeCount + 1, maxConcurrent };
}

export function releaseConcurrentLimitByKey(name, key) {
  const store = concurrentStores.get(name);
  if (!store) return;

  const normalizedKey = key || "unknown";
  const current = store.hits.get(normalizedKey);
  if (!current) return;

  if (current.count <= 1) {
    store.hits.delete(normalizedKey);
    return;
  }

  store.hits.set(normalizedKey, {
    count: current.count - 1,
    updatedAt: Date.now(),
  });
}
