import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPredictFunMatchFingerprint,
  buildPredictFunSmartMoneyDisplayTitle,
  minAmountToUsdtWei,
  mapPredictFunQuoteTypeToTradeSide,
  normalizePredictFunSmartMoneyMatch,
} from "./predictfunSmartMoney.js";

test("minAmountToUsdtWei maps USD thresholds to 18-decimal string", () => {
  assert.equal(minAmountToUsdtWei(1000), "1000000000000000000000");
  assert.equal(minAmountToUsdtWei(0), null);
});

test("buildPredictFunMatchFingerprint uses the stable dedup fields", () => {
  const match = {
    transactionHash: "0xabc",
    amountFilled: "5000000000000000000",
    executedAt: "2026-03-10T08:00:00.000Z",
    market: { id: 42 },
    outcome: { name: "Yes" },
  };

  assert.equal(
    buildPredictFunMatchFingerprint(match),
    "0xabc:42:Yes:5000000000000000000:2026-03-10T08:00:00.000Z"
  );
});

test("mapPredictFunQuoteTypeToTradeSide follows Predict.fun activity semantics", () => {
  assert.equal(mapPredictFunQuoteTypeToTradeSide("Bid"), "BUY");
  assert.equal(mapPredictFunQuoteTypeToTradeSide("Ask"), "SELL");
});

test("normalizePredictFunSmartMoneyMatch maps a match into smart money row shape", () => {
  const match = {
    transactionHash: "0xabc",
    executedAt: "2026-03-10T08:00:00.000Z",
    amountFilled: "5000000000000000000",
    priceExecuted: "550000000000000000",
    outcome: { name: "Yes" },
    taker: { quoteType: "Bid", signer: "0xwallet" },
    market: {
      id: 42,
      title: "Will BTC hit $150k?",
      imageUrl: "https://static.predict.fun/42.png",
      categorySlug: "btc-150k",
    },
  };

  const row = normalizePredictFunSmartMoneyMatch(match, new Map());

  assert.equal(row.platform, "predictfun");
  assert.equal(row.marketId, 42);
  assert.equal(row.side, "BUY");
  assert.equal(row.outcome, "Yes");
  assert.equal(row.amount, 2.75);
  assert.equal(row.price, "55.0c");
  assert.equal(row.shares, 5);
  assert.equal(row.signer, "0xwallet");
  assert.equal(row.categorySlug, "btc-150k");
  assert.match(row.marketUrl, /predict\.fun\/market\/btc-150k/);
  assert.equal(row.ts, Date.parse("2026-03-10T08:00:00.000Z"));
});

test("buildPredictFunSmartMoneyDisplayTitle expands category winner markets", () => {
  assert.equal(
    buildPredictFunSmartMoneyDisplayTitle({
      rawTitle: "Croatia",
      question: "Will Croatia win the 2026 FIFA World Cup?",
      categorySlug: "2026-world-cup-winner",
      categoryTitle: null,
    }),
    "2026 World Cup Winner - Croatia"
  );
});

test("buildPredictFunSmartMoneyDisplayTitle fills placeholder questions", () => {
  assert.equal(
    buildPredictFunSmartMoneyDisplayTitle({
      rawTitle: "$3B",
      question: "edgeX FDV above ___ one day after launch?",
      categorySlug: "edgex-fdv-above-one-day-after-launch",
      categoryTitle: null,
    }),
    "edgeX FDV above $3B one day after launch?"
  );
});

test("buildPredictFunSmartMoneyDisplayTitle keeps full question titles without redundant category prefix", () => {
  assert.equal(
    buildPredictFunSmartMoneyDisplayTitle({
      rawTitle: "Will ETH hit $2,500 before April 2026?",
      question: "Will ETH hit $2,500 before April 2026?",
      categorySlug: "what-price-will-eth-hit-before-april-2026",
      categoryTitle: null,
    }),
    "Will ETH hit $2,500 before April 2026?"
  );
});

test("buildPredictFunSmartMoneyDisplayTitle keeps already-expanded category titles intact", () => {
  assert.equal(
    buildPredictFunSmartMoneyDisplayTitle({
      rawTitle: "2026 FIFA World Cup Winner - England",
      question: "Will England win the 2026 FIFA World Cup?",
      categorySlug: "2026-fifa-world-cup-winner",
      categoryTitle: "2026 FIFA World Cup Winner",
    }),
    "2026 FIFA World Cup Winner - England"
  );
});

test("buildPredictFunSmartMoneyDisplayTitle collapses duplicated category prefixes from upstream data", () => {
  assert.equal(
    buildPredictFunSmartMoneyDisplayTitle({
      rawTitle: "2026 FIFA World Cup Winner - 2026 FIFA World Cup Winner - France",
      question: "Will France win the 2026 FIFA World Cup?",
      categorySlug: "2026-fifa-world-cup-winner",
      categoryTitle: "2026 FIFA World Cup Winner",
    }),
    "2026 FIFA World Cup Winner - France"
  );
});
