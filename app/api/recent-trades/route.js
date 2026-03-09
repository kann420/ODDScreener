import { NextResponse } from "next/server";
import { queryRecentTradesForMarket } from "@/lib/recentTradesDb";
import { enforceIpRateLimit } from "@/lib/apiRouteProtection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req) {
  try {
    const limited = enforceIpRateLimit(
      req,
      "recent-trades",
      { windowMs: 60_000, maxRequests: 60 },
      "Too many recent trade requests. Please slow down."
    );
    if (limited) return limited;

    const { searchParams } = new URL(req.url);
    const marketId = searchParams.get("marketId");

    if (!marketId) {
      return NextResponse.json({ ok: false, error: "missing marketId" }, { status: 400 });
    }

    const trades = queryRecentTradesForMarket({ marketId: Number(marketId) });

    return NextResponse.json({
      ok: true,
      marketId: Number(marketId),
      trades,
    });
  } catch (err) {
    console.error("[API /recent-trades] Error:", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
