import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizePredictFunFee,
  parsePredictFunTradeAmount,
} from "./predictfunTradeFee.js";

test("parsePredictFunTradeAmount converts 18-decimal wei to display units", () => {
  assert.equal(parsePredictFunTradeAmount("460000000000000000"), 0.46);
  assert.equal(parsePredictFunTradeAmount("200000000000000000000"), 200);
});

test("normalizePredictFunFee keeps collateral fee in USD units", () => {
  const fee = normalizePredictFunFee({
    fee: { amount: "384009600000000000", type: "COLLATERAL" },
    price: 0.52,
  });

  assert.equal(fee, 0.3840096);
});

test("normalizePredictFunFee converts share-denominated fee into USD using execution price", () => {
  const fee = normalizePredictFunFee({
    fee: { amount: "2000000000000000000", type: "SHARES" },
    price: 0.01,
  });

  assert.equal(fee, 0.02);
});

test("normalizePredictFunFee sums fee and protocolFee when both are present", () => {
  const fee = normalizePredictFunFee({
    fee: { amount: "100000000000000000", type: "COLLATERAL" },
    protocolFee: { amount: "50000000000000000", type: "COLLATERAL" },
    price: 0.5,
  });

  assert.equal(Number(fee.toFixed(6)), 0.15);
});
