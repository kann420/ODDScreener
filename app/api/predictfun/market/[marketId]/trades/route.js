import { NextResponse } from "next/server";
import { getPredictFunRecentTrades } from "@/lib/predictfunDetail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseLimit(searchParams) {
  const raw = Number(searchParams.get("limit") || 60);
  if (!Number.isFinite(raw)) return 60;
  return Math.min(200, Math.max(10, Math.round(raw)));
}

export async function GET(req, { params }) {
  const { marketId } = params;
  if (!marketId) {
    return NextResponse.json({ error: "missing marketId" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const limit = parseLimit(searchParams);

  try {
    const trades = await getPredictFunRecentTrades(marketId, { limit });
    return NextResponse.json({
      marketId: String(marketId),
      limit,
      trades,
      count: trades.length,
    }, {
      headers: {
        "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30",
      },
    });
  } catch (err) {
    console.error(`[PF Trades] Error for ${marketId}:`, err?.message);
    return NextResponse.json({
      marketId: String(marketId),
      limit,
      trades: [],
      error: err?.message || "predictfun_trades_failed",
    }, { status: 500 });
  }
}
