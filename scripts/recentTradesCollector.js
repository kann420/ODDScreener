// scripts/recentTradesCollector.js
import WebSocket from "ws";
import process from "process";
import { insertRecentTrade } from "../lib/recentTradesDb.js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const WS_URL = process.env.OPINION_WS_URL || "wss://ws.opinion.trade";
const WS_KEY = process.env.OPINION_WS_KEY || "";
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

// top markets settings
const TOP_LIMIT = Number(process.env.RECENT_TRADES_TOP_LIMIT || "40");
const REFRESH_MS = Number(process.env.RECENT_TRADES_REFRESH_MS || String(60 * 60 * 1000)); // 1h

if (!WS_KEY) {
  console.error("Missing OPINION_WS_KEY (do NOT use NEXT_PUBLIC_ keys here)");
  process.exit(1);
}

let ws = null;
let heartbeatTimer = null;
let refreshTimer = null;

// Track current subscriptions
const subs = new Map(); // key => { kind, id }
function subKey(kind, id) {
  return `${kind}:${id}`;
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isResolved(m) {
  // conservative checks
  if (Number(m?.status) === 4) return true;
  if (String(m?.statusEnum || "").toLowerCase() === "resolved") return true;
  const ra = safeNum(m?.resolvedAt ?? m?.resolved_at);
  if (ra && ra !== 0) return true;
  return false;
}

// ✅ IMPORTANT: Your /api/opinion/markets returns root markets in result.list,
// and each root market contains childMarkets[] which holds the tradable marketId.
// If we subscribe root marketId, it won't match your /market/[id] detail pages.
// So we will subscribe childMarkets[].marketId as the primary target.
async function fetchTopMarkets() {
  const url = `${BASE_URL}/api/opinion/markets?status=activated&sortBy=5&limit=${TOP_LIMIT}&marketType=2`;
  const res = await fetch(url, { method: "GET" });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.log("[Collector] markets non-JSON:", text.slice(0, 160));
    return [];
  }

  const list = data?.result?.list ?? [];
  console.log("[Collector] fetched markets:", Array.isArray(list) ? list.length : 0);

  return Array.isArray(list) ? list : [];
}

function wsSend(obj) {
  try {
    ws?.send(JSON.stringify(obj));
  } catch {}
}

function subscribeOne(target) {
  const key = subKey(target.kind, target.id);
  if (subs.has(key)) return;

  const msg = {
    action: "SUBSCRIBE",
    channel: "market.last.trade",
    ...(target.kind === "root" ? { rootMarketId: target.id } : { marketId: target.id }),
  };

  wsSend(msg);
  subs.set(key, target);
  console.log("[Collector] SUB", msg);
}

function unsubscribeOne(target) {
  const key = subKey(target.kind, target.id);
  if (!subs.has(key)) return;

  const msg = {
    action: "UNSUBSCRIBE",
    channel: "market.last.trade",
    ...(target.kind === "root" ? { rootMarketId: target.id } : { marketId: target.id }),
  };

  wsSend(msg);
  subs.delete(key);
  console.log("[Collector] UNSUB", msg);
}

function buildTargetsFromMarkets(markets) {
  const targets = [];

  for (const m of markets) {
    if (!m) continue;
    if (isResolved(m)) continue;

    const children = Array.isArray(m?.childMarkets) ? m.childMarkets : [];

    // ✅ Prefer subscribing child markets (tradable)
    if (children.length > 0) {
      for (const c of children) {
        if (!c) continue;
        if (isResolved(c)) continue;

        const childMarketId = safeNum(c?.marketId ?? c?.id);
        if (childMarketId) {
          targets.push({ kind: "market", id: childMarketId });
        }
      }
      continue;
    }

    // Fallback: if no childMarkets exist, subscribe the root marketId
    const mid = safeNum(m?.marketId ?? m?.id);
    if (mid) targets.push({ kind: "market", id: mid });
  }

  // De-dup
  const seen = new Set();
  const unique = [];
  for (const t of targets) {
    const k = subKey(t.kind, t.id);
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(t);
  }

  return unique;
}

async function refreshSubscriptions() {
  let markets = [];
  try {
    markets = await fetchTopMarkets();
  } catch (e) {
    console.log("[Collector] fetchTopMarkets failed:", e?.message || e);
    return;
  }

  const targets = buildTargetsFromMarkets(markets);

  // Build set for diff
  const nextSet = new Set(targets.map((t) => subKey(t.kind, t.id)));
  const curSet = new Set(subs.keys());

  // Unsub those not in next
  for (const k of curSet) {
    if (!nextSet.has(k)) {
      const t = subs.get(k);
      if (t) unsubscribeOne(t);
    }
  }

  // Sub new
  for (const t of targets) {
    subscribeOne(t);
  }

  console.log(`[Collector] refresh done: now subscribed ${subs.size} markets (target ${targets.length})`);
}

function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    wsSend({ action: "HEARTBEAT" });
  }, 30000);
}

function handleTradeMessage(msg) {
  const msgType = String(msg?.msgType || msg?.type || msg?.event || "");
  const channel = String(msg?.channel || msg?.topic || "");

  const isTrade =
    msgType.includes("market.last.trade") ||
    channel.includes("market.last.trade") ||
    msg?.marketId != null ||
    msg?.rootMarketId != null;

  if (!isTrade) return;

  const trade = {
    ts: Date.now(), // when received
    marketId: msg?.marketId != null ? Number(msg.marketId) : null,
    rootMarketId: msg?.rootMarketId != null ? Number(msg.rootMarketId) : null,
    tokenId: msg?.tokenId != null ? String(msg.tokenId) : null,
    side: msg?.side != null ? String(msg.side) : null,
    outcomeSide: msg?.outcomeSide != null ? Number(msg.outcomeSide) : null,
    price: msg?.price != null ? Number(msg.price) : null,
    shares: msg?.shares != null ? Number(msg.shares) : null,
    amount: msg?.amount != null ? Number(msg.amount) : null,
  };

  insertRecentTrade(trade);
}

function connect() {
  const url = `${WS_URL}?apikey=${encodeURIComponent(WS_KEY)}`;
  console.log("[Collector] connecting", WS_URL, "apikey=OK");

  ws = new WebSocket(url);

  ws.on("open", async () => {
    console.log("[Collector] WS OPEN");
    startHeartbeat();
    await refreshSubscriptions();

    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshSubscriptions, REFRESH_MS);
  });

  ws.on("message", (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }

    // ignore ACK
    if (msg?.code && msg?.message) return;

    handleTradeMessage(msg);
  });

  ws.on("close", () => {
    console.log("[Collector] WS CLOSE. Reconnecting in 3s...");
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;

    setTimeout(connect, 3000);
  });

  ws.on("error", (e) => {
    console.log("[Collector] WS ERROR:", e?.message || e);
  });
}

connect();
