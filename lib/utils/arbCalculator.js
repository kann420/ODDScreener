import {
  PREDICTFUN_BASE_FEE_RATE,
  PREDICTFUN_REFERRAL_DISCOUNT,
  calculatePredictFunFee,
  appendPredictFunReferral,
} from "./predictfunFee.js";

export const OPINION_REFERRAL_CODE = "8YfTc9";
export const OPINION_REFERRAL_DISCOUNT = 0.1;

const POLYMARKET_FEE_RULES = {
  crypto: { feeRate: 0.072, exponent: 1, label: "crypto" },
  sports: { feeRate: 0.03, exponent: 1, label: "sports" },
  finance: { feeRate: 0.04, exponent: 1, label: "finance" },
  politics: { feeRate: 0.04, exponent: 1, label: "politics" },
  economics: { feeRate: 0.03, exponent: 0.5, label: "economics" },
  culture: { feeRate: 0.05, exponent: 1, label: "culture" },
  weather: { feeRate: 0.025, exponent: 0.5, label: "weather" },
  tech: { feeRate: 0.04, exponent: 1, label: "tech" },
  mentions: { feeRate: 0.25, exponent: 2, label: "mentions" },
  general: { feeRate: 0.2, exponent: 2, label: "general" },
  geopolitics: { feeRate: 0, exponent: 0, label: "geopolitics" },
};

const FEE_TITLE_PLACEHOLDERS = new Set([
  "polymarket",
  "predictfun",
  "predict fun",
  "predict.fun",
  "opinion",
  "probable",
  "unknown market",
  "market",
]);

function normalizeFeeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[/_-]+/g, " ")
    .replace(/\s+/g, " ");
}

const POLYMARKET_MAIN_CATEGORY_ALIASES = {
  cryptocurrency: "crypto",
  sport: "sports",
  sports: "sports",
  soccer: "sports",
  football: "sports",
  basketball: "sports",
  baseball: "sports",
  hockey: "sports",
  tennis: "sports",
  golf: "sports",
  mma: "sports",
  boxing: "sports",
  ufc: "sports",
  f1: "sports",
  finance: "finance",
  politics: "politics",
  election: "politics",
  elections: "politics",
  "current affairs": "politics",
  "us current affairs": "politics",
  "uk politics": "politics",
  "world politics": "politics",
  economics: "economics",
  economic: "economics",
  culture: "culture",
  "pop culture": "culture",
  entertainment: "culture",
  celebrity: "culture",
  movies: "culture",
  movie: "culture",
  film: "culture",
  music: "culture",
  tv: "culture",
  weather: "weather",
  tech: "tech",
  technology: "tech",
  ai: "tech",
  mention: "mentions",
  mentions: "mentions",
  general: "general",
  other: "general",
  "other general": "general",
  geopolitics: "geopolitics",
};

const POLYMARKET_MAIN_CATEGORY_PATTERNS = [
  { key: "geopolitics", pattern: /\b(geopolitic|world politics|war|conflict|treaty|ceasefire)\b/ },
  { key: "crypto", pattern: /\b(crypto|cryptocurrency|bitcoin|btc|ethereum|eth|solana|token|airdrop|market cap|memecoin|defi|coinbase|fdv)\b/ },
  { key: "sports", pattern: /\b(sport|soccer|football|fifa|world cup|nba|nfl|mlb|nhl|uefa|champions league|premier league|mls|ufc|mma|boxing|f1|wimbledon|tennis|golf|baseball|basketball|hockey|cricket|tournament)\b/ },
  { key: "politics", pattern: /\b(politic|election|electoral|senate|congress|parliament|president|prime minister|governor|mayor|government|current affairs|labour|conservative|democrat|republican)\b/ },
  { key: "economics", pattern: /\b(economic|economics|macro|inflation|cpi|fed|interest rate|payroll|jobs report|gdp|recession|unemployment|rates)\b/ },
  { key: "finance", pattern: /\b(finance|financial|stock|stocks|equities|earnings|ipo|treasuries|nasdaq|nyse|dow|s&p|sp500|yield)\b/ },
  { key: "culture", pattern: /\b(culture|pop culture|entertainment|celebrity|movie|movies|film|music|album|tv|oscars|grammys|box office|netflix|hbo)\b/ },
  { key: "weather", pattern: /\b(weather|storm|hurricane|rain|snow|temperature|forecast)\b/ },
  { key: "mentions", pattern: /\b(mention|mentions|followers|social mentions)\b/ },
  { key: "tech", pattern: /\b(tech|technology|ai|openai|anthropic|chatgpt|tesla|nvidia|apple|microsoft|google|meta|software|semiconductor)\b/ },
  { key: "general", pattern: /\b(other|general)\b/ },
];

function classifyPolymarketMainCategory(value) {
  const text = normalizeFeeText(value);
  if (!text) return null;

  if (POLYMARKET_FEE_RULES[text]) {
    return text;
  }

  if (POLYMARKET_MAIN_CATEGORY_ALIASES[text]) {
    return POLYMARKET_MAIN_CATEGORY_ALIASES[text];
  }

  for (const entry of POLYMARKET_MAIN_CATEGORY_PATTERNS) {
    if (entry.pattern.test(text)) {
      return entry.key;
    }
  }

  return null;
}

function isPlaceholderFeeTitle(title) {
  const raw = String(title || "").trim();
  const normalized = normalizeFeeText(raw);
  if (!normalized) return true;
  if (FEE_TITLE_PLACEHOLDERS.has(normalized)) return true;
  if (/^(yes|no)$/.test(normalized)) return true;
  if (/^\$?\d+(?:[.,]\d+)?\s*[kmbt]?$/i.test(raw)) return true;
  if (/^\d+(?:[.,]\d+)?c$/i.test(raw)) return true;
  return false;
}

function scoreFeeTitle(title) {
  const raw = String(title || "").trim();
  if (isPlaceholderFeeTitle(raw)) return -1;

  let score = raw.length;
  if (/\?/.test(raw)) score += 20;
  if (/\bwill\b/i.test(raw)) score += 10;
  if (/\b(19|20)\d{2}\b/.test(raw)) score += 8;
  if (/\b(fifa|world cup|election|fdv|launch|president|prime minister)\b/i.test(raw)) score += 12;
  return score;
}

export function resolveFeeMarketTitle(...candidates) {
  const unique = [];

  for (const candidate of candidates) {
    const raw = String(candidate || "").trim();
    if (!raw) continue;
    if (!unique.includes(raw)) unique.push(raw);
  }

  if (!unique.length) return null;

  const descriptive = unique
    .map((title) => ({ title, score: scoreFeeTitle(title) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score);

  if (descriptive.length > 0) {
    return descriptive[0].title;
  }

  return unique[0];
}

function roundToFour(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function inferPolymarketCategoryFromTitle(title) {
  const directMatch = classifyPolymarketMainCategory(title);
  if (directMatch) return directMatch;

  const text = normalizeFeeText(title);
  if (!text) return null;

  if (/(fdv|bitcoin|btc|ethereum|eth|solana|crypto|token|airdrop|market cap|memecoin|coinbase|betmoar|launch)/.test(text)) {
    return "crypto";
  }
  if (/(starmer|trump|biden|president|prime minister|election|senate|congress|governor|parliament|labour|conservative)/.test(text)) {
    return "politics";
  }
  if (/(fifa|world cup|nba|nfl|mlb|nhl|uefa|champions league|matchup|ufc|f1|wimbledon|tournament|vs\\.? )/.test(text)) {
    return "sports";
  }
  if (/(inflation|cpi|fed|interest rate|payroll|jobs report|gdp|recession)/.test(text)) {
    return "economics";
  }
  if (/(box office|movie|oscars|grammys|celebrity|album|tv show|netflix|hbo)/.test(text)) {
    return "culture";
  }
  if (/(rain|snow|temperature|hurricane|storm|weather)/.test(text)) {
    return "weather";
  }
  if (/(ai|openai|anthropic|chatgpt|tesla|nvidia|apple|microsoft|google|meta)/.test(text)) {
    return "tech";
  }
  return null;
}

function normalizePolymarketCategory(category, sportsMarketType, marketTitle) {
  const normalizedSportsType = normalizeFeeText(sportsMarketType);
  const normalizedCategory = classifyPolymarketMainCategory(category);
  const inferredFromTitle = inferPolymarketCategoryFromTitle(marketTitle);
  const normalizedKey =
    normalizedCategory ||
    (normalizedSportsType ? "sports" : null) ||
    inferredFromTitle ||
    "";

  if (!normalizedKey) {
    return {
      key: normalizedSportsType ? "sports" : "unknown",
      label: normalizedSportsType ? "sports" : "unknown",
      sportsType: normalizedSportsType || null,
    };
  }

  return {
    key: normalizedKey,
    label: normalizedKey,
    sportsType: normalizedSportsType || null,
  };
}

export function calculatePolymarketFee({
  price,
  quantity,
  marketCategory = null,
  feesEnabled = null,
  sportsMarketType = null,
  marketTitle = null,
} = {}) {
  const normalizedPrice = Math.max(0, Math.min(1, Number(price) || 0));
  const normalizedQuantity = Math.max(0, Number(quantity) || 0);
  const notional = normalizedPrice * normalizedQuantity;
  const categoryInfo = normalizePolymarketCategory(marketCategory, sportsMarketType, marketTitle);
  const rule = POLYMARKET_FEE_RULES[categoryInfo.key] || null;
  const shouldApplyFee = Boolean(rule);
  const fee = shouldApplyFee
    ? roundToFour(
        notional * rule.feeRate * Math.pow(normalizedPrice * (1 - normalizedPrice), rule.exponent)
      )
    : 0;
  const feePercentage = notional > 0 ? (fee / notional) * 100 : 0;

  return {
    fee,
    feePercentage,
    notional,
    categoryKey: categoryInfo.key,
    categoryLabel: categoryInfo.label,
    sportsMarketType: categoryInfo.sportsType,
    feesEnabled: feesEnabled ?? null,
    feeRate: rule?.feeRate ?? 0,
    exponent: rule?.exponent ?? null,
    isFeeEnabled: shouldApplyFee,
  };
}

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

export function calcPlatformFee({
  platform,
  price,
  quantity,
  referralDiscounts = {},
  marketCategory = null,
  feesEnabled = null,
  sportsMarketType = null,
  marketTitle = null,
} = {}) {
  if (platform === "polymarket") {
    const result = calculatePolymarketFee({
      price,
      quantity,
      marketCategory,
      feesEnabled,
      sportsMarketType,
      marketTitle,
    });
    return {
      fee: result.fee,
      feePercentage: result.feePercentage,
      label: result.fee > 0 ? `~$${result.fee.toFixed(2)}` : "$0",
      labelPct: result.notional > 0 ? `~${result.feePercentage.toFixed(2)}%` : null,
      categoryLabel: result.categoryLabel !== "unknown" ? result.categoryLabel : null,
      extra: result,
    };
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
      categoryLabel: null,
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
      categoryLabel: null,
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
      categoryLabel: null,
      extra: result,
    };
  }

  return { fee: 0, feePercentage: 0, label: "$0", labelPct: null, categoryLabel: null, extra: {} };
}

export function calculateArbPnlByShares({
  shares,
  sideAPrice,
  sideBPrice,
  platformA,
  platformB,
  referralDiscounts = {},
  sideAMarketCategory = null,
  sideBMarketCategory = null,
  sideAFeesEnabled = null,
  sideBFeesEnabled = null,
  sideASportsMarketType = null,
  sideBSportsMarketType = null,
  sideAMarketTitle = null,
  sideBMarketTitle = null,
} = {}) {
  if (!shares || shares <= 0 || !sideAPrice || !sideBPrice) return null;

  const sideACost = shares * sideAPrice;
  const sideBCost = shares * sideBPrice;
  const sideAFeeResult = calcPlatformFee({
    platform: platformA,
    price: sideAPrice,
    quantity: shares,
    referralDiscounts,
    marketCategory: sideAMarketCategory,
    feesEnabled: sideAFeesEnabled,
    sportsMarketType: sideASportsMarketType,
    marketTitle: sideAMarketTitle,
  });
  const sideBFeeResult = calcPlatformFee({
    platform: platformB,
    price: sideBPrice,
    quantity: shares,
    referralDiscounts,
    marketCategory: sideBMarketCategory,
    feesEnabled: sideBFeesEnabled,
    sportsMarketType: sideBSportsMarketType,
    marketTitle: sideBMarketTitle,
  });
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
    sideAFeeCategoryLabel: sideAFeeResult.categoryLabel,
    sideBFeeCategoryLabel: sideBFeeResult.categoryLabel,
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

/**
 * Build a per-share fee callback for orderbook simulation.
 * Returns (price) => feePerShare at that price level.
 * Assumes referral discounts are applied by default.
 */
export function buildFeePerShareFn(platform, {
  marketCategory = null,
  sportsMarketType = null,
  marketTitle = null,
  referralDiscounts = {
    opinion: OPINION_REFERRAL_DISCOUNT,
    predictfun: PREDICTFUN_REFERRAL_DISCOUNT,
  },
} = {}) {
  if (platform === "polymarket") {
    const categoryInfo = normalizePolymarketCategory(marketCategory, sportsMarketType, marketTitle);
    const rule = POLYMARKET_FEE_RULES[categoryInfo.key] || null;
    if (!rule || rule.feeRate === 0) return () => 0;
    return (price) => {
      const p = Math.max(0, Math.min(1, price));
      return p * rule.feeRate * Math.pow(p * (1 - p), rule.exponent);
    };
  }
  if (platform === "predictfun") {
    const discount = 1 - (referralDiscounts.predictfun ?? 0);
    return (price) => {
      const p = Math.max(0, Math.min(1, price));
      return PREDICTFUN_BASE_FEE_RATE * Math.min(p, 1 - p) * discount;
    };
  }
  if (platform === "opinion") {
    const discount = 1 - (referralDiscounts.opinion ?? 0);
    return (price) => {
      const p = Math.max(0, Math.min(1, price));
      const baseFee = 0.01 * p * (1 - p) * discount;
      return Math.min(baseFee, p * 0.01);
    };
  }
  if (platform === "probable") {
    return (price) => {
      const p = Math.max(0, Math.min(1, price));
      return p * 0.07 * p * (1 - p);
    };
  }
  return () => 0;
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
