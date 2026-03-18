/**
 * API Route: GET /api/predictfun/wallet/[wallet]/trades
 *
 * Fetches trade/match history for a wallet from Predict.fun REST API.
 * Also extracts account info (name, imageUrl) from the first matching trade.
 *
 * Query Params:
 * - first: Number of trades to fetch (default: 100, max: 200)
 * - after: Cursor for pagination
 */

import { NextResponse } from "next/server";
import { predictFunFetch, getPredictFunCategory } from "@/lib/predictfun";
import { fetchPredictFunAccountInfo } from "@/lib/predictfunHiddenGraphql";
import {
  normalizePredictFunFee,
  parsePredictFunTradeAmount,
} from "@/lib/utils/predictfunTradeFee";
import {
  buildPredictFunDisplayTitle,
  isPredictFunYesOutcome,
} from "@/lib/utils/predictfunAccountPosition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isValidWallet(address) {
  if (!address || typeof address !== "string") return false;
  return /^0x[a-fA-F0-9]{40}$/i.test(address);
}

// Category cache
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
    console.warn("[PredictFun Wallet Trades] Category enrich failed:", err?.message);
    return null;
  }
}

/**
 * Determine this wallet's side in a match.
 * The wallet can be a maker or taker.
 */
function findSelfLeg(match, walletLower) {
  const makers = match.makers || [];
  const makerSelf = makers.find(
    (m) => String(m.signer || "").toLowerCase() === walletLower
  );
  if (makerSelf) return { leg: makerSelf, role: "maker" };

  const taker = match.taker;
  if (taker && String(taker.signer || "").toLowerCase() === walletLower) {
    return { leg: taker, role: "taker" };
  }

  return { leg: null, role: "unknown" };
}

function mapQuoteTypeToSide(quoteType) {
  if (!quoteType) return "UNKNOWN";
  const qt = String(quoteType).toLowerCase();
  if (qt === "bid") return "BUY";
  if (qt === "ask") return "SELL";
  return "UNKNOWN";
}

export async function GET(request, { params }) {
  try {
    const wallet = (await params).wallet;
    const { searchParams } = new URL(request.url);
    const first = Math.min(200, Math.max(10, Number(searchParams.get("first") || 100)));
    const after = searchParams.get("after") || undefined;

    if (!isValidWallet(wallet)) {
      return NextResponse.json(
        { error: "Invalid wallet address" },
        { status: 400 }
      );
    }

    const walletLower = wallet.toLowerCase();

    // Fetch matches from PredictFun API
    const fetchParams = {
      signerAddress: wallet,
      first: String(first),
    };
    if (after) fetchParams.after = after;

    const res = await predictFunFetch("/v1/orders/matches", {
      params: fetchParams,
      timeoutMs: 20000,
      retries: 2,
    });

    if (!res?.success || !Array.isArray(res.data)) {
      return NextResponse.json({
        success: true,
        trades: [],
        account: null,
        cursor: null,
      });
    }

    const rawMatches = res.data;

    // Extract account info from match legs
    let account = null;

    // Collect unique category slugs
    const slugSet = new Set();
    for (const match of rawMatches) {
      if (match.market?.categorySlug) slugSet.add(match.market.categorySlug);
    }

    // Enrich categories
    const slugArr = [...slugSet];
    const slugToCategory = {};
    const BATCH = 10;
    for (let i = 0; i < slugArr.length; i += BATCH) {
      const batch = slugArr.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map((s) => getCachedCategory(s))
      );
      for (let j = 0; j < batch.length; j++) {
        slugToCategory[batch[j]] =
          results[j].status === "fulfilled" ? results[j].value : null;
      }
    }

    // Normalize trades
    const trades = rawMatches.map((match) => {
      const market = match.market || {};
      const { leg: selfLeg, role } = findSelfLeg(match, walletLower);
      const side = selfLeg
        ? mapQuoteTypeToSide(selfLeg.quoteType)
        : "UNKNOWN";

      // Extract shares and price (both are 18-decimal values upstream)
      const shares = parsePredictFunTradeAmount(selfLeg?.amount || match.amountFilled || 0);
      const price = parsePredictFunTradeAmount(selfLeg?.price || match.priceExecuted || 0);

      const usdAmount = shares * price;

      // Predict.fun fee can be denominated in collateral or shares.
      // Always normalize to USD so downstream wallet stats stay comparable.
      const fee = normalizePredictFunFee({
        fee: selfLeg?.fee ?? null,
        protocolFee: selfLeg?.protocolFee ?? null,
        price,
      });
      const feeType = String(selfLeg?.fee?.type || selfLeg?.protocolFee?.type || "").trim().toUpperCase() || null;

      // Outcome info
      const outcome = selfLeg?.outcome || match.outcome || {};
      const outcomeName = outcome.name || "";
      const outcomeIndex = outcome.index ?? 0;
      const isYes = isPredictFunYesOutcome(outcomeName, outcomeIndex);

      // Category enrichment
      const catSlug = market.categorySlug || "";
      const cat = slugToCategory[catSlug] || null;
      const imageUrl = market.imageUrl || cat?.imageUrl || null;
      const categoryTitle = cat?.title || cat?.name || null;

      const marketTitle = market.title || market.question || "";
      const displayTitle = buildPredictFunDisplayTitle(categoryTitle, marketTitle);

      // Extract account info from self leg
      if (!account && selfLeg?.account) {
        const acc = selfLeg.account;
        if (acc.name || acc.imageUrl) {
          account = {
            address: acc.address || wallet,
            name: acc.name || null,
            imageUrl: acc.imageUrl || null,
            imageStatus: acc.imageStatus || null,
          };
        }
      }
      // Also check taker/makers for account info
      if (!account) {
        const allLegs = [
          match.taker,
          ...(match.makers || []),
        ].filter(Boolean);
        for (const leg of allLegs) {
          if (
            String(leg.signer || "").toLowerCase() === walletLower &&
            leg.account &&
            (leg.account.name || leg.account.imageUrl)
          ) {
            account = {
              address: leg.account.address || wallet,
              name: leg.account.name || null,
              imageUrl: leg.account.imageUrl || null,
              imageStatus: leg.account.imageStatus || null,
            };
            break;
          }
        }
      }

      // Transaction hash
      const txHash = match.transactionHash || null;

      // Timestamp
      const executedAt = match.executedAt
        ? new Date(match.executedAt).getTime()
        : null;
      const createdAt = executedAt ? Math.floor(executedAt / 1000) : null;

      return {
        platform: "predictfun",
        marketId: market.id || "",
        categorySlug: catSlug,
        displayTitle,
        marketTitle,
        categoryTitle,
        thumbnailUrl: imageUrl,
        side,
        role,
        outcome: outcomeName,
        outcomeSide: isYes ? 1 : 2,
        outcomeSideEnum: isYes ? "Yes" : "No",
        shares,
        price,
        usdAmount,
        amount: usdAmount,
        fee,
        feeType,
        txHash,
        createdAt,
        executedAtMs: executedAt,
        marketUrl: catSlug
          ? `https://predict.fun/market/${catSlug}`
          : null,
      };
    });

    // Fallback: if REST didn't provide account info, try GraphQL
    if (!account) {
      try {
        account = await fetchPredictFunAccountInfo(wallet);
      } catch (err) {
        console.warn("[PredictFun Wallet Trades] Account fallback failed:", err?.message);
      }
    }

    return NextResponse.json({
      success: true,
      trades,
      total: trades.length,
      cursor: res.cursor || null,
      account,
    });
  } catch (err) {
    console.error("[PredictFun Wallet Trades]", err?.message || err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
