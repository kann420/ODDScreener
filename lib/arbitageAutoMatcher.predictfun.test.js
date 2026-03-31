import test from "node:test";
import assert from "node:assert/strict";

import {
  findPolyMatchForOpinionMarket,
  matchCategoricalOutcomes,
  predictfunMarketsToPolyFormat,
} from "./arbitageAutoMatcher.js";

test("predictfunMarketsToPolyFormat preserves FDV project context and threshold label", () => {
  const [event] = predictfunMarketsToPolyFormat([
    {
      id: 20427,
      title: "$500M",
      question: "USD.AI FDV above $500M one day after launch?",
      categorySlug: "usdai-fdv-above-one-day-after-launch",
      _categoryTitle: "USD.AI FDV above ___ one day after launch?",
      decimalPrecision: 2,
      stats: { volume24hUsd: 12, totalLiquidityUsd: 34 },
    },
  ]);

  assert.equal(event.title, "USD.AI FDV above ___ one day after launch?");
  assert.equal(event.slug, "usdai-fdv-above-one-day-after-launch");
  assert.equal(event.markets[0].title, "USD.AI FDV above $500M one day after launch?");
  assert.equal(event.markets[0].question, "USD.AI FDV above $500M one day after launch?");
  assert.equal(event.markets[0].groupItemTitle, "$500M");
  assert.equal(event.markets[0].slug, "usdai-fdv-above-one-day-after-launch--20427");
});

test("findPolyMatchForOpinionMarket rejects FDV events from the wrong project", () => {
  const events = predictfunMarketsToPolyFormat([
    {
      id: 1346,
      title: "$500M",
      question: "Based FDV above $500M one day after launch?",
      categorySlug: "based-fdv-above-one-day-after-launch",
      _categoryTitle: "Based FDV above ___ one day after launch?",
    },
    {
      id: 20427,
      title: "$500M",
      question: "USD.AI FDV above $500M one day after launch?",
      categorySlug: "usdai-fdv-above-one-day-after-launch",
      _categoryTitle: "USD.AI FDV above ___ one day after launch?",
    },
  ]);

  const match = findPolyMatchForOpinionMarket(
    {
      marketTitle: "USD.AI FDV above ... one day after launch?",
      slug: "usdai-fdv-above-one-day-after-launch",
    },
    events,
    0.5,
    { enableWhitelist: false }
  );

  assert.ok(match);
  assert.equal(match.polyEvent.slug, "usdai-fdv-above-one-day-after-launch");
});

test("matchCategoricalOutcomes rejects same-threshold Predict.fun children from the wrong FDV series", () => {
  const [wrongEvent] = predictfunMarketsToPolyFormat([
    {
      id: 1346,
      title: "$500M",
      question: "Based FDV above $500M one day after launch?",
      categorySlug: "based-fdv-above-one-day-after-launch",
      _categoryTitle: "Based FDV above ___ one day after launch?",
    },
  ]);

  const wrongMatches = matchCategoricalOutcomes(
    {
      marketTitle: "USD.AI FDV above ... one day after launch?",
      childMarkets: [
        {
          marketId: 5001,
          marketTitle: "$500M",
        },
      ],
    },
    wrongEvent
  );

  assert.equal(wrongMatches.length, 0);

  const [rightEvent] = predictfunMarketsToPolyFormat([
    {
      id: 20427,
      title: "$500M",
      question: "USD.AI FDV above $500M one day after launch?",
      categorySlug: "usdai-fdv-above-one-day-after-launch",
      _categoryTitle: "USD.AI FDV above ___ one day after launch?",
    },
  ]);

  const rightMatches = matchCategoricalOutcomes(
    {
      marketTitle: "USD.AI FDV above ... one day after launch?",
      childMarkets: [
        {
          marketId: 5001,
          marketTitle: "$500M",
        },
      ],
    },
    rightEvent
  );

  assert.equal(rightMatches.length, 1);
  assert.equal(rightMatches[0].polyMarket.marketId, "20427");
});
