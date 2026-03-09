export const PREDICTFUN_BASE_FEE_RATE = 0.02;
export const PREDICTFUN_REFERRAL_DISCOUNT = 0.1;
export const PREDICTFUN_REFERRAL_CODE = "9DEDB";

function clampProbability(price) {
  const parsed = Number(price);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

function clampDiscount(discount) {
  const parsed = Number(discount);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

export function calculatePredictFunFee({
  price,
  quantity,
  referralDiscount = 0,
  baseFeeRate = PREDICTFUN_BASE_FEE_RATE,
} = {}) {
  const normalizedPrice = clampProbability(price);
  const normalizedQuantity = Math.max(0, Number(quantity) || 0);
  const normalizedDiscount = clampDiscount(referralDiscount);

  const notional = normalizedPrice * normalizedQuantity;
  const rawFee = baseFeeRate * Math.min(normalizedPrice, 1 - normalizedPrice) * normalizedQuantity;
  const fee = rawFee * (1 - normalizedDiscount);
  const feePercentage = notional > 0 ? (fee / notional) * 100 : 0;

  return {
    fee,
    rawFee,
    notional,
    feePercentage,
    baseFeeRate,
    discountMultiplier: 1 - normalizedDiscount,
    isDiscountApplied: normalizedDiscount > 0,
  };
}

export function appendPredictFunReferral(url, referralCode = PREDICTFUN_REFERRAL_CODE) {
  if (!url) return url;

  try {
    const nextUrl = new URL(url);
    nextUrl.searchParams.set("ref", referralCode);
    return nextUrl.toString();
  } catch {
    return url;
  }
}
