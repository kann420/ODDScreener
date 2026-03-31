import test from "node:test";
import assert from "node:assert/strict";

import {
  appendReferralCode,
  buildReferralDiscounts,
  calculateArbPnlByShares,
  calculatePolymarketFee,
  resolveFeeMarketTitle,
} from "./arbCalculator.js";

test("buildReferralDiscounts enables Opinion and Predict.fun independently", () => {
  const discounts = buildReferralDiscounts({
    useOpinionReferral: true,
    usePredictFunReferral: false,
  });

  assert.equal(discounts.opinion, 0.1);
  assert.equal(discounts.predictfun, 0);
});

test("calculateArbPnlByShares applies Predict.fun referral discount only to Predict.fun leg", () => {
  const result = calculateArbPnlByShares({
    shares: 100,
    sideAPrice: 0.2,
    sideBPrice: 0.79,
    platformA: "predictfun",
    platformB: "polymarket",
    referralDiscounts: { predictfun: 0.1 },
  });

  assert.equal(Number(result.sideAFee.toFixed(2)), 0.36);
  assert.equal(result.sideBFee, 0);
  assert.equal(Number(result.netPnl.toFixed(2)), 0.64);
});

test("calculatePolymarketFee applies crypto fee curve using market category", () => {
  const result = calculatePolymarketFee({
    price: 0.5,
    quantity: 100,
    marketCategory: "Crypto",
  });

  assert.equal(Number(result.fee.toFixed(2)), 0.90);
  assert.equal(result.categoryLabel, "crypto");
  assert.equal(Number(result.feePercentage.toFixed(2)), 1.80);
});

test("calculatePolymarketFee applies sports fee to generic sports markets", () => {
  const result = calculatePolymarketFee({
    price: 0.967,
    quantity: 100,
    marketCategory: "Sports",
  });

  assert.equal(Number(result.fee.toFixed(2)), 0.09);
  assert.equal(result.categoryLabel, "sports");
});

test("calculatePolymarketFee maps Soccer subcategory to sports fee curve", () => {
  const result = calculatePolymarketFee({
    price: 0.984,
    quantity: 100,
    marketCategory: "Soccer",
    marketTitle: "Will USA win the 2026 FIFA World Cup?",
  });

  assert.equal(result.categoryLabel, "sports");
  assert.equal(Number(result.fee.toFixed(2)), 0.05);
});

test("calculatePolymarketFee applies politics fee curve", () => {
  const result = calculatePolymarketFee({
    price: 0.57,
    quantity: 100,
    marketCategory: "Politics",
  });

  assert.equal(Number(result.fee.toFixed(2)), 0.56);
  assert.equal(result.categoryLabel, "politics");
});

test("calculatePolymarketFee maps UK Politics subcategory to politics fee curve", () => {
  const result = calculatePolymarketFee({
    price: 0.42,
    quantity: 100,
    marketCategory: "UK Politics",
    marketTitle: "Starmer out by June 30, 2026?",
  });

  assert.equal(result.categoryLabel, "politics");
  assert.equal(Number(result.fee.toFixed(2)), 0.41);
});

test("calculatePolymarketFee maps Pop-Culture subcategory to culture fee curve", () => {
  const result = calculatePolymarketFee({
    price: 0.65,
    quantity: 100,
    marketCategory: "Pop-Culture",
    marketTitle: "Will this movie win best picture?",
  });

  assert.equal(result.categoryLabel, "culture");
  assert.equal(Number(result.fee.toFixed(2)), 0.74);
});

test("calculatePolymarketFee maps US-current-affairs subcategory to politics fee curve", () => {
  const result = calculatePolymarketFee({
    price: 0.51,
    quantity: 100,
    marketCategory: "US-current-affairs",
    marketTitle: "Will Biden win?",
  });

  assert.equal(result.categoryLabel, "politics");
  assert.equal(Number(result.fee.toFixed(2)), 0.51);
});

test("calculatePolymarketFee infers crypto from FDV market title when category metadata is missing", () => {
  const result = calculatePolymarketFee({
    price: 0.65,
    quantity: 100,
    marketTitle: "Betmoar FDV above $50M one day after launch?",
  });

  assert.equal(result.categoryLabel, "crypto");
  assert.equal(Number(result.fee.toFixed(2)), 1.06);
});

test("calculatePolymarketFee infers politics from Starmer market title when category metadata is missing", () => {
  const result = calculatePolymarketFee({
    price: 0.42,
    quantity: 100,
    marketTitle: "Starmer out by June 30, 2026?",
  });

  assert.equal(result.categoryLabel, "politics");
  assert.equal(Number(result.fee.toFixed(2)), 0.41);
});

test("calculateArbPnlByShares exposes polymarket category label for calculator rows", () => {
  const result = calculateArbPnlByShares({
    shares: 100,
    sideAPrice: 0.5,
    sideBPrice: 0.014,
    platformA: "polymarket",
    platformB: "predictfun",
    sideAMarketCategory: "Crypto",
  });

  assert.equal(result.sideAFeeCategoryLabel, "crypto");
  assert.equal(Number(result.sideAFee.toFixed(2)), 0.90);
});

test("calculateArbPnlByShares uses polymarket title fallback when category metadata is absent", () => {
  const result = calculateArbPnlByShares({
    shares: 100,
    sideAPrice: 0.65,
    sideBPrice: 0.06,
    platformA: "polymarket",
    platformB: "predictfun",
    sideAMarketTitle: "Betmoar FDV above $50M one day after launch?",
  });

  assert.equal(result.sideAFeeCategoryLabel, "crypto");
  assert.equal(Number(result.sideAFee.toFixed(2)), 1.06);
});

test("calculateArbPnlByShares applies sports fee when Polymarket row carries Soccer subcategory", () => {
  const result = calculateArbPnlByShares({
    shares: 100,
    sideAPrice: 0.984,
    sideBPrice: 0.014,
    platformA: "polymarket",
    platformB: "predictfun",
    sideAMarketCategory: "Soccer",
    sideAMarketTitle: "Will USA win the 2026 FIFA World Cup?",
  });

  assert.equal(result.sideAFeeCategoryLabel, "sports");
  assert.equal(Number(result.sideAFee.toFixed(2)), 0.05);
});

test("resolveFeeMarketTitle prefers descriptive market title over generic platform label", () => {
  const result = resolveFeeMarketTitle(
    "Polymarket",
    "Will USA win the 2026 FIFA World Cup?"
  );

  assert.equal(result, "Will USA win the 2026 FIFA World Cup?");
});

test("resolveFeeMarketTitle prefers full market title over short outcome-only label", () => {
  const result = resolveFeeMarketTitle(
    "$3B",
    "Betmoar FDV above $50M one day after launch?"
  );

  assert.equal(result, "Betmoar FDV above $50M one day after launch?");
});

test("appendReferralCode adds platform-specific query params", () => {
  const opinionUrl = appendReferralCode("https://app.opinion.trade/detail?topicId=123", "opinion", { opinion: true });
  const predictUrl = appendReferralCode("https://predict.fun/market/example", "predictfun", { predictfun: true });

  assert.equal(new URL(opinionUrl).searchParams.get("code"), "8YfTc9");
  assert.equal(new URL(predictUrl).searchParams.get("ref"), "9DEDB");
});
