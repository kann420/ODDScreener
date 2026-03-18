import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPredictFunDisplayTitle,
  normalizePredictFunWalletGraphqlPosition,
  summarizePredictFunMarketPositions,
} from "./predictfunAccountPosition.js";

test("buildPredictFunDisplayTitle avoids repeating market text already present in category title", () => {
  const title = buildPredictFunDisplayTitle(
    "(Oscars 2026) Will One Battle After Another win Best Picture at the 98th Academy Awards?",
    "Will One Battle After Another win Best Picture at the 98th Academy Awards?"
  );

  assert.equal(
    title,
    "(Oscars 2026) Will One Battle After Another win Best Picture at the 98th Academy Awards?"
  );
});

test("normalizePredictFunWalletGraphqlPosition keeps small balances and category metadata", () => {
  const position = normalizePredictFunWalletGraphqlPosition({
    shares: "90060430206918545",
    averageBuyPriceUsd: 0.78,
    valueUsd: 0.07,
    pnlUsd: -0.01,
    outcome: { id: "2267", index: 1, name: "Yes" },
    market: {
      id: "1187",
      title: "Will One Battle After Another win Best Picture at the 98th Academy Awards?",
      question: "Will One Battle After Another win Best Picture at the 98th Academy Awards?",
      imageUrl: "https://static.predict.fun/example-market",
      category: {
        id: "will-one-battle-after-another-win-oscars-2026-best-picture",
        title: "(Oscars 2026) Will One Battle After Another win Best Picture at the 98th Academy Awards?",
        imageUrl: "https://static.predict.fun/example-category",
        endsAt: "2026-07-01T04:00:00.000Z",
      },
    },
  });

  assert.equal(position.marketId, "1187");
  assert.equal(position.outcomeSideEnum, "Yes");
  assert.equal(position.categorySlug, "will-one-battle-after-another-win-oscars-2026-best-picture");
  assert.equal(Number(position.sharesOwned.toFixed(8)), 0.09006043);
  assert.match(position.displayTitle, /Oscars 2026/);
});

test("summarizePredictFunMarketPositions keeps outcome-specific current balances", () => {
  const summary = summarizePredictFunMarketPositions([
    { shares: "90060430206918545", outcome: { index: 1, name: "Yes" } },
    { shares: "147000000000000000000", outcome: { index: 2, name: "No" } },
  ], "YES");

  assert.equal(summary.displayOutcome, "YES");
  assert.equal(Number(summary.displayShares.toFixed(8)), 0.09006043);
  assert.equal(summary.otherOutcome, "NO");
  assert.equal(summary.otherShares, 147);
  assert.equal(Number(summary.totalShares.toFixed(8)), 147.09006043);
});
