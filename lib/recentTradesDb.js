// lib/recentTradesDb.js
import fs from "fs";
import path from "path";
import crypto from "crypto";
import Database from "better-sqlite3";

const DEFAULT_DB = path.join(process.cwd(), "data", "recenttrades.sqlite");
const DB_PATH = process.env.RECENT_TRADES_DB_PATH || DEFAULT_DB;

let db = null;
let insertStmt = null;
let pruneStmt = null;
let countStmt = null;
let recentByMarketStmt = null;

// Throttle pruning: run at most once per 60 seconds instead of every insert
let _lastPruneTime = 0;
const _PRUNE_INTERVAL_MS = 60_000;

function getDb() {
  if (db) return db;

  if (globalThis.__RECENT_TRADES_DB__) {
    db = globalThis.__RECENT_TRADES_DB__;
    insertStmt = globalThis.__RECENT_TRADES_INSERT_STMT__;
    pruneStmt = globalThis.__RECENT_TRADES_PRUNE_STMT__;
    countStmt = globalThis.__RECENT_TRADES_COUNT_STMT__;
    recentByMarketStmt = globalThis.__RECENT_TRADES_RECENT_BY_MARKET_STMT__;
    return db;
  }

  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  } catch (err) {
    if (err.code !== "EEXIST") {
      console.warn("Could not create DB directory:", err.message);
    }
  }

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS recent_trades (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,           -- ms
      marketId INTEGER,
      rootMarketId INTEGER,
      tokenId TEXT,
      side TEXT,
      outcomeSide INTEGER,
      price REAL,
      shares REAL,
      amount REAL
    );

    CREATE INDEX IF NOT EXISTS idx_recent_trades_ts ON recent_trades(ts);
    CREATE INDEX IF NOT EXISTS idx_recent_trades_market_ts ON recent_trades(marketId, ts);
    CREATE INDEX IF NOT EXISTS idx_recent_trades_root_ts ON recent_trades(rootMarketId, ts);
  `);

  insertStmt = db.prepare(`
    INSERT OR IGNORE INTO recent_trades
    (id, ts, marketId, rootMarketId, tokenId, side, outcomeSide, price, shares, amount)
    VALUES
    (@id, @ts, @marketId, @rootMarketId, @tokenId, @side, @outcomeSide, @price, @shares, @amount)
  `);

  pruneStmt = db.prepare(`DELETE FROM recent_trades WHERE ts < ?`);

  countStmt = db.prepare(`SELECT COUNT(*) AS cnt FROM recent_trades WHERE ts >= ?`);

  // if marketId provided: match marketId; else try rootMarketId
  recentByMarketStmt = db.prepare(`
    SELECT ts, marketId, rootMarketId, tokenId, side, outcomeSide, price, shares, amount
    FROM recent_trades
    WHERE ts >= ?
      AND (
        (marketId IS NOT NULL AND marketId = ?)
        OR
        (rootMarketId IS NOT NULL AND rootMarketId = ?)
      )
    ORDER BY ts DESC
    LIMIT ?
  `);

  globalThis.__RECENT_TRADES_DB__ = db;
  globalThis.__RECENT_TRADES_INSERT_STMT__ = insertStmt;
  globalThis.__RECENT_TRADES_PRUNE_STMT__ = pruneStmt;
  globalThis.__RECENT_TRADES_COUNT_STMT__ = countStmt;
  globalThis.__RECENT_TRADES_RECENT_BY_MARKET_STMT__ = recentByMarketStmt;

  return db;
}

export function getRecentTradesDbPath() {
  return DB_PATH;
}

export function pruneOldRecentTrades({ hours = 24 } = {}) {
  const database = getDb();
  const cutoff = Date.now() - Number(hours) * 3600 * 1000;
  try {
    pruneStmt.run(cutoff);
  } catch (err) {
    console.error("[RecentTrades] pruneOldRecentTrades failed:", err.message);
  }
}

function makeId(t) {
  // stable-ish fingerprint to avoid duplicates
  const raw = [
    t.ts,
    t.marketId ?? "",
    t.rootMarketId ?? "",
    t.tokenId ?? "",
    t.side ?? "",
    t.outcomeSide ?? "",
    t.price ?? "",
    t.shares ?? "",
    t.amount ?? "",
  ].join("|");

  return crypto.createHash("sha1").update(raw).digest("hex");
}

export function insertRecentTrade(trade) {
  try {
    getDb();

    const ts = Number(trade.ts ?? trade.timestamp ?? Date.now());
    const row = {
      ts,
      marketId: trade.marketId != null ? Number(trade.marketId) : null,
      rootMarketId: trade.rootMarketId != null ? Number(trade.rootMarketId) : null,
      tokenId: trade.tokenId != null ? String(trade.tokenId) : null,
      side: trade.side != null ? String(trade.side) : null,
      outcomeSide: trade.outcomeSide != null ? Number(trade.outcomeSide) : null,
      price: trade.price != null ? Number(trade.price) : null,
      shares: trade.shares != null ? Number(trade.shares) : null,
      amount: trade.amount != null ? Number(trade.amount) : null,
    };

    const id = trade.id ? String(trade.id) : makeId(row);

    insertStmt.run({ id, ...row });

    // ✅ enforce 24h retention (throttled: at most once per 60s)
    const now = Date.now();
    if (now - _lastPruneTime > _PRUNE_INTERVAL_MS) {
      _lastPruneTime = now;
      pruneOldRecentTrades({ hours: 24 });
    }
  } catch (err) {
    console.error("[RecentTrades] insertRecentTrade failed:", err.message);
  }
}

export function queryRecentTradesForMarket({ marketId, rootMarketId, hours = 24, limit = 200 } = {}) {
  const database = getDb();
  const cutoff = Date.now() - Number(hours) * 3600 * 1000;

  const m = marketId != null ? Number(marketId) : -1;
  const r = rootMarketId != null ? Number(rootMarketId) : -1;

  return recentByMarketStmt.all(cutoff, m, r, Number(limit));
}

export function countRecentTrades({ hours = 24 } = {}) {
  const database = getDb();
  const cutoff = Date.now() - Number(hours) * 3600 * 1000;
  const row = countStmt.get(cutoff);
  return Number(row?.cnt || 0);
}
