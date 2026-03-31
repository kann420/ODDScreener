import { getPredictFunDisplayTitleText, humanizePredictFunSlug } from "../predictfunDisplay.js";

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function normalizeArbitrageMatchText(text) {
  if (!text) return "";
  return String(text)
    .toLowerCase()
    .replace(/_{2,}/g, " PLACEHOLDER ")
    .replace(/\.{3,}/g, " PLACEHOLDER ")
    .replace(/\.{2}/g, " PLACEHOLDER ")
    .replace(/-{2,}/g, " PLACEHOLDER ")
    .replace(/\u2026/g, " PLACEHOLDER ")
    .replace(/[^\w\s+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractGroupItemFromEventTitle(eventTitle, marketQuestion) {
  if (!eventTitle || !marketQuestion) return null;

  const placeholderMatch = eventTitle.match(/_{2,}|\.{3,}|\u2026/);
  if (!placeholderMatch) {
    const eventNorm = eventTitle.toLowerCase().replace(/[?!]/g, "").trim();
    const marketNorm = marketQuestion.toLowerCase().replace(/[?!]/g, "").trim();
    const evWords = eventNorm.split(/\s+/);
    const mkWords = marketNorm.split(/\s+/);

    if (mkWords.length > evWords.length) {
      for (let i = 0; i < evWords.length; i++) {
        if (evWords[i] !== mkWords[i]) {
          const extra = mkWords.slice(i, i + (mkWords.length - evWords.length));
          return extra.join(" ");
        }
      }
    }
    return null;
  }

  const placeholderIdx = placeholderMatch.index;
  const placeholderLen = placeholderMatch[0].length;
  const prefix = eventTitle.substring(0, placeholderIdx).toLowerCase().trim();
  const suffix = eventTitle.substring(placeholderIdx + placeholderLen).toLowerCase().trim();
  const marketLower = marketQuestion.toLowerCase();
  const prefixIdx = marketLower.indexOf(prefix);
  if (prefixIdx < 0) return null;

  const afterPrefix = prefixIdx + prefix.length;
  const suffixIdx = suffix ? marketLower.indexOf(suffix, afterPrefix) : marketLower.length;
  if (suffixIdx < 0) return null;

  const extracted = marketQuestion.substring(afterPrefix, suffixIdx).trim();
  return extracted || null;
}

export function extractFdvSeriesKey(title, outcome = "") {
  const normalized = normalizeArbitrageMatchText(`${title || ""} ${outcome || ""}`)
    .replace(/\bplaceholder\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized.includes("fdv above")) return null;

  const projectMatch = normalized.match(/^(.*?)\s+fdv\s+above\b/i);
  const project = projectMatch?.[1]?.replace(/\s+/g, " ").trim() || "";

  const thresholdMatch = normalized.match(/\b(\d+(?:\.\d+)?)\s*([kmbt])\b/i);
  const threshold = thresholdMatch
    ? `${thresholdMatch[1]}${thresholdMatch[2].toLowerCase()}`
    : "";

  return { project, threshold };
}

export function hasFdvSeriesMismatch(titleA, titleB, outcomeA = "", outcomeB = "") {
  const left = extractFdvSeriesKey(titleA, outcomeA);
  const right = extractFdvSeriesKey(titleB, outcomeB);
  if (!left || !right) return false;

  if (left.project && right.project && left.project !== right.project) {
    return true;
  }

  if (left.threshold && right.threshold && left.threshold !== right.threshold) {
    return true;
  }

  return false;
}

export function buildPredictFunPseudoEventTitle(groupMarkets, groupKey) {
  const first = groupMarkets?.[0];
  if (!first) return humanizePredictFunSlug(groupKey);

  const categoryTitle = normalizeWhitespace(first._categoryTitle);
  if (categoryTitle) return categoryTitle;

  if (groupMarkets.length === 1) {
    return normalizeWhitespace(
      getPredictFunDisplayTitleText({
        ...first,
        title: first.title ?? "",
        question: first.question ?? "",
        categorySlug: first.categorySlug ?? "",
        _categoryTitle: first._categoryTitle ?? null,
      })
    ) || humanizePredictFunSlug(groupKey);
  }

  return humanizePredictFunSlug(groupKey);
}

export function buildPredictFunPseudoMarket(market, eventTitle = "") {
  const marketId = String(market?.id || market?.marketId || "");
  const rawTitle = normalizeWhitespace(market?.title);
  const displayTitle = normalizeWhitespace(
    getPredictFunDisplayTitleText({
      ...market,
      title: rawTitle || market?.title || "",
      question: market?.question ?? "",
      categorySlug: market?.categorySlug ?? "",
      _categoryTitle: market?._categoryTitle ?? null,
      marketVariant: market?.marketVariant ?? null,
    })
  ) || normalizeWhitespace(market?.question || rawTitle || eventTitle);

  const groupItemTitle = normalizeWhitespace(
    (rawTitle && rawTitle !== displayTitle ? rawTitle : null) ||
      extractGroupItemFromEventTitle(market?.question || market?._categoryTitle || "", displayTitle) ||
      rawTitle
  ) || null;

  const pseudoSlug =
    normalizeWhitespace(market?.slug) ||
    (market?.categorySlug && marketId ? `${market.categorySlug}--${marketId}` : "") ||
    marketId ||
    normalizeWhitespace(market?.categorySlug) ||
    "";

  return {
    question: displayTitle,
    title: displayTitle,
    displayTitle,
    groupItemTitle,
    pseudoSlug,
  };
}
