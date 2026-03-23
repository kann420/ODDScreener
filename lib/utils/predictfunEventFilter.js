function normalizePredictFunText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizePredictFunVariant(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

export function normalizePredictFunEventKey(value) {
  return normalizePredictFunText(value).replace(/[\s_]+/g, "-");
}

export const PREDICTFUN_LIVE_MARKET_VARIANTS = new Set([
  "CRYPTO_UP_DOWN",
  "SPORTS_MATCH",
  "SPORTS_TEAM_MATCH",
  "TWEET_COUNT",
]);

function collectPredictFunTagKeys(source) {
  const tags = Array.isArray(source?.tags)
    ? source.tags
    : Array.isArray(source?.categoryTags)
      ? source.categoryTags
      : [];

  return new Set(
    tags
      .map((tag) => {
        if (typeof tag === "string") return normalizePredictFunText(tag);
        if (tag && typeof tag === "object") {
          return normalizePredictFunText(tag.name || tag.title || tag.slug || tag.id);
        }
        return "";
      })
      .filter(Boolean)
  );
}

function buildPredictFunSearchBlob(market, category = null) {
  return [
    market?.categorySlug,
    market?.title,
    market?.question,
    market?._categoryTitle,
    category?.id,
    category?.slug,
    category?.title,
    category?.name,
    ...(Array.isArray(category?.tags)
      ? category.tags.map((tag) => {
          if (typeof tag === "string") return tag;
          if (tag && typeof tag === "object") return tag.name || tag.title || tag.slug || tag.id || "";
          return "";
        })
      : []),
    ...(Array.isArray(market?.categoryTags)
      ? market.categoryTags.map((tag) => {
          if (typeof tag === "string") return tag;
          if (tag && typeof tag === "object") return tag.name || tag.title || tag.slug || tag.id || "";
          return "";
        })
      : []),
  ]
    .map(normalizePredictFunText)
    .filter(Boolean)
    .join(" | ");
}

export function isPredictFunLiveMarket(market, category = null) {
  const now = Date.now();

  // Category must be OPEN, visible, and one of the live-supported variants.
  const catStatus = normalizePredictFunText(category?.status || market?._categoryStatus);
  const catVisible = category?.isVisible ?? market?._categoryIsVisible ?? null;
  if (catStatus !== "open") return false;
  if (catVisible === false) return false;

  const marketVariant = normalizePredictFunVariant(
    category?.marketVariant || market?.marketVariant || market?._categoryMarketVariant
  );
  if (!PREDICTFUN_LIVE_MARKET_VARIANTS.has(marketVariant)) return false;

  // Must be within the live time window: now >= startsAt && now < endsAt
  const startsAt = category?.startsAt || market?._categoryStartsAt;
  const endsAt = category?.endsAt || market?._categoryEndsAt;
  const startMs = startsAt ? Date.parse(startsAt) : null;
  const endMs = endsAt ? Date.parse(endsAt) : null;
  if (!startMs || now < startMs) return false;
  if (!endMs || now >= endMs) return false;

  // Market must be visible, trading open, and not resolved
  const mktVisible = market?.isVisible ?? true;
  const tradingStatus = normalizePredictFunText(market?.tradingStatus);
  const resolution = market?.resolution ?? null;
  if (mktVisible === false) return false;
  if (tradingStatus && tradingStatus !== "open") return false;
  if (resolution != null) return false;

  return true;
}

export function isPredictFunMarchMadnessMarket(market, category = null) {
  const blob = buildPredictFunSearchBlob(market, category);
  const tagKeys = collectPredictFunTagKeys(category || market);
  const categorySlug = normalizePredictFunText(market?.categorySlug || category?.slug);
  const marketVariant = normalizePredictFunText(market?.marketVariant || category?.marketVariant);
  const isSportsMatchVariant =
    marketVariant === "sports_team_match" || marketVariant === "sports_match";
  const isCbbSlug = categorySlug.startsWith("cbb-");
  const isNcaaSlug = categorySlug.includes("ncaa");

  return (
    blob.includes("march madness") ||
    blob.includes("march-madness") ||
    blob.includes("ncaa basketball") ||
    blob.includes("mens ncaa basketball") ||
    blob.includes("men's ncaa basketball") ||
    blob.includes("ncaam") ||
    blob.includes("ncaa tournament") ||
    blob.includes("college basketball") ||
    (isSportsMatchVariant && (isCbbSlug || isNcaaSlug) && blob.includes("basketball")) ||
    (isSportsMatchVariant && isCbbSlug && blob.includes("vs.")) ||
    tagKeys.has("ncaam") ||
    tagKeys.has("march madness")
  );
}

export function matchesPredictFunEventFilter(market, eventKey, category = null) {
  const normalizedKey = normalizePredictFunEventKey(eventKey);
  if (!normalizedKey) return true;

  if (normalizedKey === "march-madness" || normalizedKey === "marchmadness" || normalizedKey === "ncaam") {
    return isPredictFunMarchMadnessMarket(market, category);
  }

  if (normalizedKey === "live") {
    return isPredictFunLiveMarket(market, category);
  }

  const blob = buildPredictFunSearchBlob(market, category);
  return blob.includes(normalizedKey) || blob.includes(normalizedKey.replace(/-/g, " "));
}
