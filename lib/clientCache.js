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
