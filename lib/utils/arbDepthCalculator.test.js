import test from "node:test";
import assert from "node:assert/strict";

import { calculateArbDepthPnlByShares } from "./arbDepthCalculator.js";

test("calculateArbDepthPnlByShares matches requested shares when profitable depth is available", () => {
  const result = calculateArbDepthPnlByShares({
    shares: 100,
    sideABook: {
      asks: [{ price: 0.2, shares: 100 }],
      bids: [],
    },
    sideBBook: {
      asks: [{ price: 0.7, shares: 100 }],
      bids: [],
    },
    platformA: "unknown-a",
    platformB: "unknown-b",
  });

  assert.equal(result.sharesExecuted, 100);
  assert.equal(Number(result.sideACost.toFixed(2)), 20);
  assert.equal(Number(result.sideBCost.toFixed(2)), 70);
  assert.equal(Number(result.netPnl.toFixed(2)), 10);
  assert.equal(Number(result.roi.toFixed(2)), 11.11);
});

test("calculateArbDepthPnlByShares stops at profitable depth and reports partial fill", () => {
  const result = calculateArbDepthPnlByShares({
    shares: 100,
    sideABook: {
      asks: [
        { price: 0.2, shares: 50 },
        { price: 0.31, shares: 50 },
      ],
      bids: [],
    },
    sideBBook: {
      asks: [{ price: 0.7, shares: 100 }],
      bids: [],
    },
    platformA: "unknown-a",
    platformB: "unknown-b",
  });

  assert.equal(result.fullyFilled, false);
  assert.equal(result.sharesExecuted, 50);
  assert.equal(Number(result.netPnl.toFixed(2)), 5);
  assert.equal(result.toReturn, 50);
});

test("calculateArbDepthPnlByShares applies referral-aware predict.fun fees", () => {
  const withReferral = calculateArbDepthPnlByShares({
    shares: 100,
    sideABook: {
      asks: [{ price: 0.2, shares: 100 }],
      bids: [],
    },
    sideBBook: {
      asks: [{ price: 0.1, shares: 100 }],
      bids: [],
    },
    platformA: "predictfun",
    platformB: "unknown-b",
    referralDiscounts: { predictfun: 0.1 },
  });

  const withoutReferral = calculateArbDepthPnlByShares({
    shares: 100,
    sideABook: {
      asks: [{ price: 0.2, shares: 100 }],
      bids: [],
    },
    sideBBook: {
      asks: [{ price: 0.1, shares: 100 }],
      bids: [],
    },
    platformA: "predictfun",
    platformB: "unknown-b",
    referralDiscounts: { predictfun: 0 },
  });

  assert.ok(withReferral.sideAFee < withoutReferral.sideAFee);
  assert.equal(withReferral.fullyFilled, true);
});
