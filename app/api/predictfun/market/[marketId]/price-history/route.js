import { NextResponse } from "next/server";
import { getPredictFunPriceHistory } from "@/lib/predictfun";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/predictfun/market/[marketId]/price-history
 * Returns market price history for detail/sparkline charts.
 */
export async function GET(req, { params }) {
  const { marketId } = params;
  if (!marketId) {
    return NextResponse.json({ error: "missing marketId" }, { status: 400 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const rawLimit = Math.round(Number(searchParams.get("limit") || 200));
    const limit = Math.min(5000, Math.max(10, rawLimit));
    const points = await getPredictFunPriceHistory(marketId, { limit });

    return NextResponse.json({
      marketId,
      limit,
      points,
      count: points.length,
    });
  } catch (err) {
    console.error(`[PF PriceHistory] Error for ${marketId}:`, err?.message);
    return NextResponse.json({ marketId, points: [], error: err?.message }, { status: 500 });
  }
}
