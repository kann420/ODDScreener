import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

process.env.SMART_MONEY_DB_PATH = path.join(
  os.tmpdir(),
  `smart-money-test-${process.pid}-${Date.now()}.sqlite`
);
delete globalThis.__SMART_MONEY_DB__;
delete globalThis.__SMART_MONEY_INSERT_STMT__;

const dbModule = await import(`./smartMoneyDb.js?test=${Date.now()}`);

test("smart money DB defaults to opinion and filters by platform", () => {
  const now = Date.now();

  dbModule.insertTrade({
    ts: now,
    marketId: 1,
    side: "Buy",
    amount: 1200,
    price: "58.0¢",
    outcome: "YES",
    marketTitle: "Opinion market",
  });

  dbModule.insertTrade({
    platform: "predictfun",
    ts: now + 1000,
    marketId: 42,
    side: "Bid",
    amount: 2500,
    price: "55.0¢",
    outcome: "Yes",
    marketTitle: "Predict.fun market",
    txHash: "0xabc",
    shares: 5,
    signer: "0xwallet",
    marketImageUrl: "https://static.predict.fun/42.png",
    categorySlug: "btc-150k",
    marketUrl: "https://predict.fun/market/btc-150k",
  });
  dbModule.insertTrade({
    platform: "predictfun",
    ts: now + 1000,
    marketId: 42,
    side: "Bid",
    amount: 2500,
    price: "55.0¢",
    outcome: "Yes",
    marketTitle: "Predict.fun market duplicate",
    txHash: "0xabc",
    shares: 5,
    signer: "0xwallet",
    marketImageUrl: "https://static.predict.fun/42.png",
    categorySlug: "btc-150k",
    marketUrl: "https://predict.fun/market/btc-150k",
  });

  const opinionRows = dbModule.queryTradesPaged({ hours: 24 * 365, minAmount: 0 });
  const predictFunRows = dbModule.queryTradesPaged({ hours: 24 * 365, minAmount: 0, platform: "predictfun" });

  assert.equal(opinionRows.length, 1);
  assert.equal(opinionRows[0].platform, "opinion");
  assert.equal(predictFunRows.length, 1);
  assert.equal(predictFunRows[0].platform, "predictfun");
  assert.equal(predictFunRows[0].txHash, "0xabc");
  assert.equal(dbModule.countTrades({ hours: 24 * 365, minAmount: 0 }), 1);
  assert.equal(dbModule.countTrades({ hours: 24 * 365, minAmount: 0, platform: "predictfun" }), 1);
});
