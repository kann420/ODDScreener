// lib/smartMoneyDb.js
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const DEFAULT_DB = path.join(process.cwd(), "data", "smartmoney.sqlite");
const DB_PATH = process.env.SMART_MONEY_DB_PATH || DEFAULT_DB;

let db = null;
let insertStmt = null;
let hasPredictFunTradeStmt = null;

function normalizeTsMs(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n)) return Date.now();
  return n < 1e12 ? n * 1000 : n;
}

function normalizePlatform(platform) {
  return String(platform || "opinion").toLowerCase() === "predictfun" ? "predictfun" : "opinion";
}

function getDb() {
  if (db) return db;

  if (globalThis.__SMART_MONEY_DB__) {
    db = globalThis.__SMART_MONEY_DB__;
    insertStmt = globalThis.__SMART_MONEY_INSERT_STMT__;
    hasPredictFunTradeStmt = globalThis.__SMART_MONEY_HAS_PREDICTFUN_STMT__;
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
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL DEFAULT 'opinion',
      ts INTEGER NOT NULL,
      marketId INTEGER NOT NULL,
      rootMarketId INTEGER,
      side TEXT,
      amount REAL,
      price TEXT,
      outcome TEXT,
      marketTitle TEXT,
      txHash TEXT,
      shares REAL,
      signer TEXT,
      marketImageUrl TEXT,
      categorySlug TEXT,
      marketUrl TEXT
    );

  `);

  const migrations = [
    "ALTER TABLE trades ADD COLUMN platform TEXT NOT NULL DEFAULT 'opinion'",
    "ALTER TABLE trades ADD COLUMN rootMarketId INTEGER",
    "ALTER TABLE trades ADD COLUMN txHash TEXT",
    "ALTER TABLE trades ADD COLUMN shares REAL",
    "ALTER TABLE trades ADD COLUMN signer TEXT",
    "ALTER TABLE trades ADD COLUMN marketImageUrl TEXT",
    "ALTER TABLE trades ADD COLUMN categorySlug TEXT",
    "ALTER TABLE trades ADD COLUMN marketUrl TEXT",
  ];

  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch (err) {
      if (!String(err?.message || "").toLowerCase().includes("duplicate column name")) {
        console.error("[SmartMoney] migration failed:", err.message);
      }
    }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_trades_ts ON trades(ts);
    CREATE INDEX IF NOT EXISTS idx_trades_amount ON trades(amount);
    CREATE INDEX IF NOT EXISTS idx_trades_market_ts ON trades(marketId, ts);
    CREATE INDEX IF NOT EXISTS idx_trades_platform_ts ON trades(platform, ts);
    CREATE INDEX IF NOT EXISTS idx_trades_predictfun_match ON trades(platform, txHash, marketId, ts);
  `);

  db.exec(`
    DELETE FROM trades
    WHERE id IN (
      SELECT newer.id
      FROM trades newer
      JOIN trades older
        ON newer.platform = 'predictfun'
       AND older.platform = 'predictfun'
       AND COALESCE(newer.txHash, '') = COALESCE(older.txHash, '')
       AND newer.marketId = older.marketId
       AND COALESCE(newer.outcome, '') = COALESCE(older.outcome, '')
       AND newer.ts = older.ts
       AND ABS(COALESCE(newer.amount, 0) - COALESCE(older.amount, 0)) < 0.000001
       AND newer.id > older.id
    );
  `);

  insertStmt = db.prepare(`
    INSERT INTO trades (
      platform, ts, marketId, rootMarketId, side, amount, price, outcome, marketTitle,
      txHash, shares, signer, marketImageUrl, categorySlug, marketUrl
    )
    VALUES (
      @platform, @ts, @marketId, @rootMarketId, @side, @amount, @price, @outcome, @marketTitle,
      @txHash, @shares, @signer, @marketImageUrl, @categorySlug, @marketUrl
    )
  `);
  hasPredictFunTradeStmt = db.prepare(`
    SELECT 1
    FROM trades
    WHERE platform = 'predictfun'
      AND txHash = ?
      AND marketId = ?
      AND COALESCE(outcome, '') = COALESCE(?, '')
      AND ts = ?
    LIMIT 1
  `);

  globalThis.__SMART_MONEY_DB__ = db;
  globalThis.__SMART_MONEY_INSERT_STMT__ = insertStmt;
  globalThis.__SMART_MONEY_HAS_PREDICTFUN_STMT__ = hasPredictFunTradeStmt;

  return db;
}

export function insertTrade(trade) {
  try {
    getDb();
    if (!insertStmt) {
      throw new Error("insert statement not initialized");
    }
    const normalizedTrade = {
      platform: normalizePlatform(trade?.platform),
      ts: normalizeTsMs(trade?.ts),
      marketId: Number(trade?.marketId || 0),
      rootMarketId: trade?.rootMarketId == null ? null : Number(trade.rootMarketId),
      side: trade?.side ?? null,
      amount: Number(trade?.amount || 0),
      price: trade?.price == null ? null : String(trade.price),
      outcome: trade?.outcome ?? null,
      marketTitle: trade?.marketTitle ?? null,
      txHash: trade?.txHash ?? null,
      shares: trade?.shares == null ? null : Number(trade.shares),
      signer: trade?.signer ?? null,
      marketImageUrl: trade?.marketImageUrl ?? null,
      categorySlug: trade?.categorySlug ?? null,
      marketUrl: trade?.marketUrl ?? null,
    };

    if (
      normalizedTrade.platform === "predictfun" &&
      normalizedTrade.txHash &&
      hasPredictFunTradeStmt?.get(
        normalizedTrade.txHash,
        normalizedTrade.marketId,
        normalizedTrade.outcome,
        normalizedTrade.ts
      )
    ) {
      return;
    }

    insertStmt.run({
      ...normalizedTrade,
    });
  } catch (err) {
    console.error("[SmartMoney] insertTrade failed:", err.message);
  }
}

export function queryTrades({ hours = 24, minAmount = 200, limit = 200, platform = "opinion" } = {}) {
  const database = getDb();
  const cutoff = Date.now() - Number(hours) * 3600 * 1000;

  const stmt = database.prepare(`
    SELECT platform, ts, marketId, rootMarketId, side, amount, price, outcome, marketTitle,
           txHash, shares, signer, marketImageUrl, categorySlug, marketUrl
    FROM trades
    WHERE platform = ? AND ts >= ? AND amount >= ?
    ORDER BY ts DESC
    LIMIT ?
  `);

  return stmt.all(normalizePlatform(platform), cutoff, Number(minAmount), Number(limit));
}

export function pruneOldTrades({ days = 7 } = {}) {
  const database = getDb();
  const cutoff = Date.now() - Number(days) * 24 * 3600 * 1000;
  try {
    database.prepare("DELETE FROM trades WHERE ts < ?").run(cutoff);
  } catch (err) {
    console.error("[SmartMoney] pruneOldTrades failed:", err.message);
  }
}

export function countTrades({ hours = 24, minAmount = 200, platform = "opinion" } = {}) {
  const database = getDb();
  const cutoff = Date.now() - Number(hours) * 60 * 60 * 1000;

  const row = database
    .prepare(`
      SELECT COUNT(*) AS cnt
      FROM trades
      WHERE platform = ? AND ts >= ? AND amount >= ?
    `)
    .get(normalizePlatform(platform), cutoff, Number(minAmount));

  return Number(row?.cnt || 0);
}

export function queryTradesPaged({
  hours = 24,
  minAmount = 200,
  limit = 50,
  offset = 0,
  platform = "opinion",
} = {}) {
  const database = getDb();
  const cutoff = Date.now() - Number(hours) * 60 * 60 * 1000;

  return database
    .prepare(`
      SELECT platform, ts, marketId, rootMarketId, side, amount, price, outcome, marketTitle,
             txHash, shares, signer, marketImageUrl, categorySlug, marketUrl
      FROM trades
      WHERE platform = ? AND ts >= ? AND amount >= ?
      ORDER BY ts DESC
      LIMIT ? OFFSET ?
    `)
    .all(normalizePlatform(platform), cutoff, Number(minAmount), Number(limit), Number(offset));
}

export function getTradesDebugSummary({ platform = "opinion" } = {}) {
  const database = getDb();
  const normalizedPlatform = normalizePlatform(platform);

  const totals = database
    .prepare(`
      SELECT COUNT(*) AS totalRows,
             COUNT(DISTINCT marketId) AS distinctMarkets,
             MIN(ts) AS minTs,
             MAX(ts) AS maxTs
      FROM trades
      WHERE platform = ?
    `)
    .get(normalizedPlatform);

  return {
    platform: normalizedPlatform,
    totalRows: Number(totals?.totalRows || 0),
    distinctMarkets: Number(totals?.distinctMarkets || 0),
    minTs: totals?.minTs == null ? null : Number(totals.minTs),
    maxTs: totals?.maxTs == null ? null : Number(totals.maxTs),
  };
}
