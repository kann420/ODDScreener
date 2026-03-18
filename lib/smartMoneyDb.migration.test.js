import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const legacyDbPath = path.join(
  os.tmpdir(),
  `smart-money-legacy-${process.pid}-${Date.now()}.sqlite`
);

{
  const legacyDb = new Database(legacyDbPath);
  legacyDb.exec(`
    CREATE TABLE trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      marketId INTEGER NOT NULL,
      rootMarketId INTEGER,
      side TEXT,
      amount REAL,
      price TEXT,
      outcome TEXT,
      marketTitle TEXT
    );
    CREATE INDEX idx_trades_ts ON trades(ts);
  `);
  legacyDb.prepare(`
    INSERT INTO trades (ts, marketId, rootMarketId, side, amount, price, outcome, marketTitle)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(Date.now(), 11, null, "Buy", 1400, "62.0¢", "YES", "Legacy row");
  legacyDb.close();
}

process.env.SMART_MONEY_DB_PATH = legacyDbPath;
delete globalThis.__SMART_MONEY_DB__;
delete globalThis.__SMART_MONEY_INSERT_STMT__;

const migratedModule = await import(`./smartMoneyDb.js?migrationTest=${Date.now()}`);

test("legacy smart money DB migrates platform-aware schema without errors", () => {
  const opinionRows = migratedModule.queryTradesPaged({ hours: 24 * 365, minAmount: 0 });
  assert.equal(opinionRows.length, 1);
  assert.equal(opinionRows[0].platform, "opinion");

  migratedModule.insertTrade({
    platform: "predictfun",
    ts: Date.now() + 1000,
    marketId: 22,
    side: "Bid",
    amount: 2200,
    price: "51.0¢",
    outcome: "Yes",
    marketTitle: "Migrated predict.fun row",
  });

  const predictFunRows = migratedModule.queryTradesPaged({
    hours: 24 * 365,
    minAmount: 0,
    platform: "predictfun",
  });

  assert.equal(predictFunRows.length, 1);
  assert.equal(predictFunRows[0].platform, "predictfun");
});
