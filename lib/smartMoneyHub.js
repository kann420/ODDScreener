// lib/smartMoneyHub.js
import { opinionFetch, normalizeMarketList } from "@/lib/opinion";
import { insertTrade, pruneOldTrades } from "@/lib/smartMoneyDb"; // ✅ persist trades

let hub = globalThis.__SMART_MONEY_HUB__;

if (!hub) {
  hub = {
    ws: null,
    wsReady: false,
    clients: new Set(), // { push, minAmount }
    latest: [],
    maxLatest: 200,
    subscribedMarketIds: new Set(),
    marketTitleById: new Map(),
    started: false,
    starting: false,
    heartbeat: null,
    lastSubscribedAt: 0,
    resubTimer: null,

    // ✅ NEW: background keepalive clients to MarketTradesHub (for Recent Trades)
    // key: marketId (number) -> cleanup fn returned by addMarketClient
    bgRecentUnsubs: new Map(),
  };
  globalThis.__SMART_MONEY_HUB__ = hub;
}

const HEARTBEAT_INTERVAL = 25_000;

// ✅ ONLY keep last 24h trades (in-memory)
const TRADE_TTL_MS = 24 * 60 * 60 * 1000;

// ✅ Auto refresh subscriptions every 1 hour
const RESUBSCRIBE_INTERVAL_MS = 60 * 60 * 1000;

// ✅ subscribe top N markets
const TOP_N = 100;

// ✅ Fetch a wider universe to compute Top N ourselves.
const UNIVERSE_PAGES = 40; // 40 pages * 20 = 800 markets max (safe cap)
const PAGE_LIMIT = 20;

function formatPrice(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return "";
  if (n >= 0 && n <= 1.2) return `${(n * 100).toFixed(1)}¢`;
  return `${n}`;
}

function normalizeOutcome(outcomeSide) {
  if (outcomeSide === 1 || outcomeSide === "1") return "YES";
  if (outcomeSide === 2 || outcomeSide === "2") return "NO";
  return outcomeSide ?? "";
}

function pruneLatest() {
  const cutoff = Date.now() - TRADE_TTL_MS;
  hub.latest = hub.latest
    .filter((x) => Number(x?.ts || 0) >= cutoff)
    .slice(0, hub.maxLatest);
}

function pushLatest(item) {
  hub.latest.unshift(item); // newest first
  pruneLatest();
}

function broadcast(item) {
  for (const c of hub.clients) {
    if (Number(item.amount) >= Number(c.minAmount || 1000)) {
      c.push(item);
    }
  }
}

/**
 * Extract 24h volume similar to how UI typically does.
 * Try multiple field names.
 */
function getVolume24h(m) {
  if (!m || typeof m !== "object") return 0;

  const candidates = [
    m.volume24h,
    m.volume_24h,
    m.volume24H,
    m.volume_24H,
    m.vol24h,
    m.vol_24h,
    m.volume24,
    m.volume_24,
    m.volume, // last fallback
  ];

  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function getMarketId(m) {
  const id = Number(m?.marketId ?? m?.id ?? m?.market_id);
  return Number.isFinite(id) ? id : null;
}

function getMarketTitle(m) {
  return m?.title ?? m?.marketTitle ?? m?.name ?? "";
}

function getWsUrl() {
  // ✅ Prefer WS key; fallback to API key if you only have 1 key
  const apiKey = process.env.OPINION_WS_KEY || process.env.OPINION_API_KEY || "";
  if (!apiKey) return null;
  return `wss://ws.opinion.trade?apikey=${apiKey}`;
}

function startHeartbeat() {
  if (hub.heartbeat) clearInterval(hub.heartbeat);
  hub.heartbeat = setInterval(() => {
    try {
      if (hub.ws && hub.wsReady && hub.ws.readyState === WebSocket.OPEN) {
        hub.ws.send(JSON.stringify({ action: "HEARTBEAT" }));
      }
    } catch {}
  }, HEARTBEAT_INTERVAL);
}

/**
 * ✅ NEW: Create a background MarketTradesHub client to keep Recent Trades tracking
 * even when no user tab is open. This prevents MarketTradesHub from auto-unsub.
 *
 * Works WITHOUT modifying MarketTradesHub (it simply keeps a client alive).
 */
async function ensureBgRecentClientForMarket(marketId) {
  const id = Number(marketId);
  if (!Number.isFinite(id)) return;

  // already has bg client
  if (hub.bgRecentUnsubs.has(id)) return;

  try {
    // dynamic import to avoid circular deps / build issues
    const mod = await import("./marketTradesHub");
    const addMarketClient = mod?.addMarketClient;

    if (typeof addMarketClient !== "function") {
      // MarketTradesHub not available or different build
      return;
    }

    const cleanup = addMarketClient(
      { marketId: id },
      {
        // no-op; we only need this client to exist to keep subscription alive
        push: () => {},
      }
    );

    hub.bgRecentUnsubs.set(id, cleanup);
    console.log(`[SmartMoney] Pinned recent-trades via bg client: marketId=${id}`);
  } catch {
    // ignore
  }
}

function removeBgRecentClientForMarket(marketId) {
  const id = Number(marketId);
  if (!Number.isFinite(id)) return;

  const cleanup = hub.bgRecentUnsubs.get(id);
  if (typeof cleanup === "function") {
    try {
      cleanup();
    } catch {}
  }
  hub.bgRecentUnsubs.delete(id);
  console.log(`[SmartMoney] Unpinned recent-trades bg client: marketId=${id}`);
}

/**
 * Fetch a wide market universe (activated) and compute Top N by volume24h locally.
 */
async function fetchTopMarketIdsByVolume24h(topN = TOP_N) {
  const seen = new Set();
  const markets = [];
  hub.marketTitleById.clear();

  for (let page = 1; page <= UNIVERSE_PAGES; page++) {
    const raw = await opinionFetch("/market", {
      params: {
        status: "activated",
        page,
        limit: PAGE_LIMIT,
      },
    });

    const { list } = normalizeMarketList(raw);
    if (!list || list.length === 0) break;

    for (const m of list) {
      const id = getMarketId(m);
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);

      const title = getMarketTitle(m);
      if (title) hub.marketTitleById.set(id, title);

      markets.push(m);
    }

    if (markets.length >= 600) break;
  }

  markets.sort((a, b) => getVolume24h(b) - getVolume24h(a));

  const ids = [];
  for (const m of markets) {
    const id = getMarketId(m);
    if (!id) continue;
    ids.push(id);
    if (ids.length >= topN) break;
  }

  return ids;
}

/**
 * Keep subscription set aligned to current Top N:
 * - SUBSCRIBE newly added markets
 * - UNSUBSCRIBE markets that dropped out
 *
 * ✅ ALSO: Keep MarketTradesHub tracking Top N in background (Recent Trades)
 */
async function syncSubscriptionsToTop(topIds, force = false) {
  if (!hub.ws || hub.ws.readyState !== WebSocket.OPEN) return;

  const nextSet = new Set(topIds.map((x) => Number(x)).filter((x) => Number.isFinite(x)));

  if (force) {
    for (const oldId of hub.subscribedMarketIds) {
      try {
        hub.ws.send(
          JSON.stringify({
            action: "UNSUBSCRIBE",
            channel: "market.last.trade",
            marketId: Number(oldId),
          })
        );
      } catch {}
      // ✅ remove bg keepalive for recent-trades
      removeBgRecentClientForMarket(oldId);
    }
    hub.subscribedMarketIds.clear();
  } else {
    // Unsubscribe dropped markets
    for (const oldId of hub.subscribedMarketIds) {
      if (!nextSet.has(oldId)) {
        hub.subscribedMarketIds.delete(oldId);
        try {
          hub.ws.send(
            JSON.stringify({
              action: "UNSUBSCRIBE",
              channel: "market.last.trade",
              marketId: Number(oldId),
            })
          );
        } catch {}

        // ✅ remove bg keepalive for recent-trades
        removeBgRecentClientForMarket(oldId);
      }
    }
  }

  // Subscribe new markets
  let added = 0;
  for (const id of nextSet) {
    if (!hub.subscribedMarketIds.has(id)) {
      hub.subscribedMarketIds.add(id);
      added++;
      try {
        hub.ws.send(
          JSON.stringify({
            action: "SUBSCRIBE",
            channel: "market.last.trade",
            marketId: Number(id),
          })
        );
      } catch {}
    }

    // ✅ ensure background recent-trades tracking for Top N markets
    // (do this for both newly-added and already-present)
    await ensureBgRecentClientForMarket(id);
  }

  console.log(
    `[SmartMoney] Synced subscriptions. target=${nextSet.size}, current=${hub.subscribedMarketIds.size}, added=${added}`
  );
}

async function refreshTopSubscriptions(force = false) {
  const now = Date.now();
  if (!force && hub.lastSubscribedAt && now - hub.lastSubscribedAt < RESUBSCRIBE_INTERVAL_MS) return;

  const topIds = await fetchTopMarketIdsByVolume24h(TOP_N);
  hub.lastSubscribedAt = now;

  console.log("[SmartMoney] Refresh top list:", topIds.length);
  await syncSubscriptionsToTop(topIds, force);
}

function startResubscribeTimer() {
  if (hub.resubTimer) clearInterval(hub.resubTimer);
  hub.resubTimer = setInterval(() => {
    refreshTopSubscriptions(false).catch(() => {});
  }, RESUBSCRIBE_INTERVAL_MS);
}

function ensureWS() {
  if (hub.ws && (hub.wsReady || hub.ws.readyState === 0 || hub.ws.readyState === 1)) {
    return;
  }

  const WS_URL = getWsUrl();
  if (!WS_URL) return;

  hub.ws = new WebSocket(WS_URL);

  hub.ws.onopen = async () => {
    hub.wsReady = true;
    startHeartbeat();
    startResubscribeTimer();
    await refreshTopSubscriptions(true); // force sync on open
  };

  hub.ws.onmessage = (ev) => {
    try {
      const text = typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf-8");
      const data = JSON.parse(text);

      if (data?.msgType !== "market.last.trade") return;

      const marketId = Number(data.marketId);

      const item = {
        ts: Date.now(),
        marketId,
        side: data.side,
        amount: Number(data.amount || 0),
        price: formatPrice(data.price),
        outcome: normalizeOutcome(data.outcomeSide),
        marketTitle: hub.marketTitleById.get(marketId) || "",
      };

      if (!Number.isFinite(item.marketId) || !Number.isFinite(item.amount)) return;

      pushLatest(item);
      insertTrade(item);

      if ((hub.latest?.length || 0) % 50 === 0) {
        pruneOldTrades({ days: 7 });
      }

      broadcast(item);
    } catch {}
  };

  hub.ws.onclose = () => {
    hub.wsReady = false;
    hub.ws = null;

    if (hub.heartbeat) clearInterval(hub.heartbeat);
    hub.heartbeat = null;

    if (hub.resubTimer) clearInterval(hub.resubTimer);
    hub.resubTimer = null;

    // keepalive clients are per-process; on reconnect they'll be recreated by refreshTopSubscriptions(true)
    setTimeout(() => ensureWS(), 1500);
  };

  hub.ws.onerror = () => {
    // onclose will reconnect
  };
}

export function startSmartMoneyHub() {
  if (hub.started || hub.starting) return;
  hub.starting = true;
  ensureWS();
  hub.started = true;
  hub.starting = false;
}

export function addClient(client) {
  hub.clients.add(client);
  return () => hub.clients.delete(client);
}

export function getLatest() {
  pruneLatest();
  return hub.latest;
}

export function getSmartMoneyHubStatus() {
  return {
    started: !!hub.started,
    wsReady: !!hub.wsReady,
    latestCount: Array.isArray(hub.latest) ? hub.latest.length : 0,
    subscribedCount: hub.subscribedMarketIds ? hub.subscribedMarketIds.size : 0,
    lastSubscribedAt: hub.lastSubscribedAt || 0,

    // debug
    pinnedRecentCount: hub.bgRecentUnsubs ? hub.bgRecentUnsubs.size : 0,

    subscribedIds: Array.from(hub.subscribedMarketIds),
    subscribedSample: Array.from(hub.subscribedMarketIds)
      .slice(0, 20)
      .map((id) => ({
        id,
        title: hub.marketTitleById.get(id) || "",
      })),
  };
}
