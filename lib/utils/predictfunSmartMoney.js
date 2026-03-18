import { getPredictFunDisplayTitleText } from "../predictfunDisplay.js";

function buildPredictFunMarketUrl(categorySlug) {
  return `https://predict.fun/market/${categorySlug}`;
}

export function toMs(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? (value < 1e12 ? value * 1000 : value) : null;
  }
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function parseTokenAmount(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return null;
  return raw > 1 ? raw / 1e18 : raw;
}

export function parsePrice01(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return null;
  return raw > 1 ? raw / 1e18 : raw;
}

export function formatPredictFunTradePrice(price) {
  const n = Number(price);
  if (!Number.isFinite(n)) return "";
  return `${(n * 100).toFixed(1)}c`;
}

export function mapPredictFunQuoteTypeToTradeSide(quoteType) {
  const type = String(quoteType || "").trim().toUpperCase();
  if (type === "BID") return "BUY";
  if (type === "ASK") return "SELL";
  return null;
}

function dedupeRepeatedCategoryPrefix(value) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  if (!normalized) return "";

  const parts = normalized.split(" - ").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3 && parts[0].toLowerCase() === parts[1].toLowerCase()) {
    return [parts[0], ...parts.slice(2)].join(" - ");
  }

  return normalized;
}

export function minAmountToUsdtWei(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  try {
    return `${BigInt(Math.round(amount * 1e6)) * 1000000000000n}`;
  } catch {
    return null;
  }
}

export function buildPredictFunMatchFingerprint(match) {
  const txHash = String(match?.transactionHash || "").trim();
  const marketId = Number(match?.market?.id || 0);
  const outcomeName = String(match?.outcome?.name || match?.taker?.outcome?.name || "").trim();
  const amountFilled = String(match?.amountFilled || "");
  const executedAt = String(match?.executedAt || "");
  return `${txHash}:${marketId}:${outcomeName}:${amountFilled}:${executedAt}`;
}

export function buildPredictFunSmartMoneyDisplayTitle({
  rawTitle,
  question,
  categorySlug,
  categoryTitle,
}) {
  const normalizedRawTitle = dedupeRepeatedCategoryPrefix(rawTitle);
  const normalizedQuestion = String(question || "").trim();
  const normalizedCategoryTitle = dedupeRepeatedCategoryPrefix(categoryTitle);

  if (
    normalizedRawTitle &&
    normalizedCategoryTitle &&
    normalizedRawTitle.toLowerCase().startsWith(`${normalizedCategoryTitle.toLowerCase()} - `)
  ) {
    return normalizedRawTitle;
  }

  const preferCategoryOutcome =
    normalizedRawTitle &&
    normalizedQuestion &&
    normalizedRawTitle.length <= 40 &&
    !normalizedRawTitle.includes("?") &&
    !normalizedRawTitle.startsWith("$") &&
    /[a-z]/i.test(normalizedRawTitle) &&
    normalizedQuestion.toLowerCase().includes(normalizedRawTitle.toLowerCase());

  if (preferCategoryOutcome) {
    return getPredictFunDisplayTitleText({
      title: normalizedRawTitle,
      question: null,
      categorySlug,
      _categoryTitle: categoryTitle,
    });
  }

  const displayTitle = getPredictFunDisplayTitleText({
    title: normalizedRawTitle,
    question,
    categorySlug,
    _categoryTitle: normalizedCategoryTitle,
  });

  return dedupeRepeatedCategoryPrefix(displayTitle || normalizedRawTitle || "Market");
}

export function normalizePredictFunSmartMoneyMatch(match, marketMetaById = new Map()) {
  const marketId = Number(match?.market?.id || 0);
  if (!Number.isFinite(marketId) || marketId <= 0) return null;

  const marketMeta = marketMetaById.get(marketId);
  const ts = toMs(match?.executedAt);
  const shares = parseTokenAmount(match?.amountFilled);
  const price01 = parsePrice01(match?.priceExecuted ?? match?.taker?.price ?? match?.makers?.[0]?.price);
  const amount = Number.isFinite(shares) && Number.isFinite(price01) ? shares * price01 : 0;
  const side = mapPredictFunQuoteTypeToTradeSide(
    match?.taker?.quoteType || match?.makers?.[0]?.quoteType || null
  );
  const signer = match?.taker?.signer || null;
  const categorySlug = match?.market?.categorySlug || marketMeta?.categorySlug || null;

  if (!Number.isFinite(ts) || !Number.isFinite(amount) || amount <= 0) return null;

  const rawTitle = match?.market?.title || marketMeta?.marketTitle || match?.market?.question || null;
  const marketTitle = buildPredictFunSmartMoneyDisplayTitle({
    rawTitle,
    question: match?.market?.question || marketMeta?.marketQuestion || null,
    categorySlug,
    categoryTitle: marketMeta?.categoryTitle || null,
  });

  return {
    platform: "predictfun",
    ts,
    marketId,
    rootMarketId: null,
    side,
    amount,
    price: formatPredictFunTradePrice(price01),
    outcome: match?.outcome?.name || match?.taker?.outcome?.name || null,
    marketTitle,
    txHash: match?.transactionHash || null,
    shares,
    signer,
    marketImageUrl: match?.market?.imageUrl || marketMeta?.marketImageUrl || null,
    categorySlug,
    marketUrl: categorySlug ? buildPredictFunMarketUrl(categorySlug) : null,
  };
}
