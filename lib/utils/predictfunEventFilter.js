function normalizePredictFunText(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizePredictFunEventKey(value) {
  return normalizePredictFunText(value).replace(/[\s_]+/g, "-");
}

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

  const blob = buildPredictFunSearchBlob(market, category);
  return blob.includes(normalizedKey) || blob.includes(normalizedKey.replace(/-/g, " "));
}
