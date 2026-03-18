import { fetchAllPredictFunMarkets } from "@/lib/predictfun";
import PredictFunListClient from "@/components/PredictFunListClient";

/**
 * Server-side cache for Predict.fun markets
 */
const _pfCache = globalThis.__PF_DISCOVER_SSR_CACHE__ ?? (globalThis.__PF_DISCOVER_SSR_CACHE__ = {
  data: null,
  fetchedAt: 0,
  building: null,
  TTL: 300_000, // 5 minutes
});
if (!globalThis.__PF_DISCOVER_SSR_CACHE__) globalThis.__PF_DISCOVER_SSR_CACHE__ = _pfCache;

async function _fetchPfInternal() {
  const startTime = Date.now();
  try {
    const markets = await fetchAllPredictFunMarkets({
      pageSize: 50,
      maxMarkets: 600,
      enrichCategoryEndDate: true,
    });

    const filtered = (markets || []).filter((m) => {
      if (!m.isVisible) return false;
      if (m.tradingStatus !== "OPEN") return false;
      if (m.resolution != null) return false;
      return true;
    });

    console.log(`[PF SSR] Fetched ${filtered.length} active markets in ${Date.now() - startTime}ms`);
    return { error: false, markets: filtered };
  } catch (err) {
    console.error("[PF SSR] Fetch failed:", err?.message);
    return { error: true, markets: [] };
  }
}

async function fetchPfMarkets() {
  const now = Date.now();

  if (_pfCache.data && !_pfCache.data.error && (now - _pfCache.fetchedAt) < _pfCache.TTL) {
    console.log(`[PF SSR] Cache HIT (age ${Math.round((now - _pfCache.fetchedAt) / 1000)}s)`);
    return _pfCache.data;
  }

  if (_pfCache.building) {
    return _pfCache.building;
  }

  _pfCache.building = _fetchPfInternal()
    .then((result) => {
      _pfCache.building = null;
      if (!result.error) {
        _pfCache.data = result;
        _pfCache.fetchedAt = Date.now();
      }
      return result;
    })
    .catch((err) => {
      _pfCache.building = null;
      if (_pfCache.data && !_pfCache.data.error) return _pfCache.data;
      return { error: true, markets: [] };
    });

  return _pfCache.building;
}

async function PredictFunContent() {
  const { error, markets } = await fetchPfMarkets();

  if (error && (!markets || markets.length === 0)) {
    return (
      <div className="panel" style={{ padding: 14 }}>
        <p className="muted" style={{ marginTop: 8 }}>
          Failed to load Predict.fun markets. Please try again later.
        </p>
      </div>
    );
  }

  return (
    <PredictFunListClient
      initialMarkets={markets}
      needsFullFetch={!_pfCache.data || _pfCache.data.error}
    />
  );
}

export { PredictFunContent };
