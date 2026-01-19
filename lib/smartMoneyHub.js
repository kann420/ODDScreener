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
  };
  globalThis.__SMART_MONEY_HUB__ = hub;
}

const HEARTBEAT_INTERVAL = 25_000;

// ✅ ONLY keep last 24h trades (in-memory)
const TRADE_TTL_MS = 24 * 60 * 60 * 1000;

// ✅ Auto refresh subscriptions every 1 hour (as you requested)
const RESUBSCRIBE_INTERVAL_MS = 60 * 60 * 1000;

// ✅ subscribe top N markets
const TOP_N = 100;

// ✅ Fetch a wider universe to compute Top N ourselves.
// (Avoid sortBy=5 because it only returns ~33 markets in your test.)
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
 * We try multiple possible field names to avoid missing data.
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
    m.volume, // last fallback (not ideal but better than 0)
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
  const apiKey = process.env.OPINION_API_KEY || "";
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
 * Fetch a wide market universe (activated) and compute Top N by volume24h locally.
 * This avoids the "sortBy=5 only returns ~33 markets" problem you observed.
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

    // if we already have plenty, we can stop early
    // (still enough for stable topN)
    if (markets.length >= 600) break;
  }

  // Sort by 24h volume desc
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
 * - UNSUBSCRIBE markets that dropped out (best-effort)
 *
 * This prevents the set from "growing forever" and keeps it truly trending.
 */
async function syncSubscriptionsToTop(topIds, force = false) {
  if (!hub.ws || hub.ws.readyState !== WebSocket.OPEN) return;

  const nextSet = new Set(topIds.map((x) => Number(x)).filter((x) => Number.isFinite(x)));

  // On force, we aggressively resync:
  // - unsubscribe everything current (best-effort)
  // - clear set
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

      // ✅ keep memory list
      pushLatest(item);

      // ✅ persist to DB so users can see history later (24h window is applied at query time)
      insertTrade(item);

      // ✅ keep DB from growing forever (keep 7 days; adjust if you want)
      if ((hub.latest?.length || 0) % 50 === 0) {
        pruneOldTrades({ days: 7 });
      }

      // ✅ push to connected SSE clients
      broadcast(item);

      // NOTE: We do NOT refresh top list every trade anymore (wasteful).
      // Top refresh is hourly by timer.
    } catch {}
  };

  hub.ws.onclose = () => {
    hub.wsReady = false;
    hub.ws = null;

    if (hub.heartbeat) clearInterval(hub.heartbeat);
    hub.heartbeat = null;

    if (hub.resubTimer) clearInterval(hub.resubTimer);
    hub.resubTimer = null;

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

    // ===== DEBUG ONLY =====
    subscribedIds: Array.from(hub.subscribedMarketIds),
    subscribedSample: Array.from(hub.subscribedMarketIds)
      .slice(0, 20)
      .map((id) => ({
        id,
        title: hub.marketTitleById.get(id) || "",
      })),
  };
}

