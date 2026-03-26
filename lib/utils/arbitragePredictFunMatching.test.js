import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPredictFunPseudoEventTitle,
  buildPredictFunPseudoMarket,
  hasFdvSeriesMismatch,
} from "./arbitragePredictFunMatching.js";

test("buildPredictFun pseudo-market expands placeholder questions but keeps the raw threshold label", () => {
  const rawMarket = {
    id: 1348,
    title: "$1B",
    question: "edgeX FDV above ___ one day after launch?",
    categorySlug: "edgex-fdv-above-one-day-after-launch",
    _categoryTitle: "edgeX FDV above ___ one day after launch?",
    marketVariant: "DEFAULT",
  };

  const eventTitle = buildPredictFunPseudoEventTitle([rawMarket], rawMarket.categorySlug);
  const pseudoMarket = buildPredictFunPseudoMarket(rawMarket, eventTitle);

  assert.equal(eventTitle, "edgeX FDV above ___ one day after launch?");
  assert.equal(pseudoMarket.question, "edgeX FDV above $1B one day after launch?");
  assert.equal(pseudoMarket.title, "edgeX FDV above $1B one day after launch?");
  assert.equal(pseudoMarket.groupItemTitle, "$1B");
  assert.equal(pseudoMarket.pseudoSlug, "edgex-fdv-above-one-day-after-launch--1348");
});

test("buildPredictFun pseudo-market slug stays unique across sibling thresholds", () => {
  const categorySlug = "backpack-fdv-above-one-day-after-launch";
  const marketA = buildPredictFunPseudoMarket({
    id: 7905,
    title: "$1B",
    question: "Backpack FDV above ___ one day after launch?",
    categorySlug,
    _categoryTitle: "Backpack FDV above ___ one day after launch?",
  });
  const marketB = buildPredictFunPseudoMarket({
    id: 7906,
    title: "$5B",
    question: "Backpack FDV above ___ one day after launch?",
    categorySlug,
    _categoryTitle: "Backpack FDV above ___ one day after launch?",
  });

  assert.notEqual(marketA.pseudoSlug, marketB.pseudoSlug);
});

test("hasFdvSeriesMismatch rejects wrong project and wrong threshold matches", () => {
  assert.equal(
    hasFdvSeriesMismatch(
      "Backpack FDV above ... one day after launch?",
      "edgeX FDV above ___ one day after launch?"
    ),
    true
  );

  assert.equal(
    hasFdvSeriesMismatch(
      "USD.AI FDV above $1B one day after launch?",
      "USD.AI FDV above $2B one day after launch?"
    ),
    true
  );

  assert.equal(
    hasFdvSeriesMismatch(
      "Backpack FDV above $1B one day after launch?",
      "Backpack FDV above $1B one day after launch?"
    ),
    false
  );

  assert.equal(
    hasFdvSeriesMismatch(
      "What price will BTC hit in April 2026?",
      "What price will ETH hit in April 2026?"
    ),
    false
  );
});
