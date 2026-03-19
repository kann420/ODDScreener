import {
  fetchAllPredictFunMarkets,
  predictFunFetch,
  primePredictFunMarketCache,
} from "@/lib/predictfun";

const QUICK_TTL = 30_000;
const FULL_TTL = 300_000;

const _pfDiscoverCache =
  globalThis.__PF_DISCOVER_CACHE__ ??
  (globalThis.__PF_DISCOVER_CACHE__ = {
    fullData: null,
    fullFetchedAt: 0,
    fullBuilding: null,
    quickData: null,
    quickFetchedAt: 0,
    quickBuilding: null,
    fullTtl: FULL_TTL,
    quickTtl: QUICK_TTL,
  });

if (!globalThis.__PF_DISCOVER_CACHE__) {
  globalThis.__PF_DISCOVER_CACHE__ = _pfDiscoverCache;
}

function isTradableMarket(market) {
  if (!market?.isVisible) return false;
  if (market?.tradingStatus !== "OPEN") return false;
  if (market?.resolution != null) return false;
  return true;
}

function filterTradableMarkets(markets) {
  return (Array.isArray(markets) ? markets : []).filter(isTradableMarket);
}

function dedupeMarkets(markets) {
  const byId = new Map();
  for (const market of Array.isArray(markets) ? markets : []) {
    const id = market?.id;
    if (!id) continue;
    if (!byId.has(String(id))) {
      byId.set(String(id), market);
      continue;
    }

    const existing = byId.get(String(id));
    byId.set(String(id), {
      ...existing,
      ...market,
      stats: market?.stats ?? existing?.stats ?? null,
    });
  }
  return Array.from(byId.values());
}

async function fetchQuickMarketSlice(params) {
  const res = await predictFunFetch("/v1/markets", { params });
  if (!res?.success || !Array.isArray(res.data)) {
    return [];
  }

  const filtered = filterTradableMarkets(res.data);
  for (const market of filtered) {
    primePredictFunMarketCache(market);
  }
  return filtered;
}

async function _fetchPredictFunDiscoverQuickInitialInternal() {
  const startTime = Date.now();
  try {
    const [topVolumeMarkets, boostedMarkets] = await Promise.all([
      fetchQuickMarketSlice({
        first: "24",
        status: "OPEN",
        sort: "VOLUME_24H_DESC",
        includeStats: "true",
      }),
      fetchQuickMarketSlice({
        first: "24",
        status: "OPEN",
        sort: "VOLUME_24H_DESC",
        includeStats: "true",
        isBoosted: "true",
      }).catch(() => []),
    ]);

    const markets = dedupeMarkets([...boostedMarkets, ...topVolumeMarkets]);
    console.log(
      `[PF Discover] Quick initial fetched ${markets.length} markets in ${Date.now() - startTime}ms`
    );
    return { error: false, markets };
  } catch (err) {
    console.error("[PF Discover] Quick initial failed:", err?.message || err);
    return { error: true, markets: [] };
  }
}

async function _fetchPredictFunDiscoverFullInternal() {
  const startTime = Date.now();
  try {
    const markets = await fetchAllPredictFunMarkets({
      pageSize: 50,
      maxMarkets: 600,
      enrichCategoryEndDate: true,
    });

    const filtered = filterTradableMarkets(markets);
    console.log(
      `[PF Discover] Full fetch ${filtered.length}/${markets.length} active markets in ${Date.now() - startTime}ms`
    );
    return { error: false, markets: filtered };
  } catch (err) {
    console.error("[PF Discover] Full fetch failed:", err?.message || err);
    return { error: true, markets: [] };
  }
}

export function getPredictFunDiscoverCache() {
  return _pfDiscoverCache;
}

export async function fetchPredictFunDiscoverQuickInitial() {
  const now = Date.now();
  if (
    _pfDiscoverCache.quickData &&
    !_pfDiscoverCache.quickData.error &&
    now - _pfDiscoverCache.quickFetchedAt < _pfDiscoverCache.quickTtl
  ) {
    return _pfDiscoverCache.quickData;
  }

  if (_pfDiscoverCache.quickBuilding) {
    return _pfDiscoverCache.quickBuilding;
  }

  _pfDiscoverCache.quickBuilding = _fetchPredictFunDiscoverQuickInitialInternal()
    .then((result) => {
      _pfDiscoverCache.quickBuilding = null;
      if (!result.error) {
        _pfDiscoverCache.quickData = result;
        _pfDiscoverCache.quickFetchedAt = Date.now();
      }
      return result;
    })
    .catch((err) => {
      _pfDiscoverCache.quickBuilding = null;
      if (_pfDiscoverCache.quickData && !_pfDiscoverCache.quickData.error) {
        return _pfDiscoverCache.quickData;
      }
      return { error: true, markets: [] };
    });

  return _pfDiscoverCache.quickBuilding;
}

export async function fetchPredictFunDiscoverFull() {
  const now = Date.now();
  if (
    _pfDiscoverCache.fullData &&
    !_pfDiscoverCache.fullData.error &&
    now - _pfDiscoverCache.fullFetchedAt < _pfDiscoverCache.fullTtl
  ) {
    return _pfDiscoverCache.fullData;
  }

  if (_pfDiscoverCache.fullBuilding) {
    return _pfDiscoverCache.fullBuilding;
  }

  _pfDiscoverCache.fullBuilding = _fetchPredictFunDiscoverFullInternal()
    .then((result) => {
      _pfDiscoverCache.fullBuilding = null;
      if (!result.error) {
        _pfDiscoverCache.fullData = result;
        _pfDiscoverCache.fullFetchedAt = Date.now();
      }
      return result;
    })
    .catch((err) => {
      _pfDiscoverCache.fullBuilding = null;
      if (_pfDiscoverCache.fullData && !_pfDiscoverCache.fullData.error) {
        return _pfDiscoverCache.fullData;
      }
      return { error: true, markets: [] };
    });

  return _pfDiscoverCache.fullBuilding;
}

export async function getPredictFunDiscoverPageState() {
  const now = Date.now();
  const hasWarmFullData =
    _pfDiscoverCache.fullData &&
    !_pfDiscoverCache.fullData.error &&
    now - _pfDiscoverCache.fullFetchedAt < _pfDiscoverCache.fullTtl;

  if (hasWarmFullData) {
    return {
      error: false,
      markets: _pfDiscoverCache.fullData.markets,
      needsFullFetch: false,
      source: "full",
    };
  }

  if (!_pfDiscoverCache.fullBuilding) {
    fetchPredictFunDiscoverFull().catch(() => {});
  }

  const quick = await fetchPredictFunDiscoverQuickInitial();
  if (!quick.error && quick.markets.length > 0) {
    return {
      error: false,
      markets: quick.markets,
      needsFullFetch: true,
      source: "quick",
    };
  }

  const full = await fetchPredictFunDiscoverFull();
  return {
    error: full.error,
    markets: full.markets,
    needsFullFetch: false,
    source: "full-fallback",
  };
}
