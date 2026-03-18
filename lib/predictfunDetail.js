import {
  getPredictFunCategory,
  getPredictFunLastSale,
  getPredictFunMarket,
  getPredictFunOrderbookData,
  getPredictFunStats,
  getPredictFunTokenIds,
  predictFunFetch,
  predictFunMarketUrl,
} from "@/lib/predictfun";
import {
  fetchPredictFunMatchEventLog,
  fetchPredictFunMarketHolders,
  fetchPredictFunAllMatchEvents,
  fetchPredictFunAccountInfo,
  fetchPredictFunAccountPositions,
} from "@/lib/predictfunHiddenGraphql";
import {
  getPredictFunCategoryTitle,
  getPredictFunDisplayTitleText,
} from "@/lib/predictfunDisplay";
import { summarizePredictFunMarketPositions } from "@/lib/utils/predictfunAccountPosition";
import { complementYesPrice } from "@/lib/utils/predictfunOrderbook";

function toMs(value) {
  if (!value) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? (value < 1e12 ? value * 1000 : value) : null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parsePrice01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 1e18 : n;
}

const predictFunAccountInfoCache = new Map();
const ACCOUNT_INFO_CACHE_TTL = 10 * 60 * 1000;

async function getCachedPredictFunAccountInfo(address) {
  if (!address) return null;
  const key = String(address).toLowerCase();
  const cached = predictFunAccountInfoCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < ACCOUNT_INFO_CACHE_TTL) {
    return cached.data;
  }

  try {
    const account = await fetchPredictFunAccountInfo(address);
    predictFunAccountInfoCache.set(key, {
      data: account || null,
      fetchedAt: Date.now(),
    });
    return account || null;
  } catch (err) {
    console.warn(`[PredictFun] Account info enrich failed for ${address}:`, err?.message);
    predictFunAccountInfoCache.set(key, {
      data: null,
      fetchedAt: Date.now(),
    });
    return null;
  }
}

async function enrichTradesWithAccountInfo(trades) {
  const rows = Array.isArray(trades) ? trades : [];
  if (!rows.length) return [];

  const missingAddresses = Array.from(
    new Set(
      rows
        .filter((trade) => trade?.signer && !trade?.accountName)
        .map((trade) => String(trade.signer))
    )
  );

  if (!missingAddresses.length) return rows;

  const results = await Promise.allSettled(
    missingAddresses.map((address) => getCachedPredictFunAccountInfo(address))
  );

  const byAddress = new Map();
  for (let index = 0; index < missingAddresses.length; index += 1) {
    if (results[index]?.status !== "fulfilled") continue;
    const account = results[index].value;
    if (!account) continue;
    byAddress.set(String(missingAddresses[index]).toLowerCase(), account);
  }

  return rows.map((trade) => {
    if (!trade?.signer || trade?.accountName) return trade;
    const account = byAddress.get(String(trade.signer).toLowerCase());
    if (!account) return trade;

    return {
      ...trade,
      accountName: account?.name || trade.accountName || null,
      accountImageUrl: account?.imageUrl || trade.accountImageUrl || null,
      accountImageStatus: account?.imageStatus || trade.accountImageStatus || null,
    };
  });
}

function parseShares(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 1e18 : n;
}

function normalizeOutcomeName(value) {
  const name = String(value || "").trim().toUpperCase();
  if (!name) return null;
  if (name === "YES") return "YES";
  if (name === "NO") return "NO";
  return name;
}

function normalizeTradeSide(quoteType) {
  const type = String(quoteType || "").trim().toUpperCase();
  if (type === "BID") return "BUY";
  if (type === "ASK") return "SELL";
  return null;
}

function getOutcomeName(outcome) {
  const name = String(outcome?.name || outcome?.title || outcome?.slug || "").trim();
  return name || null;
}

function getMarketOutcomeLabels(market) {
  const outcomes = Array.isArray(market?.outcomes) ? market.outcomes : [];
  const labels = outcomes.map(getOutcomeName).filter(Boolean);
  const normalized = labels.map((label) => label.toUpperCase());

  const yesIndex = normalized.indexOf("YES");
  const noIndex = normalized.indexOf("NO");

  if (yesIndex >= 0 || noIndex >= 0) {
    return {
      yesLabel: yesIndex >= 0 ? labels[yesIndex] : "Yes",
      noLabel: noIndex >= 0 ? labels[noIndex] : "No",
    };
  }

  return {
    yesLabel: labels[0] || "Yes",
    noLabel: labels[1] || "No",
  };
}

function getOutcomeSideKey(market, outcomeName) {
  const normalizedName = normalizeOutcomeName(outcomeName);
  if (!normalizedName) return null;
  if (normalizedName === "YES" || normalizedName === "NO") return normalizedName;

  const { yesLabel, noLabel } = getMarketOutcomeLabels(market);
  if (normalizedName === String(yesLabel || "").trim().toUpperCase()) return "YES";
  if (normalizedName === String(noLabel || "").trim().toUpperCase()) return "NO";
  return null;
}

function getOutcomeSideKeyByIndex(market, outcomeIndex) {
  const resolvedIndex = Number(outcomeIndex);
  if (!Number.isFinite(resolvedIndex)) return null;

  const outcomes = Array.isArray(market?.outcomes) ? market.outcomes : [];
  if (outcomes.length >= 2) {
    const firstIndex = Number(outcomes[0]?.index);
    const secondIndex = Number(outcomes[1]?.index);
    if (Number.isFinite(firstIndex) && resolvedIndex === firstIndex) return "YES";
    if (Number.isFinite(secondIndex) && resolvedIndex === secondIndex) return "NO";
  }

  if (resolvedIndex === 0 || resolvedIndex === 1) return "YES";
  if (resolvedIndex === 2) return "NO";
  return null;
}

function normalizeCategoryTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((tag) => {
      if (typeof tag === "string") return tag.trim();
      if (tag && typeof tag === "object") {
        return String(tag.name || tag.title || tag.slug || "").trim();
      }
      return "";
    })
    .filter(Boolean);
}

function enrichMarketWithCategory(market, category) {
  if (!market || !category) return market;
  return {
    ...market,
    _categoryTitle: category?.title || category?.name || market?._categoryTitle || null,
    _categoryEndsAt: category?.endsAt || market?._categoryEndsAt || null,
    _categoryStartsAt: category?.startsAt || market?._categoryStartsAt || null,
    imageUrl: market?.imageUrl || category?.imageUrl || null,
  };
}

function buildSubtitle(displayTitle, categoryTitle) {
  if (!categoryTitle) return null;
  const normalizedDisplay = String(displayTitle || "").trim().toLowerCase();
  const normalizedCategory = String(categoryTitle || "").trim().toLowerCase();
  if (!normalizedCategory || normalizedDisplay === normalizedCategory) {
    return null;
  }
  return categoryTitle;
}

function computeMidPrice(bestBid, bestAsk, lastPrice = null) {
  if (Number.isFinite(bestBid) && bestBid > 0 && Number.isFinite(bestAsk) && bestAsk > 0) {
    return (bestBid + bestAsk) / 2;
  }
  if (Number.isFinite(bestBid) && bestBid > 0) return bestBid;
  if (Number.isFinite(bestAsk) && bestAsk > 0) return bestAsk;
  if (Number.isFinite(lastPrice) && lastPrice > 0) return lastPrice;
  return null;
}

function parseInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

const PF_PUBLIC_MARKET_CACHE = new Map();
const PF_PUBLIC_MARKET_CACHE_TTL = 60_000;

async function fetchPredictFunPublicMarketMeta(categorySlug) {
  if (!categorySlug) return null;

  const cached = PF_PUBLIC_MARKET_CACHE.get(categorySlug);
  if (cached && Date.now() - cached.fetchedAt < PF_PUBLIC_MARKET_CACHE_TTL) {
    return cached.data;
  }

  try {
    const res = await fetch(`https://predict.fun/market/${encodeURIComponent(categorySlug)}`, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "text/html",
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const html = await res.text();
    PF_PUBLIC_MARKET_CACHE.set(categorySlug, {
      fetchedAt: Date.now(),
      data: html,
    });
    return html;
  } catch (err) {
    console.warn(`[PredictFun] Public market HTML fetch failed for ${categorySlug}:`, err?.message);
    PF_PUBLIC_MARKET_CACHE.set(categorySlug, {
      fetchedAt: Date.now(),
      data: null,
    });
    return null;
  }
}

function extractPredictFunHolderMetaFromHtml(html, marketId) {
  if (!html) return null;

  const holdersCountMatch = html.match(/"holdersCount":"(\d+)"/);
  const holdersCount = parseInteger(holdersCountMatch?.[1]);

  const marketRegex = new RegExp(
    String.raw`"id":"${String(marketId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}".*?"outcomes":\{"edges":\[(.*?)\]\},"resolution"`,
    "s"
  );
  const marketMatch = html.match(marketRegex);
  const outcomeBlock = marketMatch?.[1] || "";

  const outcomeCounts = [];
  const outcomeRegex = /"name":"([^"]+)".*?"positions":\{"totalCount":(\d+)\}/g;
  let match = null;
  while ((match = outcomeRegex.exec(outcomeBlock)) !== null) {
    outcomeCounts.push({
      name: match[1],
      holdersCount: parseInteger(match[2]),
    });
  }

  if (!Number.isFinite(holdersCount) && outcomeCounts.length === 0) {
    return null;
  }

  return {
    holdersCount,
    outcomeCounts,
  };
}

function buildSides(market, chances = {}) {
  const tokens = getPredictFunTokenIds(market);
  const labels = getMarketOutcomeLabels(market);
  return [
    {
      key: "YES",
      label: labels.yesLabel,
      tokenId: tokens?.yesTokenId ?? null,
      chance: numberOrNull(chances.yesChance),
    },
    {
      key: "NO",
      label: labels.noLabel,
      tokenId: tokens?.noTokenId ?? null,
      chance: numberOrNull(chances.noChance),
    },
  ];
}

export function buildPredictFunDetailBase({ market, category = null } = {}) {
  if (!market) return null;

  const enrichedMarket = enrichMarketWithCategory(market, category);
  const displayTitle = getPredictFunDisplayTitleText(enrichedMarket);
  const categoryTitle = getPredictFunCategoryTitle(enrichedMarket);
  const outcomeLabels = getMarketOutcomeLabels(market);

  return {
    platform: "predictfun",
    marketId: String(market.id),
    groupId: market.categorySlug ?? null,
    title: market.question || market.title || displayTitle,
    displayTitle,
    subtitle: buildSubtitle(displayTitle, categoryTitle),
    imageUrl: enrichedMarket?.imageUrl || null,
    marketUrl: predictFunMarketUrl(market.id, market.categorySlug),
    rules: market.description || null,
    categoryLabel: categoryTitle || null,
    categoryTags: normalizeCategoryTags(category?.tags),
    marketVariant: market.marketVariant || null,
    startsAtMs: toMs(category?.startsAt),
    endsAtMs: toMs(category?.endsAt),
    volume24hUsd: numberOrNull(market?.stats?.volume24hUsd),
    volumeTotalUsd: numberOrNull(market?.stats?.volumeTotalUsd),
    liquidityUsd: numberOrNull(market?.stats?.totalLiquidityUsd),
    feeRateBps: numberOrNull(market?.feeRateBps),
    isBoosted: market?.isBoosted === true,
    boostStartsAtMs: toMs(market?.boostStartsAt),
    boostEndsAtMs: toMs(market?.boostEndsAt),
    yesLabel: outcomeLabels.yesLabel,
    noLabel: outcomeLabels.noLabel,
    sides: buildSides(market),
    chart: {
      historyEndpoint: `/api/predictfun/market/${market.id}/trades?limit=160`,
      defaultSide: "YES",
    },
    orderbook: {
      endpoint: `/api/predictfun/market/${market.id}/orderbook`,
      supportsDepth: true,
    },
    trades: {
      endpoint: `/api/predictfun/market/${market.id}/trades`,
      supportsLive: false,
    },
    polymarketConditionIds: Array.isArray(market?.polymarketConditionIds)
      ? market.polymarketConditionIds
      : [],
    kalshiMarketTicker: market?.kalshiMarketTicker || null,
    raw: {
      market: enrichedMarket,
      category: category || null,
    },
  };
}

export async function getPredictFunMarketShell(marketId) {
  const market = await getPredictFunMarket(marketId);
  if (!market?.id) return null;
  const category = market.categorySlug ? await getPredictFunCategory(market.categorySlug) : null;
  return buildPredictFunDetailBase({ market, category });
}

/**
 * Fetch sibling markets that share the same categorySlug.
 * Returns lightweight summaries for the related-outcomes dropdown.
 */
export async function getPredictFunSiblings(marketId) {
  const market = await getPredictFunMarket(marketId);
  if (!market?.id || !market.categorySlug) return [];

  const category = await getPredictFunCategory(market.categorySlug);
  let siblingMarkets = [];

  // Category endpoint may include nested markets[]
  if (category && Array.isArray(category.markets) && category.markets.length > 1) {
    siblingMarkets = category.markets.filter(
      (m) => m && m.id && m.isVisible !== false && m.tradingStatus !== "CLOSED" && m.resolution == null
    );
  }

  // Fallback: scan /v1/markets filtered by category
  if (siblingMarkets.length <= 1) {
    try {
      const res = await predictFunFetch("/v1/markets", {
        params: {
          first: "50",
          status: "OPEN",
          includeStats: "true",
          sort: "VOLUME_24H_DESC",
        },
      });
      const all = Array.isArray(res?.data) ? res.data : [];
      siblingMarkets = all.filter(
        (m) => m?.categorySlug === market.categorySlug && m.isVisible !== false && m.resolution == null
      );
    } catch (err) {
      console.warn(`[PredictFun] Siblings fallback scan failed:`, err?.message);
    }
  }

  if (siblingMarkets.length <= 1) return [];

  // Fetch orderbook mid (YES-side), last-sale, and stats for each sibling (parallel)
  const siblings = await Promise.all(
    siblingMarkets.map(async (sibling) => {
      const labels = getMarketOutcomeLabels(sibling);
      let yesPrice = null;
      let vol24h = numberOrNull(sibling?.stats?.volume24hUsd);
      let volTotal = numberOrNull(sibling?.stats?.volumeTotalUsd);

      try {
        const [ob, sale, stats] = await Promise.all([
          getPredictFunOrderbookData(sibling.id, sibling?.decimalPrecision ?? null).catch(() => null),
          getPredictFunLastSale(sibling.id).catch(() => null),
          (!vol24h && !volTotal) ? getPredictFunStats(sibling.id).catch(() => null) : Promise.resolve(null),
        ]);
        // Orderbook mid is the most accurate YES price
        const obMid = computeMidPrice(ob?.bestBid, ob?.bestAsk, null);
        if (Number.isFinite(obMid)) {
          yesPrice = obMid;
        } else if (sale?.priceInCurrency != null) {
          // Fallback: use last-sale, correct for NO-side outcome
          const rawPrice = parsePrice01(sale.priceInCurrency);
          const outcome = normalizeOutcomeName(sale.outcome);
          if (Number.isFinite(rawPrice)) {
            yesPrice = outcome === "NO" ? (1 - rawPrice) : rawPrice;
          }
        }
        if (stats) {
          vol24h = numberOrNull(stats.volume24hUsd) || vol24h;
          volTotal = numberOrNull(stats.volumeTotalUsd) || volTotal;
        }
      } catch { /* ignore */ }

      const displayTitle = getPredictFunDisplayTitleText(
        enrichMarketWithCategory(sibling, category)
      );
      const outcomeName = String(sibling.title || "").trim();

      return {
        marketId: String(sibling.id),
        title: outcomeName || displayTitle,
        displayTitle,
        yesLabel: labels.yesLabel,
        noLabel: labels.noLabel,
        yesPrice,
        volume24hUsd: vol24h,
        volumeTotalUsd: volTotal,
        isCurrent: String(sibling.id) === String(marketId),
      };
    })
  );

  return siblings.sort((a, b) => (b.volumeTotalUsd || 0) - (a.volumeTotalUsd || 0));
}

export async function getPredictFunMarketEnrich(marketId) {
  const market = await getPredictFunMarket(marketId);
  if (!market?.id) return null;

  const [category, stats, lastSale, orderbook, publicMarketHtml] = await Promise.all([
    market.categorySlug ? getPredictFunCategory(market.categorySlug) : Promise.resolve(null),
    getPredictFunStats(marketId).catch(() => null),
    getPredictFunLastSale(marketId).catch(() => null),
    getPredictFunOrderbookData(marketId, market?.decimalPrecision ?? null).catch(() => null),
    market.categorySlug ? fetchPredictFunPublicMarketMeta(market.categorySlug) : Promise.resolve(null),
  ]);

  const lastPrice = numberOrNull(lastSale?.priceInCurrency);
  const midYes = computeMidPrice(orderbook?.bestBid, orderbook?.bestAsk, lastPrice);
  const decimalPrecision = Number.isInteger(market?.decimalPrecision) ? market.decimalPrecision : 2;
  const midNo = Number.isFinite(midYes) ? complementYesPrice(midYes, decimalPrecision) : null;

  const detail = buildPredictFunDetailBase({ market, category });
  if (!detail) return null;
  const holderMeta = extractPredictFunHolderMetaFromHtml(publicMarketHtml, market.id);

  return {
    ...detail,
    rules: market.description || detail.rules || null,
    volume24hUsd: numberOrNull(stats?.volume24hUsd ?? market?.stats?.volume24hUsd),
    volumeTotalUsd: numberOrNull(stats?.volumeTotalUsd ?? market?.stats?.volumeTotalUsd),
    liquidityUsd: numberOrNull(stats?.totalLiquidityUsd ?? market?.stats?.totalLiquidityUsd),
    lastPrice,
    lastOutcome: normalizeOutcomeName(lastSale?.outcome),
    lastOutcomeSide: getOutcomeSideKey(market, lastSale?.outcome),
    bestYesBid: numberOrNull(orderbook?.yes?.bestBid ?? orderbook?.bestBid),
    bestYesAsk: numberOrNull(orderbook?.yes?.bestAsk ?? orderbook?.bestAsk),
    bestNoBid: numberOrNull(orderbook?.no?.bestBid),
    bestNoAsk: numberOrNull(orderbook?.no?.bestAsk),
    orderbookUpdatedAtMs: numberOrNull(orderbook?.yes?.updatedAtMs ?? orderbook?.orderbookUpdatedAtMs),
    holdersCount: holderMeta?.holdersCount ?? null,
    outcomeHolderCounts: Array.isArray(holderMeta?.outcomeCounts) ? holderMeta.outcomeCounts : [],
    sides: buildSides(market, {
      yesChance: midYes,
      noChance: midNo,
    }),
  };
}

function normalizeMatchTrade(match, index, market, decimalPrecision = 2) {
  const rawOutcomeName = match?.taker?.outcome?.name || match?.makers?.[0]?.outcome?.name || null;
  const sideKey = getOutcomeSideKey(market, rawOutcomeName);
  const outcome = normalizeOutcomeName(
    match?.taker?.outcome?.name || match?.makers?.[0]?.outcome?.name || null
  );
  const outcomePrice = parsePrice01(
    match?.priceExecuted ?? match?.taker?.price ?? match?.makers?.[0]?.price
  );
  const shares = parseShares(
    match?.amountFilled ?? match?.taker?.amount ?? match?.makers?.[0]?.amount
  );
  const timestampMs = toMs(match?.executedAt);
  if (!outcome || !Number.isFinite(outcomePrice) || !timestampMs) return null;

  const yesPrice = sideKey === "NO"
    ? complementYesPrice(outcomePrice, decimalPrecision)
    : outcomePrice;
  const noPrice = sideKey === "YES"
    ? complementYesPrice(outcomePrice, decimalPrecision)
    : outcomePrice;

  const { yesLabel, noLabel } = getMarketOutcomeLabels(market);
  const outcomeLabel = sideKey === "NO" ? noLabel : yesLabel;
  const quoteType = String(match?.taker?.quoteType || match?.makers?.[0]?.quoteType || "").trim() || null;
  const account = match?.taker?.account || match?.makers?.[0]?.account || null;

  return {
    id: `${match?.transactionHash || "tx"}:${index}`,
    marketId: String(match?.market?.id || ""),
    timestampMs,
    outcome,
    sideKey,
    outcomeLabel,
    outcomePrice,
    yesPrice,
    noPrice,
    size: shares,
    notionalUsd: Number.isFinite(shares) ? shares * outcomePrice : null,
    quoteType,
    side: normalizeTradeSide(quoteType),
    signer: match?.taker?.signer || match?.makers?.[0]?.signer || null,
    accountName: account?.name || null,
    accountImageUrl: account?.imageUrl || null,
    accountImageStatus: account?.imageStatus || null,
    txHash: match?.transactionHash || null,
    raw: match,
  };
}

function normalizeActivityTrade(event, index, market, decimalPrecision = 2) {
  const rawOutcomeName = event?.outcome?.name || null;
  const sideKey = getOutcomeSideKey(market, rawOutcomeName)
    || getOutcomeSideKeyByIndex(market, event?.outcome?.index);
  const outcome = normalizeOutcomeName(rawOutcomeName);
  const outcomePrice = parsePrice01(event?.priceExecuted);
  const shares = parseShares(event?.amountFilled);
  const timestampMs = toMs(event?.timestamp);
  if (!outcome || !Number.isFinite(outcomePrice) || !timestampMs) return null;

  const yesPrice = sideKey === "NO"
    ? complementYesPrice(outcomePrice, decimalPrecision)
    : outcomePrice;
  const noPrice = sideKey === "YES"
    ? complementYesPrice(outcomePrice, decimalPrecision)
    : outcomePrice;

  const { yesLabel, noLabel } = getMarketOutcomeLabels(market);
  const outcomeLabel = event?.outcome?.name || (sideKey === "NO" ? noLabel : yesLabel);
  const quoteType = String(event?.quoteType || "").trim() || null;
  const account = event?.account || null;

  return {
    id: `${event?.transactionHash || "tx"}:${index}`,
    marketId: String(event?.market?.id || market?.id || ""),
    timestampMs,
    outcome,
    sideKey,
    outcomeLabel,
    outcomePrice,
    yesPrice,
    noPrice,
    size: shares,
    notionalUsd: Number.isFinite(shares) ? shares * outcomePrice : null,
    quoteType,
    side: normalizeTradeSide(quoteType),
    signer: account?.address || null,
    accountName: account?.name || null,
    accountImageUrl: account?.imageUrl || null,
    accountImageStatus: account?.imageStatus || null,
    txHash: event?.transactionHash || null,
    raw: event,
  };
}

function normalizeHolderPosition(position, index = 0) {
  const account = position?.account || null;
  const address = account?.address || null;
  const shares = parseShares(position?.shares);
  if (!address || !Number.isFinite(shares)) return null;

  return {
    id: position?.id || `${address}:${index}`,
    rank: index + 1,
    shares,
    accountAddress: address,
    accountName: account?.name || null,
    accountImageUrl: account?.imageUrl || null,
    accountImageStatus: account?.imageStatus || null,
  };
}

async function enrichTopTradersWithCurrentBalances(traders, marketId) {
  const rows = Array.isArray(traders) ? traders : [];
  if (!rows.length || !marketId) return rows;

  const uniqueAddresses = Array.from(
    new Set(rows.map((trader) => String(trader?.address || "").trim()).filter(Boolean))
  );
  if (!uniqueAddresses.length) return rows;

  const balanceByAddress = new Map();
  const BATCH_SIZE = 25;

  for (let offset = 0; offset < uniqueAddresses.length; offset += BATCH_SIZE) {
    const batch = uniqueAddresses.slice(offset, offset + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((address) =>
        fetchPredictFunAccountPositions({
          walletAddress: address,
          marketId,
          maxPositions: 10,
          pageSize: 10,
          timeoutMs: 4_000,
          retries: 0,
        })
      )
    );

    for (let index = 0; index < batch.length; index += 1) {
      const address = batch[index];
      const addressKey = String(address).toLowerCase();
      const result = results[index];
      if (result?.status !== "fulfilled") {
        console.warn(`[PredictFun] Top trader balance fetch failed for ${address}:`, result?.reason?.message);
        continue;
      }

      balanceByAddress.set(addressKey, {
        known: true,
        positions: Array.isArray(result.value?.positions) ? result.value.positions : [],
      });
    }
  }

  return rows.map((trader) => {
    const address = String(trader?.address || "").toLowerCase();
    const balance = balanceByAddress.get(address);
    if (!balance) {
      return {
        ...trader,
        currentBalanceKnown: false,
      };
    }

    const summary = summarizePredictFunMarketPositions(balance.positions, trader?.outcome);
    return {
      ...trader,
      currentBalanceKnown: true,
      currentYesShares: summary.yesShares,
      currentNoShares: summary.noShares,
      currentShares: summary.displayShares,
      currentSharesOutcome: summary.displayOutcome,
      currentOtherShares: summary.otherShares,
      currentOtherOutcome: summary.otherOutcome,
      currentTotalShares: summary.totalShares,
    };
  });
}

export async function getPredictFunRecentTrades(marketId, { limit = 60, decimalPrecision = null } = {}) {
  if (!marketId) return [];

  const market = await getPredictFunMarket(marketId).catch(() => null);

  try {
    const activity = await fetchPredictFunMatchEventLog({ marketId, limit });
    const activityEdges = Array.isArray(activity?.edges) ? activity.edges : [];
    if (activityEdges.length) {
      const resolvedPrecision =
        Number.isInteger(decimalPrecision) && decimalPrecision >= 0
          ? decimalPrecision
          : Number.isInteger(market?.decimalPrecision)
            ? market.decimalPrecision
            : 2;

      const activityTrades = activityEdges
        .map((edge, index) =>
          normalizeActivityTrade(edge?.node, index, market || edge?.node?.market, resolvedPrecision)
        )
        .filter(Boolean);

      if (activityTrades.length) {
        return enrichTradesWithAccountInfo(activityTrades);
      }
    }
  } catch (err) {
    console.warn(`[PredictFun] GraphQL activity fetch failed for ${marketId}:`, err?.message);
  }

  const res = await predictFunFetch("/v1/orders/matches", {
    params: {
      marketId: String(marketId),
      first: String(limit),
    },
  });

  const matches = Array.isArray(res?.data) ? res.data : [];
  if (!matches.length) return [];

  const resolvedPrecision =
    Number.isInteger(decimalPrecision) && decimalPrecision >= 0
      ? decimalPrecision
      : Number.isInteger(matches[0]?.market?.decimalPrecision)
        ? matches[0].market.decimalPrecision
        : 2;

  const restTrades = matches
    .map((match, index) => normalizeMatchTrade(match, index, market || matches[0]?.market, resolvedPrecision))
    .filter(Boolean);

  return enrichTradesWithAccountInfo(restTrades);
}

export async function getPredictFunMarketHolders(
  marketId,
  { limitPerOutcome = 20, afterCursor = null, outcomeId = null } = {}
) {
  if (!marketId) return [];

  const outcomeEdges = await fetchPredictFunMarketHolders({
    marketId,
    limitPerOutcome,
    afterCursor,
  });
  if (!Array.isArray(outcomeEdges) || !outcomeEdges.length) return [];

  const normalized = outcomeEdges
    .map((edge) => {
      const node = edge?.node || null;
      const positions = node?.positions || null;
      const holders = Array.isArray(positions?.edges)
        ? positions.edges
            .map((positionEdge, index) => normalizeHolderPosition(positionEdge?.node, index))
            .filter(Boolean)
        : [];

      return {
        outcomeId: String(node?.id || ""),
        outcomeIndex: parseInteger(node?.index),
        outcomeName: node?.name || null,
        holdersCount: parseInteger(positions?.totalCount),
        hasNextPage: positions?.pageInfo?.hasNextPage === true,
        endCursor: positions?.pageInfo?.endCursor || null,
        holders,
      };
    })
    .filter((outcome) => outcome.outcomeName || outcome.holders.length > 0)
    .sort((a, b) => {
      const aIndex = Number.isFinite(a?.outcomeIndex) ? a.outcomeIndex : Number.MAX_SAFE_INTEGER;
      const bIndex = Number.isFinite(b?.outcomeIndex) ? b.outcomeIndex : Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    });

  if (!outcomeId) return normalized;
  return normalized.filter((outcome) => String(outcome?.outcomeId || "") === String(outcomeId));
}

/**
 * Aggregate all trades for a market into a top-traders leaderboard.
 * Returns an array sorted by realized PnL descending.
 */
export async function getPredictFunTopTraders(marketId, { maxEvents = 500 } = {}) {
  if (!marketId) return [];

  const market = await getPredictFunMarket(marketId).catch(() => null);
  const decimalPrecision = Number.isInteger(market?.decimalPrecision) ? market.decimalPrecision : 2;

  const allEdges = await fetchPredictFunAllMatchEvents({ marketId, maxEvents });
  if (!allEdges.length) return [];

  // Aggregate by account address
  const accountMap = new Map();

  for (const edge of allEdges) {
    const node = edge?.node;
    if (!node) continue;

    const account = node.account || {};
    const address = account.address;
    if (!address) continue;

    const price = parsePrice01(node.priceExecuted);
    const shares = parseShares(node.amountFilled);
    if (!Number.isFinite(price) || !Number.isFinite(shares) || shares <= 0) continue;

    const quoteType = String(node.quoteType || "").trim().toUpperCase();
    const notionalUsd = shares * price;
    const outcomeName = node.outcome?.name || null;

    let entry = accountMap.get(address);
    if (!entry) {
      entry = {
        address,
        accountName: account.name || null,
        accountImageUrl: account.imageUrl || null,
        boughtUsd: 0,
        boughtShares: 0,
        boughtTxns: 0,
        soldUsd: 0,
        soldShares: 0,
        soldTxns: 0,
        txns: 0,
        outcomeCounts: {},
      };
      accountMap.set(address, entry);
    }

    // Update name/image if newer data has it
    if (!entry.accountName && account.name) entry.accountName = account.name;
    if (!entry.accountImageUrl && account.imageUrl) entry.accountImageUrl = account.imageUrl;

    // Track outcome frequency
    if (outcomeName) {
      entry.outcomeCounts[outcomeName] = (entry.outcomeCounts[outcomeName] || 0) + 1;
    }

    entry.txns += 1;

    if (quoteType === "BID") {
      entry.boughtUsd += notionalUsd;
      entry.boughtShares += shares;
      entry.boughtTxns += 1;
    } else if (quoteType === "ASK") {
      entry.soldUsd += notionalUsd;
      entry.soldShares += shares;
      entry.soldTxns += 1;
    }
  }

  // Build ranked array, sorted by PnL descending
  const traders = Array.from(accountMap.values())
    .map((entry) => {
      // Determine primary outcome (most traded)
      let primaryOutcome = null;
      let maxCount = 0;
      for (const [name, count] of Object.entries(entry.outcomeCounts)) {
        if (count > maxCount) { maxCount = count; primaryOutcome = name; }
      }

      return {
        address: entry.address,
        accountName: entry.accountName,
        accountImageUrl: entry.accountImageUrl,
        boughtUsd: Math.round(entry.boughtUsd * 100) / 100,
        boughtShares: Math.round(entry.boughtShares * 100) / 100,
        boughtTxns: entry.boughtTxns,
        soldUsd: Math.round(entry.soldUsd * 100) / 100,
        soldShares: Math.round(entry.soldShares * 100) / 100,
        soldTxns: entry.soldTxns,
        pnl: Math.round((entry.soldUsd - entry.boughtUsd) * 100) / 100,
        txns: entry.txns,
        outcome: primaryOutcome,
      };
    })
    .sort((a, b) => b.pnl - a.pnl);

  const ranked = traders.map((t, i) => ({ ...t, rank: i + 1 }));
  return enrichTopTradersWithCurrentBalances(ranked, marketId);
}
