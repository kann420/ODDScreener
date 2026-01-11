// lib/smartMoneyHub.js
import { opinionFetch, normalizeMarketList } from "@/lib/opinion";
import { insertTrade, pruneOldTrades } from "@/lib/smartMoneyDb"; // ✅ NEW: persist trades

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
  };
  globalThis.__SMART_MONEY_HUB__ = hub;
}

const HEARTBEAT_INTERVAL = 25_000;

// ✅ ONLY keep last 24h trades (in-memory)
const TRADE_TTL_MS = 24 * 60 * 60 * 1000;

// ✅ refresh subscriptions periodically (avoid stale top list)
const RESUBSCRIBE_INTERVAL_MS = 15 * 60 * 1000;

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

// ✅ fetch TOP 100 markets by volume24h (sortBy=5)
async function fetchTop100MarketIds() {
  // Pagination: max limit per request is 20, so we fetch multiple pages to reach 100.
  const ids = [];
  hub.marketTitleById.clear();

  // Fetch up to 5 pages * 20 = 100 markets
  for (let page = 1; page <= 5; page++) {
    const raw = await opinionFetch("/market", {
      params: { status: "activated", sortBy: 5, page, limit: 20 },
    });

    const { list } = normalizeMarketList(raw);
    if (!list || list.length === 0) break;

    for (const m of list) {
      const id = Number(m.marketId);
      if (!Number.isFinite(id)) continue;

      // avoid duplicates
      if (!ids.includes(id)) ids.push(id);

      if (m.title) hub.marketTitleById.set(id, m.title);

      if (ids.length >= 100) break;
    }

    if (ids.length >= 100) break;
  }

  return ids.slice(0, 100);
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

async function subscribeTop100(force = false) {
  const now = Date.now();
  if (!force && hub.lastSubscribedAt && now - hub.lastSubscribedAt < RESUBSCRIBE_INTERVAL_MS) return;

  const ids = await fetchTop100MarketIds();
  hub.lastSubscribedAt = now;

  if (force) hub.subscribedMarketIds.clear();

  console.log("[SmartMoney] Subscribing markets:", ids.length);

  for (const id of ids) {
    if (!hub.subscribedMarketIds.has(id)) {
      hub.subscribedMarketIds.add(id);

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
    await subscribeTop100(true);
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
      // run occasionally to reduce overhead
      if ((hub.latest?.length || 0) % 50 === 0) {
        pruneOldTrades({ days: 7 });
      }

      // ✅ push to connected SSE clients
      broadcast(item);

      // best-effort refresh
      subscribeTop100(false).catch(() => {});
    } catch {}
  };

  hub.ws.onclose = () => {
    hub.wsReady = false;
    hub.ws = null;
    if (hub.heartbeat) clearInterval(hub.heartbeat);
    hub.heartbeat = null;
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
  };
}
