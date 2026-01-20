// lib/smartMoneyHub.js
import { opinionFetch, normalizeMarketList } from "@/lib/opinion";
import { insertTrade, pruneOldTrades } from "@/lib/smartMoneyDb";

// ✅ PIN recent-trades via MarketTradesHub
import { pinMarket, unpinMarket } from "@/lib/marketTradesHub";

let hub = globalThis.__SMART_MONEY_HUB__;

if (!hub) {
  hub = {
    ws: null,
    wsReady: false,
    clients: new Set(), // { push, minAmount }
    latest: [],
    maxLatest: 200,

    // SmartMoney WS subscriptions (market.last.trade)
    subscribedKeys: new Set(), // keys like "m:123" or "r:61"

    // ✅ Recent-trades pins
    pinnedKeys: new Set(), // keys like "m:123" or "r:61"

    marketMetaById: new Map(), // id -> { title, isRoot }
    started: false,
    starting: false,
    heartbeat: null,
    lastRefreshAt: 0,
    refreshTimer: null,
  };
  globalThis.__SMART_MONEY_HUB__ = hub;
}

const HEARTBEAT_INTERVAL = 25_000;

// Keep last 24h trades (in-memory)
const TRADE_TTL_MS = 24 * 60 * 60 * 1000;

// ✅ Refresh every 60 minutes (you can reduce to 10–15 mins later if you want)
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;

// ✅ Your requirements:
const TOP_PIN_VOLUME = 120; // pin top 120 volume
const TOP_SMART_MONEY = 48; // keep smart money WS subs at 48 (as before)

// How many pages to scan (20/page) => 40 pages = up to 800 markets
const UNIVERSE_PAGES = 40;
const PAGE_LIMIT = 20;

function pruneLatest() {
  const cutoff = Date.now() - TRADE_TTL_MS;
  hub.latest = hub.latest
    .filter((x) => Number(x?.ts || 0) >= cutoff)
    .slice(0, hub.maxLatest);
}

function pushLatest(item) {
  hub.latest.unshift(item);
  pruneLatest();
}

function broadcast(item) {
  for (const c of hub.clients) {
    if (Number(item.amount) >= Number(c.minAmount || 1000)) {
      try {
        c.push(item);
      } catch {}
    }
  }
}

function getWsUrl() {
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

// -------- Volume helpers --------
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
    m.volume,
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
  return m?.marketTitle ?? m?.title ?? m?.name ?? "";
}

// ✅ Detect parent/root multi-outcome market
// In your sample JSON, parent had marketType: 1 and childMarkets array.
function isRootMultiOutcomeMarket(m) {
  if (!m || typeof m !== "object") return false;
  if (Array.isArray(m.childMarkets) && m.childMarkets.length > 0) return true;
  const mt = Number(m.marketType);
  // best-effort based on your observed data:
  // binary looked like 0, parent categorical looked like 1
  if (Number.isFinite(mt) && mt === 1) return true;
  return false;
}

// key builder for our internal sets
function makeKeyFromEntry(entry) {
  if (!entry) return null;
  if (entry.isRoot) return `r:${Number(entry.id)}`;
  return `m:${Number(entry.id)}`;
}

function subscribeKey(key) {
  if (!hub.ws || hub.ws.readyState !== WebSocket.OPEN) return;
  if (!key || typeof key !== "string") return;

  try {
    if (key.startsWith("r:")) {
      const rootMarketId = Number(key.slice(2));
      hub.ws.send(JSON.stringify({ action: "SUBSCRIBE", channel: "market.last.trade", rootMarketId }));
      console.log("[SmartMoney] Subscribed", { channel: "market.last.trade", rootMarketId });
    } else if (key.startsWith("m:")) {
      const marketId = Number(key.slice(2));
      hub.ws.send(JSON.stringify({ action: "SUBSCRIBE", channel: "market.last.trade", marketId }));
      console.log("[SmartMoney] Subscribed", { channel: "market.last.trade", marketId });
    }
  } catch {}
}

function unsubscribeKey(key) {
  if (!hub.ws || hub.ws.readyState !== WebSocket.OPEN) return;
  if (!key || typeof key !== "string") return;

  try {
    if (key.startsWith("r:")) {
      const rootMarketId = Number(key.slice(2));
      hub.ws.send(JSON.stringify({ action: "UNSUBSCRIBE", channel: "market.last.trade", rootMarketId }));
      console.log("[SmartMoney] Unsubscribed", { channel: "market.last.trade", rootMarketId });
    } else if (key.startsWith("m:")) {
      const marketId = Number(key.slice(2));
      hub.ws.send(JSON.stringify({ action: "UNSUBSCRIBE", channel: "market.last.trade", marketId }));
      console.log("[SmartMoney] Unsubscribed", { channel: "market.last.trade", marketId });
    }
  } catch {}
}

// -------- Fetch Top by volume (returns entries with isRoot) --------
async function fetchTopByVolume24h(limit) {
  const seen = new Set();
  const entries = [];
  hub.marketMetaById.clear();

  for (let page = 1; page <= UNIVERSE_PAGES; page++) {
    const raw = await opinionFetch("/market", {
      params: { status: "activated", page, limit: PAGE_LIMIT },
    });

    const { list } = normalizeMarketList(raw);
    if (!list || list.length === 0) break;

    for (const m of list) {
      const id = getMarketId(m);
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);

      const title = getMarketTitle(m);
      const isRoot = isRootMultiOutcomeMarket(m);

      hub.marketMetaById.set(id, { title, isRoot });
      entries.push({
        id,
        title,
        isRoot,
        volume24h: getVolume24h(m),
      });
    }

    if (entries.length >= 800) break;
  }

  entries.sort((a, b) => Number(b.volume24h) - Number(a.volume24h));
  return entries.slice(0, limit);
}

// -------- PIN recent trades (Top 120) --------
function syncPins(nextEntries) {
  const nextKeys = new Set(nextEntries.map(makeKeyFromEntry).filter(Boolean));

  // unpin removed
  for (const oldKey of hub.pinnedKeys) {
    if (!nextKeys.has(oldKey)) {
      hub.pinnedKeys.delete(oldKey);
      if (oldKey.startsWith("r:")) {
        unpinMarket({ rootMarketId: Number(oldKey.slice(2)) });
      } else {
        unpinMarket({ marketId: Number(oldKey.slice(2)) });
      }
    }
  }

  // pin new
  let added = 0;
  for (const key of nextKeys) {
    if (!hub.pinnedKeys.has(key)) {
      hub.pinnedKeys.add(key);
      added++;
      if (key.startsWith("r:")) {
        pinMarket({ rootMarketId: Number(key.slice(2)) });
      } else {
        pinMarket({ marketId: Number(key.slice(2)) });
      }
    }
  }

  console.log(`[RecentTradesPin] Synced pins. target=${nextKeys.size}, current=${hub.pinnedKeys.size}, added=${added}`);
}

// -------- SmartMoney WS subscriptions (Top 48) --------
function syncSmartMoneySubs(nextEntries) {
  const nextKeys = new Set(nextEntries.map(makeKeyFromEntry).filter(Boolean));

  // unsubscribe removed
  for (const oldKey of hub.subscribedKeys) {
    if (!nextKeys.has(oldKey)) {
      hub.subscribedKeys.delete(oldKey);
      unsubscribeKey(oldKey);
    }
  }

  // subscribe new
  let added = 0;
  for (const key of nextKeys) {
    if (!hub.subscribedKeys.has(key)) {
      hub.subscribedKeys.add(key);
      added++;
      subscribeKey(key);
    }
  }

  console.log(`[SmartMoney] Synced subscriptions. target=${nextKeys.size}, current=${hub.subscribedKeys.size}, added=${added}`);
}

async function refreshAll(force = false) {
  const now = Date.now();
  if (!force && hub.lastRefreshAt && now - hub.lastRefreshAt < REFRESH_INTERVAL_MS) return;

  // Fetch once, reuse slices
  const top120 = await fetchTopByVolume24h(TOP_PIN_VOLUME);
  const top48 = top120.slice(0, TOP_SMART_MONEY);

  hub.lastRefreshAt = now;

  console.log(`[SmartMoney] Refresh top list: pin=${top120.length}, smart=${top48.length}`);

  // ✅ Always pin top120 for recent trades (track ngầm)
  syncPins(top120);

  // ✅ Keep SmartMoney WS subs on top48 (or change to 120 if you want later)
  if (hub.wsReady) {
    syncSmartMoneySubs(top48);
  }
}

function startRefreshTimer() {
  if (hub.refreshTimer) clearInterval(hub.refreshTimer);
  hub.refreshTimer = setInterval(() => {
    refreshAll(false).catch(() => {});
  }, REFRESH_INTERVAL_MS);
}

// -------- WS connect --------
function ensureWS() {
  if (hub.ws && (hub.wsReady || hub.ws.readyState === 0 || hub.ws.readyState === 1)) return;

  const WS_URL = getWsUrl();
  if (!WS_URL) {
    console.error("[SmartMoney] Missing OPINION_WS_KEY/OPINION_API_KEY");
    return;
  }

  hub.ws = new WebSocket(WS_URL);

  hub.ws.onopen = async () => {
    hub.wsReady = true;
    startHeartbeat();
    startRefreshTimer();
    await refreshAll(true);
  };

  hub.ws.onmessage = (ev) => {
    try {
      const text = typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf-8");
      const data = JSON.parse(text);

      if (data?.msgType !== "market.last.trade") return;

      // can be either marketId or rootMarketId
      const marketId = Number(data.marketId);
      const rootMarketId = Number(data.rootMarketId);

      const item = {
        ts: Date.now(),
        marketId: Number.isFinite(marketId) ? marketId : null,
        rootMarketId: Number.isFinite(rootMarketId) ? rootMarketId : null,
        side: data.side,
        amount: Number(data.amount || 0),
        price: data.price,
        outcome: data.outcomeSide,
      };

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

    if (hub.refreshTimer) clearInterval(hub.refreshTimer);
    hub.refreshTimer = null;

    setTimeout(() => ensureWS(), 1500);
  };

  hub.ws.onerror = () => {};
}

export function startSmartMoneyHub() {
  if (hub.started || hub.starting) return;
  hub.starting = true;
  ensureWS();
  // even if WS not ready yet, we can pre-pin later on open
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
    smartSubscribed: hub.subscribedKeys.size,
    pinnedRecent: hub.pinnedKeys.size,
    lastRefreshAt: hub.lastRefreshAt || 0,
    samplePinned: Array.from(hub.pinnedKeys).slice(0, 20),
  };
}
