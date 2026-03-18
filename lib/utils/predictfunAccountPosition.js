function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeTitle(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function parsePredictFunPositionShares(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? n / 1e18 : n;
}

export function isPredictFunYesOutcome(outcomeName, outcomeIndex) {
  const normalizedName = String(outcomeName || "").trim().toLowerCase();
  if (normalizedName === "yes") return true;
  if (normalizedName === "no") return false;

  const normalizedIndex = Number(outcomeIndex);
  if (normalizedIndex === 0 || normalizedIndex === 1) return true;
  if (normalizedIndex === 2) return false;
  return false;
}

export function buildPredictFunDisplayTitle(categoryTitle, marketTitle) {
  const category = String(categoryTitle || "").trim();
  const market = String(marketTitle || "").trim();

  if (!category) return market;
  if (!market) return category;

  const normalizedCategory = normalizeTitle(category);
  const normalizedMarket = normalizeTitle(market);
  if (normalizedCategory === normalizedMarket || normalizedCategory.includes(normalizedMarket)) {
    return category;
  }

  return `${category}: ${market}`;
}

export function normalizePredictFunWalletGraphqlPosition(node) {
  if (!node) return null;

  const sharesOwned = parsePredictFunPositionShares(node?.shares);
  if (!(sharesOwned > 0)) return null;

  const market = node?.market || {};
  const category = market?.category || null;
  const outcome = node?.outcome || {};
  const outcomeName = outcome?.name || null;
  const outcomeIndex = outcome?.index ?? null;
  const isYes = isPredictFunYesOutcome(outcomeName, outcomeIndex);

  const avgEntryPrice = numberOrNull(node?.averageBuyPriceUsd) ?? 0;
  const currentValueInQuoteToken = numberOrNull(node?.valueUsd) ?? 0;
  const unrealizedPnl = numberOrNull(node?.pnlUsd) ?? 0;
  const currentPrice =
    sharesOwned > 0
      ? currentValueInQuoteToken / sharesOwned
      : avgEntryPrice;

  const marketTitle = market?.title || market?.question || "";
  const categoryTitle = category?.title || null;
  const displayTitle = buildPredictFunDisplayTitle(categoryTitle, marketTitle);

  return {
    platform: "predictfun",
    marketId: market?.id ? String(market.id) : "",
    categorySlug: category?.id || null,
    displayTitle,
    marketTitle,
    categoryTitle,
    outcomeName: outcomeName || (isYes ? "Yes" : "No"),
    outcome: outcomeName || (isYes ? "Yes" : "No"),
    outcomeSide: isYes ? 1 : 2,
    outcomeSideEnum: isYes ? "Yes" : "No",
    thumbnailUrl: market?.imageUrl || category?.imageUrl || null,
    imageUrl: market?.imageUrl || category?.imageUrl || null,
    sharesOwned,
    avgEntryPrice,
    currentPrice,
    currentValueInQuoteToken,
    unrealizedPnl,
    unrealizedPnlPercent:
      avgEntryPrice * sharesOwned > 0
        ? (unrealizedPnl / (avgEntryPrice * sharesOwned)) * 100
        : 0,
    endsAt: category?.endsAt || null,
    marketUrl: category?.id ? `https://predict.fun/market/${category.id}` : null,
  };
}

export function summarizePredictFunMarketPositions(positionNodes, primaryOutcome = null) {
  let yesShares = 0;
  let noShares = 0;

  for (const node of Array.isArray(positionNodes) ? positionNodes : []) {
    const shares = parsePredictFunPositionShares(node?.shares);
    if (!(shares > 0)) continue;

    if (isPredictFunYesOutcome(node?.outcome?.name, node?.outcome?.index)) {
      yesShares += shares;
    } else {
      noShares += shares;
    }
  }

  const normalizedPrimary = String(primaryOutcome || "").trim().toUpperCase();
  const displayOutcome =
    normalizedPrimary === "YES" || normalizedPrimary === "NO"
      ? normalizedPrimary
      : yesShares >= noShares
        ? "YES"
        : "NO";

  const displayShares = displayOutcome === "YES" ? yesShares : noShares;
  const otherOutcome = displayOutcome === "YES" ? "NO" : "YES";
  const otherShares = otherOutcome === "YES" ? yesShares : noShares;
  const totalShares = yesShares + noShares;

  return {
    yesShares,
    noShares,
    totalShares,
    displayOutcome,
    displayShares,
    otherOutcome,
    otherShares,
    hasAnyPosition: totalShares > 0,
  };
}
