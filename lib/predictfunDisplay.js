function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function humanizePredictFunSlug(slug) {
  if (!slug) return "";
  let text = String(slug)
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

  const replacements = [
    [/\bFifa\b/g, "FIFA"],
    [/\bNba\b/g, "NBA"],
    [/\bNfl\b/g, "NFL"],
    [/\bMlb\b/g, "MLB"],
    [/\bMma\b/g, "MMA"],
    [/\bFdv\b/g, "FDV"],
    [/\bEth\b/g, "ETH"],
    [/\bBtc\b/g, "BTC"],
    [/\bSol\b/g, "SOL"],
    [/\bXrp\b/g, "XRP"],
    [/\bEtf\b/g, "ETF"],
  ];

  for (const [pattern, value] of replacements) {
    text = text.replace(pattern, value);
  }

  return text;
}

export function getPredictFunCategoryTitle(market) {
  return normalizeWhitespace(
    market?._categoryTitle || humanizePredictFunSlug(market?.categorySlug) || ""
  );
}

export function getPredictFunDisplayTitleParts(market) {
  const categoryTitle = getPredictFunCategoryTitle(market);
  const outcomeTitle = normalizeWhitespace(market?.title);
  const questionTitle = normalizeWhitespace(market?.question);
  const marketVariant = normalizeWhitespace(market?.marketVariant);

  if (questionTitle && outcomeTitle && questionTitle.includes("___")) {
    const [prefix, suffix = ""] = questionTitle.split("___");
    return {
      plainText: `${prefix}${outcomeTitle}${suffix}`,
      prefix,
      highlight: outcomeTitle,
      suffix,
    };
  }

  if (marketVariant === "TWEET_COUNT" && categoryTitle && outcomeTitle) {
    const baseTitle = categoryTitle.replace(/\?\s*$/, "");
    const match = baseTitle.match(/^Number of (.+?) tweets (.+)$/i);
    if (match) {
      const accountName = match[1];
      const period = match[2];
      const prefix = `Will ${accountName} tweet `;
      const suffix = ` times ${period}?`;
      return {
        plainText: `${prefix}${outcomeTitle}${suffix}`,
        prefix,
        highlight: outcomeTitle,
        suffix,
      };
    }
  }

  if (
    questionTitle &&
    outcomeTitle &&
    questionTitle.length > outcomeTitle.length + 6
  ) {
    const questionLower = questionTitle.toLowerCase();
    const outcomeLower = outcomeTitle.toLowerCase();
    const idx = questionLower.indexOf(outcomeLower);

    if (idx >= 0) {
      const prefix = questionTitle.slice(0, idx);
      const highlight = questionTitle.slice(idx, idx + outcomeTitle.length);
      const suffix = questionTitle.slice(idx + outcomeTitle.length);
      return {
        plainText: questionTitle,
        prefix,
        highlight,
        suffix,
      };
    }
  }

  if (categoryTitle && outcomeTitle && categoryTitle.includes("___")) {
    const [prefix, suffix = ""] = categoryTitle.split("___");
    return {
      plainText: `${prefix}${outcomeTitle}${suffix}`,
      prefix,
      highlight: outcomeTitle,
      suffix,
    };
  }

  const isOutcomeLabel =
    categoryTitle &&
    outcomeTitle &&
    !outcomeTitle.includes("?") &&
    outcomeTitle.length <= 40 &&
    categoryTitle !== outcomeTitle &&
    categoryTitle !== questionTitle;

  if (isOutcomeLabel) {
    return {
      plainText: `${categoryTitle} - ${outcomeTitle}`,
      prefix: `${categoryTitle} - `,
      highlight: outcomeTitle,
      suffix: "",
    };
  }

  return {
    plainText: questionTitle || categoryTitle || outcomeTitle || "Market",
    prefix: "",
    highlight: "",
    suffix: "",
  };
}

export function getPredictFunDisplayTitleText(market) {
  return getPredictFunDisplayTitleParts(market).plainText;
}
