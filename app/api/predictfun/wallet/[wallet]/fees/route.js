/**
 * API Route: GET /api/predictfun/wallet/[wallet]/fees
 *
 * Calculates the accurate total taker fees paid by a wallet on Predict.fun.
 * Uses Method C: actual taker.fee.amount from match events (ground truth).
 *
 * Paginates through ALL taker matches server-side since maker fees are ~$0.
 * Fee types: COLLATERAL (direct USD) and SHARES (token × price = USD).
 *
 * Returns: { totalFeesPaid, takerFills, makerFills, totalVolume }
 * Results are cached per wallet for 10 minutes.
 */

import { NextResponse } from "next/server";
import { predictFunFetch } from "@/lib/predictfun";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isValidWallet(address) {
  if (!address || typeof address !== "string") return false;
  return /^0x[a-fA-F0-9]{40}$/i.test(address);
}

/** Parse a wei string (18 decimals) → number */
function weiToNum(val) {
  if (val == null) return 0;
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // Values > 1 are almost certainly in wei (18 decimals)
  return n > 1 ? n / 1e18 : n;
}

// In-memory cache: wallet → { data, fetchedAt }
const feeCache = new Map();
const FEE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Paginate through all taker matches and sum fees.
 * Uses isSignerMaker=false to only get taker fills (maker fees are ~$0).
 */
async function computeTakerFees(wallet) {
  let cursor = null;
  let takerFills = 0;
  let totalFeeUsd = 0;
  let totalVolumeUsd = 0;
  const PAGE_SIZE = 200;
  const MAX_PAGES = 200; // safety limit: 200 × 200 = 40k matches max

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = {
      signerAddress: wallet,
      first: String(PAGE_SIZE),
      isSignerMaker: "false",
    };
    if (cursor) params.after = cursor;

    const res = await predictFunFetch("/v1/orders/matches", {
      params,
      timeoutMs: 20000,
      retries: 2,
    });

    if (!res?.success || !Array.isArray(res.data)) break;

    for (const m of res.data) {
      takerFills++;

      const priceExecuted = weiToNum(m.priceExecuted);
      const amountFilled = weiToNum(m.amountFilled);
      const feeAmount = weiToNum(m.taker?.fee?.amount);
      const feeType = String(m.taker?.fee?.type || "").trim().toUpperCase();

      // Method C: actual fee from API
      if (feeType === "SHARES") {
        totalFeeUsd += feeAmount * priceExecuted;
      } else {
        // COLLATERAL or any other type = direct USD
        totalFeeUsd += feeAmount;
      }

      totalVolumeUsd += amountFilled * priceExecuted;
    }

    cursor = res.cursor || null;
    if (!cursor || res.data.length < PAGE_SIZE) break;
  }

  return { totalFeeUsd, takerFills, totalVolumeUsd };
}

/**
 * Quick count of maker matches (no fee summing needed).
 */
async function countMakerFills(wallet) {
  let cursor = null;
  let makerFills = 0;
  const PAGE_SIZE = 200;
  const MAX_PAGES = 200;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = {
      signerAddress: wallet,
      first: String(PAGE_SIZE),
      isSignerMaker: "true",
    };
    if (cursor) params.after = cursor;

    const res = await predictFunFetch("/v1/orders/matches", {
      params,
      timeoutMs: 20000,
      retries: 2,
    });

    if (!res?.success || !Array.isArray(res.data)) break;

    makerFills += res.data.length;

    cursor = res.cursor || null;
    if (!cursor || res.data.length < PAGE_SIZE) break;
  }

  return makerFills;
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

    const walletLower = wallet.toLowerCase();

    // Check cache
    const cached = feeCache.get(walletLower);
    if (cached && Date.now() - cached.fetchedAt < FEE_CACHE_TTL) {
      return NextResponse.json({ success: true, ...cached.data, cached: true });
    }

    // Compute taker fees and maker count in parallel
    const [takerResult, makerFills] = await Promise.all([
      computeTakerFees(wallet),
      countMakerFills(wallet),
    ]);

    const data = {
      totalFeesPaid: Math.round(takerResult.totalFeeUsd * 100) / 100,
      takerFills: takerResult.takerFills,
      makerFills,
      totalTradesCount: takerResult.takerFills + makerFills,
      totalVolume: Math.round(takerResult.totalVolumeUsd * 100) / 100,
    };

    // Cache result
    feeCache.set(walletLower, { data, fetchedAt: Date.now() });

    return NextResponse.json({ success: true, ...data, cached: false });
  } catch (err) {
    console.error("[PredictFun Wallet Fees]", err?.message || err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
