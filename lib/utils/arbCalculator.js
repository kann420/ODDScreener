import {
  PREDICTFUN_REFERRAL_DISCOUNT,
  calculatePredictFunFee,
  appendPredictFunReferral,
} from "./predictfunFee.js";

export const OPINION_REFERRAL_CODE = "8YfTc9";
export const OPINION_REFERRAL_DISCOUNT = 0.1;

function estimateOpinionNumFills(notional) {
  if (notional < 50) return 1;
  if (notional < 100) return 2;
  if (notional < 200) return 3;
  if (notional < 300) return 4;
  if (notional < 400) return 5;
  return -1;
}

export function calculateOpinionFee({
  price,
  quantity,
  topicRate = 0.01,
  userDiscount = 0,
  transactionDiscount = 0,
  referralDiscount = 0,
} = {}) {
  const totalNotional = Number(price || 0) * Number(quantity || 0);
  const maxFee = totalNotional * 0.01;
  const numFills = estimateOpinionNumFills(totalNotional);
  const discountMultiplier = (1 - userDiscount) * (1 - transactionDiscount) * (1 - referralDiscount);

  let baseTotalFee;
  let rawFeePerFill = 0;
  let feePerFill = 0;
  let isCapped = false;

  if (numFills === -1) {
    baseTotalFee = maxFee;
    isCapped = true;
  } else {
    const baseEffectiveRate = topicRate * price * (1 - price);
    const notionalPerFill = totalNotional / numFills;

    rawFeePerFill = notionalPerFill * baseEffectiveRate;
    feePerFill = Math.max(rawFeePerFill, 0.25);
    baseTotalFee = feePerFill * numFills;

    if (baseTotalFee > maxFee) {
      baseTotalFee = maxFee;
      isCapped = true;
    }
  }

  let fee = baseTotalFee * discountMultiplier;
  fee = Math.max(fee, 0.25);

  return {
    fee,
    baseFee: baseTotalFee,
    feePercentage: totalNotional > 0 ? (fee / totalNotional) * 100 : 0,
    notional: totalNotional,
    numFills: numFills === -1 ? "max" : numFills,
    rawFeePerFill,
    feePerFill,
    maxFee,
    discountMultiplier,
    isMinimumApplied: fee <= 0.25,
    isCapped,
  };
}

export function calculateProbableFee({ price, quantity } = {}) {
  const normalizedPrice = Math.max(0, Math.min(1, Number(price) || 0));
  const normalizedQuantity = Math.max(0, Number(quantity) || 0);
  const notional = normalizedPrice * normalizedQuantity;
  const feeRate = 0.07 * normalizedPrice * (1 - normalizedPrice);
  const fee = notional * feeRate;

  return {
    fee,
    feeRate,
    feePercentage: notional > 0 ? feeRate * 100 : 0,
    notional,
  };
}

export function calcPlatformFee({ platform, price, quantity, referralDiscounts = {} } = {}) {
  if (platform === "polymarket") {
    return { fee: 0, feePercentage: 0, label: "$0", labelPct: null, extra: {} };
  }

  if (platform === "opinion") {
    const result = calculateOpinionFee({
      price,
      quantity,
      referralDiscount: referralDiscounts.opinion ?? 0,
    });
    return {
      fee: result.fee,
      feePercentage: result.feePercentage,
      label: `~$${result.fee.toFixed(2)}`,
      labelPct: `~${result.feePercentage.toFixed(2)}%`,
      extra: result,
    };
  }

  if (platform === "probable") {
    const result = calculateProbableFee({ price, quantity });
    return {
      fee: result.fee,
      feePercentage: result.feePercentage,
      label: `~$${result.fee.toFixed(2)}`,
      labelPct: `~${result.feePercentage.toFixed(2)}%`,
      extra: result,
    };
  }

  if (platform === "predictfun") {
    const result = calculatePredictFunFee({
      price,
      quantity,
      referralDiscount: referralDiscounts.predictfun ?? 0,
    });
    return {
      fee: result.fee,
      feePercentage: result.feePercentage,
      label: `~$${result.fee.toFixed(2)}`,
      labelPct: `~${result.feePercentage.toFixed(3)}%`,
      extra: result,
    };
  }

  return { fee: 0, feePercentage: 0, label: "$0", labelPct: null, extra: {} };
}

export function calculateArbPnlByShares({
  shares,
  sideAPrice,
  sideBPrice,
  platformA,
  platformB,
  referralDiscounts = {},
} = {}) {
  if (!shares || shares <= 0 || !sideAPrice || !sideBPrice) return null;

  const sideACost = shares * sideAPrice;
  const sideBCost = shares * sideBPrice;
  const sideAFeeResult = calcPlatformFee({ platform: platformA, price: sideAPrice, quantity: shares, referralDiscounts });
  const sideBFeeResult = calcPlatformFee({ platform: platformB, price: sideBPrice, quantity: shares, referralDiscounts });
  const sideATotal = sideACost + sideAFeeResult.fee;
  const sideBTotal = sideBCost + sideBFeeResult.fee;
  const totalCost = sideATotal + sideBTotal;
  const toReturn = shares;
  const netPnl = toReturn - totalCost;
  const roi = totalCost > 0 ? (netPnl / totalCost) * 100 : 0;

  return {
    shares,
    sideACost,
    sideBCost,
    sideAFee: sideAFeeResult.fee,
    sideBFee: sideBFeeResult.fee,
    sideAFeePercentage: sideAFeeResult.feePercentage,
    sideBFeePercentage: sideBFeeResult.feePercentage,
    sideAFeeLabel: sideAFeeResult.label,
    sideBFeeLabel: sideBFeeResult.label,
    sideAFeeLabelPct: sideAFeeResult.labelPct,
    sideBFeeLabelPct: sideBFeeResult.labelPct,
    sideAFeeExtra: sideAFeeResult.extra,
    sideBFeeExtra: sideBFeeResult.extra,
    sideATotal,
    sideBTotal,
    totalCost,
    toReturn,
    netPnl,
    roi,
  };
}

export function appendReferralCode(url, platform, enabledReferral = {}) {
  if (!url) return url;

  try {
    const nextUrl = new URL(url);

    if (platform === "opinion" && enabledReferral.opinion) {
      nextUrl.searchParams.set("code", OPINION_REFERRAL_CODE);
    }

    if (platform === "predictfun") {
      return appendPredictFunReferral(nextUrl.toString());
    }

    return nextUrl.toString();
  } catch {
    return url;
  }
}

export function buildReferralDiscounts({ useOpinionReferral = false, usePredictFunReferral = false } = {}) {
  return {
    opinion: useOpinionReferral ? OPINION_REFERRAL_DISCOUNT : 0,
    predictfun: usePredictFunReferral ? PREDICTFUN_REFERRAL_DISCOUNT : 0,
  };
}
