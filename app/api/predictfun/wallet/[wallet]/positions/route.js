/**
 * API Route: GET /api/predictfun/wallet/[wallet]/positions
 *
 * Fetches current open positions for a wallet from Predict.fun.
 * Uses GraphQL account positions as the primary source because it matches
 * the public website more closely for small residual balances.
 * Returns normalized positions compatible with wallet tracker UI.
 */

import { NextResponse } from "next/server";
import { predictFunFetch, getPredictFunCategory } from "@/lib/predictfun";
import { fetchPredictFunAccountPositions } from "@/lib/predictfunHiddenGraphql";
import {
  buildPredictFunDisplayTitle,
  normalizePredictFunWalletGraphqlPosition,
} from "@/lib/utils/predictfunAccountPosition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isValidWallet(address) {
  if (!address || typeof address !== "string") return false;
  return /^0x[a-fA-F0-9]{40}$/i.test(address);
}

// Category cache for REST fallback enrichment only
const categoryCache = new Map();
const CATEGORY_CACHE_TTL = 10 * 60 * 1000;

async function getCachedCategory(slug) {
  if (!slug) return null;
  const cached = categoryCache.get(slug);
  if (cached && Date.now() - cached.fetchedAt < CATEGORY_CACHE_TTL) return cached.data;
  try {
    const cat = await getPredictFunCategory(slug);
    categoryCache.set(slug, { data: cat, fetchedAt: Date.now() });
    return cat;
  } catch (err) {
    console.warn("[PredictFun Wallet Positions] Category enrich failed:", err?.message);
    return null;
  }
}

async function fetchWalletPositionsFromRest(wallet) {
  const res = await predictFunFetch(`/v1/positions/${wallet}`, {
    timeoutMs: 20000,
    retries: 2,
  });

  if (!res?.success || !Array.isArray(res.data)) {
    return {
      account: null,
      positions: [],
    };
  }

  const rawPositions = res.data;
  const slugSet = new Set();
  for (const pos of rawPositions) {
    if (pos.market?.categorySlug) slugSet.add(pos.market.categorySlug);
  }

  const slugArr = [...slugSet];
  const slugToCategory = {};
  const BATCH = 10;
  for (let i = 0; i < slugArr.length; i += BATCH) {
    const batch = slugArr.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map((slug) => getCachedCategory(slug))
    );
    for (let j = 0; j < batch.length; j += 1) {
      slugToCategory[batch[j]] =
        results[j].status === "fulfilled" ? results[j].value : null;
    }
  }

  const positions = rawPositions
    .filter((pos) => Number(pos.amount) / 1e18 > 0)
    .map((pos) => {
      const market = pos.market || {};
      const outcome = pos.outcome || {};
      const sharesOwned = Number(pos.amount) / 1e18;
      const avgEntryPrice = Number(pos.averageBuyPriceUsd || 0);
      const currentValueInQuoteToken = Number(pos.valueUsd || 0);
      const unrealizedPnl = Number(pos.pnlUsd || 0);
      const currentPrice =
        sharesOwned > 0 ? currentValueInQuoteToken / sharesOwned : avgEntryPrice;

      const categorySlug = market.categorySlug || "";
      const category = slugToCategory[categorySlug] || null;
      const imageUrl = market.imageUrl || category?.imageUrl || null;
      const endsAt = category?.endsAt || null;
      const categoryTitle = category?.title || category?.name || null;

      const outcomeIndex = outcome.index ?? null;
      const outcomeName = outcome.name || (Number(outcomeIndex) === 2 ? "No" : "Yes");
      const isYes = String(outcomeName).trim().toLowerCase() === "yes";
      const marketTitle = market.title || market.question || "";
      const displayTitle = buildPredictFunDisplayTitle(categoryTitle, marketTitle);

      return {
        platform: "predictfun",
        marketId: market.id || pos.marketId || "",
        categorySlug,
        displayTitle,
        marketTitle,
        categoryTitle,
        outcomeName,
        outcome: outcomeName,
        outcomeSide: isYes ? 1 : 2,
        outcomeSideEnum: isYes ? "Yes" : "No",
        thumbnailUrl: imageUrl,
        imageUrl,
        sharesOwned,
        avgEntryPrice,
        currentPrice,
        currentValueInQuoteToken,
        unrealizedPnl,
        unrealizedPnlPercent:
          avgEntryPrice * sharesOwned > 0
            ? (unrealizedPnl / (avgEntryPrice * sharesOwned)) * 100
            : 0,
        endsAt,
        marketUrl: categorySlug ? `https://predict.fun/market/${categorySlug}` : null,
      };
    });

  return {
    account: null,
    positions,
  };
}

export async function GET(request, { params }) {
  try {
    const wallet = (await params).wallet;

    if (!isValidWallet(wallet)) {
      return NextResponse.json(
        { error: "Invalid wallet address" },
        { status: 400 }
      );
    }

    let account = null;
    let positions = [];

    try {
      const gqlResult = await fetchPredictFunAccountPositions({
        walletAddress: wallet,
        maxPositions: 500,
        pageSize: 100,
      });
      account = gqlResult?.account || null;
      positions = (Array.isArray(gqlResult?.positions) ? gqlResult.positions : [])
        .map((node) => normalizePredictFunWalletGraphqlPosition(node))
        .filter(Boolean);
    } catch (err) {
      console.warn("[PredictFun Wallet Positions] GraphQL primary failed:", err?.message);
      const fallback = await fetchWalletPositionsFromRest(wallet);
      account = fallback.account;
      positions = fallback.positions;
    }

    return NextResponse.json({
      success: true,
      positions,
      total: positions.length,
      account,
    });
  } catch (err) {
    console.error("[PredictFun Wallet Positions]", err?.message || err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
