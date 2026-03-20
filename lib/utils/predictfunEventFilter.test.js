import test from "node:test";
import assert from "node:assert/strict";

import {
  isPredictFunMarchMadnessMarket,
  matchesPredictFunEventFilter,
  normalizePredictFunEventKey,
} from "./predictfunEventFilter.js";

test("normalizePredictFunEventKey keeps March Madness stable", () => {
  assert.equal(normalizePredictFunEventKey("March Madness"), "march-madness");
  assert.equal(normalizePredictFunEventKey("  NCAAM  "), "ncaam");
});

test("isPredictFunMarchMadnessMarket matches the current NCAA basketball category", () => {
  const market = {
    categorySlug: "2026-mens-ncaa-basketball-champion",
    title: "2026 Men's NCAA Basketball Champion",
    question: "2026 Men's NCAA Basketball Champion",
  };

  assert.equal(isPredictFunMarchMadnessMarket(market), true);
});

test("matchesPredictFunEventFilter respects NCAAM tags and rejects unrelated markets", () => {
  const marchMarket = {
    categorySlug: "random-slug",
    title: "Bracket market",
    categoryTags: [{ name: "NCAAM" }],
  };
  const unrelated = {
    categorySlug: "crypto-btc",
    title: "BTC market",
    categoryTags: [{ name: "Crypto" }],
  };

  assert.equal(matchesPredictFunEventFilter(marchMarket, "march-madness"), true);
  assert.equal(matchesPredictFunEventFilter(unrelated, "march-madness"), false);
});

test("isPredictFunMarchMadnessMarket catches single-game CBB markets without category hydration", () => {
  const market = {
    id: 71378,
    categorySlug: "cbb-cabap-kan-2026-03-20",
    marketVariant: "SPORTS_TEAM_MATCH",
    title: "California Baptist Lancers vs. Kansas Jayhawks",
    question: "California Baptist Lancers vs. Kansas Jayhawks",
    description: "In the upcoming CBB game, scheduled for March 20 at 12:00 AM ET:",
  };

  assert.equal(isPredictFunMarchMadnessMarket(market), true);
});
