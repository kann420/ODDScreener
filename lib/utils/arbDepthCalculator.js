import { buildFeePerShareFn, calcPlatformFee } from "./arbCalculator.js";

function normalizeOrderbookLevels(levels, sortDirection) {
  const mapped = (Array.isArray(levels) ? levels : [])
    .map((level) => ({
      price: Number(level?.price ?? 0),
      shares: Number(level?.shares ?? level?.size ?? 0),
    }))
    .filter((level) => Number.isFinite(level.price) && level.shares > 0);

  mapped.sort((a, b) =>
    sortDirection === "desc" ? b.price - a.price : a.price - b.price
  );

  return mapped;
}

function formatFeeLabel(platform, fee, feePercentage) {
  if (!Number.isFinite(fee) || fee <= 0) {
    return {
      label: "$0",
      labelPct: null,
    };
  }

  const decimals = platform === "predictfun" ? 3 : 2;
  return {
    label: `~$${fee.toFixed(2)}`,
    labelPct: `~${feePercentage.toFixed(decimals)}%`,
  };
}

function resolveFeeCategoryLabel(platform, averagePrice, quantity, referralDiscounts, feeMeta) {
  if (!Number.isFinite(averagePrice) || averagePrice <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  return calcPlatformFee({
    platform,
    price: averagePrice,
    quantity,
    referralDiscounts,
    marketCategory: feeMeta?.marketCategory ?? null,
    feesEnabled: feeMeta?.feesEnabled ?? null,
    sportsMarketType: feeMeta?.sportsMarketType ?? null,
    marketTitle: feeMeta?.marketTitle ?? null,
  }).categoryLabel;
}

export function calculateArbDepthPnlByShares({
  shares,
  sideABook,
  sideBBook,
  platformA,
  platformB,
  mode = "buy",
  feeMetaA = {},
  feeMetaB = {},
  referralDiscounts = {},
} = {}) {
  const requestedShares = Math.max(0, Number(shares) || 0);
  if (requestedShares <= 0) return null;

  const isBuy = mode !== "sell";
  const sideKey = isBuy ? "asks" : "bids";
  const levelsA = normalizeOrderbookLevels(sideABook?.[sideKey], isBuy ? "asc" : "desc");
  const levelsB = normalizeOrderbookLevels(sideBBook?.[sideKey], isBuy ? "asc" : "desc");

  if (!levelsA.length || !levelsB.length) return null;

  const feeFnA = buildFeePerShareFn(platformA, {
    ...feeMetaA,
    referralDiscounts,
  });
  const feeFnB = buildFeePerShareFn(platformB, {
    ...feeMetaB,
    referralDiscounts,
  });

  let totalShares = 0;
  let totalCostA = 0;
  let totalCostB = 0;
  let totalFeesA = 0;
  let totalFeesB = 0;
  let totalProfit = 0;
  let idxA = 0;
  let idxB = 0;
  let remA = levelsA[0].shares;
  let remB = levelsB[0].shares;

  while (idxA < levelsA.length && idxB < levelsB.length && totalShares < requestedShares) {
    const pA = levelsA[idxA].price;
    const pB = levelsB[idxB].price;
    const feePerShareA = feeFnA(pA);
    const feePerShareB = feeFnB(pB);
    const marginalEv = isBuy
      ? 1 - pA - pB - feePerShareA - feePerShareB
      : pA + pB - 1 - feePerShareA - feePerShareB;

    if (marginalEv <= 0) break;

    const chunk = Math.min(remA, remB, requestedShares - totalShares);
    totalShares += chunk;
    totalCostA += pA * chunk;
    totalCostB += pB * chunk;
    totalFeesA += feePerShareA * chunk;
    totalFeesB += feePerShareB * chunk;
    totalProfit += marginalEv * chunk;

    remA -= chunk;
    remB -= chunk;

    if (remA <= 0) {
      idxA += 1;
      if (idxA < levelsA.length) remA = levelsA[idxA].shares;
    }
    if (remB <= 0) {
      idxB += 1;
      if (idxB < levelsB.length) remB = levelsB[idxB].shares;
    }
  }

  if (totalShares <= 0) return null;

  const avgPriceA = totalCostA / totalShares;
  const avgPriceB = totalCostB / totalShares;
  const sideAFeePercentage = totalCostA > 0 ? (totalFeesA / totalCostA) * 100 : 0;
  const sideBFeePercentage = totalCostB > 0 ? (totalFeesB / totalCostB) * 100 : 0;
  const sideATotal = totalCostA + totalFeesA;
  const sideBTotal = totalCostB + totalFeesB;
  const totalCost = sideATotal + sideBTotal;
  const roi = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;
  const sideAFeeLabelInfo = formatFeeLabel(platformA, totalFeesA, sideAFeePercentage);
  const sideBFeeLabelInfo = formatFeeLabel(platformB, totalFeesB, sideBFeePercentage);

  return {
    requestedShares,
    shares: totalShares,
    sharesExecuted: totalShares,
    fullyFilled: totalShares >= requestedShares - 1e-9,
    sideACost: totalCostA,
    sideBCost: totalCostB,
    sideAFee: totalFeesA,
    sideBFee: totalFeesB,
    sideAFeePercentage,
    sideBFeePercentage,
    sideAFeeLabel: sideAFeeLabelInfo.label,
    sideBFeeLabel: sideBFeeLabelInfo.label,
    sideAFeeLabelPct: sideAFeeLabelInfo.labelPct,
    sideBFeeLabelPct: sideBFeeLabelInfo.labelPct,
    sideAFeeCategoryLabel: resolveFeeCategoryLabel(platformA, avgPriceA, totalShares, referralDiscounts, feeMetaA),
    sideBFeeCategoryLabel: resolveFeeCategoryLabel(platformB, avgPriceB, totalShares, referralDiscounts, feeMetaB),
    sideATotal,
    sideBTotal,
    totalCost,
    toReturn: totalShares,
    netPnl: totalProfit,
    roi,
    sideAAvgPrice: avgPriceA,
    sideBAvgPrice: avgPriceB,
  };
}
