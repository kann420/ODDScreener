import test from "node:test";
import assert from "node:assert/strict";

import {
  findPolyMatchForOpinionMarket,
  matchCategoricalOutcomes,
} from "./arbitageAutoMatcher.js";

test("findPolyMatchForOpinionMarket rejects wrong Predict.fun FDV series even when thresholds overlap", () => {
  const opinionMarket = {
    marketTitle: "StandX FDV above ... one day after launch?",
    slug: "standx-fdv-above-one-day-after-launch",
  };

  const predictFunEvents = [
    {
      _source: "predictfun",
      title: "Based FDV above ___ one day after launch?",
      slug: "based-fdv-above-one-day-after-launch",
      markets: [
        {
          _source: "predictfun",
          id: "pf-based-500m",
          question: "Based FDV above $500M one day after launch?",
          title: "Based FDV above $500M one day after launch?",
          displayTitle: "Based FDV above $500M one day after launch?",
          groupItemTitle: "$500M",
          slug: "based-fdv-above-one-day-after-launch--pf-based-500m",
          outcomes: ["Yes", "No"],
          clobTokenIds: JSON.stringify(["pfyes:1", "pfno:1"]),
          active: true,
          closed: false,
        },
      ],
      closed: false,
    },
  ];

  const match = findPolyMatchForOpinionMarket(opinionMarket, predictFunEvents, 0.35, {
    enableWhitelist: false,
  });

  assert.equal(match, null);
});

test("matchCategoricalOutcomes does not map Opinion FDV children onto another project's Predict.fun series", () => {
  const opinionCategorical = {
    marketTitle: "USD.AI FDV above ... one day after launch?",
    childMarkets: [
      { marketId: 2672, marketTitle: ">$500M" },
      { marketId: 2674, marketTitle: ">$1B" },
    ],
  };

  const wrongPredictFunEvent = {
    _source: "predictfun",
    title: "Based FDV above ___ one day after launch?",
    slug: "based-fdv-above-one-day-after-launch",
    markets: [
      {
        _source: "predictfun",
        id: "pf-based-500m",
        question: "Based FDV above $500M one day after launch?",
        title: "Based FDV above $500M one day after launch?",
        displayTitle: "Based FDV above $500M one day after launch?",
        groupItemTitle: "$500M",
        slug: "based-fdv-above-one-day-after-launch--pf-based-500m",
        outcomes: ["Yes", "No"],
        clobTokenIds: JSON.stringify(["pfyes:1", "pfno:1"]),
        active: true,
        closed: false,
      },
      {
        _source: "predictfun",
        id: "pf-based-1b",
        question: "Based FDV above $1B one day after launch?",
        title: "Based FDV above $1B one day after launch?",
        displayTitle: "Based FDV above $1B one day after launch?",
        groupItemTitle: "$1B",
        slug: "based-fdv-above-one-day-after-launch--pf-based-1b",
        outcomes: ["Yes", "No"],
        clobTokenIds: JSON.stringify(["pfyes:2", "pfno:2"]),
        active: true,
        closed: false,
      },
    ],
    closed: false,
  };

  const matches = matchCategoricalOutcomes(opinionCategorical, [wrongPredictFunEvent]);

  assert.equal(matches.length, 0);
});

test("matchCategoricalOutcomes still matches the correct Predict.fun FDV series", () => {
  const opinionCategorical = {
    marketTitle: "USD.AI FDV above ... one day after launch?",
    childMarkets: [
      { marketId: 2672, marketTitle: ">$500M" },
      { marketId: 2674, marketTitle: ">$1B" },
    ],
  };

  const correctPredictFunEvent = {
    _source: "predictfun",
    title: "USD.AI FDV above ___ one day after launch?",
    slug: "usd-ai-fdv-above-one-day-after-launch",
    markets: [
      {
        _source: "predictfun",
        id: "pf-usdai-500m",
        question: "USD.AI FDV above $500M one day after launch?",
        title: "USD.AI FDV above $500M one day after launch?",
        displayTitle: "USD.AI FDV above $500M one day after launch?",
        groupItemTitle: "$500M",
        slug: "usd-ai-fdv-above-one-day-after-launch--pf-usdai-500m",
        outcomes: ["Yes", "No"],
        clobTokenIds: JSON.stringify(["pfyes:3", "pfno:3"]),
        active: true,
        closed: false,
      },
      {
        _source: "predictfun",
        id: "pf-usdai-1b",
        question: "USD.AI FDV above $1B one day after launch?",
        title: "USD.AI FDV above $1B one day after launch?",
        displayTitle: "USD.AI FDV above $1B one day after launch?",
        groupItemTitle: "$1B",
        slug: "usd-ai-fdv-above-one-day-after-launch--pf-usdai-1b",
        outcomes: ["Yes", "No"],
        clobTokenIds: JSON.stringify(["pfyes:4", "pfno:4"]),
        active: true,
        closed: false,
      },
    ],
    closed: false,
  };

  const matches = matchCategoricalOutcomes(opinionCategorical, [correctPredictFunEvent]);

  assert.equal(matches.length, 2);
  assert.deepEqual(
    matches.map((match) => match.polyMarket.id),
    ["pf-usdai-500m", "pf-usdai-1b"]
  );
});
