import test from "node:test";
import assert from "node:assert/strict";

import {
  PREDICTFUN_REFERRAL_CODE,
  calculatePredictFunFee,
  appendPredictFunReferral,
} from "./predictfunFee.js";

test("calculatePredictFunFee matches 2% * min(price, 1-price) * shares", () => {
  const result = calculatePredictFunFee({ price: 0.2, quantity: 100 });

  assert.equal(result.rawFee, 0.4);
  assert.equal(result.fee, 0.4);
  assert.equal(result.feePercentage, 2);
});

test("calculatePredictFunFee applies 10% referral discount", () => {
  const result = calculatePredictFunFee({
    price: 0.95,
    quantity: 100,
    referralDiscount: 0.1,
  });

  assert.equal(Number(result.rawFee.toFixed(4)), 0.1);
  assert.equal(Number(result.fee.toFixed(4)), 0.09);
  assert.equal(Number(result.feePercentage.toFixed(3)), 0.095);
});

test("appendPredictFunReferral injects the Predict.fun referral code", () => {
  const url = appendPredictFunReferral("https://predict.fun/market/example-slug");
  const parsed = new URL(url);

  assert.equal(parsed.searchParams.get("ref"), PREDICTFUN_REFERRAL_CODE);
});
