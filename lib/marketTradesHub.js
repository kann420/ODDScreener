// lib/marketTradesHub.js
// Server-side WebSocket hub for individual market trades
// This keeps the API key secure on the server side

import WebSocket from "ws";

const HEARTBEAT_INTERVAL = 25_000;
const MAX_TRADES_PER_MARKET = 500;

// Global hub instance
let hub = globalThis.__MARKET_TRADES_HUB__;

if (!hub) {
  hub = {
    ws: null,
    wsReady: false,
    // Map: marketId -> Set of { push: (trade) => void }
    marketClients: new Map(),
    // Map: marketId -> Array of recent trades
    marketTrades: new Map(),
    heartbeat: null,
    reconnectTimeout: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 10,
  };
  globalThis.__MARKET_TRADES_HUB__ = hub;
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
    } catch (e) {
      console.error("[MarketTradesHub] Heartbeat error:", e);
    }
  }, HEARTBEAT_INTERVAL);
}

function broadcast(marketId, trade) {
  const clients = hub.marketClients.get(marketId);
  if (!clients) return;
  
  for (const client of clients) {
    try {
      client.push(trade);
    } catch (e) {
      console.error("[MarketTradesHub] Broadcast error:", e);
    }
  }
}

function storeTrade(marketId, trade) {
  if (!hub.marketTrades.has(marketId)) {
    hub.marketTrades.set(marketId, []);
  }
  
  const trades = hub.marketTrades.get(marketId);
  trades.unshift(trade); // newest first
  
  // Keep only last MAX_TRADES_PER_MARKET
  if (trades.length > MAX_TRADES_PER_MARKET) {
    trades.length = MAX_TRADES_PER_MARKET;
  }
}

function subscribeToMarket(marketId) {
  if (!hub.ws || hub.ws.readyState !== WebSocket.OPEN) return;
  
  try {
    hub.ws.send(JSON.stringify({
      action: "SUBSCRIBE",
      channel: "market.last.trade",
      marketId: Number(marketId),
    }));
    console.log("[MarketTradesHub] Subscribed to market", marketId);
  } catch (e) {
    console.error("[MarketTradesHub] Subscribe error:", e);
  }
}

function unsubscribeFromMarket(marketId) {
  if (!hub.ws || hub.ws.readyState !== WebSocket.OPEN) return;
  
  try {
    hub.ws.send(JSON.stringify({
      action: "UNSUBSCRIBE",
      channel: "market.last.trade",
      marketId: Number(marketId),
    }));
    console.log("[MarketTradesHub] Unsubscribed from market", marketId);
  } catch (e) {
    console.error("[MarketTradesHub] Unsubscribe error:", e);
  }
}

function ensureWS() {
  if (hub.ws && (hub.wsReady || hub.ws.readyState === WebSocket.CONNECTING || hub.ws.readyState === WebSocket.OPEN)) {
    return;
  }

  const WS_URL = getWsUrl();
  if (!WS_URL) {
    console.error("[MarketTradesHub] No API key configured");
    return;
  }

  console.log("[MarketTradesHub] Connecting to WebSocket...");
  hub.ws = new WebSocket(WS_URL);

  hub.ws.on("open", () => {
    console.log("[MarketTradesHub] WebSocket connected");
    hub.wsReady = true;
    hub.reconnectAttempts = 0;
    startHeartbeat();
    
    // Re-subscribe to all markets that have active clients
    for (const marketId of hub.marketClients.keys()) {
      subscribeToMarket(marketId);
    }
  });

  hub.ws.on("message", (data) => {
    try {
      const text = typeof data === "string" ? data : Buffer.from(data).toString("utf-8");
      const msg = JSON.parse(text);

      if (msg?.msgType !== "market.last.trade") return;

      const marketId = Number(msg.marketId);
      
      const trade = {
        id: `${msg.tokenId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        tokenId: msg.tokenId,
        side: msg.side, // "Buy" or "Sell"
        outcomeSide: msg.outcomeSide, // 1 = YES, 2 = NO
        price: parseFloat(msg.price),
        shares: parseFloat(msg.shares),
        amount: parseFloat(msg.amount),
        marketId: marketId,
        timestamp: Date.now(),
      };

      // Store trade for snapshot
      storeTrade(marketId, trade);
      
      // Broadcast to all clients watching this market
      broadcast(marketId, trade);
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

    // Reconnect with exponential backoff
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
 * Add a client to receive trades for a specific market
 * @param {number} marketId 
 * @param {{ push: (trade: object) => void }} client 
 * @returns {() => void} Cleanup function to remove the client
 */
export function addMarketClient(marketId, client) {
  ensureWS();
  
  if (!hub.marketClients.has(marketId)) {
    hub.marketClients.set(marketId, new Set());
    // Subscribe to this market if WS is ready
    if (hub.wsReady) {
      subscribeToMarket(marketId);
    }
  }
  
  hub.marketClients.get(marketId).add(client);
  console.log(`[MarketTradesHub] Client added for market ${marketId}. Total clients: ${hub.marketClients.get(marketId).size}`);
  
  return () => {
    const clients = hub.marketClients.get(marketId);
    if (clients) {
      clients.delete(client);
      console.log(`[MarketTradesHub] Client removed for market ${marketId}. Remaining: ${clients.size}`);
      
      // If no more clients for this market, unsubscribe
      if (clients.size === 0) {
        hub.marketClients.delete(marketId);
        unsubscribeFromMarket(marketId);
        // Clean up trades after a delay
        setTimeout(() => {
          if (!hub.marketClients.has(marketId)) {
            hub.marketTrades.delete(marketId);
          }
        }, 60000);
      }
    }
  };
}

/**
 * Get recent trades for a market (for initial snapshot)
 * @param {number} marketId 
 * @returns {Array}
 */
export function getMarketTrades(marketId) {
  return hub.marketTrades.get(marketId) || [];
}

/**
 * Check if the hub is connected
 * @returns {boolean}
 */
export function isConnected() {
  return hub.wsReady && hub.ws?.readyState === WebSocket.OPEN;
}
