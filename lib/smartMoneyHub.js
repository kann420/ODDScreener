// lib/smartMoneyHub.js
import { opinionFetch, normalizeMarketList } from "@/lib/opinion";

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
  };
  globalThis.__SMART_MONEY_HUB__ = hub;
}

const HEARTBEAT_INTERVAL = 25_000;

function formatPrice(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return "";
  if (n >= 0 && n <= 1.2) return `${(n * 100).toFixed(1)}¢`;
  return `${n}`;
}

function normalizeOutcome(outcomeSide) {
  // WS market.last.trade trong hook của bạn: outcomeSide = 1 (YES), 2 (NO)
  if (outcomeSide === 1 || outcomeSide === "1") return "YES";
  if (outcomeSide === 2 || outcomeSide === "2") return "NO";
  // nếu không phải 1/2 thì giữ nguyên outcome gốc (đúng yêu cầu bạn)
  return outcomeSide ?? "";
}

function pushLatest(item) {
  hub.latest.unshift(item);
  if (hub.latest.length > hub.maxLatest) hub.latest.pop();
}

function broadcast(item) {
  for (const c of hub.clients) {
    if (Number(item.amount) >= Number(c.minAmount || 1000)) {
      c.push(item);
    }
  }
}

// ✅ lấy TOP 100 markets theo volume24h (sortBy=5 đang dùng trong project của bạn)
async function fetchTop100MarketIds() {
  const raw = await opinionFetch("/market", {
    params: { status: "activated", sortBy: 5, limit: 100 },
  });

  const { list } = normalizeMarketList(raw);
  const ids = [];

  hub.marketTitleById.clear();

  for (const m of list) {
    const id = Number(m.marketId);
    if (!Number.isFinite(id)) continue;
    ids.push(id);
    if (m.title) hub.marketTitleById.set(id, m.title);
  }

  return ids.slice(0, 100);
}

function getWsUrl() {
  const apiKey = process.env.OPINION_API_KEY || "";
  if (!apiKey) return null;
  // ✅ đúng format trong ws-config route của bạn
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

async function subscribeTop100() {
  const ids = await fetchTop100MarketIds();

  console.log("[SmartMoney] Subscribing markets:", ids.length);

  for (const id of ids) {
    if (!hub.subscribedMarketIds.has(id)) {
      hub.subscribedMarketIds.add(id);

      console.log("[SmartMoney] subscribe market", id);

      hub.ws.send(
        JSON.stringify({
          action: "SUBSCRIBE",
          channel: "market.last.trade",
          marketId: Number(id),
        })
      );
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
  await subscribeTop100();
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
    broadcast(item);
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
  // onclose sẽ reconnect
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
  return hub.latest;
}
