// lib/marketTradesHub.js
// Server-side WebSocket hub for per-market last trades.
// Clients should NOT connect to Opinion WS directly (would expose API keys).
// Instead, clients connect to our SSE route which proxies trades from this hub.

const WebSocket = require("ws");

const HEARTBEAT_INTERVAL = 25_000;
const MAX_TRADES_PER_KEY = 500;

// Key format:
// - Market:      m:<marketId>
// - Root market: r:<rootMarketId>
function makeKey({ marketId, rootMarketId }) {
  if (rootMarketId != null && Number.isFinite(Number(rootMarketId))) return `r:${Number(rootMarketId)}`;
  if (marketId != null && Number.isFinite(Number(marketId))) return `m:${Number(marketId)}`;
  return null;
}

function parseKey(key) {
  if (typeof key !== "string") return null;
  if (key.startsWith("m:")) {
    const id = Number(key.slice(2));
    return Number.isFinite(id) ? { marketId: id, rootMarketId: null } : null;
  }
  if (key.startsWith("r:")) {
    const id = Number(key.slice(2));
    return Number.isFinite(id) ? { marketId: null, rootMarketId: id } : null;
  }
  return null;
}

// Global hub instance (kept across hot reloads in dev)
let hub = globalThis.__MARKET_TRADES_HUB__;

if (!hub) {
  hub = {
    ws: null,
    wsReady: false,
    // Map: key -> Set of { push: (trade) => void }
    clients: new Map(),
    // Map: key -> Array of recent trades
    trades: new Map(),
    heartbeat: null,
    reconnectTimeout: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 10,
  };
  globalThis.__MARKET_TRADES_HUB__ = hub;
}

function buildWsUrl() {
  // Prefer WS-specific env var, fallback to API key.
  const wsBase = process.env.OPINION_WS_URL || "wss://ws.opinion.trade";
  const apiKey = process.env.OPINION_WS_KEY || process.env.OPINION_API_KEY || "";
  if (!apiKey) return null;

  // If user already put apikey in OPINION_WS_URL, keep it.
  if (wsBase.includes("apikey=")) return wsBase;

  const hasQuery = wsBase.includes("?");
  const sep = hasQuery ? "&" : "?";
  return `${wsBase}${sep}apikey=${encodeURIComponent(apiKey)}`;
}

function startHeartbeat() {
  if (hub.heartbeat) clearInterval(hub.heartbeat);
  hub.heartbeat = setInterval(() => {
    try {
      if (hub.ws && hub.wsReady && hub.ws.readyState === WebSocket.OPEN) {
        hub.ws.send(JSON.stringify({ action: "HEARTBEAT" }));
      }
    } catch (e) {
      console.error("[MarketTradesHub] Heartbeat error:", e);
    }
  }, HEARTBEAT_INTERVAL);
}

function storeTradeForKey(key, trade) {
  if (!hub.trades.has(key)) hub.trades.set(key, []);
  const arr = hub.trades.get(key);
  arr.unshift(trade);
  if (arr.length > MAX_TRADES_PER_KEY) arr.length = MAX_TRADES_PER_KEY;
}

function broadcastToKey(key, trade) {
  const set = hub.clients.get(key);
  if (!set) return;
  for (const c of set) {
    try {
      c.push(trade);
    } catch {
      // ignore
    }
  }
}

function subscribeKey(key) {
  if (!hub.ws || hub.ws.readyState !== WebSocket.OPEN) return;
  const parsed = parseKey(key);
  if (!parsed) return;

  try {
    const msg = {
      action: "SUBSCRIBE",
      channel: "market.last.trade",
      ...(parsed.rootMarketId != null ? { rootMarketId: parsed.rootMarketId } : { marketId: parsed.marketId }),
    };
    hub.ws.send(JSON.stringify(msg));
    console.log("[MarketTradesHub] Subscribed", msg);
  } catch (e) {
    console.error("[MarketTradesHub] Subscribe error:", e);
  }
}

function unsubscribeKey(key) {
  if (!hub.ws || hub.ws.readyState !== WebSocket.OPEN) return;
  const parsed = parseKey(key);
  if (!parsed) return;

  try {
    const msg = {
      action: "UNSUBSCRIBE",
      channel: "market.last.trade",
      ...(parsed.rootMarketId != null ? { rootMarketId: parsed.rootMarketId } : { marketId: parsed.marketId }),
    };
    hub.ws.send(JSON.stringify(msg));
    console.log("[MarketTradesHub] Unsubscribed", msg);
  } catch (e) {
    console.error("[MarketTradesHub] Unsubscribe error:", e);
  }
}

function pickMsgType(msg) {
  return msg?.msgType || msg?.type || msg?.event || msg?.channel || "";
}

function unwrapTradePayload(msg) {
  if (!msg || typeof msg !== "object") return null;
  // common wrappers from WS gateways
  return msg.data || msg.payload || msg.result || msg.trade || msg.lastTrade || msg;
}

function ensureWS() {
  if (
    hub.ws &&
    (hub.wsReady ||
      hub.ws.readyState === WebSocket.CONNECTING ||
      hub.ws.readyState === WebSocket.OPEN)
  ) {
    return;
  }

  const WS_URL = buildWsUrl();
  if (!WS_URL) {
    console.error("[MarketTradesHub] Missing OPINION_WS_KEY/OPINION_API_KEY (server env)");
    return;
  }

  console.log(
    "[MarketTradesHub] Connecting to WebSocket...",
    WS_URL.replace(/apikey=[^&]+/i, "apikey=***")
  );
  hub.ws = new WebSocket(WS_URL);

  hub.ws.on("open", () => {
    console.log("[MarketTradesHub] WebSocket connected");
    hub.wsReady = true;
    hub.reconnectAttempts = 0;
    startHeartbeat();

    // Re-subscribe to all keys that have active clients
    for (const key of hub.clients.keys()) {
      subscribeKey(key);
    }
  });

  hub.ws.on("message", (data) => {
    try {
      const text = typeof data === "string" ? data : Buffer.from(data).toString("utf-8");
      const msg = JSON.parse(text);

      // ignore ACK/error messages
      if (msg && typeof msg === "object" && msg.code && msg.message) return;

      const t = String(pickMsgType(msg));
      const isLastTrade =
        t.includes("market.last.trade") ||
        String(msg?.channel || "").includes("market.last.trade");
      if (!isLastTrade) return;

      const payload = unwrapTradePayload(msg);
      if (!payload || typeof payload !== "object") return;

      const marketId = payload.marketId ?? payload.market_id ?? msg.marketId;
      const rootMarketId = payload.rootMarketId ?? payload.root_market_id ?? msg.rootMarketId;

      const m = Number(marketId);
      const r = Number(rootMarketId);

      const tsRaw = payload.ts ?? payload.timestamp ?? Date.now();
      const ts = Number(tsRaw);

      const trade = {
        id:
          payload.id ||
          `${payload.tokenId ?? payload.token_id ?? "na"}-${Number.isFinite(ts) ? ts : Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,
        tokenId: payload.tokenId ?? payload.token_id,
        side: payload.side,
        outcomeSide: payload.outcomeSide ?? payload.outcome_side,
        price: payload.price != null ? Number(payload.price) : null,
        shares: payload.shares != null ? Number(payload.shares) : null,
        amount: payload.amount != null ? Number(payload.amount) : null,
        marketId: Number.isFinite(m) ? m : null,
        rootMarketId: Number.isFinite(r) ? r : null,
        ts: Number.isFinite(ts) ? ts : Date.now(),
      };

      if (Number.isFinite(m)) {
        const key = `m:${m}`;
        storeTradeForKey(key, trade);
        broadcastToKey(key, trade);
      }

      if (Number.isFinite(r)) {
        const key = `r:${r}`;
        storeTradeForKey(key, trade);
        broadcastToKey(key, trade);
      }
    } catch (e) {
      console.error("[MarketTradesHub] Message parse error:", e);
    }
  });

  hub.ws.on("close", (code, reason) => {
    console.log("[MarketTradesHub] WebSocket closed:", code, reason?.toString());
    hub.wsReady = false;

    if (hub.heartbeat) {
      clearInterval(hub.heartbeat);
      hub.heartbeat = null;
    }

    if (hub.reconnectAttempts < hub.maxReconnectAttempts) {
      hub.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, hub.reconnectAttempts), 30000);
      console.log(`[MarketTradesHub] Reconnecting in ${delay}ms (attempt ${hub.reconnectAttempts})`);

      hub.reconnectTimeout = setTimeout(() => {
        ensureWS();
      }, delay);
    }
  });

  hub.ws.on("error", (err) => {
    console.error("[MarketTradesHub] WebSocket error:", err);
  });
}

/**
 * Add a client to receive trades for a marketId OR rootMarketId.
 * @param {{marketId?: number|null, rootMarketId?: number|null}} sub
 * @param {{ push: (trade: object) => void }} client
 * @returns {() => void} cleanup
 */
export function addMarketClient(sub, client) {
  const key = makeKey(sub || {});
  if (!key) throw new Error("addMarketClient: marketId or rootMarketId is required");

  ensureWS();

  if (!hub.clients.has(key)) {
    hub.clients.set(key, new Set());
    if (hub.wsReady) subscribeKey(key);
  }

  hub.clients.get(key).add(client);
  console.log(`[MarketTradesHub] Client added for ${key}. Total: ${hub.clients.get(key).size}`);

  return () => {
    const set = hub.clients.get(key);
    if (!set) return;
    set.delete(client);
    console.log(`[MarketTradesHub] Client removed for ${key}. Remaining: ${set.size}`);

    if (set.size === 0) {
      hub.clients.delete(key);
      unsubscribeKey(key);

      setTimeout(() => {
        if (!hub.clients.has(key)) hub.trades.delete(key);
      }, 60000);
    }
  };
}

/**
 * Get recent trades for a market/root (for initial snapshot)
 * @param {{marketId?: number|null, rootMarketId?: number|null}} sub
 */
export function getMarketTrades(sub) {
  const key = makeKey(sub || {});
  if (!key) return [];
  return hub.trades.get(key) || [];
}

export function isConnected() {
  return hub.wsReady && hub.ws?.readyState === WebSocket.OPEN;
}
