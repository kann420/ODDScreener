// lib/smartMoneyDb.js
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const DEFAULT_DB = path.join(process.cwd(), "data", "smartmoney.sqlite");
const DB_PATH = process.env.SMART_MONEY_DB_PATH || DEFAULT_DB;

let db = globalThis.__SMART_MONEY_DB__;
if (!db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

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

  globalThis.__SMART_MONEY_DB__ = db;
}

const insertStmt = db.prepare(`
  INSERT INTO trades (ts, marketId, side, amount, price, outcome, marketTitle)
  VALUES (@ts, @marketId, @side, @amount, @price, @outcome, @marketTitle)
`);

export function insertTrade(trade) {
  try {
    insertStmt.run(trade);
  } catch {}
}

export function queryTrades({ hours = 24, minAmount = 200, limit = 200 } = {}) {
  const cutoff = Date.now() - Number(hours) * 3600 * 1000;

  const stmt = db.prepare(`
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
  const cutoff = Date.now() - Number(days) * 24 * 3600 * 1000;
  try {
    db.prepare(`DELETE FROM trades WHERE ts < ?`).run(cutoff);
  } catch {}
}
