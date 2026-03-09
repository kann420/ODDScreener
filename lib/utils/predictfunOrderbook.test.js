import test from "node:test";
import assert from "node:assert/strict";

import { buildPredictFunSideSnapshot, complementYesPrice } from "./predictfunOrderbook.js";

test("complementYesPrice preserves 3-decimal precision for Predict.fun NO prices", () => {
  assert.equal(complementYesPrice(0.055, 3), 0.945);
  assert.equal(complementYesPrice(0.036, 3), 0.964);
});

test("buildPredictFunSideSnapshot derives NO-side top of book from YES-side levels", () => {
  const rawOrderbook = {
    asks: [
      [0.055, 25073.77],
      [0.056, 2143],
      [0.063, 972.89],
    ],
    bids: [
      [0.036, 1842.07],
      [0.034, 498.55],
      [0.031, 277.41],
    ],
  };

  const noSide = buildPredictFunSideSnapshot(rawOrderbook, {
    side: "no",
    decimalPrecision: 3,
  });

  assert.equal(noSide.bestBid, 0.945);
  assert.equal(noSide.bestBidSize, 25073.77);
  assert.equal(noSide.bestAsk, 0.964);
  assert.equal(noSide.bestAskSize, 1842.07);
  assert.deepEqual(
    noSide.bids.slice(0, 3).map((level) => level.price),
    [0.945, 0.944, 0.937]
  );
  assert.deepEqual(
    noSide.asks.slice(0, 3).map((level) => level.price),
    [0.964, 0.966, 0.969]
  );
});
