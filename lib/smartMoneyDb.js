// lib/smartMoneyDb.js
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const DEFAULT_DB = path.join(process.cwd(), "data", "smartmoney.sqlite");
const DB_PATH = process.env.SMART_MONEY_DB_PATH || DEFAULT_DB;

// Lazy initialization - only initialize DB at runtime, not during build
let db = null;
let insertStmt = null;

function getDb() {
  if (db) return db;

  // Check if already initialized globally (for hot reload)
  if (globalThis.__SMART_MONEY_DB__) {
    db = globalThis.__SMART_MONEY_DB__;
    insertStmt = globalThis.__SMART_MONEY_INSERT_STMT__;
    return db;
  }

  // Create directory only at runtime (not during build)
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  } catch (err) {
    // Ignore if directory already exists or we're in build mode
    if (err.code !== "EEXIST") {
      console.warn("Could not create DB directory:", err.message);
    }
  }

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      marketId INTEGER NOT NULL,
      side TEXT,
      amount REAL,
      price TEXT,
      outcome TEXT,
      marketTitle TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_trades_ts ON trades(ts);
    CREATE INDEX IF NOT EXISTS idx_trades_amount ON trades(amount);
    CREATE INDEX IF NOT EXISTS idx_trades_market_ts ON trades(marketId, ts);
  `);

  insertStmt = db.prepare(`
    INSERT INTO trades (ts, marketId, side, amount, price, outcome, marketTitle)
    VALUES (@ts, @marketId, @side, @amount, @price, @outcome, @marketTitle)
  `);

  globalThis.__SMART_MONEY_DB__ = db;
  globalThis.__SMART_MONEY_INSERT_STMT__ = insertStmt;

  return db;
}

export function insertTrade(trade) {
  try {
    getDb(); // Ensure DB is initialized
    insertStmt.run(trade);
  } catch {}
}

export function queryTrades({ hours = 24, minAmount = 200, limit = 200 } = {}) {
  const database = getDb(); // Ensure DB is initialized
  const cutoff = Date.now() - Number(hours) * 3600 * 1000;

  const stmt = database.prepare(`
    SELECT ts, marketId, side, amount, price, outcome, marketTitle
    FROM trades
    WHERE ts >= ? AND amount >= ?
    ORDER BY ts DESC
    LIMIT ?
  `);

  return stmt.all(cutoff, Number(minAmount), Number(limit));
}

// Giữ DB gọn: chỉ giữ tối đa N ngày (khuyến nghị 7 ngày)
export function pruneOldTrades({ days = 7 } = {}) {
  const database = getDb(); // Ensure DB is initialized
  const cutoff = Date.now() - Number(days) * 24 * 3600 * 1000;
  try {
    database.prepare(`DELETE FROM trades WHERE ts < ?`).run(cutoff);
  } catch {}
}

// ✅ Count trades in the time window (read-only)
export function countTrades({ hours = 24, minAmount = 200 } = {}) {
  const db = getDb();
  const cutoff = Date.now() - Number(hours) * 60 * 60 * 1000;

  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS cnt
      FROM trades
      WHERE ts >= ? AND amount >= ?
    `
    )
    .get(cutoff, Number(minAmount));

  return Number(row?.cnt || 0);
}

// ✅ Paged query (read-only)
export function queryTradesPaged({ hours = 24, minAmount = 200, limit = 50, offset = 0 } = {}) {
  const db = getDb();
  const cutoff = Date.now() - Number(hours) * 60 * 60 * 1000;

  return db
    .prepare(
      `
      SELECT ts, marketId, side, amount, price, outcome, marketTitle
      FROM trades
      WHERE ts >= ? AND amount >= ?
      ORDER BY ts DESC
      LIMIT ? OFFSET ?
    `
    )
    .all(cutoff, Number(minAmount), Number(limit), Number(offset));
}
