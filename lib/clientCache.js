/**
 * Client-side cache with both memory and sessionStorage
 * - Memory cache: fastest, persists during session
 * - sessionStorage: persists across navigation within same tab
 */

const CACHE = globalThis.__ODD_CLIENT_CACHE__ ?? (globalThis.__ODD_CLIENT_CACHE__ = new Map());

export function clientGet(key) {
  const it = CACHE.get(key);
  if (!it) return null;
  if (Date.now() > it.exp) {
    CACHE.delete(key);
    return null;
  }
  return it.val;
}

export function clientSet(key, val, ttlMs = 30_000) {
  CACHE.set(key, { val, exp: Date.now() + ttlMs });
  return val;
}

// ===== DISCOVER PAGE CACHE =====
const DISCOVER_CACHE_KEY = "odd_discover_cache";
const DISCOVER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Get cached discover page data (markets, bonusIds, activeTab, etc.)
 */
export function getDiscoverCache() {
  // Try memory first
  const memCache = clientGet("discover");
  if (memCache) {
    console.log("[DiscoverCache] Memory hit");
    return memCache;
  }

  // Try sessionStorage
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(DISCOVER_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.ts) return null;

    // Check expiration
    if (Date.now() - parsed.ts > DISCOVER_CACHE_TTL) {
      storage.removeItem(DISCOVER_CACHE_KEY);
      return null;
    }

    // Update memory cache
    clientSet("discover", parsed.data, DISCOVER_CACHE_TTL - (Date.now() - parsed.ts));
    console.log("[DiscoverCache] Storage hit, age:", Math.round((Date.now() - parsed.ts) / 1000), "s");
    return parsed.data;
  } catch {
    return null;
  }
}

/**
 * Save discover page state to cache
 */
export function setDiscoverCache(data) {
  if (!data) return;

  // Save to memory
  clientSet("discover", data, DISCOVER_CACHE_TTL);

  // Save to sessionStorage
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(DISCOVER_CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
    console.log("[DiscoverCache] Saved");
  } catch (e) {
    console.warn("[DiscoverCache] Failed to persist:", e.message);
  }
}

// ===== BONUS IDS CACHE (longer TTL) =====
const BONUS_CACHE_KEY = "odd_bonus_cache";
const BONUS_CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours

// ===== PROBABLE BOOSTED IDS CACHE =====
const PROBABLE_BOOSTED_CACHE_KEY = "odd_probable_boosted_cache";
const PROBABLE_BOOSTED_CACHE_TTL = 5 * 60 * 1000; // 5 minutes (boosted events change more often)

/**
 * Get cached bonus market IDs
 */
export function getBonusCache() {
  // Try memory first - use special marker to distinguish "not cached" from "cached but empty"
  const memCache = clientGet("bonusIds");
  if (memCache !== null) {
    console.log("[BonusCache] Memory hit, ids:", memCache.ids?.length ?? 0);
    return memCache; // Returns { ids: [], loaded: true } or { ids: [...], loaded: true }
  }

  // Try sessionStorage
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(BONUS_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.ids) || !parsed.ts) return null;

    if (Date.now() - parsed.ts > BONUS_CACHE_TTL) {
      storage.removeItem(BONUS_CACHE_KEY);
      return null;
    }

    // Return object with loaded flag to distinguish from "not cached"
    const result = { ids: parsed.ids, loaded: true };
    clientSet("bonusIds", result, BONUS_CACHE_TTL - (Date.now() - parsed.ts));
    console.log("[BonusCache] Storage hit, ids:", parsed.ids.length, "age:", Math.round((Date.now() - parsed.ts) / 1000 / 60), "min");
    return result;
  } catch {
    return null;
  }
}

/**
 * Save bonus IDs to cache
 */
export function setBonusCache(ids) {
  if (!Array.isArray(ids)) return;

  // Memory cache - wrap in object with loaded flag
  clientSet("bonusIds", { ids, loaded: true }, BONUS_CACHE_TTL);

  // sessionStorage
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(BONUS_CACHE_KEY, JSON.stringify({ ts: Date.now(), ids }));
    console.log("[BonusCache] Saved", ids.length, "ids");
  } catch {}
}

// ===== PROBABLE BOOSTED IDS CACHE =====

/**
 * Get cached Probable boosted market IDs
 */
export function getProbableBoostedCache() {
  const memCache = clientGet("probableBoostedIds");
  if (memCache !== null) return memCache;

  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(PROBABLE_BOOSTED_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.ids) || !parsed.ts) return null;

    if (Date.now() - parsed.ts > PROBABLE_BOOSTED_CACHE_TTL) {
      storage.removeItem(PROBABLE_BOOSTED_CACHE_KEY);
      return null;
    }

    const result = { ids: parsed.ids, loaded: true };
    clientSet("probableBoostedIds", result, PROBABLE_BOOSTED_CACHE_TTL - (Date.now() - parsed.ts));
    console.log("[ProbableBoostedCache] Storage hit, ids:", parsed.ids.length);
    return result;
  } catch {
    return null;
  }
}

/**
 * Save Probable boosted market IDs to cache
 */
export function setProbableBoostedCache(ids) {
  if (!Array.isArray(ids)) return;

  clientSet("probableBoostedIds", { ids, loaded: true }, PROBABLE_BOOSTED_CACHE_TTL);

  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(PROBABLE_BOOSTED_CACHE_KEY, JSON.stringify({ ts: Date.now(), ids }));
    console.log("[ProbableBoostedCache] Saved", ids.length, "ids");
  } catch {}
}

/**
 * Clear all discover caches
 */
export function clearDiscoverCache() {
  CACHE.delete("discover");
  CACHE.delete("bonusIds");
  CACHE.delete("probableBoostedIds");
  
  const storage = getStorage();
  if (storage) {
    try {
      storage.removeItem(DISCOVER_CACHE_KEY);
      storage.removeItem(BONUS_CACHE_KEY);
      storage.removeItem(PROBABLE_BOOSTED_CACHE_KEY);
    } catch {}
  }
}
