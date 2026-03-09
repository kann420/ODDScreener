import test from "node:test";
import assert from "node:assert/strict";

import {
  appendReferralCode,
  buildReferralDiscounts,
  calculateArbPnlByShares,
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

test("appendReferralCode adds platform-specific query params", () => {
  const opinionUrl = appendReferralCode("https://app.opinion.trade/detail?topicId=123", "opinion", { opinion: true });
  const predictUrl = appendReferralCode("https://predict.fun/market/example", "predictfun", { predictfun: true });

  assert.equal(new URL(opinionUrl).searchParams.get("code"), "8YfTc9");
  assert.equal(new URL(predictUrl).searchParams.get("ref"), "9DEDB");
});
