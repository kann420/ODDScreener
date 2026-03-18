function parsePredictFunAmount(value) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric > 1 ? numeric / 1e18 : numeric;
}

function normalizePredictFunFeeComponent(component, price) {
  if (component == null) return 0;

  if (typeof component === "number" || typeof component === "string") {
    return parsePredictFunAmount(component);
  }

  const feeAmount = parsePredictFunAmount(component?.amount);
  if (feeAmount <= 0) return 0;

  const feeType = String(component?.type || "").trim().toUpperCase();
  if (feeType === "SHARES") {
    return feeAmount * Math.max(0, Number(price) || 0);
  }

  return feeAmount;
}

export function normalizePredictFunFee({ fee = null, protocolFee = null, price = 0 } = {}) {
  return normalizePredictFunFeeComponent(fee, price)
    + normalizePredictFunFeeComponent(protocolFee, price);
}

export function parsePredictFunTradeAmount(value) {
  return parsePredictFunAmount(value);
}
