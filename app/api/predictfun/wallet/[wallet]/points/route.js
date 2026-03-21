/**
 * API Route: GET /api/predictfun/wallet/[wallet]/points
 *
 * Fetches weekly points history for a wallet from Predict.fun GraphQL.
 * Returns weeklyPointsHistory and total points.
 */

import { NextResponse } from "next/server";
import { fetchPredictFunAccountInfo } from "@/lib/predictfunHiddenGraphql";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isValidWallet(address) {
  if (!address || typeof address !== "string") return false;
  return /^0x[a-fA-F0-9]{40}$/i.test(address);
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

    const account = await fetchPredictFunAccountInfo(wallet);

    if (!account) {
      return NextResponse.json({
        success: true,
        weeklyPointsHistory: [],
        totalPoints: 0,
      });
    }

    return NextResponse.json({
      success: true,
      weeklyPointsHistory: account.weeklyPointsHistory || [],
      totalPoints: account.points || 0,
      leaderboard: account.leaderboard || null,
    });
  } catch (err) {
    console.error("[PredictFun Wallet Points]", err?.message || err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
