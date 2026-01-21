// scripts/recentTradesCollector.js
import WebSocket from "ws";
import process from "process";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import {
  insertRecentTrade,
  pruneOldRecentTrades,
  getRecentTradesDbPath,
} from "../lib/recentTradesDb.js";

// Load .env if exists (local). On Render, env vars are injected, so this is safe.
dotenv.config();

const WS_URL_BASE = process.env.OPINION_WS_URL || "wss://ws.opinion.trade";
const WS_KEY = process.env.OPINION_WS_KEY || "";
const PORT = Number(process.env.PORT || "3000");

// Use internal localhost by default (faster, avoids hitting public domain)
const BASE_URL =
  process.env.BASE_URL || `http://127.0.0.1:${Number.isFinite(PORT) ? PORT : 3000}`;

// Discover collector scope (top markets by volume / whatever your /api/opinion/markets uses)
const TOP_LIMIT = Number(process.env.RECENT_TRADES_TOP_LIMIT || "80");
const REFRESH_MS = Number(process.env.RECENT_TRADES_REFRESH_MS || String(10 * 60 * 1000)); // 10m default

// TTL for keeping a market subscribed after it was last seen in the top list
const WATCHLIST_TTL_HOURS = Number(process.env.RECENT_TRADES_WATCHLIST_TTL_HOURS || "24");

// How long to keep trades in DB (you can set 168 = 7 days for "credibility")
const RETENTION_HOURS = Number(process.env.RECENT_TRADES_RETENTION_HOURS || "24");

// Heartbeat requirements (Opinion docs): send HEARTBEAT regularly to keep WS alive
const HEARTBEAT_MS = Number(process.env.RECENT_TRADES_HEARTBEAT_MS || "30000");

// How often to prune old trades & expired watchlist entries
const PRUNE_MS = Number(process.env.RECENT_TRADES_PRUNE_MS || String(60 * 1000)); // 1m
const DB_PRUNE_MS = Number(process.env.RECENT_TRADES_DB_PRUNE_MS || String(5 * 60 * 1000)); // 5m

if (!WS_KEY) {
  console.error("[Collector] Missing OPINION_WS_KEY env var.");
  process.exit(1);
}

function buildWsUrl() {
  // If WS_URL already contains apikey, do not append again
  if (WS_URL_BASE.includes("apikey=")) return WS_URL_BASE;
  const joiner = WS_URL_BASE.includes("?") ? "&" : "?";
  return `${WS_URL_BASE}${joiner}apikey=${encodeURIComponent(WS_KEY)}`;
}

function subKey(target) {
  // Only marketId subscription here (binary-like). Later you can add rootMarketId support.
  return `m:${Number(target.marketId)}`;
}

function nowMs() {
  return Date.now();
}

function ttlMs(hours) {
  return Number(hours) * 3600 * 1000;
}

// --------------------
// Watchlist persistence
// --------------------
const dbPath = getRecentTradesDbPath?.() || process.env.RECENT_TRADES_DB_PATH || "";
const watchDir = dbPath ? path.dirname(dbPath) : process.cwd();
const WATCHLIST_FILE = path.join(watchDir, "recenttrades_watchlist.json");

function loadWatchlistFromDisk() {
  try {
    if (!fs.existsSync(WATCHLIST_FILE)) return new Map();
    const raw = fs.readFileSync(WATCHLIST_FILE, "utf-8");
    const obj = JSON.parse(raw);
    const map = new Map();
    for (const [k, v] of Object.entries(obj || {})) {
      if (!v || typeof v.expiresAt !== "number" || !v.target) continue;
      map.set(k, v);
    }
    return map;
  } catch (e) {
    console.warn("[Collector] Could not load watchlist JSON:", e?.message || e);
    return new Map();
  }
}

function saveWatchlistToDisk(watchlist) {
  try {
    const obj = {};
    for (const [k, v] of watchlist.entries()) obj[k] = v;
    const tmp = `${WATCHLIST_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, WATCHLIST_FILE);
  } catch (e) {
    console.warn("[Collector] Could not save watchlist JSON:", e?.message || e);
  }
}

// --------------------
// WS + subscription state
// --------------------
let ws = null;
let wsReady = false;

let heartbeatTimer = null;
let refreshTimer = null;
let pruneTimer = null;
let dbPruneTimer = null;

let reconnectAttempt = 0;

// watchlist: key -> { target: {marketId}, expiresAt, touchedAt }
let watchlist = loadWatchlistFromDisk();

// subscribed keys currently active on WS
const subscribed = new Set();

// stats
let insertedTrades = 0;
let lastStatsAt = nowMs();

console.log("[Collector] Starting RecentTradesCollector (TTL watchlist)");
console.log("[Collector] BASE_URL =", BASE_URL);
console.log("[Collector] WS_URL   =", WS_URL_BASE);
console.log("[Collector] TOP_LIMIT =", TOP_LIMIT, "REFRESH_MS =", REFRESH_MS);
console.log("[Collector] WATCHLIST_TTL_HOURS =", WATCHLIST_TTL_HOURS);
console.log("[Collector] RETENTION_HOURS =", RETENTION_HOURS);
console.log("[Collector] Watchlist loaded:", watchlist.size, "items");
console.log("[Collector] Watchlist file:", WATCHLIST_FILE);

// -------------
// Helpers
// -------------
function wsSend(obj) {
  if (!ws || !wsReady || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(obj));
    return true;
  } catch {
    return false;
  }
}

function subscribeTarget(target) {
  const key = subKey(target);
  if (subscribed.has(key)) return;

  const msg = { action: "SUBSCRIBE", channel: "market.last.trade", marketId: Number(target.marketId) };
  if (wsSend(msg)) {
    subscribed.add(key);
    console.log("[Collector] SUB", msg);
  }
}

function unsubscribeKey(key) {
  if (!subscribed.has(key)) return;

  const v = watchlist.get(key);
  const marketId = v?.target?.marketId;
  if (!Number.isFinite(Number(marketId))) return;

  const msg = { action: "UNSUBSCRIBE", channel: "market.last.trade", marketId: Number(marketId) };
  if (wsSend(msg)) {
    subscribed.delete(key);
    console.log("[Collector] UNSUB", msg);
  }
}

function syncSubscriptions() {
  // Ensure all non-expired watchlist entries are subscribed
  const t = nowMs();
  let activeCount = 0;

  for (const [k, v] of watchlist.entries()) {
    if (!v || typeof v.expiresAt !== "number") continue;
    if (v.expiresAt <= t) continue; // expired; prune loop will remove & unsub
    activeCount++;
    subscribeTarget(v.target);
  }

  // Occasionally log stats
  const since = t - lastStatsAt;
  if (since >= 60_000) {
    console.log(
      `[Collector] status: watchlist=${watchlist.size} active=${activeCount} subscribed=${subscribed.size} insertedTrades+${insertedTrades} (last ${Math.round(since/1000)}s)`
    );
    insertedTrades = 0;
    lastStatsAt = t;
  }
}

async function fetchTopTargets() {
  // Your server route already applies filtering/caching; keep it simple.
  // Note: marketType=2 used in your older collector; keep same behavior.
  const url = `${BASE_URL}/api/opinion/markets?status=activated&sortBy=5&limit=${encodeURIComponent(
    TOP_LIMIT
  )}&marketType=2`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      console.warn("[Collector] Top list fetch failed:", res.status, res.statusText);
      return [];
    }
    const data = await res.json();
    const list = Array.isArray(data) ? data : data?.data || data?.markets || [];
    // Normalize into targets: { marketId }
    const targets = [];
    for (const m of list) {
      const id = m?.marketId ?? m?.id;
      if (!Number.isFinite(Number(id))) continue;
      targets.push({ marketId: Number(id) });
    }
    return targets;
  } catch (e) {
    console.warn("[Collector] Top list fetch error:", e?.name === "AbortError" ? "timeout" : (e?.message || e));
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function touchTargets(targets) {
  const t = nowMs();
  const exp = t + ttlMs(WATCHLIST_TTL_HOURS);

  let added = 0;
  let touched = 0;

  for (const target of targets) {
    const key = subKey(target);
    const cur = watchlist.get(key);
    if (!cur) {
      watchlist.set(key, { target, touchedAt: t, expiresAt: exp });
      added++;
    } else {
      // extend TTL
      cur.target = target; // keep fresh
      cur.touchedAt = t;
      cur.expiresAt = exp;
      watchlist.set(key, cur);
      touched++;
    }
  }

  if (added || touched) {
    saveWatchlistToDisk(watchlist);
  }

  console.log(`[Collector] Touch top list: targets=${targets.length} added=${added} touched=${touched} watchlist=${watchlist.size}`);
}

function pruneExpiredWatchlist() {
  const t = nowMs();
  let removed = 0;

  for (const [k, v] of watchlist.entries()) {
    if (!v || typeof v.expiresAt !== "number") {
      watchlist.delete(k);
      removed++;
      continue;
    }
    if (v.expiresAt <= t) {
      // Unsubscribe once expired
      unsubscribeKey(k);
      watchlist.delete(k);
      removed++;
    }
  }

  if (removed) {
    saveWatchlistToDisk(watchlist);
    console.log(`[Collector] Pruned watchlist: removed=${removed}, watchlist=${watchlist.size}, subscribed=${subscribed.size}`);
  }
}

// -------------
// WS handlers
// -------------
function onMessage(raw) {
  try {
    const msg = JSON.parse(raw.toString("utf-8"));
    if (!msg) return;

    // Opinion market last trade channel
    if (msg.channel !== "market.last.trade") return;

    // Data could be msg.data or msg itself depending on server wrapper
    const d = msg.data || msg;

    // Normalize fields (safe fallbacks)
    const ts = Number(d.ts ?? d.timestamp ?? d.time ?? Date.now());
    const tsMs = ts < 1e12 ? ts * 1000 : ts; // guard sec->ms
    const marketId = Number(d.marketId ?? d.market_id ?? d.market ?? d.id);
    const rootMarketId = d.rootMarketId != null ? Number(d.rootMarketId) : null;

    // Token / outcome fields might vary
    const tokenId = d.tokenId ?? d.token_id ?? null;
    const side = d.side ?? null;
    const outcomeSide = d.outcomeSide ?? d.outcome_side ?? null;
    const price = d.price != null ? Number(d.price) : null;
    const shares = d.shares != null ? Number(d.shares) : null;
    const amount = d.amount != null ? Number(d.amount) : null;

    if (!Number.isFinite(marketId)) return;

    // Build a stable ID to dedupe (server may already provide id)
    const id =
      String(d.id || d.tradeId || d.txHash || `${marketId}:${tokenId || ""}:${tsMs}:${price || ""}:${shares || ""}`);

    insertRecentTrade({
      id,
      ts: tsMs,
      marketId,
      rootMarketId,
      tokenId,
      side,
      outcomeSide,
      price,
      shares,
      amount,
    });

    insertedTrades++;
  } catch {
    // ignore bad messages
  }
}

function cleanupTimers() {
  for (const t of [heartbeatTimer, refreshTimer, pruneTimer, dbPruneTimer]) {
    if (t) clearInterval(t);
  }
  heartbeatTimer = null;
  refreshTimer = null;
  pruneTimer = null;
  dbPruneTimer = null;
}

function connect() {
  const wsUrl = buildWsUrl();
  reconnectAttempt++;

  console.log(`[Collector] Connecting WS... attempt=${reconnectAttempt}`);
  ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    wsReady = true;
    reconnectAttempt = 0;
    console.log("[Collector] WS connected");

    // Heartbeat loop
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      wsSend({ action: "HEARTBEAT" });
    }, HEARTBEAT_MS);

    // Refresh top list loop: touch + extend TTL (NO immediate unsub)
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(async () => {
      const targets = await fetchTopTargets();
      if (targets.length) {
        touchTargets(targets);
      }
      // ensure subs reflect watchlist
      syncSubscriptions();
    }, REFRESH_MS);

    // Watchlist prune loop: expires => UNSUB + delete
    if (pruneTimer) clearInterval(pruneTimer);
    pruneTimer = setInterval(() => {
      pruneExpiredWatchlist();
      syncSubscriptions();
    }, PRUNE_MS);

    // DB prune loop (keep DB bounded but configurable)
    if (dbPruneTimer) clearInterval(dbPruneTimer);
    dbPruneTimer = setInterval(() => {
      pruneOldRecentTrades({ hours: RETENTION_HOURS });
    }, DB_PRUNE_MS);

    // Initial kick
    (async () => {
      const targets = await fetchTopTargets();
      if (targets.length) touchTargets(targets);
      // Subscribe everything active
      syncSubscriptions();
    })();
  });

  ws.on("message", onMessage);

  ws.on("close", (code, reason) => {
    console.warn("[Collector] WS closed:", code, reason?.toString?.() || "");
    wsReady = false;

    // keep subscribed set but WS is gone; will resub on reconnect
    cleanupTimers();

    // reconnect with backoff (max 30s)
    const backoff = Math.min(30_000, 2000 + reconnectAttempt * 1000);
    setTimeout(connect, backoff);
  });

  ws.on("error", (e) => {
    console.warn("[Collector] WS error:", e?.message || e);
  });
}

connect();
