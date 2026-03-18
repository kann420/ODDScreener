import { fetchAllPredictFunMarkets, predictFunFetch, predictFunMarketUrl } from "@/lib/predictfun";
import { insertTrade, pruneOldTrades } from "@/lib/smartMoneyDb";
import {
  buildPredictFunMatchFingerprint,
  minAmountToUsdtWei,
  normalizePredictFunSmartMoneyMatch,
} from "@/lib/utils/predictfunSmartMoney";

const TRADE_TTL_MS = 24 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 15_000;
const MARKET_REFRESH_MS = 10 * 60 * 1000;
const DEFAULT_MIN_AMOUNT = 200;
const MAX_LATEST = 200;
const MAX_FINGERPRINTS = 5000;

let hub = globalThis.__SMART_MONEY_PREDICTFUN_HUB__;

if (!hub) {
  hub = {
    started: false,
    starting: false,
    initialLoadPromise: null,
    latest: [],
    clients: new Set(),
    fingerprints: new Map(),
    marketById: new Map(),
    pollTimer: null,
    marketRefreshTimer: null,
    lastPollAt: 0,
    lastSuccessAt: 0,
    lastError: null,
    lastFingerprint: null,
    lastMarketRefreshAt: 0,
  };
  globalThis.__SMART_MONEY_PREDICTFUN_HUB__ = hub;
}

function pruneLatest() {
  const cutoff = Date.now() - TRADE_TTL_MS;
  hub.latest = hub.latest
    .filter((item) => Number(item?.ts || 0) >= cutoff)
    .slice(0, MAX_LATEST);
}

function pruneFingerprints() {
  const cutoff = Date.now() - TRADE_TTL_MS;
  for (const [key, ts] of hub.fingerprints) {
    if (!Number.isFinite(ts) || ts < cutoff) {
      hub.fingerprints.delete(key);
    }
  }

  while (hub.fingerprints.size > MAX_FINGERPRINTS) {
    const oldest = hub.fingerprints.keys().next().value;
    hub.fingerprints.delete(oldest);
  }
}

function pushLatest(item) {
  hub.latest.unshift(item);
  pruneLatest();
}

function broadcast(item) {
  for (const client of hub.clients) {
    if (Number(item.amount || 0) >= Number(client.minAmount || DEFAULT_MIN_AMOUNT)) {
      client.push(item);
    }
  }
}

function currentTrackedMinAmount() {
  let minAmount = Number.POSITIVE_INFINITY;
  for (const client of hub.clients) {
    const candidate = Number(client?.minAmount || 0);
    if (Number.isFinite(candidate) && candidate > 0) {
      minAmount = Math.min(minAmount, candidate);
    }
  }
  if (!Number.isFinite(minAmount)) return DEFAULT_MIN_AMOUNT;
  return Math.max(DEFAULT_MIN_AMOUNT, minAmount);
}

function rememberMarketMeta(market) {
  const marketId = Number(market?.id);
  if (!Number.isFinite(marketId)) return;

  hub.marketById.set(marketId, {
    marketId,
    marketTitle: market?.title || market?.question || "",
    marketQuestion: market?.question || null,
    categoryTitle: market?._categoryTitle || null,
    marketImageUrl: market?.imageUrl || null,
    categorySlug: market?.categorySlug || null,
    marketUrl: market?.categorySlug ? predictFunMarketUrl(marketId, market.categorySlug) : null,
  });
}

async function refreshMarketCache() {
  try {
    const markets = await fetchAllPredictFunMarkets({
      pageSize: 50,
      maxMarkets: 300,
      enrichCategoryEndDate: false,
    });

    for (const market of markets) {
      rememberMarketMeta(market);
    }

    hub.lastMarketRefreshAt = Date.now();
  } catch (err) {
    console.error("[SmartMoney][PredictFun] refreshMarketCache failed:", err?.message || err);
  }
}

async function pollMatches() {
  hub.lastPollAt = Date.now();

  try {
    const minValueUsdtWei = minAmountToUsdtWei(currentTrackedMinAmount());
    const res = await predictFunFetch("/v1/orders/matches", {
      params: {
        first: "100",
        ...(minValueUsdtWei ? { minValueUsdtWei } : {}),
      },
      timeoutMs: 15_000,
      retries: 1,
    });

    const matches = Array.isArray(res?.data) ? res.data : [];
    let inserted = 0;

    for (const match of matches) {
      const fingerprint = buildPredictFunMatchFingerprint(match);
      if (!fingerprint || hub.fingerprints.has(fingerprint)) continue;

      const normalized = normalizePredictFunSmartMoneyMatch(match, hub.marketById);
      if (!normalized) continue;

      hub.fingerprints.set(fingerprint, normalized.ts);
      hub.lastFingerprint = fingerprint;
      pushLatest(normalized);
      insertTrade(normalized);
      broadcast(normalized);
      inserted++;
    }

    pruneFingerprints();
    if (inserted > 0 && hub.latest.length % 50 === 0) {
      pruneOldTrades({ days: 7 });
    }

    hub.lastSuccessAt = Date.now();
    hub.lastError = null;
  } catch (err) {
    hub.lastError = err?.message || String(err);
    console.error("[SmartMoney][PredictFun] pollMatches failed:", hub.lastError);
  }
}

function startPollTimer() {
  if (hub.pollTimer) clearInterval(hub.pollTimer);
  hub.pollTimer = setInterval(() => {
    pollMatches().catch(() => {});
  }, POLL_INTERVAL_MS);
}

function startMarketRefreshTimer() {
  if (hub.marketRefreshTimer) clearInterval(hub.marketRefreshTimer);
  hub.marketRefreshTimer = setInterval(() => {
    refreshMarketCache().catch(() => {});
  }, MARKET_REFRESH_MS);
}

export function startPredictFunSmartMoneyHub() {
  if (hub.initialLoadPromise) return hub.initialLoadPromise;
  if (hub.started || hub.starting) return Promise.resolve();
  hub.starting = true;
  hub.initialLoadPromise = Promise.allSettled([
    refreshMarketCache(),
    pollMatches(),
  ]).finally(() => {
    hub.started = true;
    hub.starting = false;
  });

  startPollTimer();
  startMarketRefreshTimer();
  return hub.initialLoadPromise;
}

export function addPredictFunSmartMoneyClient(client) {
  hub.clients.add(client);
  return () => hub.clients.delete(client);
}

export function getPredictFunSmartMoneyLatest() {
  pruneLatest();
  return hub.latest;
}

export function getPredictFunSmartMoneyHubStatus() {
  return {
    started: !!hub.started,
    polling: true,
    latestCount: Array.isArray(hub.latest) ? hub.latest.length : 0,
    trackedMarkets: hub.marketById.size,
    lastPollAt: hub.lastPollAt || 0,
    lastSuccessAt: hub.lastSuccessAt || 0,
    lastError: hub.lastError || null,
    lastFingerprint: hub.lastFingerprint || null,
    lastMarketRefreshAt: hub.lastMarketRefreshAt || 0,
  };
}

export function getPredictFunSmartMoneyMarketMeta(marketId) {
  return hub.marketById.get(Number(marketId)) || null;
}
